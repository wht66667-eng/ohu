'use strict'
/**
 * 课表查询云函数 · 入口（HTTP 触发）
 *
 * 本文件只做「路由 + 入参校验 + 拼响应」，业务全部在 lib/ 下：
 *
 *   lib/config.js         配置与常量（JW_* 环境变量）
 *   lib/webvpn.js         WebVPN 包裹/还原/未登录墙判定
 *   lib/cookies.js        Cookie 文本 ↔ Map
 *   lib/http.js           唯一发请求出口（手动 Cookie + 重定向 + 超时）
 *   lib/sessions.js       sid → cookie jar 的内存短会话
 *   lib/term.js           学期推算
 *   lib/weeks.js          周次解析（zcd）与课表扁平化
 *   lib/hints.js          登录入口提示 URL（教务 / WebVPN）
 *   lib/json-util.js      教务 JSON 里的课表数组定位
 *   lib/login.js          三种正方形态的登录（zfnet / jwglxt / legacy）+ 自动取表
 *   lib/parsers/          HTML/JSON → 扁平行（grid / course-list / jou-dayrow）
 *   lib/crawl.js          课表页 BFS 逐级跟随
 *   lib/import.js         Cookie 会话导入旁路 + /sync 免密续拉
 *   lib/query.js          账号密码 + 验证码 的自动登录主流程
 *   lib/captcha.js        验证码获取
 *   lib/captcha-image.js  验证码图片裁剪（纯字节）
 *   lib/gateway.js        网关响应与入参解析
 *
 * 路由：
 *   GET|POST /api/timetable/captcha   取验证码（POST 可带 WebVPN 会话）
 *   POST     /api/timetable/query     账号+密码+验证码 登录并抓课表
 *   POST     /api/timetable/import    粘贴教务 Cookie 直接抓课表（旁路）
 *   POST     /api/timetable/sync      凭 sid 免密续拉
 *
 * 拆解自单文件版（原 1848 行 / 82KB）：逻辑一行未改，只做「搬移 + 导出」。
 */

const { CONF } = require('./lib/config')
const { vpnEnabled, vpnWrap, vpnDecode, vpnNormalize, vpnOrigin } = require('./lib/webvpn')
const { jarFromCookie } = require('./lib/cookies')
const { createSession } = require('./lib/sessions')
const { zfLoginHint, vpnSiteHint, vpnLoginHint } = require('./lib/hints')
const { doCaptcha } = require('./lib/captcha')
const { doQuery } = require('./lib/query')
const { doImportQuery, doSync } = require('./lib/import')
const { cropCaptcha } = require('./lib/captcha-image')
const { httpRes, parseJsonBody } = require('./lib/gateway')

