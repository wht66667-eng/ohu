/**
 * 正方教务 HTML 解析 · 纯函数（不依赖网络，方便 fixture 回归）。
 *
 * 结构来自真实页面与 Flutter 版 `zf_html_parser.dart`：
 *  - 成绩 `#Datagrid1`：学年 | 学期 | 课程代码 | 课程名称 | 课程性质 | 课程归属 | 学分 | 绩点 | 成绩
 *  - 课表 `#Table1`：首列节次，其余七列周一到周日，格子里是「课名 周X第N,M节{第A-B周} 教师 地点」
 *  - 考试 `#Datagrid1`：课程 | 考试时间 | 地点 | 座位号 | 形式
 *
 * 纯模块：不 import 本地文件，方便 `node --test` 直接回归。
 */

export interface ZfGradeRow {
  year: string
  term: string
  code: string
  name: string
  nature: string
  credit: string
  score: string
  gpa: string
}

export interface ZfExamRow {
  year: string
  term: string
  code: string
  name: string
  datetime: string
  room: string
  form: string
  seat: string
  campus: string
  teacher: string
}

export interface ZfCourseRow {
  week: number
  day: number
  sections: number[]
  name: string
  teacher: string
  room: string
}

const YEAR = /^\d{4}-\d{4}$/

function findTable(html: string, id: string): string | null {
  const open = new RegExp(`<table[^>]*\\bid\\s*=\\s*["']?${id}["']?[^>]*>`, 'i')
  const match = open.exec(html)
  if (!match) return null
  const start = match.index + match[0].length
  const tag = /<table\b[^>]*>|<\/table\s*>/gi
  tag.lastIndex = start
  let depth = 1
  let token: RegExpExecArray | null
  while ((token = tag.exec(html))) {
    if (/^<table/i.test(token[0])) depth += 1
    else {
      depth -= 1
      if (depth === 0) return html.slice(start, token.index)
    }
  }
  return html.slice(start)
}

function fallbackTable(html: string, id: string): string | null {
  const tables = html.matchAll(/<table[^>]*>([\s\S]*?)<\/table\s*>/gi)
  for (const table of tables) {
    const body = table[1] ?? ''
    if (id === 'Datagrid1' && body.includes('>学年<')) return body
    if (id === 'kbtable' && (body.includes('节次/星期') || body.includes('节次'))) return body
  }
  return null
}

function tableRows(html: string, id: string): string[][] {
  const body = findTable(html, id) ?? fallbackTable(html, id)
  if (!body) return []
  const rows: string[][] = []
  for (const row of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
    const cells: string[] = []
    for (const cell of (row[1] ?? '').matchAll(/<t([dh])[^>]*>([\s\S]*?)<\/t\1\s*>/gi)) {
      cells.push(cellText(cell[2] ?? ''))
    }
    if (cells.length) rows.push(cells)
  }
  return rows
}

/** 去标签、解实体、`<br>` 转换行；保留空行（课表单元格靠空行分隔多门课）。 */
export function cellText(raw: string): string {
  const text = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .trim()
}

function pick(cells: string[], index: number): string {
  return index < cells.length ? (cells[index] ?? '').trim() : ''
}

export function parseZfGrades(html: string): ZfGradeRow[] {
  const rows = tableRows(html, 'Datagrid1')
  const grades: ZfGradeRow[] = []
  const seen = new Set<string>()
  for (const cells of rows) {
    if (cells.length < 9) continue
    const year = (cells[0] ?? '').trim()
    if (!YEAR.test(year)) continue
    const grade: ZfGradeRow = {
      year,
      term: pick(cells, 1),
      code: pick(cells, 2),
      name: pick(cells, 3),
      nature: pick(cells, 4),
      credit: pick(cells, 6),
      gpa: pick(cells, 7),
      score: pick(cells, 8),
    }
    if (!grade.name) continue
    const key = JSON.stringify(grade)
    if (seen.has(key)) continue
    seen.add(key)
    grades.push(grade)
  }
  return grades
}

export function parseZfExams(html: string): ZfExamRow[] {
  const rows = tableRows(html, 'Datagrid1')
  const exams: ZfExamRow[] = []
  for (const cells of rows) {
    if (cells.length < 3) continue
    const name = (cells[0] ?? '').trim()
    if (!name || name === '课程名称' || name.includes('合计')) continue
    exams.push({
      year: '',
      term: '',
      code: '',
      name,
      datetime: pick(cells, 1),
      room: pick(cells, 2),
      seat: pick(cells, 3),
      form: pick(cells, 4),
      campus: pick(cells, 5),
      teacher: '',
    })
  }
  return exams
}

