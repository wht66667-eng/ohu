'use strict'
/**
 * 【模块】解析器 · 江苏海洋大学 xs_main 首页「日行课表」
 *
 * 来源：原 index.js 第 1097-1164 行，代码逐行搬运。
 * 这是本项目最先落地的格式（本校实测），也是三种解析器里优先级最高的一种。
 *
 * 依赖：./grid（stripTags）、../weeks（parseZcd）
 */

const { stripTags } = require('./grid')
const { parseZcd } = require('../weeks')

/**
 * 江苏海洋大学 xs_main 首页「周课表」：行=星期，单元格内多门课纵向堆叠。
 * 每门课常见三行：`3-4节 (1-10周)` / 课程名 / `教学楼101`；单双周如 `(8-12|双周)`。
 * 识别不了返回 null。
 */
function walkJouDayRowSchedule(html) {
  const plain = stripTags(
    String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|tr|td|th)>/gi, '\n'),
  )
  if (!/星期[一二三四五六日]/.test(plain) || !/\d{1,2}\s*[-~—至]\s*\d{1,2}\s*节/.test(plain)) return null

  const dayMap = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7 }
  const parts = plain.split(/(?=星期[一二三四五六日])/)
  const out = []
  for (const part of parts) {
    const dm = /星期([一二三四五六日])/.exec(part)
    if (!dm) continue
    const day = dayMap[dm[1]]
    if (!day) continue
    const lines = part
      .split(/\n+/)
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    for (let i = 0; i < lines.length; i++) {
      const secM = /(\d{1,2})\s*[-~—至]\s*(\d{1,2})\s*节\s*[（(]\s*([^）)]+?)\s*[）)]/.exec(lines[i])
      if (!secM) continue
      const s1 = Number(secM[1])
      const s2 = Number(secM[2])
      if (s1 < 1 || s1 > 12 || s2 < s1 || s2 > 12) continue
      const weeks = parseZcd(secM[3])
      if (!weeks.length) continue
      let name = lines[i].slice(secM.index + secM[0].length).trim()
      let room = ''
      let j = i + 1
      if (!name || /^\d{1,2}\s*[-~]/.test(name) || /^星期/.test(name)) {
        name = ''
        while (j < lines.length) {
          const cand = lines[j]
          if (/(\d{1,2})\s*[-~—至]\s*(\d{1,2})\s*节/.test(cand) || /^星期/.test(cand)) break
          if (/[\u4e00-\u9fa5A-Za-z]{2,}/.test(cand) && cand.length <= 40) {
            name = cand
            j++
            break
          }
          j++
        }
      }
      if (j < lines.length) {
        const cand = lines[j]
        if (
          /^[A-Za-z]?[\u4e00-\u9fa5A-Za-z]*\d{2,4}$/.test(cand) ||
          /(楼|馆|室|文思|文通|苍梧)/.test(cand)
        ) {
          room = cand
        }
      }
      if (!name) continue
      const sections = []
      for (let s = s1; s <= s2; s++) sections.push(s)
      for (const week of weeks) {
        out.push({ week, day, sections, name, teacher: '', room: room || '' })
      }
    }
  }
  return out.length ? out : null
}

module.exports = { walkJouDayRowSchedule }
