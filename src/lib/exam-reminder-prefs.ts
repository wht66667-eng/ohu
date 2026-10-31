export type ExamReminderPreferences = {
  enabled: boolean
  eveningEnabled: boolean
  eveningTime: string
  leadEnabled: boolean
  leadHours: number
  startEnabled: boolean
}

export const EXAM_REMIND_PREF_EVENT = 'ohhu-exam-remind-pref-change'
const PREFERENCES_KEY = 'exam.remind.preferences.v1'
export const DEFAULT_EXAM_REMINDER_PREFERENCES: Readonly<ExamReminderPreferences> = {
  enabled: true, eveningEnabled: true, eveningTime: '20:00', leadEnabled: true, leadHours: 2, startEnabled: true,
}

function validatePreferences(input: unknown): ExamReminderPreferences | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const value = input as Partial<ExamReminderPreferences>
  if (typeof value.enabled !== 'boolean' || typeof value.eveningEnabled !== 'boolean'
    || typeof value.leadEnabled !== 'boolean' || typeof value.startEnabled !== 'boolean'
    || typeof value.eveningTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.eveningTime)
    || typeof value.leadHours !== 'number' || !Number.isFinite(value.leadHours)
    || value.leadHours < 0.25 || value.leadHours > 24) return null
  const minutes = value.leadHours * 60
  if (Math.abs(minutes - Math.round(minutes)) > 1e-7) return null
  return {
    enabled: value.enabled, eveningEnabled: value.eveningEnabled, eveningTime: value.eveningTime,
    leadEnabled: value.leadEnabled, leadHours: Math.round(minutes) / 60, startEnabled: value.startEnabled,
  }
}

/** One complete local preference record; malformed records retain the old default cadence. */
export function getExamReminderPreferences(): ExamReminderPreferences {
  try {
    return validatePreferences(JSON.parse(localStorage.getItem(PREFERENCES_KEY) || 'null'))
      ?? { ...DEFAULT_EXAM_REMINDER_PREFERENCES }
  } catch {
    return { ...DEFAULT_EXAM_REMINDER_PREFERENCES }
  }
}

/** Validate before the single write. Failures never persist a partial policy or publish an event. */
export function saveExamReminderPreferences(preferences: ExamReminderPreferences): void {
  const validated = validatePreferences(preferences)
  if (!validated) throw new Error('考试提醒设置无效：前晚时间须为 HH:MM，提前时间须为 0.25～24 小时且精确到整分钟')
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(validated))
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EXAM_REMIND_PREF_EVENT))
}
