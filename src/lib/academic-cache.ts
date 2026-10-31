/**
 * 教务成绩 / 考试安排 · 按 App 身份与分类保存的本机快照。
 * 旧版 study.*.v1 无归属数据保留原样，不向首次登录账号自动迁移。
 */
import { captureQbankSession, isQbankSessionCurrent } from './qbank'

export type GradeRowRemote = {
  year: string
  term: string
  code: string
  name: string
  nature: string
  credit: string
  score: string
  gpa: string
}

export type ExamRowRemote = {
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

export const ACADEMIC_CACHE_EVENT = 'ohhu-academic-cache'

export type AcademicMeta = {
  stuid: string
  savedAt: string
  ownerUid: string
}

type Kind = 'grades' | 'exams'
type AcademicSnapshot<T> = { rows: T[]; meta: AcademicMeta }
const GRADE_FIELDS: Array<keyof GradeRowRemote> = ['year', 'term', 'code', 'name', 'nature', 'credit', 'score', 'gpa']
const EXAM_FIELDS: Array<keyof ExamRowRemote> = ['year', 'term', 'code', 'name', 'datetime', 'room', 'form', 'seat', 'campus', 'teacher']

function snapshotKey(kind: Kind, uid = captureQbankSession().uid): string {
  const owner = uid ? `uid:${encodeURIComponent(uid)}` : 'guest'
  return `study.academic.v2:${owner}:${kind}`
}

function validRows(rows: unknown, kind: Kind): boolean {
  const fields = kind === 'grades' ? GRADE_FIELDS : EXAM_FIELDS
  return Array.isArray(rows) && rows.every((row) => row && typeof row === 'object' && fields.every((field) => typeof row[field] === 'string'))
}

function readSnapshot<T>(kind: Kind): AcademicSnapshot<T> | null {
  try {
    const uid = captureQbankSession().uid
    const raw = JSON.parse(localStorage.getItem(snapshotKey(kind, uid)) || 'null') as AcademicSnapshot<T> | null
    if (!raw || !raw.meta || raw.meta.ownerUid !== uid || typeof raw.meta.stuid !== 'string' || !raw.meta.stuid.trim() || typeof raw.meta.savedAt !== 'string' || !Number.isFinite(Date.parse(raw.meta.savedAt)) || !validRows(raw.rows, kind)) return null
    return raw
  } catch {
    return null
  }
}

function saveSnapshot<T>(kind: Kind, rows: T[], stuid: string, session: ReturnType<typeof captureQbankSession>): boolean {
  if (!isQbankSessionCurrent(session) || !stuid.trim() || !validRows(rows, kind)) return false
  try {
    const meta: AcademicMeta = { stuid: stuid.trim().normalize('NFKC'), savedAt: new Date().toISOString(), ownerUid: session.uid }
    const encoded = JSON.stringify({ rows, meta } satisfies AcademicSnapshot<T>)
    const key = snapshotKey(kind, session.uid)
    // Empty successful responses are real snapshots too, and replace that
    // category's old rows without touching other categories or legacy data.
    localStorage.setItem(key, encoded)
    if (localStorage.getItem(key) !== encoded) return false
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(ACADEMIC_CACHE_EVENT))
    return true
  } catch {
    return false
  }
}

/** Pass the identity captured before querying the school, never a late fresh one. */
export function saveGradesCache(rows: GradeRowRemote[], stuid: string, session = captureQbankSession()): boolean {
  return saveSnapshot('grades', rows, stuid, session)
}

export function loadGradesCache(): GradeRowRemote[] {
  return readSnapshot<GradeRowRemote>('grades')?.rows ?? []
}

export function saveExamsCache(rows: ExamRowRemote[], stuid: string, session = captureQbankSession()): boolean {
  return saveSnapshot('exams', rows, stuid, session)
}

export function loadExamsCache(): ExamRowRemote[] {
  return readSnapshot<ExamRowRemote>('exams')?.rows ?? []
}

export function loadAcademicMeta(kind?: Kind): AcademicMeta | null {
  if (kind) return readSnapshot<unknown>(kind)?.meta ?? null
  const metas = [readSnapshot<GradeRowRemote>('grades')?.meta, readSnapshot<ExamRowRemote>('exams')?.meta].filter((meta): meta is AcademicMeta => !!meta)
  return metas.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))[0] ?? null
}