/** 考试平台（exam.jou.edu.cn 的 einfo/fgquery）表头不固定：按表头文字映射列。 */
export function parseExamPortalRows(rows: string[][]): ZfExamRow[] {
  const clean = rows.map((row) => row.map((cell) => String(cell ?? '').replace(/\s+/g, ' ').trim()))
  /* 只在表格前几行找表头，避免把页面下方的说明文字当成表头。 */
  let headerIndex = -1
  for (let index = 0; index < Math.min(clean.length, 3); index += 1) {
    const row = clean[index]
    if (row.some((cell) => /课程|科目/.test(cell)) && row.some((cell) => /时间|日期/.test(cell))) {
      headerIndex = index
      break
    }
  }
  const header = headerIndex >= 0 ? clean[headerIndex] : []
  const at = (pattern: RegExp) => header.findIndex((cell) => pattern.test(cell))
  const indexes = {
    name: at(/课程|科目/),
    date: at(/日期/),
    time: at(/时间/),
    room: at(/地点|考场|教室/),
    seat: at(/座位/),
    form: at(/形式/),
    campus: at(/校区/),
    teacher: at(/教师|老师/),
  }
  const fallback: Record<keyof typeof indexes, number> = {
    name: 0, date: 1, time: -1, room: 2, seat: 3, form: 4, campus: 5, teacher: 6,
  }
  const exams: ZfExamRow[] = []
  for (let index = headerIndex >= 0 ? headerIndex + 1 : 0; index < clean.length; index += 1) {
    const cells = clean[index]
    if (!cells.length || cells.every((cell) => !cell)) continue
    const value = (key: keyof typeof indexes) => {
      /* 有表头时只按表头映射；缺列就留空，避免把「时间/班级」误当座位、校区。 */
      if (headerIndex >= 0) {
        const column = indexes[key]
        return column >= 0 ? cells[column] || '' : ''
      }
      const column = fallback[key]
      return column >= 0 ? cells[column] || '' : ''
    }
    const name = value('name')
    if (!name || /合计|课程名称|考试科目/.test(name)) continue
    /* 只收「有明确日期 + 时间」的考试行；页面导航、说明文字和页脚一律跳过。 */
    if (name.length > 40 || /首页|教务处|登录|导航|版权|成绩查询|系统入口|校历/.test(name)) continue
    const date = value('date')
    const time = value('time')
    if (!/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(date)) continue
    if (!/\d{1,2}:\d{2}/.test(time)) continue
    const datetime = [date, time].filter(Boolean).join(' ').trim()
    exams.push({
      year: '',
      term: '',
      code: '',
      name,
      datetime: datetime || time || date,
      room: value('room'),
      seat: value('seat'),
      form: value('form'),
      campus: value('campus'),
      teacher: value('teacher'),
    })
  }
  return exams
}

/** `1-16周` / `1,3,5` / `第2-8周` / `单周` / `双周` → 周次集合。 */
export function parseWeeks(raw: string): number[] {
  const text = String(raw ?? '').replace(/[{}第周]/g, '')
  if (!text.trim()) return []
  const result = new Set<number>()
  for (const part of text.split(/[,，、;；\s]+/)) {
    const token = part.trim()
    if (!token) continue
    if (token.includes('单')) {
      for (let week = 1; week <= 40; week += 2) result.add(week)
      continue
    }
    if (token.includes('双')) {
      for (let week = 2; week <= 40; week += 2) result.add(week)
      continue
    }
    const range = token.match(/(\d+)\s*[-~至]\s*(\d+)/)
    if (range) {
      const start = Number.parseInt(range[1], 10)
      const end = Number.parseInt(range[2], 10)
      for (let week = start; week <= end && week <= 40; week += 1) if (week > 0) result.add(week)
      continue
    }
    const single = token.match(/(\d+)/)
    if (single) {
      const week = Number.parseInt(single[1], 10)
      if (week > 0 && week <= 40) result.add(week)
    }
  }
  return [...result].sort((a, b) => a - b)
}

function sectionsOf(text: string): number[] {
  const match = text.match(/第([\d,，]+)节/)
  if (!match) return [1]
  return match[1]
    .split(/[,，]/)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value > 0)
}

