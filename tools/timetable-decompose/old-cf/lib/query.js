'use strict'
/**
 * 【模块】爬取主流程 doQuery（账号密码 + 验证码 的自动登录链路）
 *
 * 来源：原 index.js「爬取主流程」一节（原第 1419-1452 行），代码逐行搬运。
 *
 * 错误码语义（前端按码分支提示，改动前先看 README 的错误码表）：
 *   1001 验证码错误 / 1002 账号或密码错误 / 1003 验证码会话过期 / 1004 教务不可达或未识别
 *   2002 教务会话已失效 / 2003 无可复用会话 / 2004 WebVPN 会话不可用
 *
 * 依赖：./config、./sessions、./term、./login、./crawl
 */

const { CONF } = require('./config')
const { takeSession } = require('./sessions')
const { guessTerm } = require('./term')
const { tryLogin, fetchJwglxtSchedule, fetchLegacySchedule } = require('./login')
const { fetchZfnetSchedule } = require('./crawl')

async function doQuery(ctx, sid, cred) {
  if (!CONF.base) return { code: '1004', message: '教务系统尚未接入（未配置 JW_BASE_URL），请先完成配置' }

  const rec = takeSession(sid)
  if (!rec) return { code: '1003', message: '验证码会话已过期，请刷新后再试' }
  const { jar, meta } = rec

  const login = await tryLogin(ctx, jar, cred, meta)
  if (!login.ok) {
    // 1001/1002 = 验证码/账密错；2004 = WebVPN 会话不可用。三类都要原样透传，前端提示才有区分度。
    if (login.code === '1001' || login.code === '1002' || login.code === '2004')
      return { code: login.code, message: login.reason }
    // 教务不可达 / 登录流程未识别（含 1004）：不再伪造课表，返回明确错误提示
    return { code: '1004', message: login.reason || '教务系统暂时不可达，请稍后再试' }
  }

  try {
    const term = guessTerm()
    const res =
      login.mode === 'jwglxt'
        ? await fetchJwglxtSchedule(ctx, jar, cred)
        : login.mode === 'zfnet'
          ? await fetchZfnetSchedule(ctx, jar, cred, login)
          : await fetchLegacySchedule(ctx, jar, cred)
    if (!res || !res.rows) throw { kind: 'parse', msg: '未能解析到课表数据，请稍后重试' }
    // 登录成功且取到真实课表 → 本会话标记为「已登录」，供 /sync 在约 20 分钟内免密续拉课表
    rec.authed = true
    return { term: res.term || term.label, rows: res.rows || [] }
  } catch (e) {
    return { code: '1004', message: (e && e.msg) || '课表拉取失败，请稍后再试' }
  }
}

module.exports = { doQuery }
