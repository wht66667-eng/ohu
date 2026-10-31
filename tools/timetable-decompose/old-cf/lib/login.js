'use strict'
/**
 * 【模块】教务登录（三种正方形态：zfnet / jwglxt / legacy）+ 前两种的自动取表
 *
 * 来源：原 index.js「教务抓取（新版 jwglxt / 旧版 legacy）」一节（原第 457-900 行），
 * 去掉已独立出去的 findFirstArray（→ ../json-util）、walkLegacyGrid（→ ./parsers/grid），
 * 其余代码逐行搬运。
 *
 * 形态识别：
 *   · zfnet  —— 站点首页即 ASP.NET 登录表单（txtUserName + CheckCode.aspx + RSA 隐藏公钥），
 *                密码用 RSA/PKCS#1 v1.5 加密后发 hex，与官方 RSA.js 互通；
 *   · jwglxt —— 新版 /jwglxt/xtgl/login_slogin.html，RSA 公钥从页面脚本里现取；
 *   · legacy —— 旧版 /default.aspx，明文 POST + __VIEWSTATE。
 * tryLogin 按 CONF.mode 在三种形态间编排（auto 时 jwglxt 404 自动回落 legacy）。
 *
 * 依赖：node:crypto、../config、../http、../webvpn、../captcha-image、../term、../weeks、
 *       ../json-util、./parsers/grid
 */

const crypto = require('node:crypto')

const { CONF } = require('./config')
const { reqText, request } = require('./http')
const { isVpnWall, vpnEnabled, VPN_WALL_MSG } = require('./webvpn')
const { cropCaptcha } = require('./captcha-image')
const { guessTerm } = require('./term')
const { flatten } = require('./weeks')
const { findFirstArray } = require('./json-util')
const { walkLegacyGrid } = require('./parsers/grid')

/** 从 HTML 里取隐藏表单域 */
function pickHidden(html, names) {
  const out = {}
  for (const name of names) {
    const re = new RegExp(`<input[^>]+name=["']${name}["'][^>]*>`, 'i')
    const m = html.match(re)
    if (m) {
      const v = /value=["']([^"']*)["']/i.exec(m[0])
      out[name] = v ? v[1] : ''
    }
  }
  return out
}

