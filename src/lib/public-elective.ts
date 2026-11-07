/** 正方「网上选课 / 选课情况」公选课目录解析与本地缓存。 */
import { captureQbankSession } from './qbank'

export interface ElectiveOffering {
  code: string
  name: string
  teacher: string
  credit: number
  category: string
  nature: string
  weeks: string
  termKey: string
}

const STORAGE_PREFIX = 'ohu.public-elective.v1:uid:'
const key = (uid: string) => `${STORAGE_PREFIX}${encodeURIComponent(uid)}`
const text = (value: string) => value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim()
const CATEGORY: Record<string, string> = { H: '海洋知识类', R: '人文素养类', Z: '自然科学类', G: '公共艺术类' }

function categoryOf(value: string, code: string): string {
  const explicit = value.trim()
  if (explicit && !/^[-—/]+$/.test(explicit)) return explicit
  return CATEGORY[code.trim().toUpperCase().slice(0, 1)] ?? '其他公选'
}

export function parseZfCourseSelectionHtml(html: string, termKey = ''): ElectiveOffering[] {
  const rows = String(html).match(/<tr[\s\S]*?<\/tr>/gi) ?? []
  const cells = (row: string) => (row.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? []).map(text)
  let headers: string[] | null = null
  const offerings: ElectiveOffering[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const values = cells(row)
    if (!values.length) continue
    if (!headers) {
      if (values.some((value) => value.includes('课程名称') || value.includes('课程代码'))) headers = values
      continue
    }
    /* 数据行没有「选择」checkbox，比表头少一列；按差值对齐。 */
    const shift = Math.max(0, headers.length - values.length)
    const at = (...names: string[]) => {
      for (const name of names) {
        const index = headers!.findIndex((header) => header.includes(name))
        if (index >= 0) return values[index - shift] ?? ''
      }
      return ''
    }
    const name = at('课程名称', '课程名')
    const code = at('课程代码', '课程编号', '课程号')
    if (!name || !code || !/\d{4,}/.test(code)) continue
    const nature = at('性质', '课程性质')
    const category = at('类别', '归属', '模块')
    if (nature && !nature.includes('公选') && category && !/类$/.test(category)) continue
    const teacher = at('教师', '老师', '任课')
    const credit = Number(at('学分').replace(/[^\d.]/g, '')) || 0
    const weeks = at('周次', '上课周', '起始结束周', '起止周')
    const id = `${code}|${teacher}`
    if (seen.has(id)) continue
    seen.add(id)
    offerings.push({ code, name, teacher, credit, category: categoryOf(category, code), nature: nature || '公选课', weeks, termKey })
  }
  return offerings
}
export function readPublicElectives(): ElectiveOffering[] {
  try {
    const uid = captureQbankSession().uid
    if (!uid) return []
    const parsed: unknown = JSON.parse(localStorage.getItem(key(uid)) || '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is ElectiveOffering => !!item && typeof item === 'object' && typeof (item as ElectiveOffering).code === 'string') : []
  } catch {
    return []
  }
}

export function savePublicElectives(rows: ElectiveOffering[]): boolean {
  try {
    const uid = captureQbankSession().uid
    if (!uid) return false
    localStorage.setItem(key(uid), JSON.stringify(rows.slice(0, 500)))
    return true
  } catch {
    return false
  }
}

const PASS = /^(及格|合格|通过|优秀|良好|中等|好)$/
const passed = (score: string) => {
  const numeric = Number(String(score).replace(/[^\d.]/g, ''))
  if (Number.isFinite(numeric) && numeric > 0) return numeric >= 60
  return PASS.test(String(score).trim())
}
const categoryByCode = (code: string) => ({ H: '海洋知识类', R: '人文素养类', Z: '自然科学类', G: '公共艺术类' } as Record<string, string>)[String(code).toUpperCase().slice(0, 1)] ?? '其他公选'

/**
 * 公选课进度：目录课程与成绩按课程代码/名称匹配，H/R/Z/G 每类最高 2 学分。
 * 返回 { total, passedCount, categories }，total 上限 8。
 */
export function summarizePublicElectives(
  grades: Array<{ code: string; name: string; score: string; credit: string | number; nature: string }>,
  offerings: ElectiveOffering[],
): { total: number; passedCount: number; categories: Array<{ name: string; credits: number; courses: number }> } {
  const consumed = new Set<number>()
  const catalog = offerings.map((item) => {
    const index = grades.findIndex((row, rowIndex) => !consumed.has(rowIndex) && (row.code === item.code || row.name === item.name))
    const grade = index >= 0 ? grades[index] : undefined
    if (index >= 0) consumed.add(index)
    return { code: item.code, name: item.name, credit: item.credit, category: item.category || categoryByCode(item.code), score: grade?.score ?? '未修', ok: grade ? passed(grade.score) : false }
  })
  const used = new Set(catalog.map((item) => item.code))
  const deduped = new Set<string>()
  const fromGrades = grades
    .filter((row, rowIndex) => !consumed.has(rowIndex) && !used.has(row.code))
    .filter((row) => row.nature.includes('公选') || /^[HRZG]/i.test(String(row.code)))
    .sort((a, b) => Number(passed(b.score)) - Number(passed(a.score)))
    .filter((row) => {
      const key = row.code || row.name
      if (deduped.has(key)) return false
      deduped.add(key)
      return true
    })
    .map((row) => ({ code: row.code, name: row.name, credit: Number(row.credit) || 0, category: categoryByCode(row.code), score: row.score, ok: passed(row.score) }))
  const map = new Map<string, { credits: number; courses: number }>([
    ['海洋知识类', { credits: 0, courses: 0 }],
    ['人文素养类', { credits: 0, courses: 0 }],
    ['自然科学类', { credits: 0, courses: 0 }],
    ['公共艺术类', { credits: 0, courses: 0 }],
  ])
  let passedCount = 0
  for (const course of [...catalog, ...fromGrades]) {
    const item = map.get(course.category) ?? { credits: 0, courses: 0 }
    item.courses += 1
    if (course.ok) { item.credits = Math.min(2, item.credits + course.credit); passedCount += 1 }
    map.set(course.category, item)
  }
  const categories = Array.from(map, ([name, value]) => ({ name, credits: value.credits, courses: value.courses }))
  return { total: Math.min(8, categories.reduce((sum, item) => sum + item.credits, 0)), passedCount, categories }
}
