/** 声音偏好只保存在本机；总开关关闭后提示音与背景音乐全部停止。 */
export type SoundGroup = 'click' | 'page' | 'success' | 'task' | 'fox' | 'notify' | 'achieve'
export const SOUND_GROUPS: readonly SoundGroup[] = ['click', 'page', 'success', 'task', 'fox', 'notify', 'achieve']
export interface SoundPreferences {
  master: boolean
  /** 0..1，默认 0.35（设计稿 35%） */
  volume: number
  events: Record<SoundGroup, boolean>
  quietEnabled: boolean
  /** HH:MM，支持跨午夜（如 22:00–08:00） */
  quietStart: string
  quietEnd: string
  /** App 背景音乐独立开关，默认关闭；官网音乐不会自动带入 */
  bgm: boolean
}
const KEY = 'ohu.sound.prefs.v1'
const EVENT = 'ohu-sound-prefs'

export function defaultSoundPreferences(): SoundPreferences {
  return {
    master: true,
    volume: 0.35,
    events: { click: false, page: false, success: true, task: true, fox: true, notify: true, achieve: true },
    quietEnabled: true,
    quietStart: '22:00',
    quietEnd: '08:00',
    bgm: false,
  }
}
const isClock = (value: unknown): value is string => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
export function validateSoundPreferences(value: unknown): SoundPreferences {
  const fallback = defaultSoundPreferences()
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const events = { ...fallback.events }
  const rawEvents = raw.events && typeof raw.events === 'object' ? raw.events as Record<string, unknown> : {}
  for (const group of SOUND_GROUPS) if (typeof rawEvents[group] === 'boolean') events[group] = rawEvents[group] as boolean
  return {
    master: typeof raw.master === 'boolean' ? raw.master : fallback.master,
    volume: typeof raw.volume === 'number' && Number.isFinite(raw.volume) ? Math.min(1, Math.max(0, raw.volume)) : fallback.volume,
    events,
    quietEnabled: typeof raw.quietEnabled === 'boolean' ? raw.quietEnabled : fallback.quietEnabled,
    quietStart: isClock(raw.quietStart) ? raw.quietStart : fallback.quietStart,
    quietEnd: isClock(raw.quietEnd) ? raw.quietEnd : fallback.quietEnd,
    bgm: typeof raw.bgm === 'boolean' ? raw.bgm : fallback.bgm,
  }
}
export function getSoundPreferences(): SoundPreferences {
  try { return validateSoundPreferences(JSON.parse(localStorage.getItem(KEY) || 'null')) } catch { return defaultSoundPreferences() }
}
/** 存储失败向上抛出，界面不能误报已保存。 */
export function saveSoundPreferences(next: SoundPreferences): void {
  const checked = validateSoundPreferences(next)
  localStorage.setItem(KEY, JSON.stringify(checked))
  window.dispatchEvent(new Event(EVENT))
}
export function subscribeSoundPreferences(callback: () => void): () => void {
  const onStorage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) callback() }
  window.addEventListener(EVENT, callback); window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener(EVENT, callback); window.removeEventListener('storage', onStorage) }
}
const clockMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
/** 免打扰时段判断；起止相同视为不生效。 */
export function isSoundQuietNow(prefs: SoundPreferences, now = new Date()): boolean {
  if (!prefs.quietEnabled) return false
  const start = clockMinutes(prefs.quietStart), end = clockMinutes(prefs.quietEnd)
  if (start === end) return false
  const minutes = now.getHours() * 60 + now.getMinutes()
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end
}