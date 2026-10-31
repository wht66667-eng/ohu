/**
 * Android 常驻提醒：前台服务 + 双通知卡，以及提醒权限体检。
 *
 * 系统通知计划（LocalNotifications → AlarmManager）负责「关掉 App 也准时响」；
 * 常驻服务额外保证进程留在后台，让应用内到点弹层 / 语音也能触发，
 * 并在通知栏常驻两条卡：
 * - 前台卡（70501）：随服务生死，进程被杀会被系统一并撤走；
 * - 独立卡（70502）：普通 ongoing 通知，划掉后台后仍留在通知栏（「上课闹钟已布防」）。
 * 两者互相独立：服务没开时闹钟照常工作，只是弹层与语音会因进程被冻结而失效。
 */
import { Capacitor, registerPlugin } from '@capacitor/core'
import { IS_NATIVE } from './platform'

interface KeepAlivePlugin {
  start(opts: { title: string; text: string }): Promise<{ running: boolean }>
  restore(opts: { title: string; text: string; defaultWanted: boolean }): Promise<{ running: boolean; wanted: boolean }>
  update(opts: { title: string; text: string }): Promise<{ running: boolean }>
  stop(): Promise<{ running: boolean }>
  isRunning(): Promise<{ running: boolean; wanted?: boolean | null }>
  isBatteryOptimizationIgnored(): Promise<{ ignored: boolean }>
  openBatteryOptimization(): Promise<{ opened: string }>
  openNotificationSettings(): Promise<{ opened: string }>
  openChannelSettings(opts: { channelId: string }): Promise<{ opened: string }>
  openAutostartGuide(): Promise<{ opened: string }>
  openAppDetails(): Promise<{ opened: string }>
  getReminderPermissionState(opts: { channelId?: string }): Promise<ReminderPermissionSnapshot>
  ensureReminderChannel(opts: ReminderChannelOptions): Promise<{ supported: boolean; created: boolean }>
}

export type ReminderPermissionSnapshot = {
  courseChannelsSupported: boolean
  /** Added by APK 1.2.130. Absence on older bridges means unsupported. */
  courseAlarmClockSupported?: boolean
  notificationsEnabled: boolean | null
  exactAlarmAllowed: boolean | null
  batteryOptimizationIgnored: boolean | null
  hasVibrator: boolean | null
  ringerMode: 'normal' | 'vibrate' | 'silent' | 'unknown'
  notificationVolume: number | null
  notificationMaxVolume: number | null
  interruptionFilter: 'all' | 'priority' | 'none' | 'alarms' | 'unknown'
  channelExists: boolean | null
  channelImportance: number | null
  channelSoundEnabled: boolean | null
  channelVibrationEnabled: boolean | null
}
export type ReminderChannelOptions = { id: string; name: string; description: string; importance: number; visibility: number; vibration: boolean; soundEnabled: boolean }

const KeepAlive = registerPlugin<KeepAlivePlugin>('KeepAlive')

const LS_ENABLED = 'sc.keepalive.enabled.v1'
let preferenceRevision = 0
const DEFAULT_TITLE = '哦狐提醒守护中'
export const DEFAULT_KEEP_ALIVE_TEXT = '上课 / 考试 / 待办提醒已安排，到点会通知你'

export function isAndroidNative(): boolean {
  return IS_NATIVE && Capacitor.getPlatform() === 'android'
}

/* ---------------- 开关状态（本地偏好） ---------------- */

/**
 * 用户有没有主动关掉常驻提醒。
 * **默认开启**：没写这个键就当作想要常驻（这是产品要求——「后台常驻一条通知」是默认行为），
 * 只有用户在设置里主动关过才会写 '0'。
 */
export function isKeepAliveWanted(): boolean {
  try {
    return localStorage.getItem(LS_ENABLED) !== '0'
  } catch {
    return false
  }
}

