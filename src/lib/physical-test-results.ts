import { captureQbankSession, isQbankSessionCurrent } from './qbank'

const STORAGE_KEY = 'ohu.physical-test-results.v1'

export type PhysicalTestEvent = { name: string; result: string; score?: number }
export type PhysicalTestRecord = {
  id: string
  academicYear: string
  testedAt: string
  totalScore: number
  events: PhysicalTestEvent[]
  updatedAt: number
}

function keyFor(uid: string) {
  return `${STORAGE_KEY}:${uid ? `uid:${encodeURIComponent(uid)}` : 'guest'}`
}

function validRecord(value: unknown): value is PhysicalTestRecord {
  if (!value || typeof value !== 'object') return false
  const row = value as PhysicalTestRecord
  return typeof row.id === 'string' && typeof row.academicYear === 'string' &&
    /^\d{4}-\d{4}$/.test(row.academicYear) && typeof row.testedAt === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(row.testedAt) && Number.isFinite(row.totalScore) &&
    row.totalScore >= 0 && row.totalScore <= 100 && Array.isArray(row.events) &&
    row.events.length <= 12 && row.events.every((event) => event && typeof event.name === 'string' &&
      event.name.length <= 24 && typeof event.result === 'string' && event.result.length <= 48 &&
      (event.score === undefined || Number.isFinite(event.score) && event.score >= 0 && event.score <= 100))
}

function readRows(session = captureQbankSession()): PhysicalTestRecord[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(keyFor(session.uid)) || '[]')
    return Array.isArray(parsed) ? parsed.filter(validRecord).sort((a, b) => b.testedAt.localeCompare(a.testedAt)) : []
  } catch { return [] }
}

export function listPhysicalTestResults() {
  return readRows()
}

export function savePhysicalTestResult(input: Omit<PhysicalTestRecord, 'id' | 'updatedAt'>, expected = captureQbankSession()) {
  if (!isQbankSessionCurrent(expected)) throw new Error('账号已切换，请重新录入体测成绩。')
  const candidate: PhysicalTestRecord = { ...input, id: `pt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, updatedAt: Date.now() }
  if (!validRecord(candidate)) throw new Error('体测记录格式不正确，请检查学年、日期、分数和项目明细。')
  const rows = readRows(expected)
  const sameTest = rows.findIndex((row) => row.academicYear === candidate.academicYear && row.testedAt === candidate.testedAt)
  if (sameTest >= 0) candidate.id = rows[sameTest].id
  const next = [candidate, ...rows.filter((row) => row.id !== candidate.id)].sort((a, b) => b.testedAt.localeCompare(a.testedAt)).slice(0, 100)
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
  return { totalScore: totalScore !== null && totalScore <= 100 ? totalScore : null, events }
}
