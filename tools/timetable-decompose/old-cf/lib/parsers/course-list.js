'use strict'
/**
 * 【模块】解析器 · 「课程列表型」表格
 *
 * 来源：原 index.js「zfnet 课表抓取」一节首个函数（原第 1047-1095 行），代码逐行搬运。
 *
 * 形态：每行一节课，行内同时含 星期 / 节次 / 周次 三要素（zfnet 与部分新版页面）。
 *
 * 依赖：./grid（sliceTableRows）、../weeks（parseZcd）
 */

const { sliceTableRows } = require('./grid')
const { parseZcd } = require('../weeks')

/** 通用「课程列表型」表格解析：每行一节课，行内含 星期/节次/周次 三要素。识别不了返回 null。 */
function parseCourseListTable(html) {
  const norm = html.replace(/<br\s*\/?>/gi, '\n')
  const rows = sliceTableRows(norm)
  if (rows.length < 2) return null
  const out = []
  for (const row of rows) {
    const cells = row.map((c) => c.text.replace(/\s+/g, ' ').trim()).filter(Boolean)
    if (cells.length < 4) continue
    const joined = cells.join(' ')
    const dayM = /(?:星期|周)([一二三四五六日])/.exec(joined)
    const secM = /(?:第)?(\d{1,2})\s*(?:[-~—至]\s*(\d{1,2}))?\s*节/.exec(joined)
    const weekM = /(\d{1,2}\s*(?:[-~—,，、至]\s*\d{1,2})+)\s*周/.exec(joined)
    if (!dayM || !secM || !weekM) continue
    const day = '一二三四五六日'.indexOf(dayM[1]) + 1
    const s1 = Number(secM[1])
    const s2 = secM[2] ? Number(secM[2]) : s1
    if (s1 < 1 || s1 > 12 || s2 < s1 || s2 > 12) continue
    // 该行的课程名/教室/教师：从其余单元格里挑
    let name = ''
    let teacher = ''
    let room = ''
    let weekCell = ''
    for (const t of cells) {
      const tt = t.trim()
      if (!tt) continue
      if (/^(?:星期|周)[一二三四五六日]/.test(tt)) continue
      if (/节/.test(tt) || /^第?\d{1,2}\s*[-~至]?\s*\d{0,2}$/.test(tt)) continue
      if (/周/.test(tt) && /\d/.test(tt)) {
        weekCell = tt
        continue
      }
      if (tt.length < 2 || tt.length > 40 || /^(序号|学号|姓名|课程代码|课程号)$/.test(tt)) continue
      if (!name && /[\u4e00-\u9fa5A-Za-z]/.test(tt) && !/^\d/.test(tt)) {
        name = tt
        continue
      }
      if (/[A-Za-z\u4e00-\u9fa5]{1,20}(楼|馆|室|报告厅|中心|区)|^\d{1,3}$/.test(tt)) room = tt
      else if (!teacher && tt.length <= 12) teacher = tt
    }
    if (!name || !weekCell) continue
    const weeks = parseZcd(weekCell.replace(/[周次]+/g, '周'))
    if (!weeks.length) continue
    const sections = []
    for (let s = s1; s <= s2; s++) sections.push(s)
    for (const w of weeks) out.push({ week: w, day, sections, name, teacher: teacher || '', room: room || '' })
  }
  return out.length >= 2 ? out : null
}

module.exports = { parseCourseListTable }
