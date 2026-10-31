'use strict'
/**
 * 【模块】WebVPN 中转（反向代理形态）
 *
 * 来源：原 index.js「WebVPN 中转（反向代理形态）」一节（原第 79-201 行），代码逐行搬运。
 *
 * 背景：江苏海洋大学等学校要求校外访问教务必须经 WebVPN，直连公网提交登录会被拒绝。
 * 网瑞达（wrd）WebVPN 是「反向代理」：把目标地址编码进自己的路径即可由它代为转发，
 * 编码规则为  /<proto>/<marker><hex(host:port)>/<path>?<query>，
 * 其中 marker = hex('wrdvpnisthebest!')（校本部实测：/https/77726476706e69737468656265737421
 * + hex('zfxk.jou.edu.cn:443') 即指向 https://zfxk.jou.edu.cn）。
 *
 * WebVPN 自身登录需要滑块 + 短信/动态口令/微信，服务端无法自动化，因此会话 Cookie
 * 由用户在浏览器登录 WebVPN 后原样带入（/captcha 的 vpn 字段），函数只是复用它去转发。
 *
 * 设计要点：中转对上层完全透明——所有调用点继续使用「教务本体地址」（inner URL），
 * 只在唯一出口 http.request() 里包裹，并把重定向 Location 归一化回本体地址。
 *
 * 依赖：./config
 */

const { CONF } = require('./config')

/** WebVPN 入口 origin（未配置/非法则为空串） */
function vpnOrigin() {
  if (!CONF.vpnBase) return ''
  try {
    return new URL(CONF.vpnBase).origin
  } catch (_) {
    return ''
  }
}

function vpnEnabled() {
  return !!vpnOrigin() && !!CONF.base
}

/** WebVPN 自身页面路径（未登录墙），不得当作教务页再包一层 */
const VPN_SELF_RE = /^\/(login|logindo|logout|logoutdo|reset|resetpassword|portal|api|static|assets|js|css|img|images|favicon\.ico)/i

/** 把「教务本体地址」编码成 WebVPN 包裹地址；非教务域名（含 WebVPN 自身）原样返回 */
function vpnWrap(inner) {
  if (!vpnEnabled()) return inner
  let u
  let jw
  try {
    u = new URL(inner)
    jw = new URL(CONF.base)
  } catch (_) {
    return inner
  }
  if (u.origin !== jw.origin) return inner
  const proto = u.protocol.replace(':', '')
  const port = u.port || (proto === 'https' ? '443' : '80')
  const hex = Buffer.from(`${u.hostname}:${port}`, 'utf8').toString('hex')
  return `${CONF.vpnBase}/${proto}/${CONF.vpnMarker}${hex}${u.pathname}${u.search}`
}

/** WebVPN 包裹地址 → 教务本体地址；不是合法包裹地址则返回 '' */
function vpnDecode(url) {
  if (!vpnEnabled()) return ''
  let u
  try {
    u = new URL(url)
  } catch (_) {
    return ''
  }
  if (u.origin !== vpnOrigin()) return ''
  const m = /^\/(https?)\/([0-9a-f]+)(\/.*)?$/i.exec(u.pathname)
  if (!m) return ''
  let hx = m[2].toLowerCase()
  if (!hx.startsWith(CONF.vpnMarker) || hx.length <= CONF.vpnMarker.length) return ''
  hx = hx.slice(CONF.vpnMarker.length)
  if (hx.length % 2) return ''
  let plain
  try {
    plain = Buffer.from(hx, 'hex').toString('utf8')
  } catch (_) {
    return ''
  }
  const i = plain.lastIndexOf(':')
  if (i < 1) return ''
  const proto = m[1].toLowerCase()
  const port = plain.slice(i + 1)
  const auth = port && port !== (proto === 'https' ? '443' : '80') ? `:${port}` : ''
  return `${proto}://${plain.slice(0, i)}${auth}${m[3] || '/'}${u.search}`
}

/**
 * 把一次响应的落点（可能是 WebVPN 包裹地址、WebVPN 代理域下的相对地址、
 * 或教务本体地址）统一归一化为「教务本体地址」，以维持「target 恒为本体地址」的不变量。
 * WebVPN 自身的页面（未登录墙）保持原样，由上层识别并给出 2004 提示。
 */
function vpnNormalize(abs) {
  if (!vpnEnabled()) return abs
  let u
  try {
    u = new URL(abs)
  } catch (_) {
    return abs
  }
  if (u.origin !== vpnOrigin()) return abs
  const inner = vpnDecode(abs)
  if (inner) return inner
  // WebVPN 自身页面：未登录墙（/login 等）与门户首页，不得误当成教务路径
  if (u.pathname === '/' || VPN_SELF_RE.test(u.pathname)) return abs
  // 代理域内未编码的相对跳转（WebVPN 漏重写 Location）：按教务站点根解析回本体地址
  return `${CONF.base}${u.pathname}${u.search}`
}

/** 落点是否就是 WebVPN 自身页面（未登录墙，如 /login）；与教务页面严格区分 */
function isVpnSelfUrl(url) {
  if (!vpnEnabled()) return false
  try {
    const u = new URL(url)
    // 门户首页与 /login、/reset 等自身路径都不是教务页面
    return u.origin === vpnOrigin() && (u.pathname === '/' || VPN_SELF_RE.test(u.pathname))
  } catch (_) {
    return false
  }
}

/** 判定响应是否落在「WebVPN 未登录墙」上（区分于教务自身的错误页） */
function isVpnWall(finalUrl, text) {
  if (!vpnEnabled()) return false
  if (isVpnSelfUrl(finalUrl)) return true
  // 未登录墙的 <title> 形如「…WebVPN系统」；只取页面前段避免误判
  return /WebVPN[\s\S]{0,20}(登录|系统)/i.test(String(text || '').slice(0, 2000))
}

/** 统一文案：WebVPN 会话不可用（区别于「学号密码错」，避免用户一直怀疑密码） */
const VPN_WALL_MSG =
  'WebVPN 会话缺失或已失效：请先在浏览器登录学校 WebVPN（滑块 + 短信/动态口令/微信），把会话 Cookie 粘贴到「WebVPN 会话」后重新获取验证码再登录。'

module.exports = {
  vpnOrigin,
  vpnEnabled,
  VPN_SELF_RE,
  vpnWrap,
  vpnDecode,
  vpnNormalize,
  isVpnSelfUrl,
  isVpnWall,
  VPN_WALL_MSG,
}
