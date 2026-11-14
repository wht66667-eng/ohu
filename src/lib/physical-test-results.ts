import { captureQbankSession, isQbankSessionCurrent } from './qbank'
import type { TiceSummary, TiceYear } from './tice-parse'

const STORAGE_KEY = 'ohu.physical-test-results.v1'

export type PhysicalTestEvent = { name: string; result: string; score?: number | null; note?: string }
export type PhysicalTestSource = 'jou-tice' | 'tice-import'
export type PhysicalTestRecord = {
  id: string
  academicYear: string
  /** 学校只给学年时为空串，不编造日期。 */
  testedAt: string
  /** null = 未公布（0 是有效分数，两者不能合并）。 */
  totalScore: number | null
  grade?: string
  bonus?: number
  events: PhysicalTestEvent[]
  updatedAt: number
  source?: PhysicalTestSource
}

function keyFor(uid: string) {
  return `${STORAGE_KEY}:${uid ? `uid:${encodeURIComponent(uid)}` : 'guest'}`
}
function validDate(value: string) {
  if (value === '') return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
function optionalScore(value: unknown, max: number): boolean {
  return value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max)
}

function validRecord(value: unknown): value is PhysicalTestRecord {
  if (!value || typeof value !== 'object') return false
  const row = value as PhysicalTestRecord
  return typeof row.id === 'string' && typeof row.academicYear === 'string' &&
    (/^\d{4}(?:-\d{4})?$/.test(row.academicYear) || row.academicYear === '' &&
      row.id === 'tice:current' && row.source === 'tice-import' && row.testedAt === '' &&
      Array.isArray(row.events) && row.events.length > 0) && typeof row.testedAt === 'string' &&
    validDate(row.testedAt) && (row.totalScore === null || Number.isFinite(row.totalScore) &&
      row.totalScore >= 0 && row.totalScore <= 120) &&
    (row.grade === undefined || typeof row.grade === 'string' && row.grade.length <= 20) &&
    (row.bonus === undefined || Number.isFinite(row.bonus) && row.bonus >= 0 && row.bonus <= 40) &&
    Array.isArray(row.events) && row.events.length <= 16 &&
    row.events.every((event) => event && typeof event.name === 'string' &&
      event.name.length <= 24 && typeof event.result === 'string' && event.result.length <= 48 &&
      optionalScore(event.score, 100) && (event.note === undefined || typeof event.note === 'string' && event.note.length <= 48))
}

function compareRecords(a: PhysicalTestRecord, b: PhysicalTestRecord) {
  return Number(b.id === 'tice:current' && b.academicYear === '') - Number(a.id === 'tice:current' && a.academicYear === '') ||
    (b.testedAt || b.academicYear).localeCompare(a.testedAt || a.academicYear)
}

function readRows(session = captureQbankSession()): PhysicalTestRecord[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(keyFor(session.uid)) || '[]')
    return Array.isArray(parsed) ? parsed.filter(validRecord).sort(compareRecords) : []
  } catch { return [] }
}

export function listPhysicalTestResults() {
  return readRows()
}

function persist(rows: PhysicalTestRecord[], expected: ReturnType<typeof captureQbankSession>) {
  if (!isQbankSessionCurrent(expected)) throw new Error('账号已变更，请重新同步体测成绩。')
  const merged = rows.sort(compareRecords).slice(0, 100)
  if (!merged.every(validRecord)) throw new Error('体测成绩格式异常，整批结果未保存。')
  const encoded = JSON.stringify(merged), key = keyFor(expected.uid)
  if (!isQbankSessionCurrent(expected)) throw new Error('账号已切换，成绩没有保存到其他账号。')
  localStorage.setItem(key, encoded)
  if (localStorage.getItem(key) !== encoded) throw new Error('体测成绩未能保存，请检查存储空间。')
  return merged
}

/** Validate the whole remote batch first, then atomically persist once. */
export function savePhysicalTestBatch(input: Array<Pick<PhysicalTestRecord, 'academicYear' | 'testedAt' | 'totalScore' | 'events'>>, expected = captureQbankSession()) {
  if (!expected.uid || !isQbankSessionCurrent(expected)) throw new Error('账号已变更，请重新同步体测成绩。')
  if (!Array.isArray(input) || input.length > 100) throw new Error('体测成绩返回格式异常，原记录已保留。')
  const stamp = Date.now()
  if (input.some(row => !row || !Array.isArray(row.events))) throw new Error('体测成绩返回格式异常，原记录已保留。')
  const imported = input.map(row => ({ academicYear: row.academicYear, testedAt: row.testedAt, totalScore: row.totalScore,
    events: row.events.map(event => ({ name: event?.name, result: event?.result,
      ...(event?.score === undefined ? {} : { score: event.score }),
      ...(event?.note ? { note: event.note } : {}) })),
    id: `jou-tice:${row.academicYear}:${row.testedAt}`, source: 'jou-tice' as const, updatedAt: stamp }))
  if (!imported.every(validRecord)) throw new Error('体测成绩格式异常，整批结果未保存。')
  const ids = new Set(imported.map(row => row.id))
  return persist([...readRows(expected).filter(row => !ids.has(row.id)), ...imported], expected)
}

function ticeEvents(year: TiceYear, current: TiceYear | null): PhysicalTestEvent[] {
  const source = current && current.year === year.year && current.items.length ? current : year.items.length ? year : null
  if (!source) return []
  return source.items.slice(0, 16).map((item) => ({
    name: item.name.slice(0, 24),
    result: (item.raw || item.note || (item.score === null ? '未计分' : String(item.score))).slice(0, 48),
    ...(item.score === null ? {} : { score: item.score }),
    ...(item.note ? { note: item.note.slice(0, 48) } : {}),
  }))
}

