'use strict'
/**
 * 【模块】Cookie 会话导入（手动登录旁路）+ /sync 免密续拉
 *
 * 来源：原 index.js「Cookie 会话导入（手动登录）」一节（原第 1259-1417 行），
 * 去掉已独立出去的 jarFromCookie / seedCookie（→ ./cookies），其余代码逐行搬运。
 *
 * 为什么需要这条旁路：本校教务对非校园网/自动化请求有风控，且 WebVPN 自身登录含滑块+短信，
 * 服务端不可能全自动。于是让用户在自己浏览器里登录好，把 Cookie 原文贴进来，函数只负责复用。
 *
 * 三条出口语义（务必保持）：
 *   { rows, term, live:true }   成功
 *   { live:false, msg/code }    会话失效（需重新登录教务/重新贴 WebVPN 会话）
 *   { live:true|null, msg }     会话有效但没解析到课表 / 不可达
 *
 * 依赖：../config、../http、../webvpn、../sessions、../term、../weeks、../json-util、
 *       ../crawl、../parsers
 */

const { CONF } = require('./config')
const { reqText } = require('./http')
const { isVpnWall, VPN_WALL_MSG } = require('./webvpn')
const { takeSession } = require('./sessions')
const { guessTerm } = require('./term')
const { flatten } = require('./weeks')
const { findFirstArray } = require('./json-util')
const { crawlSchedule } = require('./crawl')
const { parseSchedule } = require('./parsers')

/** zfnet 登录表单特征（回落登录页 = 会话失效） */
function isZfnetLoginText(text) {
  return /name=["']txtUserName["']/i.test(String(text || ''))
}

/**
 * 用导入的教务会话抓课表：
 *  - 给了课表展示页网址：直接抓该页解析（最稳，绕过学期下拉/页内跳转差异）；
 *  - 没给网址：探活 xs_main → 自动逐级定位课表页（含 jwglxt JSON 通道）。
 * 返回三种形态：
 *  - { rows, term, live:true }            成功
 *  - { live:false, msg }                  会话失效（需重新登录教务再导入）
 *  - { live:true, msg } / { live:null,msg } 解析失败或不可达（上层按失败返回错误提示）
 */
async function fetchImportedSchedule(ctx, jar, term, userUrl) {
  if (userUrl) {
    let page
    try {
      page = await reqText(ctx, userUrl, jar, { headers: { Referer: CONF.base + '/' } })
    } catch (e) {
      return { live: null, msg: (e && e.msg) || '教务系统不可达，请稍后再试' }
    }
    if (page.status !== 200) return { live: null, msg: `课表页返回状态 ${page.status}` }
    if (page.wallHint || isVpnWall(page.finalUrl, page.text))
      return { live: false, code: '2004', msg: VPN_WALL_MSG }
    const r = parseSchedule(page.text, term)
    if (r) return { rows: r.rows, term: r.term, live: true }
    return { live: true, msg: '该网址已打开，但页面里没有解析到课表：请确认复制的是“学生个人课表”展示页的网址' }
  }

  // 会话探活：登录后内页 xs_main.aspx；会话失效会被 302 回落登录表单、跳学校错误页或直接复位连接。
  // 注意：教务侧对同 IP 高频请求会间歇性 RST，故对网络层异常做小退避重试后再分类。
  const classifyProbe = (probe) => {
    const finalUrl = probe.finalUrl || ''
    const text = probe.text || ''
    // WebVPN 会话缺失/过期时，所有请求都会被反向代理打回它自己的登录页
    if (probe.wallHint || isVpnWall(finalUrl, text)) return 'vpnwall'
    if (probe.status === 200 && !isZfnetLoginText(text) && !/zdy\.htm|aspxerrorpath/i.test(finalUrl)) return 'ok'
    if (isZfnetLoginText(text) || /default2\.aspx|zdy\.htm|aspxerrorpath/i.test(finalUrl)) return 'invalid'
    return 'unknown'
  }
  let auth = 'unknown'
  for (let i = 0; i < 3 && auth === 'unknown'; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 500))
    try {
      const probe = await reqText(ctx, `${CONF.base}/xs_main.aspx`, jar, { headers: { Referer: CONF.base + '/' } })
      auth = classifyProbe(probe)
    } catch (e) {
      auth = 'unknown'
      if (e && e.kind !== 'net' && e.kind !== 'timeout') break // 非网络层异常不再重试
    }
  }
  if (auth === 'unknown') {
    // 多次内页探活都被复位/超时：用登录页确认站点可达性，区分「教务不可达」与「会话被拒/风控」
    try {
      const aux = await reqText(ctx, `${CONF.base}/default2.aspx`, jar, { headers: { Referer: CONF.base + '/' } })
      if (aux.wallHint || isVpnWall(aux.finalUrl, aux.text)) auth = 'vpnwall'
      else auth = aux.status === 200 ? 'reset-on-auth' : 'unreach'
    } catch (_) {
      auth = 'unreach'
    }
  }
  if (auth === 'vpnwall') return { live: false, code: '2004', msg: VPN_WALL_MSG }
  if (auth === 'unreach') return { live: null, msg: '教务系统不可达，请稍后再试' }
  if (auth === 'invalid')
    return { live: false, msg: '教务会话未认证或已失效（页面回落到了登录表单），请先在教务里登录成功后再重新复制导入' }
  if (auth === 'reset-on-auth')
    return {
      live: false,
      msg: '教务内页连接被重置：通常是该会话未通过认证（还没登录成功 / 已过期 / 复制的是 Cookie 列表而非请求头整行），也可能是教务临时风控。请确认教务页面右上角已显示学号/姓名后重新复制导入；若仍如此请稍等半分钟再试',
    }

  // jwglxt 形态：直接走 JSON 课表接口（会话有效时 xs_main 不存在/非 200，auth 为 unknown）
  if (CONF.mode === 'jwglxt' || (CONF.mode === 'auto' && auth === 'unknown')) {
    try {
      const idx = `${CONF.base}/jwglxt/kbcx/kbcx_index.html?gnmkdm=N2151`
      try {
        await reqText(ctx, idx, jar, { headers: { Referer: `${CONF.base}/jwglxt/frame/menuBar.html` } })
      } catch (_) {}
      const api = `${CONF.base}/jwglxt/kbcx/xskbcx_cxXsgrkb.html?gnmkdm=N2151`
      const r = await reqText(ctx, api, jar, {
        method: 'POST',
        form: { xnm: term.xnm, xqm: term.xqm, kzlx: 'ck' },
        headers: { Referer: idx, 'X-Requested-With': 'XMLHttpRequest' },
      })
      if (r.status === 200) {
        const data = JSON.parse(r.text)
        const list = findFirstArray(data)
        const rows = flatten(
          (Array.isArray(list) ? list : []).map((row) => ({
            xqj: row.xqj,
            skjc: row.skjc,
            skjs: row.skjs,
            zcd: row.zcd,
            name: row.kcmc || row.kcm || row.kcgs || '',
            teacher: row.xm || row.jsmc || '',
            room: row.jxdd || row.cdmc || '',
          })),
        )
        if (rows.length) return { rows, term: term.label, live: true }
      }
    } catch (_) {}
  }

  // zfnet / 其它：逐级定位课表页
  const r = await crawlSchedule(ctx, jar, [`${CONF.base}/xskbcx.aspx`, `${CONF.base}/kbcx.aspx`, `${CONF.base}/xs_main.aspx`], 14)
  if (r) return { rows: r.rows, term: r.term, live: true }
  return { live: true, msg: '教务会话有效，但自动定位课表页未果：请在教务系统里打开一次「学生个人课表」，把页面网址随 Cookie 一起粘贴导入' }
}

