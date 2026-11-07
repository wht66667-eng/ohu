import { TIMETABLE_API_BASE } from './timetable'
import { captureQbankSession, isQbankSessionCurrent } from './qbank'
import { withTimeout } from './abort-signal'

export type LearningCourse = { key: string; name: string; teacher: string }
export type LearningHomework = { key: string; courseKey: string; title: string; status: string; dueAt: string | null; deadlineText: string }
export type LearningSnapshot = { courses: LearningCourse[]; homework: LearningHomework[]; coveredCourseKeys: string[]; remainingCourseKeys: string[]; queriedAt: number }
const KEY = 'ohu.chaoxing.read.v1:'
const validText = (v: unknown, max: number) => typeof v === 'string' && v.length <= max
function validSnapshot(value: unknown): value is LearningSnapshot {
  const s = value as LearningSnapshot | null
  return !!s && Array.isArray(s.courses) && s.courses.length <= 200 && s.courses.every(c => !!c && typeof c.key === 'string' && /^\d+:\d+:\d+$/.test(c.key) && validText(c.name, 120) && validText(c.teacher, 80))
    && Array.isArray(s.homework) && s.homework.length <= 2000 && s.homework.every(h => !!h && validText(h.key, 180) && validText(h.courseKey, 120) && validText(h.title, 160) && validText(h.status, 40) && validText(h.deadlineText, 60) && (h.dueAt === null || typeof h.dueAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+08:00$/.test(h.dueAt) && Number.isFinite(Date.parse(h.dueAt))))
    && Array.isArray(s.coveredCourseKeys) && Array.isArray(s.remainingCourseKeys) && [...s.coveredCourseKeys, ...s.remainingCourseKeys].every(k => typeof k === 'string' && /^\d+:\d+:\d+$/.test(k)) && Number.isFinite(s.queriedAt)
}
export function readLearningSnapshot(): LearningSnapshot | null {
  const uid = captureQbankSession().uid
  if (!uid) return null
  try { const s: unknown = JSON.parse(localStorage.getItem(KEY + encodeURIComponent(uid)) || 'null'); return validSnapshot(s) ? s : null } catch { return null }
}
export function clearLearningSnapshot() { const uid = captureQbankSession().uid; if (uid) localStorage.removeItem(KEY + encodeURIComponent(uid)) }
export async function learningSyncAvailable(signal?: AbortSignal): Promise<boolean> {
  const r = await fetch(`${TIMETABLE_API_BASE}/api/integrations/capabilities`, { signal: signal ? withTimeout(signal, 10_000) : AbortSignal.timeout(10000) })
  if (!r.ok) return false
  const data = await r.json()
  return data?.ok === true && data?.chaoxing?.enabled === true
}
export async function syncLearning(username: string, password: string, courseKey: string, signal: AbortSignal, courseKeys: string[] = []): Promise<LearningSnapshot> {
  const expected = captureQbankSession()
  if (!expected.uid) throw new Error('请先登录哦狐，再同步个人学习通记录。')
  const r = await fetch(`${TIMETABLE_API_BASE}/api/learning/chaoxing/query`, {
    method: 'POST', signal: withTimeout(signal, 55_000), headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: username.trim(), password, courseKey, courseKeys, consent: true }),
  })
  const raw: unknown = await r.json().catch(() => null)
  const result = raw as { ok?: boolean; message?: string }
  if (!r.ok || result?.ok !== true || !validSnapshot(raw)) throw new Error(validText(result?.message, 200) ? result.message : '学习通读取失败，原记录已保留。')
  if (!isQbankSessionCurrent(expected)) throw new Error('账号已切换，本次结果没有保存。')
  const previous = readLearningSnapshot()
  const covered = new Set(raw.coveredCourseKeys)
  const active = new Set(raw.courses.map(c => c.key))
  const snapshot: LearningSnapshot = {
    courses: raw.courses.map(c => ({ key: c.key, name: c.name, teacher: c.teacher })), queriedAt: raw.queriedAt,
    coveredCourseKeys: raw.coveredCourseKeys, remainingCourseKeys: raw.remainingCourseKeys,
    homework: [...(previous?.homework || []).filter(h => active.has(h.courseKey) && !covered.has(h.courseKey)), ...raw.homework]
      .map(h => ({ key: h.key, courseKey: h.courseKey, title: h.title, status: h.status, dueAt: h.dueAt, deadlineText: h.deadlineText })),
  }
  // Persist only structured display fields, never cookies, password or signed task URLs.
  const encoded = JSON.stringify(snapshot)
  if (!isQbankSessionCurrent(expected)) throw new Error('账号已切换，本次结果没有保存。')
  localStorage.setItem(KEY + encodeURIComponent(expected.uid), encoded)
  if (localStorage.getItem(KEY + encodeURIComponent(expected.uid)) !== encoded) throw new Error('学习通记录未能保存，请检查存储空间。')
  return snapshot
}
