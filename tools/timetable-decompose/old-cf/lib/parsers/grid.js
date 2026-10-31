'use strict'
/**
 * 【模块】解析器 · 旧版正方周课表「网格型」
 *
 * 来源：原 index.js 第 902-1043 行（夹在「教务抓取」与「zfnet 课表抓取」两节之间的
 * 通用表格解析函数组），代码逐行搬运。
 *
 * 形态：星期表头 × 纵向节次 的矩阵表，一格一门课（可能 rowspan 跨节）。
 * 这是正方 legacy 形态最常见的一种课表页。
 *
 * 依赖：../weeks
 */

const { parseZcd } = require('../weeks')

const WEEKDAY_TEXT = ['一', '二', '三', '四', '五', '六', '日']
const WEEKDAY_CELL_RE = new RegExp(`星期[${WEEKDAY_TEXT.join('')}]|周[${WEEKDAY_TEXT.join('')}]|(?:周|礼拜)[${WEEKDAY_TEXT.join('')}]`)

function dayOf(s) {
  const ch = /[一二三四五六日]/.exec(s)
  return ch ? '一二三四五六日'.indexOf(ch[0]) + 1 : 0
}

/** 把旧版课表 HTML 表格拆成行×列单元格（正则级，够用即可） */
function sliceTableRows(html) {
  const norm = html.replace(/<br\s*\/?>/gi, '\n').replace(/<p[^>]*>/gi, '\n').replace(/<\/p>/gi, '\n')
  const rows = []
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  const tdRe = /<td[^>]*>([\s\S]*?)<\/td>|<th[^>]*>([\s\S]*?)<\/th>/gi
  let m
  while ((m = trRe.exec(norm)) !== null) {
    const inner = m[1]
    const cells = []
    let cm
    tdRe.lastIndex = 0
    while ((cm = tdRe.exec(inner)) !== null) {
      const open = /^<(td|th)[^>]*>/i.exec(cm[0])
      const attrs = open ? open[0] : ''
      const rowspan = /rowspan=["'](\d+)["']/i.exec(attrs)
      const text = stripTags(cm[1] !== undefined ? cm[1] : cm[2] || '')
      cells.push({
        text: text.replace(/\u00a0/g, ' ').trim(),
        rowspan: rowspan ? Number(rowspan[1]) : 1,
      })
    }
    rows.push(cells)
  }
  return rows
}

function stripTags(s) {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#\d+;/g, ' ')
    .replace(/\n{2,}/g, '\n')
}

function looksLikeCourse(text) {
  if (!text || text.length > 80) return false
  if (WEEKDAY_CELL_RE.test(text) || /^(节次|时间|星期|上午|下午)/.test(text)) return false
  return /[\u4e00-\u9fa5A-Za-z0-9]{2,}/.test(text)
}

/** 单个课表单元格 → {name, teacher, room, zcd}（内容按 <br> 分行） */
function parseCourseCell(text) {
  const lines = text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (!lines.length) return {}
  const name = lines[0].replace(/^(第)?[\d,、]*(单|双)?\s*节[:：]?\s*/g, '')
  let teacher = ''
  let room = ''
  let zcd = ''
  for (const ln of lines.slice(1)) {
    if (/^(第)?\d{1,2}([-~—至]\d{1,2})?节/.test(ln) || /^\d{1,2}:\d{2}/.test(ln)) continue
    if (!zcd && /\d{1,2}\s*[-~—至]\s*\d{1,2}\s*周?/.test(ln)) {
      zcd = ln
      continue
    }
    if (!room && /(楼|馆|室|实验|实训|报告厅|\d+号|区)/.test(ln) && ln.length <= 30) {
      room = ln
      continue
    }
    if (!teacher && ln.length <= 12) teacher = ln
  }
  return { name, teacher, room, zcd }
}

/**
 * 旧版正方周课表为「星期表头 × 纵向节次」矩阵：按表头识别星期列，
 * 逐行推进节次（尊重 rowspan），把课程单元格还原成周/星期/节次发生行。
 * 无法识别表头结构时返回 null（由上层按失败处理并提示，不输出错误数据）。
 */
function walkLegacyGrid(html) {
  const rows = sliceTableRows(html)
  if (!rows.length) return null
  let head = -1
  let dayMap = []
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const hits = rows[i].filter((c) => WEEKDAY_CELL_RE.test(c.text)).length
    if (hits >= 5) {
      head = i
      dayMap = rows[i].map((c) => (WEEKDAY_CELL_RE.test(c.text) ? dayOf(c.text) : 0))
      break
    }
  }
  if (head < 0) return null

  const out = []
  const stateSec = []
  const stateRem = []
  for (let r = head + 1; r < rows.length; r++) {
    const cs = rows[r]
    // 行首节次标签（如 “1” 单独成列）可用于校准节次起点
    let labelRow = 0
    for (let i = 0; i < cs.length; i++) {
      if (dayMap[i] !== 0) break
      const n = /^(\d{1,2})$/.exec(cs[i].text.trim())
      if (n) labelRow = Number(n[1])
    }
    for (let i = 0; i < cs.length; i++) {
      if (!dayMap[i]) continue
      const span = cs[i] ? Math.max(1, cs[i].rowspan || 1) : 1
      if (stateRem[i] > 0) {
        stateRem[i]--
        continue
      }
      const sec = labelRow || stateSec[i] || 1
      const cell = cs[i] || { text: '' }
      if (looksLikeCourse(cell.text)) {
        const info = parseCourseCell(cell.text)
        const weeks = parseZcd(info.zcd || '')
        if (info.name && weeks.length) {
          const secs = []
          for (let s = sec; s < sec + span; s++) secs.push(s)
          for (const w of weeks) {
            out.push({
              week: w,
              day: dayMap[i],
              sections: secs,
              name: info.name,
              teacher: info.teacher || '',
              room: info.room || '',
            })
          }
        }
      }
      stateSec[i] = sec + span
      stateRem[i] = span - 1
    }
  }
  return out.length ? out : []
}

module.exports = {
  WEEKDAY_TEXT,
  WEEKDAY_CELL_RE,
  dayOf,
  sliceTableRows,
  stripTags,
  looksLikeCourse,
  parseCourseCell,
  walkLegacyGrid,
}
