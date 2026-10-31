/**
 * Android 桌面图标变脸（activity-alias）——多邻国式效果：
 * 未打开 App 时后台也会按「多久没来」换表情。
 */
import { Capacitor, registerPlugin } from '@capacitor/core'
import { IS_NATIVE } from './platform'
import { foxAssetUrl, FOX_MOOD_POSES } from './fox-art'
import { foxLocalDay } from './fox-calendar'

export type IconStateKey =
  | 'streak_1'
  | 'streak_3'
  | 'streak_7'
  | 'streak_14'
  | 'away_2'
  | 'away_5'
  | 'away_8'
  | 'away_12'
  | 'away_15'
  | 'away_20'
  | 'away_25'
  | 'away_30'
  | 'default'

export const ICON_STATE_KEYS: IconStateKey[] = [
  'default',
  'streak_1',
  'streak_3',
  'streak_7',
  'streak_14',
  'away_2',
  'away_5',
  'away_8',
  'away_12',
  'away_15',
  'away_20',
  'away_25',
  'away_30',
]

interface LauncherIconPlugin {
  setIcon(options: { name: string }): Promise<LauncherMoodResult>
  syncMood(options: {
    lastActiveDate: string
    lastCheckinDate?: string
    streakCurrent: number
    iconState: string
  }): Promise<LauncherMoodResult>
  setEnabled(options: { enabled: boolean }): Promise<LauncherMoodResult>
  resetMood(): Promise<LauncherMoodResult>
  getIcon(): Promise<{ name: string; pending?: boolean; error?: string }>
}

export type LauncherMoodResult = { ok: boolean; enabled?: boolean; name?: string; pending?: boolean; error?: string }
export const LAUNCHER_MOOD_STATUS_EVENT = 'sc-launcher-mood-status'
let lastLauncherMoodError: string | null = null
let reconciledEnabled: boolean | undefined
let moodGeneration = 0

export function getLauncherMoodError(): string | null { return lastLauncherMoodError }

/** 读取退到后台后的真实切换错误，供设置页再次打开时展示。 */
export async function refreshLauncherMoodStatus(): Promise<void> {
  if (!supportsLauncherMood()) return
  try {
    const result = await LauncherIcon.getIcon()
    publishStatus({ ok: !result.error, ...result })
  } catch (cause) {
    publishStatus({ ok: false, error: nativeFailure(cause).message })
  }
}

function publishStatus(result: LauncherMoodResult): LauncherMoodResult {
  lastLauncherMoodError = result.ok ? null : result.error || '桌面图标设置未成功，请稍后重试'
  window.dispatchEvent(new CustomEvent(LAUNCHER_MOOD_STATUS_EVENT, { detail: result }))
  return result
}

function nativeFailure(error?: unknown): Error {
  const message = error instanceof Error ? error.message : String(error || '')
  if (/not implemented|unimplemented|unavailable|not available/i.test(message)) {
    return new Error('此安装版本暂不支持桌面图标设置，请安装新版本后重试')
  }
  return new Error(message
    ? message
    : '此安装版本暂不支持桌面图标设置，请安装新版本后重试')
}

function cacheIcon(name: string | undefined) {
  if (name && ICON_STATE_KEYS.includes(name as IconStateKey)) localStorage.setItem(LS_ICON, name)
}

const LauncherIcon = registerPlugin<LauncherIconPlugin>('LauncherIcon')

const LS_ICON = 'sc.launcher.icon.v1'
const LS_MOOD_ENABLED = 'sc.launcher.mood.enabled.v1'

export function supportsLauncherMood(): boolean {
  return IS_NATIVE && Capacitor.getPlatform() === 'android'
}

/** 只有明确开启的记录才生效；未选择、无效记录或存储不可用均默认关闭。 */
export function isLauncherMoodEnabled(): boolean {
  try {
    return localStorage.getItem(LS_MOOD_ENABLED) === '1'
  } catch {
    /* ignore */
  }
  return false
}

/** 写入开关并同步原生（关 = 取消后台变脸 + 恢复默认图标） */
export async function setLauncherMoodEnabled(on: boolean): Promise<LauncherMoodResult> {
  const generation = moodGeneration
  try {
    /* 关闭意愿先落盘；系统恢复图标失败也不能让下次启动自动重新开启。 */
    if (!on) {
      try {
        localStorage.setItem(LS_MOOD_ENABLED, '0')
        localStorage.setItem(LS_ICON, 'default')
      } catch { /* 默认关闭时，存储不可用也继续关闭原生能力。 */ }
    }
    if (!supportsLauncherMood()) {
      if (on) throw new Error('桌面图标变脸仅在支持此功能的 Android 安装版中可用')
      return publishStatus({ ok: true, name: 'default' })
    }
    const result = await LauncherIcon.setEnabled({ enabled: on })
    if (generation !== moodGeneration) return { ok: false, error: '账号已变化，本次图标更新已取消' }
    if (result.ok !== true) {
      if (result.enabled === false) {
        try {
          localStorage.setItem(LS_MOOD_ENABLED, '0')
          localStorage.setItem(LS_ICON, 'default')
        } catch { /* 存储不可用时读取开关也默认关闭。 */ }
      }
      throw new Error(result.error || '系统未能完成桌面图标设置，请稍后重试')
    }
    if (on) {
      try {
        localStorage.setItem(LS_MOOD_ENABLED, '1')
      } catch {
        await LauncherIcon.setEnabled({ enabled: false })
        throw new Error('无法保存图标变脸开关，本次未开启，请稍后重试')
      }
    }
    try { cacheIcon(result.name) } catch { /* 图标预览缓存不影响已确认的原生结果。 */ }
    reconciledEnabled = on
    return publishStatus(result)
  } catch (cause) {
    reconciledEnabled = undefined
    const error = nativeFailure(cause)
    publishStatus({ ok: false, error: error.message })
    throw error
  }
}

