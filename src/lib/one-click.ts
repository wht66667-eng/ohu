/**
 * 「三输入一键获取」业务编排（设备侧 WebView）。
 *
 * 链路与 URL 全部来自抓包实证（见 Flutter 版 `campus_contracts.dart`）：
 *   WebVPN 登录 → CAS 登录 → 正方成绩/课表/考试 → 体测两页；
 *   PU / 学习通需要各自登录一次，用可见 WebView 让用户授权，之后才能取数。
 *
 * 约束：
 *  - 密码只在内存里传给页面脚本，不写 localStorage、不进日志、不进错误信息；
 *  - 错误信息只报阶段与状态，不回显密码；
 *  - 任一数据源失败不影响其它源（部分成功）。
 */
import { CAMPUS_BRIDGE_AVAILABLE, CampusBridge, decodeEvalValue, evalText } from './campus-bridge'
import { saveExamsCache, saveGradesCache } from './academic-cache'
import { saveScheduleCache } from './schedule-cache'
import { captureQbankSession, isQbankSessionCurrent } from './qbank'
import { importTiceSummary } from './physical-test-results'
import { parseTiceCurrent, parseTiceHistory, parseTiceHistoryDetailLinks, mergeTicePages } from './tice-parse'
import { parsePuCreditJson, parsePuPageText, puIsEmpty, type PuSummary } from './pocketuni-parse'
import { savePocketUni } from './pocketuni-store'
import { parseZfCourseSelectionHtml, savePublicElectives } from './public-elective'
import { filterCurrentSemester, parseChaoxingCourseHtml, parseChaoxingCourseListHtml, parseChaoxingCourses } from './chaoxing-parse'
import { saveChaoxingCourses } from './chaoxing-store'
import { parseExamPortalRows, parseZfExams, parseZfGrades, parseZfTimetable, type ZfExamRow, type ZfGradeRow } from './zf-html-parse'
import { parseQualityPayload, qualityPersonalFilesBody } from './quality-parse'
import { saveQuality } from './quality-store'

const GATEWAY = 'http://webvpn.jou.edu.cn:58888'
const HEX = {
  zf: '77726476706e69737468656265737421eaf10f96282526557a1dc7af96',
  cas: '77726476706e69737468656265737421f3f652d22d3f7d1e7b0c9ce29b5b',
  tice: '77726476706e69737468656265737421e4fe4299693a6745300d8db9d6562d',
  practice: '77726476706e69737468656265737421e0e5409f33396b55300286b9d65027208df006',
  exam: '77726476706e69737468656265737421f5ef4091693a6745300d8db9d6562d',
  quality: '77726476706e69737468656265737421a5af0fcd7e6226032f46d8f4c9',
} as const

const VPN_LOGIN = `${GATEWAY}/login`
const zfUrl = (path: string) => `${GATEWAY}/https/${HEX.zf}${path}`
const ticeUrl = (path: string) => `${GATEWAY}/http-8080/${HEX.tice}${path}`
const CAS_LOGIN = `${GATEWAY}/https/${HEX.cas}/lyuapServer/login?service=${encodeURIComponent('https://zf.jou.edu.cn/login_cas.aspx')}`
const PORTAL_CAS_LOGIN = `${GATEWAY}/https/${HEX.cas}/lyuapServer/login?service=${encodeURIComponent('http://portal.jou.edu.cn/')}`
const ZF_MAIN = (studentId: string) => zfUrl(`/xs_main.aspx?xh=${encodeURIComponent(studentId)}`)
const ZF_GRADES = (studentId: string, name = '') =>
  zfUrl(`/xscj_gc2.aspx?xh=${encodeURIComponent(studentId)}${name ? `&xm=${encodeURIComponent(name)}` : ''}&gnmkdm=N121619`)
const ZF_TIMETABLE = (studentId: string, name = '') =>
  zfUrl(`/xskbcx.aspx?xh=${encodeURIComponent(studentId)}${name ? `&xm=${encodeURIComponent(name)}` : ''}&gnmkdm=N121603`)
const ZF_EXAMS = (studentId: string) => zfUrl(`/xskscx.aspx?xh=${encodeURIComponent(studentId)}&gnmkdm=N121604`)
const examUrl = (path: string) => `${GATEWAY}/http-80/${HEX.exam}${path}`
const EXAM_ENTRY = (studentId: string) => examUrl(`/einfo.do?status=queryExamShortcut&tsid=${encodeURIComponent(studentId)}`)
const EXAM_LIST = (studentId: string) => examUrl(`/fgquery.do?status=lowquery&tsid=${encodeURIComponent(studentId)}`)
const QUALITY_BASE = `${GATEWAY}/http-7058/${HEX.quality}`
const QUALITY_LOGIN = `${GATEWAY}/http-8011/${HEX.quality}/cas/login`

export type OneClickStage =
  | 'vpn' | 'cas' | 'zf' | 'grades' | 'timetable' | 'exams'
  | 'tice-login' | 'tice' | 'pu-login' | 'pu' | 'chaoxing-login' | 'chaoxing' | 'quality'

export type StageReporter = (stage: OneClickStage, message: string) => void

export type SourceStatus = {
  ok: boolean
  count?: number
  message?: string
}

export class OneClickError extends Error {
  stage: OneClickStage
  constructor(stage: OneClickStage, message: string) {
    super(message)
    this.name = 'OneClickError'
    this.stage = stage
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function waitForUrl(match: (url: string) => boolean, timeoutMs = 25_000, stage: OneClickStage = 'vpn'): Promise<string> {
  const started = Date.now()
  let last = ''
  while (Date.now() - started < timeoutMs) {
    const state = await CampusBridge.currentUrl()
    last = state.url
    if (last && match(last)) return last
    await sleep(400)
  }
  throw new OneClickError(stage, `等待页面跳转超时（当前停留在 ${last || '空白页'}）`)
}

/**
 * 手动验证码 / 手动登录等待：轮询逻辑与 waitForUrl 相同（不改其签名），
 * 但每 10s 用 report 刷新一次剩余时间，让用户知道还要等多久、页面没有卡死。
 */
async function waitForManualLogin(
  match: (url: string) => boolean,
  timeoutMs: number,
  stage: OneClickStage,
  report: StageReporter,
  describe: (remainingSecs: number) => string,
): Promise<string> {
  const started = Date.now()
  let lastReported = -10_000
  let last = ''
  while (Date.now() - started < timeoutMs) {
    const state = await CampusBridge.currentUrl()
    last = state.url
    if (last && match(last)) return last
    const elapsed = Date.now() - started
    if (elapsed - lastReported >= 10_000) {
      lastReported = elapsed
      report(stage, describe(Math.max(0, Math.ceil((timeoutMs - elapsed) / 1000))))
    }
    await sleep(400)
  }
  throw new OneClickError(stage, `等待页面跳转超时（当前停留在 ${last || '空白页'}）`)
}

async function waitReady(timeoutMs = 20_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const state = await evalText("(document.readyState || '') + '|' + (document.body ? document.body.innerText.length : 0)")
      const [ready, length] = state.split('|')
      if (ready === 'complete' && Number(length) > 0) return
    } catch {
      /* WebView 还在加载 */
    }
    await sleep(300)
  }
}

