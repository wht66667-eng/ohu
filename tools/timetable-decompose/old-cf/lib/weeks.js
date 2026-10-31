'use strict'
/**
 * 【模块】周次解析与课表扁平化
 *
 * 来源：原 index.js「周次解析」一节（原第 380-455 行），代码逐行搬运。
 * 这是整条链路里「最容易被各校课表格式打穿」的一层，故单独成模块、单独可测。
 *
 * 依赖：无
 */

/**
 * 把 zcd 展开为周数组。
 * 兼容： "1-16周" / "1-17周(单)" / "1-8周,18周"
 * 以及江苏海洋大学首页周课表特例： "(8-12|双周)" / "(9-9|单周)"
 */
function parseZcd(text) {
  const src = String(text || '')
    .replace(/\s+/g, '')
    .replace(/(\d{1,2})-(\d{1,2})\|双周?/g, '$1-$2周(双)')
    .replace(/(\d{1,2})-(\d{1,2})\|单周?/g, '$1-$2周(单)')
    .replace(/(\d{1,2})\|双周?/g, '$1周(双)')
    .replace(/(\d{1,2})\|单周?/g, '$1周(单)')
  const out = new Set()
  const segs = String(src).match(/(\d{1,2})(?:-(\d{1,2}))?周?(?:[(（](单|双)[)）])?/g) || []
  if (!segs.length) {
    // 兜底：纯数字串
    for (const m of String(src).match(/\d{1,2}/g) || []) out.add(Number(m))
    return [...out].sort((a, b) => a - b)
  }
  let parity = 0 // 0 全 / 1 单 / 2 双
  let modeGlobal = String(src).match(/[(（](单|双)[)）]/)
  if (modeGlobal) parity = modeGlobal[1] === '单' ? 1 : 2
  for (const seg of segs) {
    const mm = /(\d{1,2})(?:-(\d{1,2}))?周?(?:[(（](单|双)[)）])?/.exec(seg)
    if (!mm) continue
    const a = Number(mm[1])
    const b = mm[2] ? Number(mm[2]) : a
    const p = mm[3] ? (mm[3] === '单' ? 1 : 2) : parity
    for (let w = Math.min(a, b); w <= Math.max(a, b); w++) {
      if (p && w % 2 !== (p === 1 ? 1 : 0)) continue
      out.add(w)
    }
  }
  return [...out].sort((x, y) => x - y).filter((w) => w >= 1 && w <= 25)
}

function sectionsFrom(row) {
  const start = parseInt(String(row.skjc || '1'), 10) || 1
  const rawEnd = String(row.skjs ?? '').trim()
  let end = start + 1
  if (rawEnd !== '') {
    const n = Number(rawEnd)
    if (!Number.isNaN(n)) {
      if (n >= start && n <= 12) end = n // skjs 视为「结束节」
      else if (n >= 1 && n <= 6) end = start + n - 1 // skjs 视为「节数」
    }
  }
  const arr = []
  for (let i = start; i <= end && i <= 12; i++) arr.push(i)
  return arr.length ? arr : [start]
}

/** 课表条目 → 扁平 occurrence {week, day, sections, name, teacher, room} */
function flatten(courses) {
  const rows = []
  for (const c of courses) {
    if (!c || !c.name) continue
    const weeks = parseZcd(c.zcd)
    const day = Number(c.xqj || c.day || 0)
    if (!day || day < 1 || day > 7) continue
    for (const week of weeks) {
      rows.push({
        week,
        day,
        sections: sectionsFrom(c),
        name: c.name,
        teacher: c.teacher || '',
        room: c.room || '',
      })
    }
  }
  rows.sort((a, b) => a.day - b.day || a.week - b.week || a.sections[0] - b.sections[0])
  return rows
}

module.exports = { parseZcd, sectionsFrom, flatten }