/**
 * 把体测页面解析结果落库：历年表每个学年一条，本次页明细挂到同学年。
 *
 * 同一学年的旧系统记录会被覆盖（学校系统更新后不该两行并存），手动录入的行保留。
 */
export function importTiceSummary(summary: TiceSummary, expected = captureQbankSession()): PhysicalTestRecord[] {
  const current = summary.current
  const years = new Map<string, TiceYear>()
  for (const year of summary.history) years.set(year.year, year)
  if (current && (current.year || current.year === '' && current.items.length) && !years.has(current.year)) years.set(current.year, current)
  const ordered = [...years.values()].sort((a, b) => b.year.localeCompare(a.year))
  if (!ordered.length) throw new Error('没有识别到学年成绩。请把「历年成绩」页整页复制后再试。')
  const stamp = Date.now(), existing = readRows(expected)
  const imported = ordered.map((year): PhysicalTestRecord => {
    const detail = current && current.year === year.year ? current : null
    const previous = existing.filter((row) => year.year && row.academicYear === year.year && row.source)
    const total = detail?.total ?? year.total ?? previous.find((row) => row.totalScore !== null)?.totalScore ?? null
    const grade = year.grade || detail?.grade || previous.find((row) => row.grade)?.grade
    const events = ticeEvents(year, detail)
    return {
      id: year === current && year.year === '' ? 'tice:current' : `tice:${year.year}`,
      academicYear: year.year,
      testedAt: '',
      totalScore: total,
      ...(grade ? { grade: grade.slice(0, 20) } : {}),
      ...(year.bonus > 0 ? { bonus: year.bonus } : {}),
      events: (events.length ? events : previous.find((row) => row.events.length)?.events || []).map((event) => ({
        name: event.name, result: event.result,
        ...(event.score === undefined ? {} : { score: event.score }),
        ...(event.note ? { note: event.note } : {}),
      })),
      source: 'tice-import',
      updatedAt: stamp,
    }
  })
  if (!imported.every(validRecord)) throw new Error('体测页面内容无法对应到明显的学年与分数，请检查后重试。')
  const importedYears = new Set(imported.map((row) => row.academicYear))
  const kept = existing.filter((row) => !(row.source && importedYears.has(row.academicYear)) &&
    !(row.id === 'tice:current' && summary.hasCurrentDetail && current))
  return persist([...kept, ...imported], expected)
}

export function savePhysicalTestResult(input: Omit<PhysicalTestRecord, 'id' | 'updatedAt'>, expected = captureQbankSession()) {
  if (!isQbankSessionCurrent(expected)) throw new Error('账号已切换，请重新录入体测成绩。')
  const candidate: PhysicalTestRecord = { ...input, id: `pt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, updatedAt: Date.now() }
  if (!validRecord(candidate)) throw new Error('体测记录格式不正确，请检查学年、日期、分数和项目明细。')
  const rows = readRows(expected)
  const sameTest = rows.findIndex((row) => !row.source && row.academicYear === candidate.academicYear && row.testedAt === candidate.testedAt)
  if (sameTest >= 0) candidate.id = rows[sameTest].id
  const next = [candidate, ...rows.filter((row) => row.id !== candidate.id)].sort(compareRecords).slice(0, 100)
  if (!isQbankSessionCurrent(expected)) throw new Error('账号已切换，成绩没有保存到其他账号。')
  try {
    const key = keyFor(expected.uid), encoded = JSON.stringify(next)
    localStorage.setItem(key, encoded)
    if (localStorage.getItem(key) !== encoded) throw new Error('storage unavailable')
  } catch { throw new Error('体测成绩未能保存到本机，请检查存储空间后重试。') }
  return candidate
}

/** Extract only score-like fields. The caller must not persist the pasted source text. */
export function parsePhysicalTestText(text: string): { totalScore: number | null; events: PhysicalTestEvent[] } {
  const totalMatch = text.match(/(?:体测)?(?:综合)?(?:总分|总成绩|最终成绩|成绩总分|体质健康测试成绩)\s*[:：]?\s*(\d{1,3}(?:\.\d+)?)/i)
  const ignored = /姓名|学号|身份证|证件号|学院|班级|手机号|联系电话|登录|密码|网址|http|总分|总成绩|最终成绩|测试日期|体测年份/i
  const events: PhysicalTestEvent[] = []
  for (const rawLine of text.split(/[\r\n]+/)) {
    const line = rawLine.trim().replace(/^[•·\-*\s]+/, '')
    if (!line || line.length > 100 || ignored.test(line)) continue
    const match = line.match(/^([^：:，,\t]{2,20})[：:,\t]\s*(.{1,48})$/)
    if (!match) continue
    const name = match[1].trim(), result = match[2].trim()
    if (!/[\u4e00-\u9fff]/.test(name) || !result || /\d{10,}/.test(`${name}${result}`)) continue
    const scoreMatch = result.match(/(?:得分|分数|评分)\s*[:：]?\s*(\d{1,3}(?:\.\d+)?)/)
    events.push({ name, result, ...(scoreMatch ? { score: Number(scoreMatch[1]) } : {}) })
    if (events.length >= 12) break
  }
  const totalScore = totalMatch ? Number(totalMatch[1]) : null
  return { totalScore: totalScore !== null && totalScore <= 120 ? totalScore : null, events }
}