/** 用一份（已登录）教务 Cookie jar 抓课表；jar 的合法性（域名/是否登录态）由调用方先行确认 */
async function doImportQuery(ctx, jar, safeUrl) {
  const term = guessTerm()
  const res = await fetchImportedSchedule(ctx, jar, term, safeUrl)
  if (res && res.rows && res.rows.length) return { term: res.term || term.label, rows: res.rows }
  if (res && res.live === false) return { code: res.code || '2002', message: res.msg }
  return { code: '1004', message: (res && res.msg) || '课表导入失败，请检查后重试' }
}

/** /sync：凭 sid 复用最近一次成功登录/导入建立的教务会话抓课表，全程无需账号密码与验证码 */
async function doSync(ctx, sid) {
  const rec = takeSession(sid)
  if (!rec || !rec.authed)
    return { code: '2003', message: '可复用的教务登录会话不存在或已过期，请重新登录后同步' }
  const term = guessTerm()
  const res = await fetchImportedSchedule(ctx, rec.jar, term, '')
  if (res && res.rows && res.rows.length) return { term: res.term || term.label, rows: res.rows }
  if (res && res.live === false) {
    // 教务侧会话已失效：摘除登录标记，前端收到 2002/2004 后引导重新登录或重新粘贴 WebVPN 会话
    if (res.code !== '2004') rec.authed = false
    return { code: res.code || '2002', message: res.msg }
  }
  // 会话有效但抓取未果（1004）：保留已存课表与会话，前端提示后可直接重试
  return { code: '1004', message: (res && res.msg) || '课表同步失败，请稍后再试' }
}

module.exports = { isZfnetLoginText, fetchImportedSchedule, doImportQuery, doSync }