export function iconAssetUrl(state: IconStateKey): string {
  return foxAssetUrl(FOX_MOOD_POSES[state] || 'avatar')
}

/** 原生 mipmap 图标的同源预览，不随界面主题插画变化。 */
export function launcherIconPreviewUrl(state: IconStateKey): string {
  const safe = ICON_STATE_KEYS.includes(state) ? state : 'default'
  return `${import.meta.env.BASE_URL}launcher-icon-previews/${safe}.png`
}

/** 活跃日与启动封面使用相同的校园自然日。 */
export function activityDay(value: string | null): string | null {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return foxLocalDay(date.getTime())
}

/** 进门 / 打卡后：写原生活跃日 + 立刻变脸 + 挂后台定时 */
export async function syncLauncherMood(opts: {
  lastActiveAt: string | null
  lastCheckinDate: string | null
  streakCurrent: number
  iconState: IconStateKey
}): Promise<LauncherMoodResult> {
  const generation = moodGeneration
  /* 关闭时仍记录活跃日，重新开启即可按当前记录恢复；原生不切图标或挂任务。 */
  const enabled = isLauncherMoodEnabled()
  const lastActiveDate = activityDay(opts.lastActiveAt) || opts.lastCheckinDate || activityDay(new Date().toISOString())!
  const lastCheckinDate = (opts.lastCheckinDate || '').slice(0, 10)
  try {
    if (!enabled) localStorage.setItem(LS_ICON, 'default')
  } catch {
    /* ignore */
  }
  if (!supportsLauncherMood()) return { ok: true, name: 'default' }
  try {
    /* 先同步用户意愿，防止旧安装版的原生默认开启绕过新的 Web 默认关闭。 */
    if (reconciledEnabled !== enabled) await setLauncherMoodEnabled(enabled)
    if (generation !== moodGeneration) return { ok: false, error: '账号已变化，本次图标更新已取消' }
    const result = await LauncherIcon.syncMood({
      lastActiveDate,
      lastCheckinDate,
      streakCurrent: opts.streakCurrent,
      iconState: opts.iconState,
    })
    if (generation !== moodGeneration) return { ok: false, error: '账号已变化，本次图标更新已取消' }
    if (result.ok !== true) throw new Error(result.error || '系统未能同步桌面图标，请稍后重试')
    try { cacheIcon(enabled ? result.name || opts.iconState : 'default') } catch { /* 预览缓存不阻断同步。 */ }
    return publishStatus(result)
  } catch (cause) {
    /* 不用 setIcon 绕过失败的开关。返回可展示的错误，不中断登录/打卡。 */
    reconciledEnabled = undefined
    return publishStatus({ ok: false, error: nativeFailure(cause).message })
  }
}

/** Explicit logout or account change clears the previous owner's native history. */
export async function resetLauncherMoodForAccountChange(): Promise<void> {
  moodGeneration++
  reconciledEnabled = undefined
  try { localStorage.setItem(LS_ICON, 'default') } catch { /* no cached preview */ }
  if (!supportsLauncherMood()) return
  try {
    const result = await LauncherIcon.resetMood()
    if (!result.ok) throw new Error(result.error || '无法恢复默认桌面图标')
    publishStatus(result)
  } catch (cause) {
    // Older installed shells cannot clear ownership: disable their background mood instead.
    try { await setLauncherMoodEnabled(false) } catch { publishStatus({ ok: false, error: nativeFailure(cause).message }) }
  }
}

export async function applyLauncherIcon(state: IconStateKey): Promise<void> {
  if (!isLauncherMoodEnabled() && state !== 'default') throw new Error('请先在设置中开启桌面图标变脸')
  if (!supportsLauncherMood()) throw new Error('此平台暂不支持切换桌面图标')
  try {
    if (reconciledEnabled !== isLauncherMoodEnabled()) await setLauncherMoodEnabled(isLauncherMoodEnabled())
    const result = await LauncherIcon.setIcon({ name: state })
    if (result.ok !== true) throw new Error(result.error || '系统未能切换桌面图标，请稍后重试')
    try { cacheIcon(result.name || state) } catch { /* 预览缓存不改变原生结果。 */ }
    publishStatus(result)
  } catch (cause) {
    const error = nativeFailure(cause)
    publishStatus({ ok: false, error: error.message })
    throw error
  }
}

export function getCachedIconState(): IconStateKey {
  if (!isLauncherMoodEnabled()) return 'default'
  try {
    const v = localStorage.getItem(LS_ICON) as IconStateKey | null
    if (v && ICON_STATE_KEYS.includes(v)) return v
  } catch {
    /* ignore */
  }
  return 'default'
}