exports.main = async (event) => {
  const rawPath = event.path || ''
  const path = rawPath.split('?')[0].replace(/\/+$/, '')
  const method =
    event.httpMethod ||
    (event.requestContext && event.requestContext.http && event.requestContext.http.method) ||
    'GET'

  if (method === 'OPTIONS') return httpRes(204, { ok: true })

  // GET/POST /api/timetable/captcha
  // POST 用于携带 WebVPN 会话（会话属敏感信息，走请求体而不是 URL，避免被网关访问日志留存）
  if ((method === 'GET' || method === 'POST') && /^\/api\/timetable\/captcha$/.test(path)) {
    let vpnCookie = ''
    if (method === 'POST') {
      let rec
      try {
        rec = parseJsonBody(event)
      } catch (e) {
        return httpRes(400, { ok: false, error: 'bad json' })
      }
      if (rec && typeof rec === 'object') vpnCookie = String(rec.vpn || rec.vpnCookie || '').trim()
      if (vpnCookie.length > 8192)
        return httpRes(400, { ok: false, error: 'WebVPN 会话过长：请只复制请求头 Cookie 这一行的内容' })
    }
    // 恒回传 WebVPN 形态，前端据此决定是否展示「WebVPN 会话」引导区
    const vpnMeta = { vpn: vpnEnabled(), vpnSite: vpnSiteHint(), vpnLogin: vpnLoginHint() }
    try {
      const data = await doCaptcha(vpnCookie)
      if (data && data.ok === false) {
        return httpRes(200, { ...vpnMeta, ...data, ok: false, site: CONF.base || '', error: data.error || '验证码获取失败，请稍后再试' })
      }
      return httpRes(200, { ...vpnMeta, ok: true, site: CONF.base || '', login: zfLoginHint(), ...data })
    } catch (e) {
      return httpRes(200, { ...vpnMeta, ok: false, site: CONF.base || '', error: '验证码服务异常，请稍后再试' })
    }
  }

  // POST /api/timetable/query
  if (method === 'POST' && /^\/api\/timetable\/query$/.test(path)) {
    let rec
    try {
      rec = parseJsonBody(event)
    } catch (e) {
      return httpRes(400, { ok: false, error: 'bad json' })
    }
    const username = String(rec.username || '').trim()
    const password = String(rec.password || '')
    const captcha = String(rec.captcha || '').trim()
    const sid = String(rec.sid || '')
    if (!username || !password) return httpRes(400, { ok: false, error: '学号与密码必填' })
    if (!captcha) return httpRes(400, { ok: false, error: '请先填写验证码' })
    if (username.length > 40 || password.length > 64 || captcha.length > 16)
      return httpRes(400, { ok: false, error: '参数长度不合法' })

    const ctx = { stepMs: CONF.stepMs, deadline: Date.now() + CONF.deadlineMs }
    const cred = { username, password, captcha }
    const data = await doQuery(ctx, sid, cred)
    // 密码不落库、不打日志：cred.password 到此即弃
    if (data.code) return httpRes(200, { ok: false, code: data.code, message: data.message })
    const { rows, term } = data
    // 登录成功且抓到真实课表才回传 sid：前端存为「可复用会话」，约 20 分钟内可 /sync 免密续拉
    const real = Array.isArray(rows) && rows.length
    return httpRes(200, { ok: true, term: term || '', rows: rows || [], sid: real ? sid : undefined })
  }

  // POST /api/timetable/import（会话导入：粘贴教务登录后的 Cookie 直接抓课表，绕开验证码/密码）
  if (method === 'POST' && /^\/api\/timetable\/import$/.test(path)) {
    let rec
    try {
      rec = parseJsonBody(event)
    } catch (e) {
      return httpRes(400, { ok: false, error: 'bad json' })
    }
    const cookie = String(rec.cookie || '').trim()
    const pageUrl = String(rec.url || rec.pageUrl || '').trim()
    if (!cookie) return httpRes(400, { ok: false, error: '请先粘贴教务登录后的 Cookie' })
    if (cookie.length > 8192) return httpRes(400, { ok: false, error: 'Cookie 过长：请只复制请求头 Cookie 这一行的内容' })
    // Cookie 属敏感会话信息：仅用于本次爬取，不落库、不打日志
    if (!CONF.base) {
      return httpRes(200, { ok: false, code: '1004', message: '教务系统尚未接入（未配置 JW_BASE_URL），请先完成配置' })
    }
    const jar = jarFromCookie(cookie)
    if (!jar) return httpRes(200, { ok: false, code: '2001', message: '未检测到可用的 Cookie，请整行复制「Cookie:」之后的内容后重试' })
    let safeUrl = ''
    if (pageUrl) {
      // 配置了 WebVPN 时，用户地址栏里的网址是 WebVPN 包裹形态，先还原成教务本体地址再校验
      const inner = vpnDecode(pageUrl)
      if (inner) safeUrl = inner
      else {
        try {
          const u = new URL(pageUrl)
          if (u.origin === new URL(CONF.base).origin) safeUrl = u.toString()
        } catch (_) {}
      }
      if (!safeUrl) {
        return httpRes(200, {
          ok: false,
          code: '2001',
          message: vpnEnabled()
            ? '课表页网址既不是当前教务系统域名，也不是可识别的 WebVPN 包裹地址，请复制浏览器地址栏里的完整网址'
            : '课表页网址不是当前教务系统域名，请复制教务系统内的页面网址',
        })
      }
    }
    const ctx = { stepMs: CONF.stepMs, deadline: Date.now() + CONF.deadlineMs }
    const data = await doImportQuery(ctx, jar, safeUrl)
    if (data.code) return httpRes(200, { ok: false, code: data.code, message: data.message })
    const { rows, term } = data
    // 导入即代表该 Cookie 是「已登录教务会话」：落为可复用短会话并回传 sid，约 20 分钟内可 /sync 免密续拉
    const real = Array.isArray(rows) && rows.length
    const sid = real ? createSession(jar, { authed: true, via: 'import' }) : undefined
    return httpRes(200, { ok: true, term: term || '', rows: rows || [], sid })
  }

  // POST /api/timetable/sync（免密续拉：复用 sid 对应的已登录教务会话抓课表，无需再次输入账号密码/验证码）
  if (method === 'POST' && /^\/api\/timetable\/sync$/.test(path)) {
    let rec
    try {
      rec = parseJsonBody(event)
    } catch (e) {
      return httpRes(400, { ok: false, error: 'bad json' })
    }
    const sid = String(rec.sid || '').trim()
    if (!sid || sid.length > 128)
      return httpRes(200, { ok: false, code: '2003', message: '可复用的教务登录会话不存在，请重新登录后同步' })
    const ctx = { stepMs: CONF.stepMs, deadline: Date.now() + CONF.deadlineMs }
    const data = await doSync(ctx, sid)
    if (data.code) return httpRes(200, { ok: false, code: data.code, message: data.message })
    const { rows, term } = data
    return httpRes(200, { ok: true, term: term || '', rows: rows || [] })
  }

  return httpRes(404, { ok: false, error: 'not found' })
}

