'use strict'
/**
 * 【模块】解析器 · 统一出口
 *
 * 来源：原 index.js 的 parseSchedule（原第 1166-1202 行），代码逐行搬运。
 *
 * 这是「一页 HTML/JSON → 扁平课表行」的唯一入口，四种形态按优先级串起来：
 *   ① JSON（新版 jwglxt 的 kbList 接口）
 *   ② JOU 首页「行=星期」周课表（优先于旧版网格，避免误拆）
 *   ③ 旧版正方「列=星期」网格
 *   ④ 通用「课程列表」表格
 * 全部识别不了返回 null —— 宁可不给数据，也不给脏数据。
 *
 * 依赖：./jou-dayrow、./grid、./course-list、../weeks、../json-util
 */

const { walkJouDayRowSchedule } = require('./jou-dayrow')
const { walkLegacyGrid } = require('./grid')
const { parseCourseListTable } = require('./course-list')
const { flatten } = require('../weeks')
const { findFirstArray } = require('../json-util')

/**
 * 把任意教务页面文本解析成扁平行：JSON / JOU 日行课表 / 旧版网格 / 课程列表。
 * 识别不了返回 null（由上层按失败处理并提示，不输出脏数据）。
 */
function parseSchedule(html, term) {
  if (!html) return null
  const trimmed = html.trim()
  if (/^[{[]/.test(trimmed)) {
    try {
      const data = JSON.parse(trimmed)
      const list = findFirstArray(data)
      if (Array.isArray(list) && list.length)
        return {
          rows: flatten(
            list.map((row) => ({
              xqj: row.xqj,
              skjc: row.skjc,
              skjs: row.skjs,
              zcd: row.zcd,
              name: row.kcmc || row.kcm || row.kc || row.kcmc2 || '',
              teacher: row.xm || row.jsmc || row.jsxx || '',
              room: row.jxdd || row.cdmc || '',
            })),
          ),
          term: term.label,
        }
    } catch (_) {}
  }
  // JOU 首页周课表（行=星期）优先于「列=星期」旧版网格，避免误拆
  const jou = walkJouDayRowSchedule(html)
  if (jou && jou.length) return { rows: jou, term: term.label }
  const grid = walkLegacyGrid(html)
  if (grid && grid.length) return { rows: grid, term: term.label }
  const listRows = parseCourseListTable(html)
  if (listRows && listRows.length) return { rows: listRows, term: term.label }
  return null
}

module.exports = { parseSchedule }
