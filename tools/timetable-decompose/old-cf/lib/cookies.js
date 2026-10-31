'use strict'
/**
 * 【模块】Cookie 工具
 *
 * 来源：原 index.js 两处纯函数合并：
 *   - absorbCookies / cookieHeader    ←「会话与 Cookie」一节（原第 244-273 行）
 *   - jarFromCookie / seedCookie      ←「Cookie 会话导入」一节（原第 1261-1281 行）
 * 这两组函数都是「Cookie 文本 ↔ Map」的无状态工具，与业务无关，故合到一个模块。
 *
 * 依赖：无
 */

/**
 * 把一次响应的 Set-Cookie 吸收进 jar。
 * 兼容三种取法：标准 Headers.getSetCookie()、undici 的 headers.raw()、以及单值兜底。
 */
function absorbCookies(jar, headers) {
  let cookies = []
  try {
    if (typeof headers.getSetCookie === 'function') cookies = headers.getSetCookie()
  } catch (_) {}
  if (!cookies.length) {
    try {
      const raw = headers.raw ? headers.raw()['set-cookie'] : null
      if (raw && raw.length) cookies = raw
    } catch (_) {}
  }
  if (!cookies.length) {
    const v = headers.get('set-cookie')
    if (v) cookies = [v]
  }
  for (const c of cookies) {
    const seg = String(c).split(';')[0]
    const i = seg.indexOf('=')
    if (i < 1) continue
    const name = seg.slice(0, i).trim()
    if (!name) continue
    jar.set(name, seg.slice(i + 1).trim())
  }
}

function cookieHeader(jar) {
  const parts = []
  for (const [k, v] of jar) parts.push(`${k}=${v}`)
  return parts.join('; ')
}

/** 把用户在浏览器教务登录后复制的 Cookie 请求头文本解析进 jar（name=value 片段） */
function jarFromCookie(cookie) {
  const jar = new Map()
  for (const seg of String(cookie || '').split(';')) {
    const s = seg.trim()
    const i = s.indexOf('=')
    if (i < 1) continue
    const name = s.slice(0, i).trim()
    if (!name) continue
    jar.set(name, s.slice(i + 1).trim())
  }
  return jar.size ? jar : null
}

/** 把 Cookie 文本片段合并进已有 jar（WebVPN 会话与教务 Cookie 同域，共用同一个 jar） */
function seedCookie(jar, cookie) {
  if (!cookie) return jar
  const parsed = jarFromCookie(cookie)
  if (parsed) for (const [k, v] of parsed) jar.set(k, v)
  return jar
}

module.exports = { absorbCookies, cookieHeader, jarFromCookie, seedCookie }
