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