/** 页面里找登录表单并提交；返回 submitted / no-form / no-button。 */
async function fillAndSubmit(studentId: string, password: string, base: string): Promise<string> {
  const rewrites = [
    ['https://cas.jou.edu.cn', `${GATEWAY}/https/${HEX.cas}`],
    ['http://cas.jou.edu.cn', `${GATEWAY}/https/${HEX.cas}`],
    ['https://zf.jou.edu.cn', `${GATEWAY}/https/${HEX.zf}`],
    ['http://zf.jou.edu.cn', `${GATEWAY}/https/${HEX.zf}`],
    ['http://tice.jou.edu.cn:8080', `${GATEWAY}/http-8080/${HEX.tice}`],
    ['https://practice.jou.edu.cn', `${GATEWAY}/https/${HEX.practice}`],
    ['http://practice.jou.edu.cn', `${GATEWAY}/https/${HEX.practice}`],
  ]
  const script = `(function(){
    function visible(el){ return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)); }
    /* 校内页面会把表单 action 写成真实主机；WebView 在校外必须换回 WebVPN 网关地址。 */
    var rewrites = ${JSON.stringify(rewrites)};
    [].slice.call(document.querySelectorAll('form')).forEach(function(form){
      var action = form.getAttribute('action') || '';
      rewrites.forEach(function(pair){
        if (action.indexOf(pair[0]) === 0) action = pair[1] + action.slice(pair[0].length);
      });
      /* 根路径 action 会丢掉 WebVPN 的 /https/<hex>/ 前缀，必须补回当前系统的 base。 */
      if (action.charAt(0) === '/' && action.charAt(1) !== '/') action = ${JSON.stringify(base)} + action;
      form.setAttribute('action', action);
    });
    var pwd = document.querySelector('input[type=password]');
    var user = document.querySelector('#user_name, input[name=username], input[name=user], input[name=uname], input[name=userName], #username');
    if (!pwd || !user) return 'no-form';
    var captcha = document.querySelector('input[name=captcha]');
    if (captcha && visible(captcha)) return 'need-captcha';
    user.value = ${JSON.stringify(studentId)};
    user.dispatchEvent(new Event('input', {bubbles:true}));
    user.dispatchEvent(new Event('change', {bubbles:true}));
    pwd.value = ${JSON.stringify(password)};
    pwd.dispatchEvent(new Event('input', {bubbles:true}));
    pwd.dispatchEvent(new Event('change', {bubbles:true}));
    var btn = document.querySelector('#login, input[name=login], button[type=submit], input[type=submit]');
    if (!btn) {
      btn = [].slice.call(document.querySelectorAll('button, input[type=button], a'))
        .filter(visible)
        .filter(function(el){ return /登录|login/i.test((el.innerText || el.value || '').trim()); })[0];
    }
    if (btn) { btn.click(); return 'submitted'; }
    if (pwd.form) { pwd.form.submit(); return 'submitted'; }
    return 'no-button';
  })()`
  const started = Date.now()
  let last = 'no-form'
  while (Date.now() - started < 10_000) {
    last = await evalText(script)
    if (last === 'submitted' || last === 'no-button' || last === 'need-captcha') return last
    await sleep(400)
  }
  return last
}

function assertBridge() {
  if (!CAMPUS_BRIDGE_AVAILABLE) throw new OneClickError('vpn', '设备侧取数桥不可用，请在 Android App 内使用。')
}

/** 只登录 WebVPN（体测等校内系统只需要这一步）。 */
async function loginVpn(studentId: string, vpnPassword: string, report: StageReporter): Promise<void> {
  report('vpn', '正在登录校园网（WebVPN）…')
  await CampusBridge.open()
  try {
    const { hasSession } = await CampusBridge.hasVpnSession({ url: `${GATEWAY}/` })
    /* 已有 WebVPN 票据时先探测一次：旧票据会整站弹回 /login，不能直接复用。 */
    if (hasSession) {
      await CampusBridge.load({ url: zfUrl('/') })
      await waitReady(8_000)
      const probe = await CampusBridge.currentUrl()
      if (!probe.url.includes('/login')) return
    }
  } catch {
    /* 读不到 cookie 时按未登录处理 */
  }
  await CampusBridge.load({ url: VPN_LOGIN })
  await waitReady()
  const state = await CampusBridge.currentUrl()
  if (!state.url.includes('/login') && !(await hasPasswordField())) {
    /* 已有 WebVPN 会话：/login 会直接跳门户，不再要求填表。 */
    return
  }
  const vpnResult = await fillAndSubmit(studentId, vpnPassword, GATEWAY)
  if (vpnResult === 'no-form') throw new OneClickError('vpn', '没找到校园网登录表单，页面可能已改版。')
  if (vpnResult === 'need-captcha') {
    report('vpn', '校园网登录需要验证码，请在页面上手动完成一次…')
    await CampusBridge.show()
    await waitForManualLogin(
      (url) => !url.includes('/login') && !url.endsWith('/do-login'),
      180_000,
      'vpn',
      report,
      (left) => `请在弹出的页面上完成校园网验证码（剩余 ${left}s）…`,
    ).catch(() => {
      throw new OneClickError('vpn', '手动登录没有完成或超时。')
    })
    await CampusBridge.hide()
  } else {
    await waitForUrl((url) => !url.includes('/login') && !url.endsWith('/do-login'), 25_000, 'vpn').catch(() => {
      throw new OneClickError('vpn', '校园网登录没有跳转，请检查 VPN 密码。')
    })
  }
}

async function resetBridge(): Promise<void> {
  await CampusBridge.close().catch(() => {})
  await CampusBridge.open()
}

/**
 * CAS 登录（抓包实证：先登门户，不是直接登正方）。
 *
 * 酱海带的真实顺序：
 *   1. POST lyuapServer/login?service=http://portal.jou.edu.cn/ （明文 password + lt/execution）
 *   2. 再 GET  lyuapServer/login?service=https://zf.jou.edu.cn/login_cas.aspx
 *      —— 此时 CAS 会话已建立，会直接 302 发票据，不再出现登录表单。
 * 直接拿 zf service 提交会被 CAS 拒绝，这是之前“自动进不去”的根因。
 */
async function submitCasForm(studentId: string, password: string): Promise<string> {
  const base = `${GATEWAY}/https/${HEX.cas}`
  const action = `${base}/lyuapServer/login?service=${encodeURIComponent('http://portal.jou.edu.cn/')}`
  const submit = `(function(){
    var form = document.forms[0];
    var user = document.getElementById('username');
    var pwd = document.getElementById('password');
    if (!form || !user || !pwd) return 'no-form';
    var captcha = document.querySelector('input[name=captcha]');
    if (captcha && captcha.type !== 'hidden' && (captcha.offsetWidth || captcha.offsetHeight)) return 'need-captcha';
    var next = document.createElement('form');
    next.method = 'POST';
    next.action = ${JSON.stringify(action)};
    [].slice.call(form.elements).forEach(function(el){
      if (!el.name) return;
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = el.name;
      input.value = el.name === 'username' ? ${JSON.stringify(studentId)}
        : el.name === 'password' ? ${JSON.stringify(password)}
        : (el.value || '');
      next.appendChild(input);
    });
    (document.body || document.documentElement).appendChild(next);
    next.submit();
    return 'submitted';
  })()`
  const started = Date.now()
  let last = 'no-form'
  while (Date.now() - started < 10_000) {
    last = await evalText(submit)
    if (last !== 'no-form') return last
    await sleep(400)
  }
  return last
}

/** 登录弹窗用：只验证学号 + 校园密码，不读成绩/课表，成功后关闭原生 WebView。 */
export async function verifyCampusIdentity(
  studentId: string,
  vpnPassword: string,
  casPassword: string,
  report: StageReporter,
  options: { zfTicket?: boolean } = {},
): Promise<void> {
  const id = studentId.trim()
  if (!/^\d{6,20}$/.test(id)) throw new Error('请输入正确的学号。')
  if (!casPassword) throw new Error('请输入统一认证密码。')
  await resetBridge()
  try {
    // 首次认证门槛只需建立 WebVPN + CAS 会话；正方票据交换留给「一键获取」阶段，
    // 登录面少等 40–90 秒（zf 段含两次 20s waitReady + 25s 跳转等待）。
    await loginCampus(id, vpnPassword || casPassword, casPassword, report, { zfTicket: options.zfTicket !== false })
  } finally {
    await CampusBridge.close().catch(() => {})
  }
}

