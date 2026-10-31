/** 本机手记成绩：按哦狐账号隔离；历史无归属记录只允许显式认领。 */
import { captureQbankSession, isQbankSessionCurrent } from './qbank'

export type GradeRow = {
  id: string
  term: string
  course: string
  credit: string
  score: string
  /** 百分或等级，展示用 */
  note?: string
  updatedAt: string
}

const KEY_PREFIX = 'study.gradeBook.v2:uid:'
const LEGACY_KEY = 'study.gradeBook.v1'

function keyFor(uid: string) { return `${KEY_PREFIX}${encodeURIComponent(uid || 'guest')}` }

function readKey(key: string): GradeRow[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(raw) ? raw as GradeRow[] : []
  } catch { return [] }
}

export function loadGradeBook(): GradeRow[] {
  const session = captureQbankSession()
  return readKey(keyFor(session.uid))
}

export function saveGradeBook(rows: GradeRow[]): boolean {
  const session = captureQbankSession()
  try {
    const value = JSON.stringify(rows)
    if (!isQbankSessionCurrent(session)) return false
    localStorage.setItem(keyFor(session.uid), value)
    return localStorage.getItem(keyFor(session.uid)) === value && isQbankSessionCurrent(session)
  } catch { return false }
}

export function addGrade(partial: Omit<GradeRow, 'id' | 'updatedAt'>): GradeRow[] {
  const session = captureQbankSession()
  const rows = readKey(keyFor(session.uid))
  const row: GradeRow = {
    ...partial,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    updatedAt: new Date().toISOString(),
  }
  const next = [row, ...rows]
  if (!isQbankSessionCurrent(session)) return rows
  try { localStorage.setItem(keyFor(session.uid), JSON.stringify(next)) } catch { return rows }
  return isQbankSessionCurrent(session) ? next : rows
}

export function removeGrade(id: string): GradeRow[] {
  const session = captureQbankSession()
  const next = readKey(keyFor(session.uid)).filter((row) => row.id !== id)
  if (!isQbankSessionCurrent(session)) return loadGradeBook()
  try { localStorage.setItem(keyFor(session.uid), JSON.stringify(next)) } catch { return loadGradeBook() }
  return isQbankSessionCurrent(session) ? next : loadGradeBook()
}

/** Historical v1 records have no owner; never assign them to an account automatically. */
export function hasUnclaimedGradeBook(): boolean {
  try { return localStorage.getItem(LEGACY_KEY) !== null } catch { return false }
}

export function claimLegacyGradeBook(): { ok: boolean; rows: GradeRow[] } {
  const session = captureQbankSession()
  if (!session.uid) return { ok: false, rows: [] }
  const existing = readKey(keyFor(session.uid))
  if (existing.length) return { ok: false, rows: existing }
  let legacy: GradeRow[]
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (raw === null) return { ok: false, rows: [] }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return { ok: false, rows: [] }
    legacy = parsed as GradeRow[]
  } catch { return { ok: false, rows: [] } }
  if (!isQbankSessionCurrent(session)) return { ok: false, rows: [] }
  try {
    const target = keyFor(session.uid)
    localStorage.setItem(target, JSON.stringify(legacy))
    if (localStorage.getItem(target) !== JSON.stringify(legacy) || !isQbankSessionCurrent(session)) {
      localStorage.removeItem(target)
      return { ok: false, rows: [] }
    }
    localStorage.removeItem(LEGACY_KEY)
    return { ok: true, rows: legacy }
  } catch { return { ok: false, rows: [] } }
}

/** 成绩字符串 → 百分（支持等级制） */
export function scoreToNumber(raw: string): number | null {
  const s = (raw || '').trim()
  if (!s) return null
  const n = parseFloat(s)
  if (Number.isFinite(n)) return n
  const map: Record<string, number> = {
    优秀: 95, 良好: 85, 中等: 75, 及格: 65, 不及格: 50,
    通过: 80, 不通过: 40, A: 95, 'A+': 98, 'A-': 90,
    B: 85, 'B+': 88, 'B-': 80, C: 75, 'C+': 78, 'C-': 70, D: 65, F: 50,
  }
  return map[s] ?? map[s.toUpperCase()] ?? null
}

/** 粗算平均分：仅对可解析为数字/等级的成绩加权（学分） */
export function roughGpa(rows: GradeRow[]): { avg: number | null; credited: number } {
  let sum = 0
  let weight = 0
  for (const row of rows) {
    const score = scoreToNumber(row.score)
    const credit = parseFloat(row.credit) || 0
    if (score == null || credit <= 0) continue
    sum += score * credit
    weight += credit
  }
  return { avg: weight > 0 ? Math.round((sum / weight) * 10) / 10 : null, credited: weight }
}