// 本地自测：node index.js（云函数运行时不会进入此分支）
if (require.main === module) {
  const selfTest = async () => {
    console.log('[getTimetable] 本地自测（JW_BASE_URL=' + (CONF.base || '未配置→应报错而非返回虚拟课表') + '）')
    const cap = await exports.main({
      httpMethod: 'GET',
      path: '/api/timetable/captcha',
    })
    const capData = JSON.parse(cap.body)
    console.log('captcha -> ok=%s sid=%s imagePrefix=%s err=%s', capData.ok, capData.sid || '', (capData.image || '').slice(0, 30), capData.error || '')
    const q = await exports.main({
      httpMethod: 'POST',
      path: '/api/timetable/query',
      body: JSON.stringify({
        sid: capData.sid || '',
        username: '2026000001',
        password: 'only-in-memory',
        captcha: capData.ok ? '0000' : '',
      }),
    })
    const qData = JSON.parse(q.body)
    console.log('query   -> ok=%s code=%s rows=%d term=%s msg=%s', qData.ok, qData.code || '', (qData.rows || []).length, qData.term || '', qData.message || '')
    if (qData.ok && Array.isArray(qData.rows)) {
      console.log('sample  ->', JSON.stringify(qData.rows[0]))
    }
    const imp = await exports.main({
      httpMethod: 'POST',
      path: '/api/timetable/import',
      body: JSON.stringify({ cookie: 'ASP.NET_SessionId=localtest', url: '' }),
    })
    const impData = JSON.parse(imp.body)
    console.log('import  -> ok=%s code=%s rows=%d msg=%s', impData.ok, impData.code || '', (impData.rows || []).length, impData.message || '')
    const sy = await exports.main({
      httpMethod: 'POST',
      path: '/api/timetable/sync',
      body: JSON.stringify({ sid: capData.sid }),
    })
    const syData = JSON.parse(sy.body)
    console.log('sync    -> ok=%s code=%s message=%s', syData.ok, syData.code || '', syData.message || '')
    // 离线回归：用实捕验证码文件复现「JPEG 后夹带登录页 HTML / 整包 HTML」的裁剪行为（文件不存在则跳过）
    try {
      const fs = require('node:fs')
      for (const f of ['_cap_b.jpg', '_cap_probe.jpg']) {
        const raw = fs.readFileSync(f)
        const img = cropCaptcha(raw)
        const isImg = !!img && (img[0] === 0xff || img[0] === 0x89 || img[0] === 0x47)
        console.log('crop ' + f.padEnd(16) + 'raw=' + raw.length + 'B -> ' + (isImg ? 'OK  ' : 'REJECT') + ' (' + (img ? img.length : 0) + 'B)')
      }
    } catch (_) {
      console.log('crop 回归跳过（本地无 _cap_*.jpg 文件）')
    }
    // WebVPN 编解码回归：纯字符串往返校验，不依赖网络。
    // 这一层最容易「静默编错」——编错了只会表现为登录失败，极难排查，故固化为自测项。
    console.log('--- WebVPN 编解码（JW_WEBVPN_URL=%s）---', CONF.vpnBase || '未配置')
    if (vpnEnabled()) {
      let allOk = true
      const check = (label, got, want) => {
        const pass = got === want
        if (!pass) allOk = false
        console.log('  [%s] %s', pass ? 'PASS' : 'FAIL', label)
        if (!pass) console.log('        got  = %s\n        want = %s', got, want)
        return pass
      }
      const hostPort = Buffer.from(`${new URL(CONF.base).hostname}:443`, 'utf8').toString('hex')
      const inner = `${CONF.base}/xskbcx.aspx?xh=2026000001&xm=%E5%BC%A0%E4%B8%89`
      const wrapped = `${CONF.vpnBase}/https/${CONF.vpnMarker}${hostPort}/xskbcx.aspx?xh=2026000001&xm=%E5%BC%A0%E4%B8%89`
      check('包裹教务地址', vpnWrap(inner), wrapped)
      check('还原为教务地址', vpnDecode(wrapped), inner)
      check('跳转归一化（绝对包裹）', vpnNormalize(wrapped), inner)
      check('跳转归一化（代理域相对跳转）', vpnNormalize(`${vpnOrigin()}/xs_main.aspx`), `${CONF.base}/xs_main.aspx`)
      check('未登录墙保持原样', vpnNormalize(`${vpnOrigin()}/login`), `${vpnOrigin()}/login`)
      check('第三方域名不中转', vpnWrap('https://example.com/x'), 'https://example.com/x')
      if (CONF.vpnBase === 'http://webvpn.jou.edu.cn:58888' && CONF.base === 'https://zfxk.jou.edu.cn') {
        // 与人工核验过的线上真实地址逐字符对齐，防编码规则被误改
        check(
          '本校固定样例',
          vpnWrap(`${CONF.base}/default2.aspx`),
          'http://webvpn.jou.edu.cn:58888/https/77726476706e697374686562657374217a66786b2e6a6f752e6564752e636e3a343433/default2.aspx',
        )
      }
      console.log('WebVPN 编解码回归：%s', allOk ? '全部通过' : '存在失败项')
    }
    process.exit(0)
  }
  selfTest().catch((e) => {
    console.error('自测失败:', e && e.message ? e.message : e)
    process.exit(1)
  })
}