/** 展开 `rowspan` / `colspan`，否则课表第二行起星期列会整体错位。 */
function expandTable(html: string, id: string): string[][] {
  const body = findTable(html, id)
  if (!body) return []
  const grid: string[][] = []
  const pending = new Map<number, { text: string; remaining: number }>()
  for (const rowMatch of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
    const row: string[] = []
    let column = 0
    for (const cell of (rowMatch[1] ?? '').matchAll(/<t([dh])([^>]*)>([\s\S]*?)<\/t\1\s*>/gi)) {
      while (pending.has(column)) {
        const span = pending.get(column)
        if (!span) break
        row.push(span.text)
        if (span.remaining <= 1) pending.delete(column)
        else pending.set(column, { text: span.text, remaining: span.remaining - 1 })
        column += 1
      }
      const attrs = cell[2] ?? ''
      const text = cellText(cell[3] ?? '')
      const rowspan = Number.parseInt(attrs.match(/rowspan\s*=\s*["']?(\d+)/i)?.[1] ?? '1', 10) || 1
      const colspan = Number.parseInt(attrs.match(/colspan\s*=\s*["']?(\d+)/i)?.[1] ?? '1', 10) || 1
      row.push(text)
      if (rowspan > 1) pending.set(column, { text, remaining: rowspan - 1 })
      for (let extra = 1; extra < colspan; extra += 1) {
        row.push('')
        column += 1
      }
      column += 1
    }
    for (;;) {
      const keys = [...pending.keys()].filter((key) => key >= column).sort((a, b) => a - b)
      if (!keys.length) break
      const key = keys[0]
      while (column < key) {
        row.push('')
        column += 1
      }
      const span = pending.get(key)
      if (!span) break
      row.push(span.text)
      if (span.remaining <= 1) pending.delete(key)
      else pending.set(key, { text: span.text, remaining: span.remaining - 1 })
      column += 1
    }
    if (row.some((cell) => cell.trim() !== '')) grid.push(row)
  }
  return grid
}

/** `#Table1` 文本网格：每格可能含多门课，用空行分隔。 */
function parseTextGrid(html: string): ZfCourseRow[] {
  const grid = expandTable(html, 'Table1')
  const found = new Map<string, ZfCourseRow>()
  for (const row of grid) {
    for (let column = 1; column < row.length; column += 1) {
      const text = (row[column] ?? '').trim()
      // 只有「第N节 + 周X」的格子才是课程，表头/节次标签一律跳过。
      if (!text || !/第[\d,，]+节/.test(text) || !/周[一二三四五六日]/.test(text)) continue
      for (const block of text.split(/\n{2,}/)) {
        for (const course of parseGridBlock(block.trim(), column) ?? []) {
          found.set(`${course.name}|${course.day}|${course.sections.join(',')}|${course.week}`, course)
        }
      }
    }
  }
  return [...found.values()].sort((a, b) => a.week - b.week || a.day - b.day)
}

function parseGridBlock(text: string, column: number): ZfCourseRow[] | null {
  if (!text) return null
  const weekday = text.match(/周([一二三四五六日])/)
  const sectionText = text.match(/第[\d,，]+节/)
  const weekText = text.match(/\{?第?([\d,\-~至]+)周/)
  const name = text.split(/\s*(?:周[一二三四五六日]|第[\d,，]+节)/)[0]?.trim() ?? ''
  if (!name) return null
  const day = weekday ? '一二三四五六日'.indexOf(weekday[1]) + 1 : column
  const rest = text
    .replace(name, '')
    .replace(/周[一二三四五六日]第[\d,，]+节/, '')
    .replace(/\{?第?[\d,\-~至]+周\}?/g, '')
    .trim()
  const parts = rest.split(/\s+/).filter(Boolean)
  const teacher = parts[0] ?? ''
  const room = parts[1] ?? ''
  const weeks = parseWeeks(weekText?.[1] ?? '')
  const weekList = weeks.length ? weeks : Array.from({ length: 16 }, (_, index) => index + 1)
  const sections = sectionsOf(sectionText?.[0] ?? '')
  return weekList.map((week) => ({ week, day, sections, name, teacher, room }))
}

/** `#kbtable` 老版式：行=节次，列=星期，格子里多行一门课。 */
function parseKbTable(html: string): ZfCourseRow[] {
  const rows = tableRows(html, 'kbtable')
  const result: ZfCourseRow[] = []
  if (!rows.length) return result
  for (let index = 1; index < rows.length; index += 1) {
    const cells = rows[index]
    if (cells.length < 3) continue
    const section = Number.parseInt((cells[0] ?? '').match(/\d+/)?.[0] ?? '', 10)
    if (!Number.isFinite(section)) continue
    for (let column = 1; column < cells.length; column += 1) {
      const text = (cells[column] ?? '').trim()
      if (!text) continue
      for (const block of text.split(/\n{2,}/)) {
        const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
        if (!lines.length) continue
        const name = lines[0]
        let teacher = ''
        let room = ''
        let weeksText = ''
        for (const line of lines.slice(1)) {
          if (line.includes('节') || /\d+\s*[-~]\s*\d+\s*周|[单双]周/.test(line)) weeksText += ` ${line}`
          else if (/教学楼|楼|室|馆|\d{3,}/.test(line)) room ||= line
          else teacher ||= line
        }
        const weeks = parseWeeks(weeksText)
        const weekList = weeks.length ? weeks : Array.from({ length: 16 }, (_, i) => i + 1)
        for (const week of weekList) result.push({ week, day: column, sections: [section], name, teacher, room })
      }
    }
  }
  return result
}

export function parseZfTimetable(html: string): ZfCourseRow[] {
  const grid = parseTextGrid(html)
  if (grid.length) return grid
  return parseKbTable(html)
}
