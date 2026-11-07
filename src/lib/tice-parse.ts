/**
 * 体测系统（tice.jou.edu.cn:8080）页面解析 · 纯函数。
 *
 * 两个页面的真实结构（fixture：`_shots/zf/tice_Historyhealth.jsp`、`tice_queryHealthInfo.jsp`）：
 *  - `Historyhealth.jsp`：序号 | 学号 | 姓名 | 性别 | 学年 | 体测成绩 | 体测等级 | 详细
 *  - `queryHealthInfo.jsp`：项目名称 | 测试成绩 | 分数 | 结论 | 加分 | 减分 | 体测总成绩 | 体测总结论
 *
 * 两个必须守住的规则（Flutter 版踩过坑，这里照搬）：
 *  1. **0 是有效分数，空才是未公布**（`total` 用 `number | null`）；
 *  2. 表格大量用 `rowspan`，必须按网格展开；首行还可能是 `</tr >`（带空格）闭合，
 *     正则不容忍空格会把两行粘成一行，第二行起「分数」列就错位。
 *
 * 纯模块：不 import 本地文件，方便 `node --test` 直接回归。
 */

export interface TiceItem {
  name: string
  /** 测试成绩原文（如 `0.0`、`-100.0`、`8.5秒`）。 */
  raw: string
  /** 分数；`---` / 空 = 未计分，记 null。 */
  score: number | null
  /** 结论等补充文字。 */
  note: string
}


export type TiceEventView = TiceItem & { weight: number; label?: string }

const TICE_WEIGHT: Record<string, number> = {
  'BMI': 15, '肺活量': 15, '50米跑': 20, '50米': 20,
  '立定跳远': 10, '坐位体前屈': 10, '坐体前屈': 10,
  '1000米跑': 20, '1000米': 20, '800米跑': 20, '800米': 20,
  '引体向上': 10, '仰卧起坐': 10, '左眼视力': 0, '右眼视力': 0,
}

function normalizeName(name: string): string {
  const base = name.replace(/\([^)]*\)/g, '').replace(/\s+/g, '')
  if (base === '坐体前屈') return '坐位体前屈'
  if (base === '千米跑') return '1000米跑'
  if (base.includes('引体向上')) return '引体向上'
  if (base.includes('仰卧起坐')) return '仰卧起坐'
  return base.replace(/^(\d+)米$/, '$1米跑')
}

/** 把原始项目补成展示模型：身高/体重合成 BMI，按国标权重标注。 */
export function ticeEventViews(items: TiceItem[]): TiceEventView[] {
  const height = Number.parseFloat(items.find((item) => item.name.includes('身高'))?.raw ?? '')
  const weight = Number.parseFloat(items.find((item) => item.name.includes('体重'))?.raw ?? '')
  const views: TiceEventView[] = []
  if (Number.isFinite(height) && Number.isFinite(weight) && height > 50 && weight > 10) {
    const bmi = weight / ((height / 100) ** 2)
    views.push({ name: 'BMI', raw: bmi.toFixed(1), score: null, note: `身高 ${height}cm · 体重 ${weight}kg`, weight: 15 })
  }
  for (const item of items) {
    if (item.name.includes('身高') || item.name.includes('体重')) continue
    const name = normalizeName(item.name)
    views.push({ ...item, name, weight: TICE_WEIGHT[name] ?? 0 })
  }
  return views
}
export interface TiceYear {
  /** 归一化成 `2025-2026`。 */
  year: string
  total: number | null
  grade: string
  bonus: number
  items: TiceItem[]
  doneCount: number
  totalCount: number
}

export interface TiceSummary {
  current: TiceYear | null
  history: TiceYear[]
  /** 本次页是否读到了明细（用于区分「没明细」和「没登录」）。 */
  hasCurrentDetail: boolean
}

const NOISE = (text: string) =>
  text === '' || text === '---' || text === '—' || text.includes('具体信息') || text === '详细' || text === '查看'

/** 学年可能是 `2025-2026`、`2526`、`2025`；必须整格匹配，学号 `2023120448` 不能被当成学年。 */
export function normalizeTiceYear(raw: string): string {
  const text = String(raw ?? '').replace(/\s/g, '')
  if (/^20\d{2}[-~—–/至](?:20)?\d{2,4}$/.test(text)) {
    const start = Number.parseInt(text.slice(0, 4), 10)
    return `${start}-${start + 1}`
  }
  const short = text.match(/^(\d{2})(\d{2})$/)
  if (short) {
    const start = 2000 + Number.parseInt(short[1], 10)
    return `${start}-${start + 1}`
  }
  if (/^20\d{2}$/.test(text)) {
    const start = Number.parseInt(text, 10)
    return `${start}-${start + 1}`
  }
  return ''
}