/** 尝试从登录页提取 RSA 公钥（部分新版正方把 modulus/exponent 写进页面或脚本） */
function pickRsaKey(html) {
  const mod = /(?:modulus|"n"|publicKeyModulus)\s*[:=]\s*["']([0-9a-fA-F]{64,})["']/.exec(html)
  const exp = /(?:exponent|"e")\s*[:=]\s*["']([0-9a-fA-F]{1,16})["']/.exec(html)
  if (mod && exp) return { modulus: mod[1], exponent: exp[1] }
  return null
}

function rsaEncrypt(modulusHex, exponentHex, text) {
  const pub = crypto.createPublicKey({
    key: { kty: 'RSA', n: modulusHex, e: exponentHex },
    format: 'jwk',
  })
  return crypto.publicEncrypt({ key: pub, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(text, 'utf8')).toString('hex')
}

/** 判断失败文案：只在错误语境中匹配（避免误把登录表单里的“验证码”字样当错误）。 */
function matchLoginError(text) {
  const t = String(text || '')
  if (/验证码[^，。；:！?]{0,14}(错误|不正确|有误|过期)/.test(t) || /(错误|不正确|有误|过期)[^，。；]{0,8}验证码/.test(t))
    return { code: '1001', message: '验证码错误，请刷新后重试' }
  if (/(用户名|账号|学号|密码|口令)[^，。；:！?]{0,16}(错误|不正确|不存在|无效|有误)/.test(t))
    return { code: '1002', message: '账号或密码错误' }
  return null
}

/**
 * 正方 ASP.NET 首页登录表单（zfnet）识别与解析：
 * 站点首页即登录页，特征 = <input name="txtUserName"> + <img src="...CheckCode.aspx?SafeKey=..">
 * + 隐藏 RSA 公钥 txtKeyExponent/txtKeyModulus + 角色单选 RadioButtonList1。
 * 密码加密与官方 RSA.js(RSAKeyPair + PKCS#1 v1.5)互通，发送 hex。
 */
function zfnetParseLogin(html) {
  const t = String(html || '')
  if (!t || !/name=["']txtUserName["']/i.test(t) || !/CheckCode\.aspx/i.test(t)) return null
  // txtKeyExponent/txtKeyModulus 为 text 型「隐藏公钥域」，浏览器提交时会一并回传，
  // 服务端据此定位对应 RSA 私钥解密密码；缺失会抛异常跳错误页。
  const state = pickHidden(t, ['__VIEWSTATE', '__VIEWSTATEGENERATOR', '__EVENTTARGET', '__EVENTARGUMENT', '__LASTFOCUS', 'txtKeyExponent', 'txtKeyModulus'])
  state.__EVENTTARGET = state.__EVENTTARGET || ''
  state.__EVENTARGUMENT = state.__EVENTARGUMENT || ''

  const valById = (id) => {
    const re = new RegExp(`(?:id|name)=["']${id}["'][^>]*value=["']([^"']*)["']`, 'i')
    const m = re.exec(t)
    if (m) return m[1]
    const m2 = new RegExp(`value=["']([^"']*)["'][^>]*(?:id|name)=["']${id}["']`, 'i').exec(t)
    return m2 ? m2[1] : ''
  }
  const key = { n: valById('txtKeyModulus'), e: valById('txtKeyExponent') || '010001' }

  // 角色：取 RadioButtonList1 中默认勾选项的 value，兜底“学生”（UTF-8 与页面一致）
  let role = '学生'
  const rlb = /<table[^>]*id="RadioButtonList1"[\s\S]{0,1200}?<\/table>/i.exec(t)
  if (rlb) {
    const radios = [...rlb[0].matchAll(/<input[^>]*name="RadioButtonList1"[^>]*\/?>/gi)].map((m) => m[0])
    const getV = (tag) => {
      const v = /value=["']([^"']*)["']/i.exec(tag)
      return v ? v[1] : ''
    }
    const checkedTag = radios.find((tag) => /checked/i.test(tag))
    if (checkedTag && getV(checkedTag)) role = getV(checkedTag)
    else {
      const stu = radios.map(getV).find((v) => v === '学生')
      if (stu) role = stu
      else if (radios.length) role = getV(radios[0]) || role
    }
  }

  // 验证码图 URL（含 SafeKey）
  let capUrl = ''
  const im = /<img[^>]+id=["']icode["'][^>]*src=["']([^"']+)["']/i.exec(t)
  if (im) capUrl = im[1]
  if (!capUrl) {
    const im2 = /<img[^>]+src=["']([^"']*CheckCode\.aspx[^"']*)["']/i.exec(t)
    if (im2) capUrl = im2[1]
  }
  if (!key.n) return null
  // 表单提交目标（action 需相对当前登录页解析后回传，与浏览器一致；本校页面为 action="./default2.aspx" → 提交到 /default2.aspx）
  const am = /<form[^>]+action=["']([^"']*)["']/i.exec(t)
  const action = am ? am[1] : ''
  return { state, key, role, capUrl, action }
}

/**
 * zfnet 登录页定位：先试 /default2.aspx（该校登录表单与回传处理同页，action="./default2.aspx"），兜底站点首页。
 * 返回 { info, loginUrl }；若所有候选都落在 WebVPN 未登录墙，则返回 { wall: true } 供上层给出 2004 提示。
 */
async function zfnetInit(ctx, jar) {
  let wall = false
  for (const u of [`${CONF.base}/default2.aspx`, `${CONF.base}/`]) {
    try {
      const page = await reqText(ctx, u, jar)
      if (page.status === 200) {
        const info = zfnetParseLogin(page.text)
        if (info) return { info, loginUrl: page.finalUrl || u }
      }
      // wallHint：跳转链里出现过 /login（未登录墙确证）；isVpnWall：最终落点/正文也指向 WebVPN
      const hitWall = !!page.wallHint || isVpnWall(page.finalUrl, page.text)
      if (hitWall) wall = true
      // 诊断日志（只含落点与长度，不含任何 Cookie/凭据）：区分「教务不可达」与「被 WebVPN 拦在登录页」
      console.log(
        '[zfnet-init] %s -> status=%s final=%s wall=%s len=%d',
        u,
        page.status,
        String(page.finalUrl).slice(0, 130),
        hitWall,
        (page.text || '').length,
      )
      // 非 200 时补一行正文片段：用于区分「WebVPN 拒绝了这次访问（403/风控）」
      // 与「教务站点自身报错」。正文为错误页文本，不含任何凭据。
      if (page.status !== 200) {
        console.log(
          '[zfnet-init] %s -> body=%s',
          u,
          String(page.text || '').replace(/\s+/g, ' ').slice(0, 200),
        )
      }
    } catch (e) {
      if (e && e.wallHint) wall = true
      // 该候选不可达，试下一个；记下原因，便于区分「校外不可达」与「会话被拒」
      console.log(
        '[zfnet-init] %s -> FAIL %s wallHint=%s',
        u,
        (e && (e.kind + ':' + e.msg)) || e,
        !!(e && e.wallHint),
      )
    }
  }
  return wall ? { wall: true } : null
}

/** 尝试在指定会话里走 zfnet 验证码链路：定位登录页→取 SafeKey 图。成功返回 jar 已带 Cookie。 */
async function tryZfnetCaptcha(jar) {
  const ctx = { stepMs: 4000, deadline: Date.now() + 6000 }
  const init = await zfnetInit(ctx, jar)
  if (!init) return null
  if (!init.info) return init // { wall: true }：WebVPN 会话不可用
  const { info, loginUrl } = init
  if (!info.capUrl) return null
  let r
  try {
    r = await request(ctx, new URL(info.capUrl, loginUrl).toString(), { jar })
  } catch (_) {
    return null
  }
  if (r.status !== 200) return null
  // 只认「裁剪后仍以真实图片头开始」的响应：混入登录页 HTML 或整包 HTML 一律按不可用处理
  const img = cropCaptcha(r.buf)
  if (!img) return null
  return { info, loginUrl, buf: img, ct: r.headers.get('content-type') || '' }
}

/** zfnet：回填隐藏域 + RSA(hex) 密码 POST 回登录页。 */
async function tryLoginZfnet(ctx, jar, meta, cred) {
  // 优先复用验证码阶段缓存的登录现场（state/key/role/loginUrl/postAction 与验证码同一次会话）
  const cached = meta && meta.state && meta.key
  let loginUrl = (cached && meta.loginUrl) || `${CONF.base}/default2.aspx`
  let info = cached ? { state: meta.state, key: meta.key, role: meta.role || '学生', action: meta.postAction || '' } : null
  if (!info) {
    // 会话没带登录现场（如直连 query）：现场重新定位登录页
    const init = await zfnetInit(ctx, jar)
    if (!init) return { ok: false, unreach: true, reason: '未识别到正方ASP.NET登录表单，请核对 JW_BASE_URL' }
    if (!init.info) return { ok: false, unreach: false, code: '2004', reason: VPN_WALL_MSG }
    info = init.info
    loginUrl = init.loginUrl || loginUrl
  }
  // POST 目标必须与浏览器一致：按登录页 <form action> 相对当前页解析，不要手工改写成根路径等其它落点。
  // 本校登录页（/ 与 /default2.aspx 内容相同）action="./default2.aspx"，解析结果即 https://zfxk.jou.edu.cn/default2.aspx。
  // 登录被拒时服务端会 302 到 zdy.htm?aspxerrorpath=.. 错误页，由下方 finalUrl 分支识别，与 POST 落点无关。
  const postUrl = info.action ? new URL(info.action, loginUrl).toString() : loginUrl
  const pwd = rsaEncrypt(info.key.n, info.key.e, cred.password)
  const form = {
    ...info.state,
    txtUserName: cred.username,
    TextBox2: pwd,
    txtSecretCode: cred.captcha,
    RadioButtonList1: info.role,
    Button1: '登录',
  }
  let post
  try {
    post = await reqText(ctx, postUrl, jar, { method: 'POST', form, headers: { Referer: postUrl } })
  } catch (e) {
    return { ok: false, unreach: e && e.kind === 'net', reason: (e && e.msg) || '教务系统不可达' }
  }
  const finalUrl = post.finalUrl || ''
  const text = post.text || ''
  // 诊断日志（不含密码等敏感信息）：确认登录 POST 的落点与正文形态
  console.log('[zfnet-login] POST %s -> status=%s final=%s len=%d', postUrl, post.status, String(finalUrl).slice(0, 130), (text || '').length)

  // ⓪ 配置了 WebVPN 但会话缺失/过期 → 请求被 WebVPN 打回它自己的登录页（而非教务错误页）。
  //    这是「没带 WebVPN 会话」而非「学号密码错」，必须分开提示，否则用户会一直怀疑密码。
  //    post.wallHint：跳转链里出现过 /login，即使最后一跳失败也照样判墙。
  if (post.wallHint || isVpnWall(finalUrl, text)) {
    console.log('[zfnet-login] blocked-by-webvpn-wall final=%s', String(finalUrl).slice(0, 130))
    return { ok: false, unreach: false, code: '2004', reason: VPN_WALL_MSG }
  }

  // ① 教务异常/拒绝登录时常 302 到 zdy.htm?aspxerrorpath=..（正文“系统正忙”）等错误页：
  //    只要落点 URL 是错误页就一律判失败，不再依赖错误页正文，避免把“跳错页”误判成登录成功
  //    而继续去抓课表、最终给学生返回一个无用的错误结果。
  //    注意：该校正方把「凭证错/验证码错/风控拒连」统一伪装成该错误页，无法进一步细分，
  //    故提示需同时覆盖两种可能，并引导走 Cookie 导入旁路。
  if (/\/zdy\.htm\b|aspxerrorpath|\/(error|err)\.aspx/i.test(finalUrl)) {
    const e2 = matchLoginError(text)
    if (e2) return { ok: false, code: e2.code, reason: e2.message }
    console.log('[zfnet-login] rejected-by-errorpage final=%s len=%d sysBusy=%s', String(finalUrl).slice(0, 130), (text || '').length, String(text || '').includes('系统正忙'))
    return {
      ok: false,
      unreach: false,
      code: '1004',
      reason: vpnEnabled()
        ? '教务系统未接受本次登录（已经 WebVPN 转发）：请核对账号、密码与验证码；若确认无误仍失败，通常是 WebVPN 会话已过期，请在浏览器重新登录 WebVPN 后重新粘贴会话，或改用下方「Cookie 导入」方式查课表。'
        : '教务系统未接受本次登录：请核对账号、密码与验证码（如验证码看不清可点击刷新）；若确认无误仍失败，多为教务对非校园网/自动化请求的防护（本校需校外经 WebVPN 访问），请改用下方「Cookie 导入」方式查课表。',
    }
  }

  // ② 已离开登录页（成功会 302 到 xs_main.aspx 之类）→ 登录成功
  const norm = (u) => {
    try {
      const uu = new URL(u, CONF.base)
      uu.hash = ''
      return uu.origin + uu.pathname.replace(/\/+$/, '')
    } catch (_) {
      return String(u).replace(/\/+$/, '')
    }
  }
  if (norm(finalUrl) !== norm(postUrl) && norm(finalUrl) !== norm(CONF.base)) {
    return { ok: true, mode: 'zfnet', navUrl: finalUrl, navText: text }
  }

  // ③ 登录页原地回显错误（验证码/账号密码错误）→ 精确定位错误码
  const err = matchLoginError(text + ' ' + finalUrl)
  if (err) return { ok: false, code: err.code, reason: err.message }
  // 页面内含客户端跳转（常见 postback 成功后 script 改 top.location）且已无登录表单 → 视为成功
  if (!/name=["']txtUserName["']/i.test(text)) {
    const js = /(?:top|window|location)\.(?:href|location)\s*=\s*["']([^"']+)["']/i.exec(text)
    return { ok: true, mode: 'zfnet', navUrl: js ? js[1] : '', navText: text }
  }
  return { ok: false, unreach: false, code: '1004', reason: '登录未跳转成功，请检查账号、密码或验证码' }
}

async function tryLogin(ctx, jar, cred, meta) {
  // zfnet：验证码阶段已在会话中标注形态，直接走对应登录
  if (CONF.mode === 'zfnet' || (meta && meta.profile === 'zfnet')) {
    return await tryLoginZfnet(ctx, jar, meta, cred)
  }
  // ---- 新版 jwglxt ----
  if (CONF.mode !== 'legacy') {
    try {
      const r = await tryLoginJwglxt(ctx, jar, cred)
      if (r.applicable === false) {
        if (CONF.mode === 'jwglxt') return { ok: false, unreach: true, reason: '新版登录页不可达' }
      } else {
        return r
      }
    } catch (e) {
      if (CONF.mode === 'jwglxt') return { ok: false, unreach: e && e.kind === 'net', reason: (e && e.msg) || '新版登录失败' }
    }
  }

  // ---- 旧版 default.aspx ----
  if (CONF.mode !== 'jwglxt') {
    try {
      return await tryLoginLegacy(ctx, jar, cred)
    } catch (e) {
      return { ok: false, unreach: e && e.kind === 'net', reason: (e && e.msg) || '旧版登录失败' }
    }
  }
  return { ok: false, unreach: true, reason: '教务系统不可达' }
}

async function tryLoginJwglxt(ctx, jar, cred) {
  const loginUrl = `${CONF.base}/jwglxt/xtgl/login_slogin.html?language=zh_CN&_t=${Date.now()}`
  let page
  try {
    page = await reqText(ctx, loginUrl, jar)
  } catch (e) {
    throw e
  }
  if (page.status === 404) return { applicable: false }
  if (page.status !== 200) return { ok: false, unreach: true, reason: `教务登录页状态 ${page.status}` }

  const hidden = pickHidden(page.text, ['csrftoken', 'execution'])
  let mm = cred.password
  const key = pickRsaKey(page.text)
  if (key) {
    mm = rsaEncrypt(key.modulus, key.exponent, cred.password)
  } else if (CONF.rsaEnforce) {
    return { ok: false, unreach: false, code: '1004', reason: '教务系统未提供 RSA 公钥但要求加密，请联系管理员核对配置' }
  }

  const form = {
    yhm: cred.username,
    mm,
    yzm: cred.captcha,
    language: 'zh_CN',
    ...hidden,
  }
  let post
  try {
    post = await reqText(ctx, loginUrl, jar, {
      method: 'POST',
      form,
      headers: { Referer: loginUrl },
    })
  } catch (e) {
    throw e
  }
  const text = post.text || ''
  const finalUrl = post.finalUrl || ''
  if (!/login/.test(finalUrl) && !/验证码|密码|错误|login_slogin/i.test(text)) {
    // 已跳出登录页（重定向到 index 等），视为登录成功
    return { ok: true, mode: 'jwglxt' }
  }
  const err = matchLoginError(text + ' ' + finalUrl)
  if (err) return { ok: false, code: err.code, reason: err.message }
  return { ok: false, unreach: false, code: '1004', reason: '登录未跳转成功（可能需要适配登录参数）' }
}

/** 从新版 jwglxt 拉取 JSON 课表 */
async function fetchJwglxtSchedule(ctx, jar, cred) {
  const kbIndex = `${CONF.base}/jwglxt/kbcx/kbcx_index.html?gnmkdm=N2151`
  try {
    await reqText(ctx, kbIndex, jar, { headers: { Referer: `${CONF.base}/jwglxt/frame/menuBar.html` } })
  } catch (_) {}
  const term = guessTerm()
  const api = `${CONF.base}/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151`
  const r = await reqText(ctx, api, jar, {
    method: 'POST',
    form: { xnm: term.xnm, xqm: term.xqm, kzlx: 'ck' },
    headers: { Referer: kbIndex, 'X-Requested-With': 'XMLHttpRequest' },
  })
  if (r.status !== 200) throw { kind: 'net', msg: `课表接口返回 ${r.status}` }
  const data = JSON.parse(r.text) // 解析失败会抛给上层按不可达降级
  const list = findFirstArray(data)
  const courses = (Array.isArray(list) ? list : []).map((row) => ({
    xqj: row.xqj,
    skjc: row.skjc,
    skjs: row.skjs,
    zcd: row.zcd,
    name: row.kcmc || row.kcm || row.kcgs || '',
    teacher: row.xm || row.jsmc || '',
    room: row.jxdd || row.cdmc || '',
  }))
  return { rows: flatten(courses), term: term.label }
}

async function tryLoginLegacy(ctx, jar, cred) {
  // 旧版正方：GET 首页（default.aspx），抓 __VIEWSTATE 等隐藏域后 POST 登录
  const indexUrl = `${CONF.base}/default.aspx`
  let page
  try {
    page = await reqText(ctx, indexUrl, jar)
  } catch (e) {
    throw e
  }
  if (page.status === 404) return { applicable: false }
  if (!/txtUserName|txtPassword|CheckCode|txtCheckCode/i.test(page.text))
    return { ok: false, unreach: true, reason: '未识别到旧版登录表单' }

  const hidden = pickHidden(page.text, [
    '__VIEWSTATE',
    '__EVENTVALIDATION',
    '__VIEWSTATEGENERATOR',
    'efdfdfuuyyuuckjg',
    '__EVENTTARGET',
    '__EVENTARGUMENT',
  ])
  const form = {
    ...hidden,
    txtUserName: cred.username,
    txtPassword: cred.password,
    txtCheckCode: cred.captcha,
    efdfdfuuyyuuckjg: hidden.efdfdfuuyyuuckjg || '1',
    __EVENTTARGET: '',
    __EVENTARGUMENT: '',
    Button1: '',
  }
  let post
  try {
    post = await reqText(ctx, indexUrl, jar, { method: 'POST', form, headers: { Referer: indexUrl } })
  } catch (e) {
    throw e
  }
  const finalUrl = post.finalUrl || ''
  const text = post.text || ''
  if (finalUrl.includes('xs_main') || /xs_main\.aspx/.test(text) || !/txtUserName|txtPassword/.test(text)) {
    return { ok: true, mode: 'legacy' }
  }
  const err = matchLoginError(text + ' ' + finalUrl)
  if (err) return { ok: false, code: err.code, reason: err.message }
  return { ok: false, unreach: false, code: '1004', reason: '旧版登录未跳转成功' }
}

/** 旧版 xskbcx.aspx 课表页（表格按 星期×节次 展开）。返回扁平行，尽力解析。 */
async function fetchLegacySchedule(ctx, jar, cred) {
  const xsUrl = `${CONF.base}/xskbcx.aspx?xh=${encodeURIComponent(cred.username)}&xm=&gnmkdm=N121603`
  let page
  try {
    page = await reqText(ctx, xsUrl, jar, { headers: { Referer: `${CONF.base}/xs_main.aspx` } })
  } catch (e) {
    throw e
  }
  if (page.status !== 200) throw { kind: 'parse', msg: `旧版课表页返回 ${page.status}` }
  const rows = walkLegacyGrid(page.text)
  if (!rows) throw { kind: 'parse', msg: '旧版课表表格结构未识别，未能提取课表，请稍后重试' }
  return { rows, term: guessTerm().label }
}

module.exports = {
  pickHidden,
  pickRsaKey,
  rsaEncrypt,
  matchLoginError,
  zfnetParseLogin,
  zfnetInit,
  tryZfnetCaptcha,
  tryLoginZfnet,
  tryLogin,
  tryLoginJwglxt,
  fetchJwglxtSchedule,
  tryLoginLegacy,
  fetchLegacySchedule,
}
