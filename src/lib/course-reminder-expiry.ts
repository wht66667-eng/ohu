export const COURSE_MAX_LATENESS_MS = 60_000

/** Course alerts expire one minute after their original due time, including legacy records. */
export function courseReminderExpiry(kind: string, due: number, start?: number, end?: number): number {
  if (!Number.isFinite(due) || due <= 0) return NaN
  let expires = due + COURSE_MAX_LATENESS_MS
  if (start !== undefined && (!Number.isFinite(start) || start <= 0)) return NaN
  if (end !== undefined && (!Number.isFinite(end) || end <= 0 || (start !== undefined && end <= start))) return NaN
  if (kind === 'class-soon' && start !== undefined) expires = Math.min(expires, start)
  if (kind === 'class-start' && end !== undefined) expires = Math.min(expires, end)
  return expires
}