function optionalNumber(text: string): number | null {
  const value = String(text ?? '').trim()
  if (!value || !/-?\d+(?:\.\d+)?/.test(value)) return null
  const match = value.match(/-?\d+(?:\.\d+)?/)
  if (!match) return null
  const parsed = Number.parseFloat(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

function cellAt(row: string[], index: number): string {
  return index >= 0 && index < row.length ? row[index].trim() : ''
}

function indexOfCell(row: string[], test: (cell: string) => boolean): number {
  for (let index = 0; index < row.length; index += 1) {
    if (test(row[index])) return index
  }
  return -1
}

function decodeText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t\u00a0]+/g, ' ')
    .trim()
}

interface SpanCell {
  text: string
  /** 还剩余多少行需要沿用这个值（不含当前行）。 */
  remaining: number
}

/**
 * 把 HTML 表格展开成网格：`rowspan` / `colspan` 的占位填进后续行，
 * 这样「分数」列在第二行之后也不会错位。
 */
export function tableGrid(html: string): string[][] {
  const rows: string[][] = []
  const pending = new Map<number, SpanCell>()
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr\s*>/gi
  const cellPattern = /<(td|th)([^>]*)>([\s\S]*?)<\/\1\s*>/gi

  for (const rowMatch of String(html ?? '').matchAll(rowPattern)) {
    const row: string[] = []
    let col = 0

    for (const cell of (rowMatch[1] ?? '').matchAll(cellPattern)) {
      while (pending.has(col)) {
        const span = pending.get(col)
        if (!span) break
        row.push(span.text)
        if (span.remaining <= 1) pending.delete(col)
        else pending.set(col, { text: span.text, remaining: span.remaining - 1 })
        col += 1
      }

      const attrs = cell[2] ?? ''
      const text = decodeText(cell[3] ?? '')
      const rowspan = spanAttr(attrs, 'rowspan')
      const colspan = spanAttr(attrs, 'colspan')

      row.push(text)
      if (rowspan > 1) pending.set(col, { text, remaining: rowspan - 1 })
      for (let extra = 1; extra < colspan; extra += 1) {
        row.push('')
        col += 1
      }
      col += 1
    }

    // 行尾补齐本行还没消费掉的 rowspan（真实体测表：后 4 列只在第一行有 td）
    for (;;) {
      const keys = [...pending.keys()].filter((key) => key >= col).sort((a, b) => a - b)
      if (!keys.length) break
      const key = keys[0]
      while (col < key) {
        row.push('')
        col += 1
      }
      const span = pending.get(key)
      if (!span) break
      row.push(span.text)
      if (span.remaining <= 1) pending.delete(key)
      else pending.set(key, { text: span.text, remaining: span.remaining - 1 })
      col += 1
    }

    if (row.some((cell) => cell.trim() !== '')) rows.push(row)
  }
  return rows
}

function spanAttr(attrs: string, name: string): number {
  const match = attrs.match(new RegExp(`${name}\\s*=\\s*["']?\\s*(\\d+)`, 'i'))
  return match ? Number.parseInt(match[1], 10) || 1 : 1
}

/** 解析历年汇总表。优先按表头定位列；没有表头时退回「能归一化成学年的那一格」。 */
export function parseTiceHistory(html: string): TiceYear[] {
  const rows = tableGrid(html)
  if (!rows.length) return []

  let yearCol = -1
  let scoreCol = -1
  let gradeCol = -1
  for (const row of rows) {
    const year = indexOfCell(row, (cell) => cell.includes('学年'))
    const score = indexOfCell(row, (cell) => cell.includes('体测成绩') || cell.includes('成绩'))
    if (year >= 0 && score >= 0) {
      yearCol = year
      scoreCol = score
      gradeCol = indexOfCell(row, (cell) => cell.includes('等级'))
      break
    }
  }

  const years: TiceYear[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const yearIndex = yearCol >= 0 ? yearCol : row.findIndex((cell) => normalizeTiceYear(cell) !== '')
    if (yearIndex < 0 || yearIndex >= row.length) continue
    const year = normalizeTiceYear(row[yearIndex])
    if (!year || seen.has(year)) continue
    seen.add(year)
    const scoreText = cellAt(row, scoreCol >= 0 ? scoreCol : yearIndex + 1)
    const gradeText = cellAt(row, gradeCol >= 0 ? gradeCol : yearIndex + 2)
    years.push({
      year,
      total: optionalNumber(scoreText),
      grade: NOISE(gradeText) ? '' : gradeText,
      bonus: 0,
      items: [],
      doneCount: 0,
      totalCount: 0,
    })
  }
  years.sort((a, b) => b.year.localeCompare(a.year))
  return years
}

