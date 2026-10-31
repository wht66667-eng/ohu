import { captureQbankSession, isQbankSessionCurrent } from './qbank'
import { foxLocalDay } from './fox-calendar'
export { foxLocalDay } from './fox-calendar'

export const FOX_V1_EVENT = 'ohu-fox-v1-summary'
const KEY = 'ohu.fox.verified-days.v1'
export type LoginMoodSummary = {
  userId: string; localDate: string; timezone: string; lastActiveDate: string | null
  totalLoginDays: number; currentStreakDays: number; missedDays: number; moodId: string
  hasHistory: boolean; isActiveToday: boolean; pendingSync: boolean
}
type Mirror = { dates: string[]; verifiedAt: number }
const validDay = (day: unknown): day is string => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T00:00:00Z`)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`)
const previousDay = (day: string) => new Date(dayMs(day) - 86_400_000).toISOString().slice(0, 10)
/** Only server-returned active dates are counted; unavailable history is never fabricated. */
export function deriveFoxV1Summary(userId: string, dates: readonly unknown[], now = Date.now(), pendingSync = false, timezone = 'Asia/Shanghai'): LoginMoodSummary {
  const localDate = foxLocalDay(now, timezone)
  const days = userId ? [...new Set(dates.filter(validDay).filter(day => day <= localDate))].sort() : []
  const lastActiveDate = days.at(-1) || null, isActiveToday = days.includes(localDate)
  let currentStreakDays = 0
  if (isActiveToday) {
    const set = new Set(days)
    for (let day = localDate; set.has(day); day = previousDay(day)) currentStreakDays++
  }
  const missedDays = lastActiveDate && !isActiveToday ? Math.max(0, Math.round((dayMs(localDate) - dayMs(lastActiveDate)) / 86_400_000)) : 0
  const hasHistory = !!userId && !!days.length
  const stage = (value: number, thresholds: number[]) => String(thresholds.find(day => value >= day) || 1).padStart(2, '0')
  const moodId = !hasHistory ? 'login_day_01' : isActiveToday
    ? `login_day_${stage(currentStreakDays, [30, 7, 3, 1])}`
    : `miss_day_${stage(missedDays, [30, 15, 7, 3, 2, 1])}`
  return { userId, localDate, timezone, lastActiveDate, totalLoginDays: hasHistory ? days.length : 0, currentStreakDays, missedDays, moodId, hasHistory, isActiveToday, pendingSync }
}
function readMirror(userId: string): Mirror | null {
  try {
    const row = JSON.parse(localStorage.getItem(KEY) || '{}')[userId] as Mirror | undefined
    return row && Array.isArray(row.dates) && Number.isFinite(row.verifiedAt) ? row : null
  } catch { return null }
}
export function getFoxV1Summary(userId = captureQbankSession().uid): LoginMoodSummary {
  const mirror = userId ? readMirror(userId) : null
  // Yesterday's verified data is useful, but it cannot certify today's login.
  const stale = !!userId && (!mirror || foxLocalDay(mirror.verifiedAt) !== foxLocalDay())
  return deriveFoxV1Summary(userId, mirror?.dates || [], Date.now(), stale)
}
let reading: { scope: string; promise: Promise<LoginMoodSummary> } | null = null
export function refreshFoxV1Summary(): Promise<LoginMoodSummary> {
  const session = captureQbankSession(), scope = `${session.revision}:${session.uid}`
  if (!session.uid) return Promise.resolve(deriveFoxV1Summary('', []))
  if (reading?.scope === scope) return reading.promise
  const promise = (async () => {
    try {
      const { cbRdb } = await import('./cb')
      const response = await (cbRdb().from('checkins') as any).select('date').eq('uid', session.uid).eq('shell', 'user').limit(10000)
      if (!isQbankSessionCurrent(session)) return getFoxV1Summary()
      if (response?.error || !Array.isArray(response?.data) || response.data.length >= 10000) throw new Error('登录日期记录尚未完整同步')
      const dates = (response.data as { date?: unknown }[]).map(row => row.date).filter(validDay)
      const summary = deriveFoxV1Summary(session.uid, dates)
      const store = JSON.parse(localStorage.getItem(KEY) || '{}')
      store[session.uid] = { dates: [...new Set(dates)], verifiedAt: Date.now() } satisfies Mirror
      localStorage.setItem(KEY, JSON.stringify(store))
      window.dispatchEvent(new CustomEvent(FOX_V1_EVENT, { detail: summary }))
      return summary
    } catch {
      if (!isQbankSessionCurrent(session)) return getFoxV1Summary()
      const summary = { ...getFoxV1Summary(session.uid), pendingSync: true }
      if (isQbankSessionCurrent(session)) window.dispatchEvent(new CustomEvent(FOX_V1_EVENT, { detail: summary }))
      return summary
    }
  })().finally(() => { if (reading?.scope === scope) reading = null })
  reading = { scope, promise }
  return promise
}