/** 登录 WebVPN + CAS；zfTicket=false 时跳过正方票据交换（认证门槛用）。 */
async function loginCampus(studentId: string, vpnPassword: string, casPassword: string, report: StageReporter, options: { zfTicket?: boolean } = {}): Promise<string> {
  await loginVpn(studentId, vpnPassword, report)

  report('cas', '正在登录统一认证（CAS）…')
  await CampusBridge.load({ url: PORTAL_CAS_LOGIN })
  await waitReady()
  let casResult = 'already'
  const casState = await CampusBridge.currentUrl()
  if (casState.url.includes('lyuapServer')) {
    await waitForUrl((url) => url.includes('lyuapServer'), 15_000, 'cas').catch(() => {
      throw new OneClickError('cas', '统一认证页面没有打开。')
    })
    casResult = await submitCasForm(studentId, casPassword)
    if (casResult === 'no-form') {
      /* 页面在我们填写前已经自动跳走 = CAS 会话本来就有效，直接继续。 */
      const settled = await CampusBridge.currentUrl()
      if (settled.url.includes('lyuapServer')) throw new OneClickError('cas', '没找到统一认证登录表单。')
    }
    if (casResult === 'need-captcha') {
      report('cas', '统一认证需要验证码，请在页面上手动完成一次…')
      await CampusBridge.show()
      await waitForManualLogin(
        (url) => !url.includes('lyuapServer'),
        180_000,
        'cas',
        report,
        (left) => `请在弹出的页面上完成统一认证验证码（剩余 ${left}s）…`,
      ).catch(() => {
        throw new OneClickError('cas', '手动登录没有完成或超时。')
      })
      await CampusBridge.hide()
    } else {
      await waitForUrl((url) => !url.includes('lyuapServer'), 30_000, 'cas').catch(() => {
        throw new OneClickError('cas', '统一认证没有通过：请检查密码，或先把账号在浏览器里登录一次。')
      })
    }
  }

  if (options.zfTicket !== false) {
    /* CAS 会话已建立后，再拿 zf 的 service 换票据：服务端会自动 302，无需再填表。 */
    report('zf', '正在进入正方教务…')
    let landedOk = false
    for (let attempt = 0; attempt < 2 && !landedOk; attempt += 1) {
      if (attempt > 0) {
        report('zf', '正方票据没有换到，重建校园会话后重试…')
        await resetBridge()
        await loginVpn(studentId, vpnPassword, () => {})
      }
      await CampusBridge.load({ url: CAS_LOGIN })
      await waitReady(20_000)
      landedOk = await waitForUrl((url) => url.includes('cas_verify') || url.includes('login_cas') || url.includes('xs_main'), 25_000, 'zf')
        .then(() => true)
        .catch(() => false)
    }
    if (!landedOk) throw new OneClickError('zf', '正方会话没有建立：CAS 已登录，但没有换到正方票据，重试后仍失败。')

    /* 抓包实证：login_cas.aspx?ticket=ST-... 页面靠 window.open('xs_main.aspx') 跳转，
       部分 WebView 会拦截这个跳转；这里直接带 Referer 走一次 xs_main。 */
    const afterTicket = await CampusBridge.currentUrl()
    if (!afterTicket.url.includes('xs_main')) {
      await CampusBridge.load({
        url: zfUrl(`/xs_main.aspx?xh=${encodeURIComponent(studentId)}&type=1`),
        headers: { Referer: afterTicket.url },
      })
      await waitReady(20_000)
      await waitForUrl((url) => url.includes('xs_main'), 15_000, 'zf').catch(() => {})
    }

    if (await isZfLoginPage()) {
      throw new OneClickError('zf', '正方回到了登录页：CAS 票据没有换成会话，请重试或手动登录一次。')
    }

    /* 正方链接里可能是 `&amp;xm=`，也可能 URL 编码；两种都要能取到姓名。 */
    const html = await evalText('document.documentElement.outerHTML')
    const match = html.match(/[?&](?:amp;)?xm=([^&"'#]+)/)
    return match ? decodeURIComponent(match[1].replace(/&amp;/g, '&')) : ''
  }

  /* zfTicket=false（首次认证门槛）：只建立 WebVPN + CAS 会话，不换正方票据。 */
  return ''
}

async function loadWithReferer(url: string, referer: string, expect: string) {
  /* 先等上一页完全停稳，避免 loadUrl 被未完成的回发吞掉。 */
  await waitReady(10_000)
  await CampusBridge.load({ url, headers: { Referer: referer } })
  await waitForUrl((current) => current.includes(expect), 25_000, 'zf').catch(() => {})
  await waitReady(20_000)
  await sleep(600)
}

function raceTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ])
}

async function pageHtml(): Promise<string> {
  const outer = await raceTimeout(evalText('document.documentElement.outerHTML'), 8_000, '页面读取超时').catch(() => '')
  if (outer.trim()) return outer
  /* 体测系统是老 frameset，外层 document 可能没有 body；合并所有 frame 的 HTML。 */
  return raceTimeout(evalText("(function(){var s='';for(var i=0;i<window.frames.length;i++){try{s+=window.frames[i].document.documentElement.outerHTML}catch(e){}}return s})()"), 8_000, '页面读取超时').catch(() => '')
}

async function loadAndWait(url: string, expect: string, timeout = 25_000): Promise<void> {
  await raceTimeout(CampusBridge.load({ url }), 10_000, '页面加载超时').catch(() => {})
  await waitForUrl((current) => current.includes(expect), timeout, 'zf').catch(() => {})
  await waitReady(20_000)
}

async function hasElement(selector: string): Promise<boolean> {
  return (await evalText(`document.querySelector(${JSON.stringify(selector)}) ? '1' : '0'`)) === '1'
}

async function hasPasswordField(): Promise<boolean> {
  return (await evalText("document.querySelector('input[type=password]') ? '1' : '0'")) === '1'
}

async function isZfLoginPage(): Promise<boolean> {
  const text = await evalText('document.body ? document.body.innerText.slice(0,500) : ""')
  const loginPage = /请登录|欢迎使用正方教务管理系统|用户名|用户名为/.test(text)
  const userPage = /学生个人课表|成绩查询|考试查询|学籍|我的课表|选课/.test(text)
  return loginPage && !userPage
}

/** 成绩页首屏没有表格，需要点「按学期查询」触发整页回发。 */
async function triggerGradeQuery(allTerms = false): Promise<boolean> {
  const script = `(function(){
    window.alert = function(){};
    [].slice.call(document.querySelectorAll('form')).forEach(function(form){
      var action = form.getAttribute('action') || '';
      if (action.indexOf('https://zf.jou.edu.cn') === 0) action = '${GATEWAY}/https/${HEX.zf}' + action.slice(21);
      if (action.indexOf('http://zf.jou.edu.cn') === 0) action = '${GATEWAY}/https/${HEX.zf}' + action.slice(20);
      if (action.charAt(0) === '/' && action.charAt(1) !== '/') action = '${GATEWAY}/https/${HEX.zf}' + action;
      form.setAttribute('action', action);
    });
    var table = document.getElementById('Datagrid1');
    if (table && table.rows && table.rows.length > 1) return 'ready';
    function pickOption(sel){
      if (!sel) return false;
      for (var i=0;i<sel.options.length;i++){ var v=sel.options[i].value; if (v && v!=='' && v!=='-1'){ sel.selectedIndex=i; break; } }
      sel.dispatchEvent(new Event('change',{bubbles:true})); return true;
    }
    var selects = [].slice.call(document.querySelectorAll('select'));
    var year = selects.filter(function(s){var k=(s.id+' '+s.name).toLowerCase();return k.indexOf('xn')>=0||k.indexOf('year')>=0;})[0];
    var term = selects.filter(function(s){var k=(s.id+' '+s.name).toLowerCase();return k.indexOf('xq')>=0||k.indexOf('term')>=0;})[0];
    if (!term) term = selects.filter(function(s){return s!==year;})[0];
    if (${allTerms ? 'true' : 'false'}) { [year, term].forEach(function(sel){ if (!sel) return; for (var i=0;i<sel.options.length;i++){ if (sel.options[i].value === ''){ sel.selectedIndex=i; sel.dispatchEvent(new Event('change',{bubbles:true})); return; } } }); } else { pickOption(year); pickOption(term); }
    var cands = [].slice.call(document.querySelectorAll('input,button,a'));
    function pick(kw){ return cands.filter(function(e){var l=(e.value||e.innerText||'').replace(/\\s+/g,'');return l.indexOf(kw)>=0;})[0]; }
    var target = ${allTerms ? "pick('在校学习成绩查询')" : 'null'} || pick('按学期查询') || pick('按学年查询') || pick('查询');
    if (!target) return 'no-button';
    target.click();
    return 'submitted';
  })()`
  const result = await evalText(script)
  return result === 'ready'
}

/** 成绩页学年下拉的可选值（去掉「全部」空项与提示项）。 */
export async function listGradeYears(): Promise<string[]> {
  const raw = await evalText(`(function(){
    var selects=[].slice.call(document.querySelectorAll('select'));
    var year=selects.filter(function(s){var k=(s.id+' '+s.name).toLowerCase();return k.indexOf('xn')>=0||k.indexOf('year')>=0;})[0];
    if(!year) return '[]';
    return JSON.stringify([].slice.call(year.options).map(function(o){return String(o.value||'');}).filter(function(v){return v&&v!=='-1';}));
  })()`)
  try {
    const parsed: unknown = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed.map((value) => String(value)) : []
  } catch {
    return []
  }
}

export async function queryGradesByYear(yearValue: string): Promise<void> {
  await queryGradeTerm(yearValue, '')
}