/** 解析「本次」体测明细（queryHealthInfo.jsp）。页面不带学年，由调用方补。 */
export function parseTiceCurrent(html: string, year = ''): TiceYear | null {
  const rows = tableGrid(html)
  if (!rows.length) return null

  let headerIndex = -1
  let nameCol = -1
  let rawCol = -1
  let scoreCol = -1
  let noteCol = -1
  let bonusCol = -1
  let totalCol = -1
  let gradeCol = -1
  for (let index = 0; index < rows.length; index += 1) {
    const name = indexOfCell(rows[index], (cell) => cell.includes('项目名称'))
    if (name < 0) continue
    headerIndex = index
    nameCol = name
    rawCol = indexOfCell(rows[index], (cell) => cell.includes('测试成绩'))
    scoreCol = indexOfCell(rows[index], (cell) => cell === '分数' || cell.includes('分数'))
    noteCol = indexOfCell(rows[index], (cell) => cell.includes('结论') && !cell.includes('总'))
    bonusCol = indexOfCell(rows[index], (cell) => cell.includes('加分'))
    totalCol = indexOfCell(rows[index], (cell) => cell.includes('体测总成绩'))
    gradeCol = indexOfCell(rows[index], (cell) => cell.includes('总结论'))
    break
  }
  if (headerIndex < 0) return null

  const items: TiceItem[] = []
  let grade = ''
  let total: number | null = null
  let bonus = 0

  for (const row of rows.slice(headerIndex + 1)) {
    const name = cellAt(row, nameCol)
    if (!name || name.includes('项目名称')) continue
    const rawScore = cellAt(row, rawCol)
    const score = optionalNumber(cellAt(row, scoreCol))
    const note = cellAt(row, noteCol)
    items.push({
      name,
      raw: NOISE(rawScore) ? '' : rawScore,
      score,
      note: NOISE(note) ? '' : note,
    })
    total ??= optionalNumber(cellAt(row, totalCol))
    const gradeValue = cellAt(row, gradeCol)
    if (!grade && !NOISE(gradeValue)) grade = gradeValue
    if (bonus === 0) bonus = optionalNumber(cellAt(row, bonusCol)) ?? 0
  }

  if (!items.length) return null
  return {
    year,
    total,
    grade,
    bonus,
    items,
    doneCount: items.filter((item) => item.score !== null).length,
    totalCount: items.length,
  }
}

/**
 * 两页合并：历年表给总分/等级，「本次」页给项目明细。
 * 本次页总分是 0 占位而历年表同学年已有最终分时以历年表为准；两边都没有保持 null。
 */

/** 历年「具体信息」页：项目名称/测试成绩/分数/结论，按制表符逐行解析。 */
export function parseTiceDetailText(text: string, year: string): TiceYear | null {
  const lines = String(text ?? '').split(/\r?\n/)
  const items: TiceItem[] = []
  let started = false
  let total: number | null = null
  let grade = ''
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!started) {
      if (line.includes('项目名称')) started = true
      continue
    }
    if (!line) continue
    if (line.startsWith('总计')) {
      const cells = line.split('\t').map((cell) => cell.trim())
      const value = Number.parseFloat(cells[3] ?? '')
      if (Number.isFinite(value)) total = value
      grade = cells[4] ?? ''
      break
    }
    const cells = line.split('\t').map((cell) => cell.trim())
    if (cells.length < 3) continue
    const name = cells[1] ?? ''
    if (!name || /^\d+$/.test(name)) continue
    const scoreValue = Number.parseFloat(cells[3] ?? '')
    items.push({ name, raw: cells[2] ?? '', score: Number.isFinite(scoreValue) ? scoreValue : null, note: cells[4] ?? '' })
    if (items.length >= 16) break
  }
  return items.length ? { year, total, grade, bonus: 0, items, doneCount: items.length, totalCount: 10 } : null
}
export function mergeTicePages(history: TiceYear[], current: TiceYear | null): TiceSummary {
  let resolved = current
  if (resolved) {
    const matched = resolved.year ? history.find((year) => year.year === resolved?.year) : undefined
    const total = resolved.total !== null && resolved.total > 0 ? resolved.total : (matched?.total ?? resolved.total)
    resolved = {
      ...resolved,
      total,
      grade: resolved.grade || matched?.grade || '',
    }
  }
  return {
    current: resolved ?? history[0] ?? null,
    history,
    hasCurrentDetail: Boolean(current && current.items.length),
  }
}

