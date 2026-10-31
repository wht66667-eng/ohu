'use strict'
/**
 * 【模块】内存短会话（sid → cookie jar）
 *
 * 来源：原 index.js「会话与 Cookie」一节里的会话仓库部分（原第 205-242 行），代码逐行搬运。
 * （同节的 absorbCookies / cookieHeader 是纯 Cookie 工具，已移到 ./cookies）
 *
 * 语义：
 *   - 验证码与登录必须共用同一份 Cookie，故用 sid 把 cookie jar 留在函数内存里；
 *   - authed=true 表示该会话已携带「登录成功的教务会话」（query 成功 / import 成功时置位），
 *     供 /sync 免密续拉课表复用，有效期与正方 ASP.NET_SessionId 的默认过期时间基本一致；
 *   - 低并发演示足够；如需强一致可将 jar 落数据库。
 *
 * 依赖：node:crypto
 */

const crypto = require('node:crypto')

const SESSION_TTL = 20 * 60 * 1000
const MAX_SESSIONS = 300
const SESSIONS = new Map()

function purgeSessions() {
  const now = Date.now()
  for (const [sid, s] of SESSIONS) {
    if (now - s.t > SESSION_TTL) SESSIONS.delete(sid)
  }
  if (SESSIONS.size > MAX_SESSIONS) {
    const keys = [...SESSIONS.keys()]
    const drop = keys.length - MAX_SESSIONS + 10
    for (let i = 0; i < drop; i++) SESSIONS.delete(keys[i])
  }
}

function createSession(jar, meta) {
  purgeSessions()
  const sid = crypto.randomBytes(12).toString('hex')
  SESSIONS.set(sid, { jar: jar || new Map(), meta: meta || null, t: Date.now() })
  return sid
}

function takeSession(sid) {
  if (!sid || !SESSIONS.has(sid)) return null
  const s = SESSIONS.get(sid)
  if (Date.now() - s.t > SESSION_TTL) {
    SESSIONS.delete(sid)
    return null
  }
  s.t = Date.now()
  return s
}

module.exports = { SESSION_TTL, MAX_SESSIONS, SESSIONS, purgeSessions, createSession, takeSession }
