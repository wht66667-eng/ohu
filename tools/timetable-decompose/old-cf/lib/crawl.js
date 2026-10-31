'use strict'
/**
 * 【模块】课表页爬取（BFS 逐级跟随）
 *
 * 来源：原 index.js 第 1204-1257 行，代码逐行搬运。
 * 原文件把它放在「zfnet 课表抓取」一节里，但它被三条链路共用
 * （zfnet 自动登录、legacy/jwglxt 自动登录、Cookie 手工导入），故独立成模块。
 *
 * 依赖：./config、./http、./term、./parsers
 */

const { CONF } = require('./config')
const { reqText } = require('./http')
const { guessTerm } = require('./term')
const { parseSchedule } = require('./parsers')

/** 收集页面里“课表”锚点与 frame/iframe 的地址（自动登录与 Cookie 导入共用） */
function scanScheduleHrefs(html) {
  const out = []
  const norm = (u) => String(u).replace(/&amp;/g, '&').trim()
  for (const m of html.matchAll(/<(?:a|area)\b[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,80}?)<\/(?:a|area)>/gi)) {
    const t = (m[2] || '').replace(/<[^>]+>/g, '')
    if (/(课表|我的课表|课程表|课表查询|学期课表|个人课表)/.test(t) || /(xskb|kbcx|\bkb\b)/i.test(m[1])) out.push(norm(m[1]))
  }
  for (const m of html.matchAll(/<(?:frame|iframe)\b[^>]+src=["']([^"']+)["']/gi)) out.push(norm(m[1]))
  return out
}

/** 广度优先逐级抓取课表页：自动登录链路与 Cookie 导入链路共用 */
async function crawlSchedule(ctx, jar, seeds, cap = 12) {
  const seen = new Set()
  const queue = [...seeds].filter(Boolean)
  const term = guessTerm()
  for (let d = 0; d < queue.length && d < cap; d++) {
    const url = queue[d]
    if (seen.has(url)) continue
    seen.add(url)
    let page
    try {
      page = await reqText(ctx, url, jar, { headers: { Referer: CONF.base + '/' } })
    } catch (_) {
      continue
    }
    if (page.status !== 200) continue
    const r = parseSchedule(page.text, term)
    if (r) return r
    for (const h of scanScheduleHrefs(page.text)) {
      let abs
      try {
        abs = new URL(h, url).toString()
      } catch (_) {
        continue
      }
      if (!seen.has(abs)) queue.push(abs)
    }
  }
  return null
}

/** zfnet 自动登录成功后的课表获取：登录落点页→（frame/课表链接逐级）→ 三种解析 */
async function fetchZfnetSchedule(ctx, jar, cred, login) {
  const term = guessTerm()
  let r = parseSchedule(login.navText, term)
  if (r) return r
  return await crawlSchedule(ctx, jar, [
    `${CONF.base}/xskbcx.aspx`,
    `${CONF.base}/kbcx.aspx`,
    login.navUrl ? new URL(login.navUrl, CONF.base).toString() : '',
  ])
}

module.exports = { scanScheduleHrefs, crawlSchedule, fetchZfnetSchedule }