/** 选中「学年 + 学期」后点「按学期查询」触发回发；学期留空表示该学年全部。 */
async function queryGradeTerm(yearValue: string, termValue: string): Promise<void> {
  const script = `(function(){
    window.alert = function(){};
    var selects = [].slice.call(document.querySelectorAll('select'));
    var year = selects.filter(function(s){var k=(s.id+' '+s.name).toLowerCase();return k.indexOf('xn')>=0||k.indexOf('year')>=0;})[0];
    var term = selects.filter(function(s){var k=(s.id+' '+s.name).toLowerCase();return k.indexOf('xq')>=0||k.indexOf('term')>=0;})[0];
    if (year) {
      for (var i=0;i<year.options.length;i++){ if (year.options[i].value === ${JSON.stringify(yearValue)}){ year.selectedIndex=i; break; } }
      year.dispatchEvent(new Event('change',{bubbles:true}));
    }
    if (term) {
      for (var j=0;j<term.options.length;j++){ if (term.options[j].value === ${JSON.stringify(termValue)}){ term.selectedIndex=j; break; } }
      term.dispatchEvent(new Event('change',{bubbles:true}));
    }
    var cands = [].slice.call(document.querySelectorAll('input,button,a'));
    function pick(kw){ return cands.filter(function(e){var l=(e.value||e.innerText||'').replace(/\\s+/g,'');return l.indexOf(kw)>=0;})[0]; }
    var target = pick('按学期查询') || pick('按学年查询') || pick('查询');
    if (target) target.click();
    return 'ok';
  })()`
  await evalText(script)
}

/**
 * 全量成绩：先用「学年/学期都选全部」试一次回发；只返回一个学年时，
 * 退化为逐学年点「按学年查询」，按 学年|学期|课程代码 去重合并。
 */
async function readAllGrades(progress: (msg: string) => void): Promise<ZfGradeRow[]> {
  /* 只查一次：拿到结果立即返回，绝不循环重查。 */
  progress('正在读取成绩…')
  const clicked = await triggerGradeQuery(true)
  if (!clicked) await sleep(1500)
  const started = Date.now()
  while (Date.now() - started < 15_000) {
    const rows = parseZfGrades(await pageHtml())
    if (rows.length) return rows
    await sleep(1000)
  }
  return []
}

export type SchoolSyncResult = {
  studentId: string
  name: string
  grades: SourceStatus
  timetable: SourceStatus
  exams: SourceStatus
}

/**
 * 三输入 → 课表 / 成绩 / 考试。
 * 单项失败只记录该源失败，不中断其它源。
 */
/** 考试已迁到 exam.jou.edu.cn：einfo.do 入口取 tsid，再 fgquery.do 出列表。 */
async function readExamPortal(studentId: string, referer: string): Promise<ZfExamRow[]> {
  await CampusBridge.load({ url: EXAM_ENTRY(studentId), headers: { Referer: referer } })
  await waitReady(15_000)
  await CampusBridge.load({ url: EXAM_LIST(studentId), headers: { Referer: EXAM_ENTRY(studentId) } })
  await waitReady(20_000)
  await sleep(800)
  const raw = await evalText(
    "JSON.stringify([].slice.call(document.querySelectorAll('table')).filter(function(table){var head=table.rows&&table.rows[0]?table.rows[0].innerText||'':'';return /课程|科目/.test(head)&&/日期|时间/.test(head)&&/考场|地点/.test(head)}).map(function(table){return [].slice.call(table.rows).map(function(row){return [].slice.call(row.cells).map(function(cell){return (cell.innerText||'').trim()})})}))",
  )
  if (!raw || raw === 'null') return []
  let parsed: unknown = raw
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { return [] }
  }
  if (!Array.isArray(parsed)) return []
  return (parsed as string[][][]).flatMap((table) => parseExamPortalRows(table))
}
export async function runSchoolSync(input: {
  studentId: string
  vpnPassword: string
  casPassword: string
  report?: StageReporter
}): Promise<SchoolSyncResult> {
  assertBridge()
  const report = input.report ?? (() => {})
  const session = captureQbankSession()
  if (!session.uid) throw new OneClickError('vpn', '请先登录哦狐账号，再同步校园数据。')
  const studentId = input.studentId.trim()
  if (!studentId || !input.vpnPassword || !input.casPassword) {
    throw new OneClickError('vpn', '请填写学号、校园网密码和统一认证密码。')
  }

  await resetBridge()
  const name = await loginCampus(studentId, input.vpnPassword, input.casPassword, report)
  const referer = ZF_MAIN(studentId)
  const result: SchoolSyncResult = {
    studentId, name,
    grades: { ok: false }, timetable: { ok: false }, exams: { ok: false },
  }

  report('grades', '正在读取成绩…')
  try {
    await loadWithReferer(ZF_GRADES(studentId, name), referer, 'xscj_gc2')
    if (await isZfLoginPage()) throw new Error('成绩页回到了登录页（正方会话失效），请重新同步。')
    let grades = await readAllGrades((msg) => report('grades', msg))
    if (!grades.length) {
      /* 正方回发有竞态：第一次可能返回空表，重载页面再读一次。 */
      report('grades', '成绩页为空，重载后重试…')
      await loadWithReferer(ZF_GRADES(studentId, name), referer, 'xscj_gc2')
      await waitReady(15_000)
      await sleep(800)
      grades = await readAllGrades((msg) => report('grades', msg))
    }
    if (!grades.length) throw new Error('页面里没有解析到成绩（可能需要先点查询，或页面已改版）。')
    if (!saveGradesCache(grades, studentId, session)) throw new Error('成绩已读取，但本机保存失败。')
    result.grades = { ok: true, count: grades.length }
  } catch (error) {
    result.grades = { ok: false, message: error instanceof Error ? error.message : '成绩读取失败' }
  }

  report('timetable', '正在读取课表…')
  try {
    await loadWithReferer(ZF_TIMETABLE(studentId, name), referer, 'xskbcx')
    if (!(await CampusBridge.currentUrl()).url.includes('xskbcx')) {
      /* 个别会话下第一次 load 会被上一次回发覆盖，带时间戳重试一次。 */
      await CampusBridge.load({
        url: `${ZF_TIMETABLE(studentId, name)}&_t=${Date.now()}`,
        headers: { Referer: referer },
      })
      await waitForUrl((current) => current.includes('xskbcx'), 20_000, 'zf').catch(() => {})
      await waitReady(20_000)
    }
    if (await isZfLoginPage()) throw new Error('课表页回到了登录页（正方会话失效），请重新同步。')
    if (!(await hasElement('#Table1')) && !(await hasElement('#kbtable'))) {
      /* 有些会话返回 1123 字节的空壳页，URL 仍是 xskbcx；再带时间戳重载一次。 */
      await CampusBridge.load({ url: `${ZF_TIMETABLE(studentId, name)}&_t=${Date.now()}`, headers: { Referer: referer } })
      await waitReady(15_000)
    }
    if (!(await hasElement('#Table1')) && !(await hasElement('#kbtable'))) {
      const probe = await evalText("JSON.stringify({title:document.title,url:location.href,html:document.documentElement.outerHTML.length,text:(document.body?document.body.innerText:'').slice(0,60)})")
      throw new Error(`课表页没有课表容器（${probe}）`)
    }
    const rows = parseZfTimetable(await pageHtml())
    if (!rows.length) throw new Error('课表页没有解析到课程。')
    if (!saveScheduleCache(rows, studentId, session)) throw new Error('课表已读取，但本机保存失败。')
    result.timetable = { ok: true, count: rows.length }
  } catch (error) {
    result.timetable = { ok: false, message: error instanceof Error ? error.message : '课表读取失败' }
  }

  report('exams', '正在读取考试安排…')
  try {
    /* 先走新考试平台；解析不到再退回正方 xskscx。 */
    let exams: ZfExamRow[] = []
    try { exams = await readExamPortal(studentId, referer) } catch { exams = [] }
    if (!exams.length) {
      await loadWithReferer(ZF_EXAMS(studentId), referer, 'xskscx')
      if (await isZfLoginPage()) throw new Error('考试页回到了登录页（正方会话失效），请重新同步。')
      if (!(await hasElement('#Datagrid1'))) throw new Error('考试平台与正方都没有考试表，页面可能已改版。')
      exams = parseZfExams(await pageHtml())
    }
    if (!exams.length) throw new Error('考试平台没有返回可解析的考试安排。')
    if (!saveExamsCache(exams, studentId, session)) throw new Error('考试已读取，但本机保存失败。')
    result.exams = { ok: true, count: exams.length }
  } catch (error) {
    result.exams = { ok: false, message: error instanceof Error ? error.message : '考试读取失败' }
  }

  return result
}

/**
 * 体测：体测系统是独立账号，需要额外一次密码。
 * 登录后依次读「历年表」与「本次明细」，合并落库。
 */