export function parseTicePages(input: {
  historyHtml?: string | null
  currentHtml?: string | null
  currentYear?: string
}): TiceSummary {
  const history = input.historyHtml ? parseTiceHistory(input.historyHtml) : []
  const current = input.currentHtml
    ? parseTiceCurrent(input.currentHtml, input.currentYear ?? history[0]?.year ?? '')
    : null
  return mergeTicePages(history, current)
}

/* ------------------------------ 文字导入 ------------------------------ */

const ITEM_NAMES = [
  '身高测量', '身高', '体重测量', '体重', '肺活量', '50米跑', '50米', '立定跳远',
  '1000米跑', '1000米', '800米跑', '800米', '坐位体前屈', '坐体前屈', '引体向上',
  '仰卧起坐', '左眼视力', '右眼视力', '视力',
]

function splitCells(line: string): string[] {
  const tabs = line.split('\t').map((cell) => cell.trim()).filter(Boolean)
  if (tabs.length >= 2) return tabs
  return line.split(/\s*\|\s*|\s{2,}/).map((cell) => cell.trim()).filter(Boolean)
}

function tokensOf(line: string): string[] {
  const cells = splitCells(line)
  if (cells.length >= 2) return cells
  return line.split(/\s+/).map((token) => token.trim()).filter(Boolean)
}

function findItemName(line: string): string | null {
  for (const name of ITEM_NAMES) if (line.includes(name)) return name
  return null
}

/**
 * 解析从体测页面「全选复制」出来的纯文字。
 *
 * 手机浏览器复制表格后通常是每行一条、单元格用制表符或连续空格分隔；
 * 也兼容 `2025-2026 70 及格` 这种空格分隔。没有表头时按「能归一化成学年的那一格」定位。
 */
export function parseTiceText(text: string): TiceSummary {
  const lines = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\u00a0\u3000]/g, ' ').trim())
    .filter(Boolean)

  const history: TiceYear[] = []
  const seen = new Set<string>()
  const items: TiceItem[] = []
  let currentTotal: number | null = null
  let currentGrade = ''

  for (const line of lines) {
    const tokens = tokensOf(line)
    const yearIndex = tokens.findIndex((token) => normalizeTiceYear(token) !== '')
    if (yearIndex >= 0 && !findItemName(line)) {
      const year = normalizeTiceYear(tokens[yearIndex])
      if (year && !seen.has(year)) {
        seen.add(year)
        const next = tokens.slice(yearIndex + 1)
        const total = next.length ? optionalNumber(next[0]) : null
        const grade = next.slice(1).find((token) => !/\d/.test(token) && !NOISE(token)) ?? ''
        history.push({ year, total, grade, bonus: 0, items: [], doneCount: 0, totalCount: 0 })
        continue
      }
    }

    const itemName = findItemName(line)
    if (itemName) {
      const tail = line.slice(line.indexOf(itemName) + itemName.length)
      const values = tail.split(/\s*\|\s*|\t+|\s{2,}|\s+/).map((value) => value.trim()).filter(Boolean)
      const raw = values[0] ?? ''
      const scoreToken = values[1] ?? ''
      items.push({
        name: itemName,
        raw: NOISE(raw) ? '' : raw,
        score: /^-?\d+(?:\.\d+)?$/.test(scoreToken) ? optionalNumber(scoreToken) : null,
        note: NOISE(scoreToken) ? '' : scoreToken,
      })
      continue
    }

    const totalLine = line.match(/体测总(?:成绩|分)[^\d-]{0,6}(-?\d+(?:\.\d+)?)/)
    if (totalLine && currentTotal === null) currentTotal = Number.parseFloat(totalLine[1])
    const gradeLine = line.match(/体测总(?:结论|等级)[^\u4e00-\u9fff]{0,4}([\u4e00-\u9fff]{1,8})/)
    if (gradeLine && !currentGrade) currentGrade = gradeLine[1]
  }

  history.sort((a, b) => b.year.localeCompare(a.year))
  const current: TiceYear | null = items.length
    ? {
        year: history[0]?.year ?? '',
        total: currentTotal,
        grade: currentGrade,
        bonus: 0,
        items,
        doneCount: items.filter((item) => item.score !== null).length,
        totalCount: items.length,
      }
    : null
  return mergeTicePages(history, current)
}

/** 统一入口：含表格标签按 HTML 解析，否则按复制文字解析。 */
export function parseTicePaste(text: string): TiceSummary {
  const raw = String(text ?? '')
  if (/<\s*(table|tr|td|th)\b/i.test(raw)) return parseTicePages({ historyHtml: raw, currentHtml: raw })
  return parseTiceText(raw)
}

export function ticeYearTotalKnown(year: TiceYear | null): boolean {
  return Boolean(year && year.total !== null)
}
