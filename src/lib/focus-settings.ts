export type FocusOptions = {
  minutes: number
  breakMinutes: number
  title: string
  theme: string
  noise: string
  reminder: 'sound' | 'vibrate' | 'none'
  customThemes: string[]
  customNoises: { label: string; value: string }[]
}

const KEY = 'focus.options.v2'
const VOLUME_KEY = 'focus.audio.volume.v1'
export const clampFocusVolume = (volume: number): number => Number.isFinite(volume) ? Math.max(0, Math.min(.5, volume)) : .15
export function loadFocusVolume(): number {
  try { const raw = localStorage.getItem(VOLUME_KEY); return clampFocusVolume(raw == null || !raw.trim() ? .15 : Number(raw)) } catch { return .15 }
}
export function saveFocusVolume(volume: number): number {
  const value = clampFocusVolume(volume)
  try { localStorage.setItem(VOLUME_KEY, String(value)) } catch { /* session-level volume still applies */ }
  return value
}
export function isFocusAudioSource(source: string): boolean {
  if (['off', 'rain', 'cafe', 'white'].includes(source) || /^local:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(source)) return true
  try { return new URL(source).protocol === 'https:' } catch { return false }
}
export const FOCUS_THEMES = ['学习', '工作', '阅读', '运动']
export const FOCUS_NOISES = [
  { label: '关闭声音', value: 'off' },
  { label: '轻雨声（合成）', value: 'rain' },
  { label: '低频环境声（合成）', value: 'cafe' },
  { label: '柔和白噪音（合成）', value: 'white' },
]
export const FOCUS_REMINDERS = [
  { label: '铃声', value: 'sound' },
  { label: '震动', value: 'vibrate' },
  { label: '无提醒', value: 'none' },
]

export function loadFocusOptions(): FocusOptions {
  let raw: Partial<FocusOptions> = {}
  try { raw = JSON.parse(localStorage.getItem(KEY) || '{}') || {} } catch { /* defaults */ }
  return {
    minutes: Number.isInteger(raw.minutes) && raw.minutes! >= 5 && raw.minutes! <= 120 ? raw.minutes! : 25,
    breakMinutes: Number.isInteger(raw.breakMinutes) && raw.breakMinutes! >= 0 && raw.breakMinutes! <= 30 ? raw.breakMinutes! : 5,
    title: typeof raw.title === 'string' ? raw.title.slice(0, 120) : '学习',
    theme: typeof raw.theme === 'string' ? raw.theme : '学习',
    noise: typeof raw.noise === 'string' && isFocusAudioSource(raw.noise) ? raw.noise : 'off',
    reminder: raw.reminder === 'vibrate' || raw.reminder === 'none' ? raw.reminder : 'sound',
    customThemes: Array.isArray(raw.customThemes) ? raw.customThemes.filter((s) => typeof s === 'string').slice(0, 20) : [],
    customNoises: Array.isArray(raw.customNoises) ? raw.customNoises.filter((s) => typeof s?.label === 'string' && /^https:\/\//.test(s.value)).slice(0, 12) : [],
  }
}

export function saveFocusOptions(options: FocusOptions) {
  const next = { ...options, noise: isFocusAudioSource(options.noise) ? options.noise : 'off' }
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* usable without storage */ }
}