function setKeepAliveWanted(on: boolean): void {
  try {
    localStorage.setItem(LS_ENABLED, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

/* ---------------- 服务控制 ---------------- */

/**
 * 老版本 APK 里原生 `start()` 仍是「直接拒绝」的空壳实现。
 * 这类拒绝要翻译成能指导行动的提示，否则用户看不懂。
 */
const LEGACY_REJECT = /无需开启常驻服务|数据同步任务/
function friendlyStartError(message: string): string {
  return LEGACY_REJECT.test(message)
    ? '当前安装的 App 版本还不支持常驻提醒，装上 1.2.92 版即可开启'
    : message
}

/** 开启常驻提醒；成功后记住偏好，失败把原因交给调用方展示。 */
export async function startKeepAlive(text?: string): Promise<{ ok: boolean; error?: string }> {
  if (!isAndroidNative()) return { ok: false, error: '仅 Android App 内可用' }
  const revision = ++preferenceRevision
  try {
    await KeepAlive.start({ title: DEFAULT_TITLE, text: text || DEFAULT_KEEP_ALIVE_TEXT })
  } catch (e) {
    const message = (e as Error)?.message || '开启常驻提醒失败，请重试'
    return { ok: false, error: friendlyStartError(message) }
  }
  if (revision === preferenceRevision) setKeepAliveWanted(true)
  return { ok: true }
}

export async function stopKeepAlive(): Promise<{ ok: boolean; error?: string }> {
  preferenceRevision++
  setKeepAliveWanted(false)
  if (!isAndroidNative()) return { ok: true }
  try {
    await KeepAlive.stop()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || '关闭常驻提醒失败' }
  }
}

/**
 * 刷新常驻通知文案（如「下节课 · 高等数学 08:00」）。
 * 服务没在跑时静默跳过，绝不因为更新文案把服务拉起来。
 */
export async function updateKeepAliveText(text: string): Promise<void> {
  if (!isAndroidNative() || !isKeepAliveWanted() || !text) return
  try {
    await KeepAlive.update({ title: DEFAULT_TITLE, text })
  } catch {
    /* 文案更新失败不影响提醒本身 */
  }
}

/** 进程内服务真实运行状态（原生标志位；App 被杀后重置为 false） */
export async function isKeepAliveRunning(): Promise<boolean> {
  if (!isAndroidNative()) return false
  const revision = preferenceRevision
  try {
    const r = await KeepAlive.isRunning()
    if (revision === preferenceRevision && typeof r.wanted === 'boolean') setKeepAliveWanted(r.wanted)
    return !!r.running
  } catch {
    return false
  }
}

/** App 启动时：用户开过就重新挂上，没开过就确保没有遗留服务。 */
export async function restoreKeepAliveIfWanted(): Promise<void> {
  if (!isAndroidNative()) return
  const revision = preferenceRevision
  if (!isKeepAliveWanted()) {
    await stopKeepAlive()
    return
  }
  try {
    const result = await KeepAlive.restore({ title: DEFAULT_TITLE, text: DEFAULT_KEEP_ALIVE_TEXT, defaultWanted: isKeepAliveWanted() })
    if (typeof result.wanted !== 'boolean') throw new Error('无法确认常驻提醒设置，请稍后重试。')
    if (revision === preferenceRevision) setKeepAliveWanted(result.wanted)
  } catch (cause) {
    const error = cause as { code?: string; message?: string }
    // Older APKs cannot distinguish a killed service from a notification-bar opt-out.
    // Never fall back to start(), which would overwrite that real user choice.
    if (error.code === 'UNIMPLEMENTED' || /not implemented|not available|unimplemented/i.test(error.message || '')) return
    throw cause
  }
}

/* ---------------- 权限体检与设置跳转 ---------------- */

export async function isBatteryOptimizationIgnored(): Promise<boolean> {
  if (!isAndroidNative()) return true
  try {
    const r = await KeepAlive.isBatteryOptimizationIgnored()
    return !!r.ignored
  } catch {
    return false
  }
}

export async function openBatteryOptimization(): Promise<string | null> {
  if (!isAndroidNative()) return '请在 Android App 中设置'
  try {
    await KeepAlive.openBatteryOptimization()
    return null
  } catch (e) {
    return (e as Error)?.message || '无法打开电池设置'
  }
}

export async function openNotificationSettings(): Promise<string | null> {
  if (!isAndroidNative()) return '请在 Android App 中设置'
  try {
    await KeepAlive.openNotificationSettings()
    return null
  } catch (e) {
    return (e as Error)?.message || '无法打开通知设置'
  }
}

/** 打开指定通知渠道详情（如上课闹钟 class-remind-v2 / 考试闹钟 exam-remind-v2） */
export async function openChannelSettings(channelId: string): Promise<string | null> {
  if (!isAndroidNative()) return '请在 Android App 中设置'
  try {
    await KeepAlive.openChannelSettings({ channelId })
    return null
  } catch (e) {
    return (e as Error)?.message || '无法打开渠道设置'
  }
}

export async function openAutostartGuide(): Promise<string | null> {
  if (!isAndroidNative()) return '请在 Android App 中设置'
  try {
    await KeepAlive.openAutostartGuide()
    return null
  } catch (e) {
    return (e as Error)?.message || '请手动在系统设置中允许本 App 自启动'
  }
}

/** Read-only health details. An older APK is reported separately from denied permission. */
export async function getReminderPermissionState(channelId: string): Promise<{ supported: boolean; state: ReminderPermissionSnapshot | null; error?: string }> {
  if (!isAndroidNative()) return { supported: false, state: null }
  try { return { supported: true, state: await KeepAlive.getReminderPermissionState({ channelId }) } }
  catch (cause) {
    const error = cause as { code?: string; message?: string }
    const older = error.code === 'UNIMPLEMENTED' || /not implemented|not available|unimplemented/i.test(error.message || '')
    return { supported: false, state: null, error: older ? '安装新版 APK 后可查看手机权限与声音状态。' : error.message || '无法读取手机提醒状态，请重试。' }
  }
}

/** The native bridge creates a channel only if absent, including truly silent channels. */
export async function ensureReminderChannel(options: ReminderChannelOptions): Promise<{ supported: boolean; created: boolean }> {
  if (!isAndroidNative()) return { supported: false, created: false }
  try { return await KeepAlive.ensureReminderChannel(options) }
  catch (cause) {
    const error = cause as { code?: string; message?: string }
    if (error.code === 'UNIMPLEMENTED' || /not implemented|not available|unimplemented/i.test(error.message || '')) {
      throw new Error('铃声与震动独立设置需要新版 APK，请先安装更新后重试；当前未确认新的提醒计划。')
    }
    throw cause
  }
}