export async function runTiceSync(input: {
  studentId: string
  vpnPassword: string
  ticePassword: string
  report?: StageReporter
  signal?: AbortSignal
}): Promise<SourceStatus> {
  assertBridge()
  const report = input.report ?? (() => {})
  const session = captureQbankSession()
  if (!session.uid) throw new OneClickError('tice-login', '请先登录哦狐账号，再同步体测成绩。')
  const studentId = input.studentId.trim()
  if (!studentId || !input.vpnPassword || !input.ticePassword) {
    throw new OneClickError('tice-login', '请填写学号、校园网密码和体测系统密码。')
  }

  await resetBridge()
  await loginVpn(studentId, input.vpnPassword, report)
  report('tice-login', '正在登录体测系统…')
  /* 进体测前确认 VPN 还在线：票据失效时这里会被弹回 /login，页面长度约 12KB，
     如果不校验就会把 VPN 登录页当成体测成绩页解析成 0 行。 */
  const ensureVpn = async (): Promise<void> => {
    const probe = await CampusBridge.currentUrl()
    if (!probe.url.includes('/login')) return
    report('tice-login', '校园网会话失效，重新登录…')
    await loginVpn(studentId, input.vpnPassword, report)
    const again = await CampusBridge.currentUrl()
    if (again.url.includes('/login')) throw new OneClickError('tice-login', '校园网会话没有恢复：请先完成一次认证再读取体测。')
  }
  await ensureVpn()
  await CampusBridge.load({ url: ticeUrl('/student/studentFrame.jsp') })
  await waitReady(20_000)
  /* 未登录时会被弹回 index.jsp，角色下拉默认「教师用户登录」；
     固定选学生（911），可见页面与手动登录都不再落在教师入口。 */
  await evalText("(function(){var s=document.querySelector('select[name=displayRole]');if(!s)return 'no-role';for(var i=0;i<s.options.length;i++){var student=s.options[i].value==='911';s.options[i].selected=student;s.options[i].defaultSelected=student}if(s.value!=='911')return 'no-student-option';s.dispatchEvent(new Event('change',{bubbles:true}));return 'student'})()")
  /* 抓包实证：体测登录是对 studentFrame.jsp 的表单 POST，
     字段 operType=911 / loginflag=0 / loginType=1 / userName / passwd。
     页面本身是 frameset，直接找按钮并不可靠，这里直接构造同样的表单提交。
     action 固定为学生入口：被弹回 index.jsp 时 location.href 不再是登录地址。 */
  const payload = JSON.stringify({
    operType: '911', loginflag: '0', loginType: '1', userName: studentId, passwd: input.ticePassword,
  })
  const loginScript = `(function(){
    var data = ${payload};
    var form = document.createElement('form');
    form.method = 'POST';
    form.action = ${JSON.stringify(ticeUrl('/student/studentFrame.jsp'))};
    Object.keys(data).forEach(function(key){
      var input = document.createElement('input');
      input.type = 'hidden'; input.name = key; input.value = data[key];
      form.appendChild(input);
    });
    (document.body || document.documentElement).appendChild(form);
    form.submit();
    return 'submitted';
  })()`
  const login = await evalText(loginScript)
  if (login !== 'submitted') throw new OneClickError('tice-login', '体测登录表单没有提交成功。')
  await sleep(2500)
  const afterLogin = await evalText('document.body ? document.body.innerText.slice(0,300) : ""')
  if (/密码错误|登录失败|用户名或密码|不存在/.test(afterLogin)) {
    throw new OneClickError('tice-login', '体测密码不正确，请核对后重试。')
  }

  /* 体测是老 frameset：登录成功的标志是任意 frame 出现「欢迎你回来」。 */
  const ticeLoggedIn = async (): Promise<boolean> => {
    const frames = await evalText("(function(){var s='';for(var i=0;i<window.frames.length;i++){try{s+=window.frames[i].document.body.innerText}catch(e){}}return s})()")
    return frames.includes('欢迎你回来') || frames.includes('学生查询')
  }
  if (!(await ticeLoggedIn())) {
    report('tice-login', '体测登录未生效，重试一次…')
    await evalText(loginScript)
    await sleep(3000)
    if (!(await ticeLoggedIn())) throw new OneClickError('tice-login', '体测登录失败：页面没有进入学生查询，请检查体测密码或稍后重试。')
  }

  const readPage = async (path: string): Promise<string> => {
    input.signal?.throwIfAborted()
    const key = `__ticePage_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const slot = `window[${JSON.stringify(key)}]`
    try {
      await raceTimeout(evalText(`(function(){var state={value:'',controller:new AbortController()};${slot}=state;state.timer=setTimeout(function(){state.controller.abort()},12000);fetch(${JSON.stringify(ticeUrl(path))},{credentials:'include',signal:state.controller.signal}).then(function(r){if(!r.ok)throw new Error('http');return r.text()}).then(function(t){state.value='OK|'+t}).catch(function(){state.value='ERR'}).finally(function(){clearTimeout(state.timer)});return 'started'})()`), 8_000, '体测页面请求超时')
      const started = Date.now()
      while (Date.now() - started < 15_000) {
        input.signal?.throwIfAborted()
        const value = await raceTimeout(evalText(`${slot} ? ${slot}.value : ''`), 8_000, '体测页面读取超时')
        if (value.startsWith('OK|')) return value.slice(3)
        if (value === 'ERR') return ''
        await sleep(300)
      }
      return ''
    } catch {
      input.signal?.throwIfAborted()
      return ''
    } finally {
      await raceTimeout(evalText(`(function(){var s=${slot};if(s){clearTimeout(s.timer);s.controller.abort();delete ${slot}}return 'cleared'})()`), 3_000, '体测请求清理超时').catch(() => {})
    }
  }
  report('tice', '正在读取历年体测汇总…')
  let historyHtml = await readPage('/student/Historyhealth.jsp')
  report('tice', '正在读取当前最新体测明细…')
  let currentHtml = await readPage('/student/queryHealthInfo.jsp')
  let history = parseTiceHistory(historyHtml)
  let current = parseTiceCurrent(currentHtml)
  if (!history.length && !current) {
    /* 部分账号 POST 后还要走一次 left1.jsp 才把体测会话落到 cookie（抓包里的真实顺序）。 */
    const query = `userName=${encodeURIComponent(studentId)}&passwd=${encodeURIComponent(input.ticePassword)}`
    await CampusBridge.load({ url: ticeUrl(`/student/common/left1.jsp?${query}`) })
    await waitReady(15_000)
    await loadAndWait(ticeUrl('/student/Historyhealth.jsp'), 'Historyhealth')
    historyHtml = await pageHtml()
    await loadAndWait(ticeUrl('/student/queryHealthInfo.jsp'), 'queryHealthInfo')
    currentHtml = await pageHtml()
    history = parseTiceHistory(historyHtml)
    current = parseTiceCurrent(currentHtml)
  }
  input.signal?.throwIfAborted()
  if (!history.length && !current) throw new OneClickError('tice', '体测页面没有解析到成绩，原记录已保留，请稍后重试。')

  const unresolved = new Set(history.map((year) => year.year))
  const detailLinks = parseTiceHistoryDetailLinks(historyHtml)
  for (const [index, link] of detailLinks.entries()) {
    input.signal?.throwIfAborted()
    const position = history.findIndex((year) => year.year === link.year)
    if (position < 0) continue
    report('tice', `正在读取 ${link.year} 明细（${index + 1}/${detailLinks.length}）…`)
    const detail = parseTiceCurrent(await readPage(link.path), link.year)
    if (!detail) continue
    const target = history[position]
    history[position] = {
      ...detail,
      total: detail.total !== null && detail.total > 0 ? detail.total : (target.total ?? detail.total),
      grade: detail.grade || target.grade,
    }
    unresolved.delete(link.year)
  }
  const summary = mergeTicePages(history, current)
  if (current && summary.current?.year) unresolved.delete(summary.current.year)
  const warnings = [
    ...(!history.length ? ['历年汇总未读取。'] : []),
    ...(!current ? ['当前最新明细未读取。'] : !summary.current?.year ? ['当前明细已保存，学年待确认；未按手机日期推断。'] : []),
    ...(unresolved.size ? [`${unresolved.size} 个学年的明细未读取，已有明细保留。`] : []),
  ]
  input.signal?.throwIfAborted()
  importTiceSummary(summary, session)
  const years = new Set(history.map((year) => year.year))
  if (current) years.add(summary.current?.year ?? '')
  return { ok: true, count: years.size, ...(warnings.length ? { message: warnings.join('') } : {}) }
}

/** 登录后从 SPA 的 localStorage 取 token/sid，直连 PU 学分接口，避免依赖成绩页 DOM。 */
async function readPocketUniApi(): Promise<PuSummary | null> {
  try {
    const credsRaw = await evalText("(function(){function find(o,d){if(!o||typeof o!=='object'||d>4)return null;if(typeof o.token==='string'&&o.token.length>8&&o.sid!==undefined&&o.sid!==null)return {token:o.token,sid:String(o.sid)};for(var k in o){try{var r=find(o[k],d+1);if(r)return r}catch(e){}}return null}for(var i=0;i<localStorage.length;i++){var key=localStorage.key(i)||'',value=localStorage.getItem(key)||'';if(value.indexOf('token')<0)continue;try{var r=find(JSON.parse(value),0);if(r)return JSON.stringify(r)}catch(e){}}return ''})()")
    if (!credsRaw || credsRaw === 'null') return null
    const creds = JSON.parse(credsRaw) as { token?: string; sid?: string }
    if (!creds.token || !creds.sid) return null
    await evalText(`(function(){window.__pu='';var h={Authorization:'Bearer '+${JSON.stringify(creds.token)}+':'+${JSON.stringify(creds.sid)}};var urls=['https://apis.pocketuni.net/apis/credit/index','https://apis.pocketuni.net/apis/credit/activity','https://apis.pocketuni.net/apis/credit/apply'];Promise.all(urls.map(function(u){return fetch(u,{headers:h,credentials:'include'}).then(function(r){return r.json()}).catch(function(){return null})})).then(function(a){window.__pu=JSON.stringify({index:a[0],activity:a[1],apply:a[2]})}).catch(function(){window.__pu='ERR'})})()`)
    const started = Date.now()
    while (Date.now() - started < 12_000) {
      const raw = await evalText("window.__pu || ''")
      if (raw === 'ERR') return null
      if (raw) {
        const parsed = JSON.parse(raw) as { index?: unknown; activity?: unknown; apply?: unknown }
        const summary = parsePuCreditJson({ index: parsed.index, activity: parsed.activity, apply: parsed.apply })
        return puIsEmpty(summary) ? null : summary
      }
      await sleep(500)
    }
    return null
  } catch {
    return null
  }
}
/** PU 二课：口袋校园是第三方账号，首次需要可见登录一次。 */
export async function runPocketUniSync(input: { account?: string; password?: string; report?: StageReporter; timeoutMs?: number } = {}): Promise<SourceStatus> {
  assertBridge()
  const report = input.report ?? (() => {})
  const timeoutMs = input.timeoutMs ?? 180_000
  await resetBridge()
  /* 先尝试复用已有 PU 登录态/令牌：有 token 就不登录、不弹页面。 */
  await CampusBridge.load({ url: 'https://class.pocketuni.net/' })
  const existingSummary = await readPocketUniApi()
  if (existingSummary) {
    savePocketUni(existingSummary)
    return { ok: true, count: existingSummary.rows.length, message: `总成绩 ${existingSummary.totalCredit ?? '—'}（已有授权）` }
  }

  if (input.account && input.password) {
    /* 有账号密码时在后台自动填表，不弹可见登录页。 */
    report('pu-login', '正在加载口袋校园…')
    await sleep(1200)
    await evalText("(function(){var t=[].slice.call(document.querySelectorAll('div,span,a,button')).filter(function(n){return (n.innerText||'').trim()==='账号登录'})[0];if(t){t.click();return 'clicked'}return 'none'})()")
    await sleep(600)
    const hasPassword = async () =>
      (await evalText("(function(){var list=[].slice.call(document.querySelectorAll('input[type=password]')).filter(function(i){return !!(i.offsetWidth||i.offsetHeight)});return list.length?'1':'0'})()")) === '1'
    const clickVisibleText = async (value: string) =>
      (await evalText(`(function(){var list=[].slice.call(document.querySelectorAll('div,span,a,button,li,p'));var hits=list.filter(function(n){return (n.innerText||'').trim()===${JSON.stringify(value)}&&!!(n.offsetWidth||n.offsetHeight)});if(!hits.length)return 'none';hits[hits.length-1].click();return 'clicked'})()`)).trim()
    /* 登录请求带的是 localStorage.sid；没有学校时服务端会统一报“用户名或密码错误”。
       有的浏览器会记住上次学校，此时登录框直接可见；否则先走一次选择学校。 */
    const schoolReady = async () => {
      const raw = await evalText("(function(){try{var s=localStorage.getItem('sid');return s?String(s):''}catch(e){return ''}})()")
      return raw.trim() !== '' && raw.trim() !== '0'
    }
    if (!(await hasPassword()) || !(await schoolReady())) {
      report('pu-login', '正在选择江苏海洋大学…')
      await clickVisibleText('选择学校')
      const schoolStart = Date.now()
      let typed = 'no-search'
      while (Date.now() - schoolStart < 10_000) {
        typed = await evalText("(function(){var i=[].slice.call(document.querySelectorAll('input')).filter(function(n){return /搜索|学校/.test(n.placeholder||'')&&!!(n.offsetWidth||n.offsetHeight)})[0];if(!i)return 'no-search';var s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(i,'江苏海洋大学');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));i.click();return 'typed'})()")
        if (typed === 'typed') break
        await sleep(500)
      }
      await sleep(1000)
      const pickStart = Date.now()
      let picked = 'no-item'
      while (Date.now() - pickStart < 10_000) {
        picked = await evalText("(function(){var list=[].slice.call(document.querySelectorAll('div,li,span'));var hits=list.filter(function(x){return (x.innerText||'').trim()==='江苏海洋大学'&&!!(x.offsetWidth||x.offsetHeight)});if(!hits.length)return 'no-item';hits[hits.length-1].click();return 'picked'})()")
        if (picked === 'picked') break
        await sleep(500)
      }
      await sleep(800)
      await clickVisibleText('下一步')
      const backStart = Date.now()
      while (Date.now() - backStart < 10_000) {
        if (await hasPassword()) break
        await sleep(500)
      }
      if (!await hasPassword()) throw new OneClickError('pu-login', '选择江苏海洋大学后没有回到登录页，请改用手动登录。')
    }
    const fillScript = `(function(){
      var pwd=document.querySelector('input[type=password]');
      if(!pwd) return 'no-password';
      var scope=pwd.closest('form')||document;
      var user=[].slice.call(scope.querySelectorAll('input')).filter(function(i){return i.type==='text'||i.type==='tel'||i.type==='number'})[0];
      if(!user) return 'no-user';
      user.value=${JSON.stringify(input.account)}; user.dispatchEvent(new Event('input',{bubbles:true})); user.dispatchEvent(new Event('change',{bubbles:true}));
      pwd.value=${JSON.stringify(input.password)}; pwd.dispatchEvent(new Event('input',{bubbles:true})); pwd.dispatchEvent(new Event('change',{bubbles:true}));
      var btn=[].slice.call((pwd.form||scope).querySelectorAll('button')).filter(function(b){return /登录/.test(b.innerText||'')})[0];
      if(btn){btn.click();return 'submitted'}
      if(pwd.form){pwd.form.submit();return 'submitted'}
      return 'no-button';
    })()`
    let filled = 'no-password'
    let clickedTab = false
    const fillStart = Date.now()
    while (Date.now() - fillStart < 18_000) {
      if (!clickedTab && Date.now() - fillStart > 1500) {
        await evalText("(function(){var t=[].slice.call(document.querySelectorAll('div,span,a,button')).filter(function(n){return (n.innerText||'').trim()==='密码登录'})[0];if(t){t.click();return 'clicked'}return 'none'})()")
        clickedTab = true
      }
      filled = await evalText(fillScript)
      if (filled !== 'no-password') break
      report('pu-login', '正在等待口袋校园登录框…')
      await sleep(700)
    }
    if (filled === 'no-password') throw new OneClickError('pu-login', '口袋校园没有出现密码登录框：可能默认是验证码登录，请改用页面登录。')
    if (filled === 'no-user') throw new OneClickError('pu-login', '口袋校园登录页没有账号输入框，可能改版了。')
    if (filled === 'no-button') throw new OneClickError('pu-login', '口袋校园登录页没有登录按钮。')
    report('pu-login', '已提交账号，等待登录结果…')
    const started = Date.now()
    let loggedIn = false
    while (Date.now() - started < 30_000) {
      const text = await evalText('document.body ? document.body.innerText : ""')
      if (/用户名或者密码错误|账号或密码错误|登录失败/.test(text)) {
        throw new OneClickError('pu-login', '口袋校园账号或密码不正确（只尝试了 1 次，避免锁号）。请核对密码；如果确认无误，可先到口袋校园网页选择「江苏海洋大学」登录一次再回来。')
      }
      if (text.includes('我的成绩') || text.includes('成绩明细') || text.includes('总成绩')) { loggedIn = true; break }
      const visiblePassword = await evalText("(function(){var list=[].slice.call(document.querySelectorAll('input[type=password]')).filter(function(i){return !!(i.offsetWidth||i.offsetHeight)});return list.length ? '1' : '0'})()")
      const current = (await CampusBridge.currentUrl()).url
      if (visiblePassword === '0' && !/login/i.test(current) && text.trim().length > 20) { loggedIn = true; break }
      await sleep(1000)
    }
    if (!loggedIn) {
      const pageText = await evalText('document.body ? document.body.innerText : ""')
      report('pu-login', '自动登录未成功，请在打开的页面手动登录一次…')
      await CampusBridge.show()
      const manualStart = Date.now()
      while (Date.now() - manualStart < 120_000) {
        const state = await CampusBridge.currentUrl()
        if (!state.visible) throw new OneClickError('pu-login', '已取消口袋校园授权。')
        const text = await evalText('document.body ? document.body.innerText : ""')
        if (text.includes('我的成绩') || text.includes('成绩明细') || text.includes('总成绩')) { loggedIn = true; break }
        const visiblePassword = await evalText("(function(){var list=[].slice.call(document.querySelectorAll('input[type=password]')).filter(function(i){return !!(i.offsetWidth||i.offsetHeight)});return list.length ? '1' : '0'})()")
        if (visiblePassword === '0' && !/login/i.test(state.url) && text.trim().length > 20) { loggedIn = true; break }
        await sleep(1200)
      }
      await CampusBridge.hide()
      if (!loggedIn) throw new OneClickError('pu-login', `口袋校园没有登录成功（页面提示：${pageText.replace(/\s+/g, ' ').slice(0, 100) || '无'}）`)
    }
    report('pu', '登录成功，正在进入成绩页…')
  } else {
    report('pu-login', '请在打开的页面里登录口袋校园…')
    await CampusBridge.show()
    await CampusBridge.load({ url: 'https://class.pocketuni.net/' })
    await waitReady(10_000)
    const started = Date.now()
    let loggedIn = false
    while (Date.now() - started < timeoutMs) {
      const state = await CampusBridge.currentUrl()
      if (!state.visible) throw new OneClickError('pu-login', '已取消口袋校园授权。')
      const text = await evalText('document.body ? document.body.innerText : ""')
      if (text.includes('我的成绩') || text.includes('成绩明细') || text.includes('总成绩')) { loggedIn = true; break }
      await sleep(1200)
    }
    if (!loggedIn) {
      await CampusBridge.hide()
      throw new OneClickError('pu-login', '没有检测到口袋校园登录态，已停止。')
    }
  }

  report('pu', '正在读取 PU 学分接口…')
  const apiSummary = await readPocketUniApi()
  if (apiSummary) {
    savePocketUni(apiSummary)
    return { ok: true, count: apiSummary.rows.length, message: `总成绩 ${apiSummary.totalCredit ?? '—'}（接口）` }
  }
  report('pu', '接口不可用，正在读取成绩页文字…')
  await evalText("location.hash = '#/score/detail'; 'ok'")
  await sleep(2500)
  let text = await evalText('document.body ? document.body.innerText : ""')
  if (!text.includes('【')) {
    await evalText(`(function(){
      var nodes=[].slice.call(document.querySelectorAll('div,span,a'));
      var t=nodes.filter(function(n){return (n.innerText||'').trim()==='成绩明细';})[0];
      if(t){t.click();return 'clicked';} return 'none';
    })()`)
    await sleep(2000)
    text = await evalText('document.body ? document.body.innerText : ""')
  }
  await CampusBridge.hide()
  const summary = parsePuPageText(text)
  if (puIsEmpty(summary)) throw new OneClickError('pu', '没有读到 PU 学分（可能停在成绩单 canvas 页）。')
  savePocketUni(summary)
  return { ok: true, count: summary.rows.length }
}
/** 解除 PU 授权：清掉口袋校园 SPA 里的 token/sid 键，保留学校 VPN 会话。 */
export async function clearPocketUniAuth(): Promise<void> {
  assertBridge()
  await CampusBridge.load({ url: 'https://class.pocketuni.net/' })
  await waitReady(10_000)
  await evalText("(function(){var n=0;for(var i=localStorage.length-1;i>=0;i--){var k=localStorage.key(i)||'';var v=localStorage.getItem(k)||'';if(/token|sid/i.test(k)||/\"token\"/.test(v)){localStorage.removeItem(k);n++}}return n})()")
  await CampusBridge.close().catch(() => {})
}
/** 学习通 CAS SSO：复用统一认证会话，不需要学习通密码。 */
const CHAOXING_HOME_HEX = 'faf854d22a382653760986b4915b247b99808d'
async function waitForChaoxingHome(timeoutMs = 30_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const state = await CampusBridge.currentUrl()
    if (state.url.includes(CHAOXING_HOME_HEX)) return
    await sleep(800)
  }
  throw new OneClickError('chaoxing', '统一认证已通过，但学习通门户没有在限定时间内打开。')
}
const CHAOXING_SSO_URL = 'http://webvpn.jou.edu.cn:58888/http/77726476706e69737468656265737421f8ff48883423671e780987b5991b203d9a17c842c1baabc10f20/sso/hhit'
const CHAOXING_COURSE_URL = 'http://webvpn.jou.edu.cn:58888/https/77726476706e69737468656265737421f6ee429332227b55300e88a281546d36c83a42e014090b3692b99d/fyportal/courselist/getStudyCourse?sectionId=0&semesterNum&coursesource=0&coursename&searchkkstatus=0&belongSchoolId=0'

export async function runChaoxingSsoSync(input: { studentId: string; vpnPassword: string; casPassword: string; report?: StageReporter }): Promise<SourceStatus> {
  assertBridge()
  const report = input.report ?? (() => {})
  const session = captureQbankSession()
  if (!session.uid) throw new OneClickError('chaoxing-login', '请先登录哦狐，再同步学习通课程。')
  await loginCampus(input.studentId, input.vpnPassword, input.casPassword, report)
  report('chaoxing', '正在用统一认证登录学习通…')
  await CampusBridge.load({ url: CHAOXING_SSO_URL })
  await waitForChaoxingHome()
  report('chaoxing', '正在读取学习通课程…')
  await CampusBridge.load({ url: CHAOXING_COURSE_URL })
  await sleep(3500)
  const html = await pageHtml()
  const allCourses = parseChaoxingCourseListHtml(html)
  if (!allCourses.length) throw new OneClickError('chaoxing', '未能读取课程列表，已保留原记录。请在学习通页面登录后重试。')
  const courses = filterCurrentSemester(allCourses)
  saveChaoxingCourses(courses, session)
  return { ok: true, count: courses.length }
}
/** 学习通 Cookie 导入：浏览器登录后复制 uid/_uid/fid/vc3，直接读课程列表（chaoxing-mcp 同款兜底）。 */
export async function runChaoxingCookieSync(input: { cookie: string; report?: StageReporter }): Promise<SourceStatus> {
  assertBridge()
  const session = captureQbankSession()
  if (!session.uid) throw new OneClickError('chaoxing-login', '请先登录哦狐，再同步学习通课程。')
  const cookie = input.cookie.trim().replace(/^cookie:\s*/i, '')
  if (!cookie) throw new OneClickError('chaoxing-login', '请先粘贴学习通 Cookie。')
  const report = input.report ?? (() => {})
  await resetBridge()
  report('chaoxing-login', '正在导入学习通 Cookie…')
  const hosts = ['https://chaoxing.com', 'https://mooc1.chaoxing.com', 'https://mooc2-ans.chaoxing.com', 'https://i.chaoxing.com', 'https://passport2.chaoxing.com', 'https://v8.chaoxing.com']
  for (const url of hosts) await CampusBridge.setCookie({ url, cookie })
  report('chaoxing', '正在读取课程列表…')
  let courses: ReturnType<typeof parseChaoxingCourses> = []
  for (const url of ['https://mooc1.chaoxing.com/visit/courselistdata', 'https://mooc2-ans.chaoxing.com/mooc2-ans/visit/courselistdata']) {
    await CampusBridge.load({ url })
    await waitReady(20_000)
    const html = await pageHtml()
    const fromHtml = parseChaoxingCourseHtml(html)
    courses = fromHtml.length ? fromHtml : parseChaoxingCourses(await evalText('document.body ? document.body.innerText : ""'))
    if (courses.length) break
  }
  if (!courses.length) throw new OneClickError('chaoxing', 'Cookie 已导入，但没有读到课程：Cookie 可能过期或页面改版。')
  saveChaoxingCourses(courses, session)
  return { ok: true, count: courses.length }
}
/** 学习通：首次可见登录，之后读课程列表。 */
export async function runChaoxingSync(input: { report?: StageReporter; timeoutMs?: number } = {}): Promise<SourceStatus> {
  assertBridge()
  const report = input.report ?? (() => {})
  const session = captureQbankSession()
  if (!session.uid) throw new OneClickError('chaoxing-login', '请先登录哦狐，再同步学习通课程。')
  const timeoutMs = input.timeoutMs ?? 180_000
  report('chaoxing-login', '请在打开的页面里登录学习通…')
  await resetBridge()
  await CampusBridge.show()
  await CampusBridge.load({ url: 'https://v8.chaoxing.com/' })
  await waitReady(20_000)

  const started = Date.now()
  let loggedIn = false
  while (Date.now() - started < timeoutMs) {
    const state = await CampusBridge.currentUrl()
    if (!state.visible) throw new OneClickError('chaoxing-login', '已取消学习通授权。')
    if (!isQbankSessionCurrent(session)) throw new OneClickError('chaoxing-login', '账号已切换，请重新授权。')
    const text = await evalText('document.body ? document.body.innerText : ""')
    if (!state.url.includes('passport') && (text.includes('课程') || text.includes('我的课程'))) { loggedIn = true; break }
    await sleep(1200)
  }
  if (!loggedIn) {
    await CampusBridge.hide()
    throw new OneClickError('chaoxing-login', '没有检测到学习通登录态，已停止。')
  }

  report('chaoxing', '正在读取学习通课程…')
  const text = await evalText('document.body ? document.body.innerText : ""')
  await CampusBridge.hide()
  const html = await pageHtml()
  const fromHtml = parseChaoxingCourseHtml(html)
  const courses = fromHtml.length ? fromHtml : parseChaoxingCourses(text)
  if (!courses.length) throw new OneClickError('chaoxing', '未能读取课程列表，已保留原记录。')
  saveChaoxingCourses(courses, session)
  return { ok: true, count: courses.length }
}

/**
 * 公选进度：进实践系统后，在页面上下文里请求 personalFiles。
 * 若路由不存在会抛错并带回捕获到的请求，便于继续抓包定位。
 */
const ZF_COURSE_SELECTION = (studentId: string, name = '') =>
  zfUrl(`/xf_xsqxxxk.aspx?xh=${encodeURIComponent(studentId)}${name ? `&xm=${encodeURIComponent(name)}` : ''}&gnmkdm=N121106`)

/** 正方「选课情况」：公选课目录，按课程代码与成绩匹配。 */
export async function runPublicElectiveSync(input: { studentId: string; vpnPassword: string; casPassword: string; report?: StageReporter }): Promise<SourceStatus> {
  assertBridge()
  const report = input.report ?? (() => {})
  await resetBridge()
  const name = await loginCampus(input.studentId, input.vpnPassword, input.casPassword, report)
  report('quality', '正在读取全量成绩…')
  await loadWithReferer(ZF_GRADES(input.studentId, name), ZF_MAIN(input.studentId), 'xscj_gc2')
  const allGrades = await readAllGrades((msg) => report('quality', msg))
  if (allGrades.length) saveGradesCache(allGrades, input.studentId)

  report('quality', '正在读取正方选课情况…')
  await loadWithReferer(ZF_COURSE_SELECTION(input.studentId, name), ZF_MAIN(input.studentId), 'xf_xsqxxxk')
  await waitReady(15_000)
  if (await isZfLoginPage()) throw new OneClickError('quality', '选课页回到了登录页（正方会话失效），请重新同步。')
  const frameHtml = await evalText("(function(){var f=document.querySelector('#iframeautoheight')||document.querySelector('iframe');try{return f&&f.contentDocument?f.contentDocument.documentElement.outerHTML:''}catch(e){return ''}})()")
  const html = frameHtml || await pageHtml()
  const listings = parseZfCourseSelectionHtml(html)
  if (!listings.length) throw new OneClickError('quality', '选课页没有解析到公选课目录；页面结构可能变化。')
  if (!savePublicElectives(listings)) throw new OneClickError('quality', '公选课目录未能保存到本机。')
  return { ok: true, count: listings.length }
}

export async function runQualitySync(input: { studentId: string; vpnPassword: string; casPassword: string; report?: StageReporter }): Promise<SourceStatus> {
  assertBridge()
  const report = input.report ?? (() => {})
  try {
    report('quality', '正在进入公选 / 实践系统…')
    await resetBridge()
    await loginCampus(input.studentId, input.vpnPassword, input.casPassword, report)
    await CampusBridge.setCapture({ enabled: true }).catch(() => {})

    /* 8011 CAS 登录后会 302 到 7058 的 /login?token=<uuid>，token 也可能被 SPA 立刻收进 localStorage。 */
    const readToken = async (): Promise<string> => {
      const started = Date.now()
      let fallback = ''
      while (Date.now() - started < 25_000) {
        const current = (await CampusBridge.currentUrl()).url
        const match = current.match(/[?&]token=([0-9a-f-]{20,})/i)
        if (match) return match[1]
        const captured = await CampusBridge.requests().catch(() => ({ requests: [] as string[] }))
        for (const url of captured.requests) {
          const hit = url.match(/[?&]token=([0-9a-f-]{20,})/i)
          if (hit) return hit[1]
        }
        if (!fallback && Date.now() - started > 2500) {
          const stored = await evalText("(function(){try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i)||'';var v=localStorage.getItem(k)||'';var m=v.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);if(m)return m[0];if(/token/i.test(k)&&/^[0-9a-f-]{20,}$/i.test(v))return v}}catch(e){}return ''})()")
          if (stored) fallback = stored.replace(/^"|"$/g, '')
        }
        await sleep(250)
      }
      return fallback
    }

    /* eval 不能等 Promise：把 fetch 结果写进 window.__q，再轮询取回。 */
    const postJson = async (url: string, body = ''): Promise<string> => {
      await evalText(`(function(){window.__q='';fetch(${JSON.stringify(url)},{method:'POST',credentials:'include',headers:{'Content-Type':'application/json;charset=UTF-8'},body:${JSON.stringify(body)}}).then(function(r){return r.text()}).then(function(t){window.__q='OK|'+t}).catch(function(e){window.__q='ERR|'+e});return 'started'})()`)
      const started = Date.now()
      while (Date.now() - started < 20_000) {
        const value = await evalText("window.__q || ''")
        if (value.startsWith('OK|')) return value.slice(3)
        if (value.startsWith('ERR|')) throw new OneClickError('quality', `公选接口请求失败：${value.slice(4, 160)}`)
        await sleep(300)
      }
      throw new OneClickError('quality', '公选接口超时，请重试。')
    }
    const fetchQuality = async (token: string, outid: string): Promise<string> => {
      const suffix = `?access_token=${encodeURIComponent(token)}`
      /* 抓包实证：getCurrentUserInfo 空 body；personalFiles 必须带 {"outid":"学号"}。 */
      await postJson(`${QUALITY_BASE}/api/auth/funcPermission/getCurrentUserInfo${suffix}`).catch(() => '')
      return postJson(`${QUALITY_BASE}/api/student/quality/personalFiles${suffix}`, qualityPersonalFilesBody(outid))
    }

    await CampusBridge.load({ url: QUALITY_LOGIN })
    let token = await readToken()
    await waitReady(15_000).catch(() => {})
    await sleep(1000)
    if (!token) throw new OneClickError('quality', '实践系统没有返回 access_token，请重试。')
    let raw = await fetchQuality(token, input.studentId)
    let summary = parseQualityPayload(JSON.parse(raw))
    if (!summary && raw.includes('10102')) {
      /* token 可能是上一轮会话留下的旧值，重新走一次 8011 登录。 */
      await CampusBridge.load({ url: QUALITY_LOGIN })
      token = await readToken()
      if (token) {
        raw = await fetchQuality(token, input.studentId)
        summary = parseQualityPayload(JSON.parse(raw))
      }
    }
    if (!summary) throw new OneClickError('quality', `公选接口返回的数据结构未识别：${raw.slice(0, 240)}`)
    saveQuality(summary)
    return {
      ok: true,
      count: summary.semesters.length,
      message: `总学分 ${summary.totalCredit}（类型2 ${summary.type2} / 类型3 ${summary.type3}，排名 ${summary.rank || '—'}）`,
    }
  } finally {
    await CampusBridge.setCapture({ enabled: false }).catch(() => {})
    await CampusBridge.close().catch(() => {})
  }
}
export async function closeCampusWebView(): Promise<void> {
  await CampusBridge.close().catch(() => {})
}

export function evalValue(raw: string): string {
  return decodeEvalValue(raw)
}
