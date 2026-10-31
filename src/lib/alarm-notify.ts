/**
 * 系统本地提醒交给原生排程；送达、横幅、锁屏及声音仍取决于系统设置。
 * 精确闹钟需要系统允许；未允许时非精确排程可能被休眠推迟。
 */
import type { Channel } from '@capacitor/local-notifications'
import { IS_NATIVE, PLATFORM } from './platform'

export function idleSchedule(at: Date) {
  return { at, allowWhileIdle: true as const }
}

export type AlarmChannelState = { supported: boolean; created: boolean; channel: Channel | null }
type AlarmChannelOptions = Pick<Channel, 'importance' | 'visibility' | 'vibration' | 'sound'> & { soundEnabled?: boolean }

/** Existing Android channels belong to the user: never delete or recreate them. */
export async function ensureAlarmChannel(id: string, name: string, description: string, options: AlarmChannelOptions = {}): Promise<AlarmChannelState> {
  if (!IS_NATIVE || PLATFORM.os === 'ios') return { supported: false, created: false, channel: null }
  const { LocalNotifications } = await import('@capacitor/local-notifications')
  try {
    const listed = await LocalNotifications.listChannels()
    const existing = listed.channels.find((channel) => channel.id === id)
    if (existing) return { supported: true, created: false, channel: existing }
    // Capacitor 7 treats a nonempty sound as res/raw/<name>, including "default".
    // Omitting it lets a new Android channel keep its system default sound.
    // IMPORTANCE_LOW (2) is silent; the system/user ultimately controls the channel.
    if (options.soundEnabled !== undefined) {
      const { ensureReminderChannel } = await import('./keep-alive')
      const result = await ensureReminderChannel({ id, name, description, importance: options.importance ?? 4, visibility: options.visibility ?? 1, vibration: options.vibration ?? true, soundEnabled: options.soundEnabled })
      if (!result.supported) return { supported: false, created: false, channel: null }
    } else {
      await LocalNotifications.createChannel({ id, name, description, importance: 5, visibility: 1, vibration: true, ...options })
    }
    const actual = (await LocalNotifications.listChannels()).channels.find((channel) => channel.id === id)
    if (!actual) throw new Error('系统未保留提醒通知渠道，请检查通知设置后重试')
    return { supported: true, created: true, channel: actual }
  } catch (error) {
    // Android before 26 has no channel API. Do not pretend its sound/priority can
    // be changed through channels, and do not swallow an actual bridge failure.
    const code = (error as { code?: string })?.code
    if (code === 'UNAVAILABLE' || code === 'UNIMPLEMENTED') return { supported: false, created: false, channel: null }
    throw error
  }
}

export async function exactAlarmGranted(): Promise<boolean> {
  if (!IS_NATIVE) return false
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const st = await LocalNotifications.checkExactNotificationSetting()
    return st.exact_alarm === 'granted'
  } catch {
    return false
  }
}

/** 打开系统「闹钟和提醒」授权页，返回后告知是否已允许 */
export async function requestExactAlarm(): Promise<boolean> {
  if (!IS_NATIVE) return false
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const st = await LocalNotifications.changeExactNotificationSetting()
    return st.exact_alarm === 'granted'
  } catch {
    return exactAlarmGranted()
  }
}
