/** Notification preferences are separate from current OS permission and alarm capability. */
import { IS_NATIVE, PLATFORM } from './platform'
import { exactAlarmGranted, requestExactAlarm } from './alarm-notify'
import { restoreKeepAliveIfWanted } from './keep-alive'
import { rescheduleClassReminders, type ClassReminderResult } from './class-remind'
import { rescheduleExamReminders } from './exam-utils'
import { rescheduleCertReminders } from './cert-remind'
import { rescheduleTodoReminders } from './todo-remind'
import { captureQbankSession, isQbankSessionCurrent } from './qbank'
import { clearPersonalReminders } from './personal-reminders'
import { clearReminderOverlays } from './reminder-overlay'
import { clearCourseReminderPlan } from './reminder-plan'

const LS_EXACT = 'notify.exactAlarm.prompted.v1'
const LS_ASKED = 'notify.consent.asked.v1'
const LS_GRANTED = 'notify.consent.granted.v1'

function readFlag(key: string): boolean { try { return localStorage.getItem(key) === '1' } catch { return false } }
function writeFlag(key: string, enabled: boolean) { try { localStorage.setItem(key, enabled ? '1' : '0') } catch { /* Preference storage may be unavailable. */ } }
export function wasNotifyConsentAsked(): boolean { return readFlag(LS_ASKED) }
export function isNotifyConsentGranted(): boolean { return readFlag(LS_GRANTED) }
export function markNotifyConsentAsked() { writeFlag(LS_ASKED, true) }

export type ReminderHealth = {
  native: boolean
  display: 'granted' | 'denied' | 'prompt' | 'unavailable'
  exactAlarm: boolean | null
  canSchedule: boolean
  error?: string
}

export async function checkReminderHealth(): Promise<ReminderHealth> {
  try {
    if (IS_NATIVE) {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      const permissions = await LocalNotifications.checkPermissions()
      const display = permissions.display === 'granted' ? 'granted' : permissions.display === 'denied' ? 'denied' : 'prompt'
      const exactAlarm = PLATFORM.os === 'android' ? await exactAlarmGranted() : null
      writeFlag(LS_GRANTED, display === 'granted')
      return { native: true, display, exactAlarm, canSchedule: display === 'granted' }
    }
    const display = typeof Notification === 'undefined' ? 'unavailable' : Notification.permission === 'default' ? 'prompt' : Notification.permission
    return { native: false, display, exactAlarm: null, canSchedule: false }
  } catch (error) {
    return { native: IS_NATIVE, display: 'unavailable', exactAlarm: null, canSchedule: false, error: (error as Error)?.message || '无法读取系统通知状态' }
  }
}

export async function requestNotifyPermission(): Promise<boolean> {
  const session = captureQbankSession()
  markNotifyConsentAsked()
  try {
    let ok = false
    if (IS_NATIVE) {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      ok = (await LocalNotifications.requestPermissions()).display === 'granted'
      if (ok && PLATFORM.os === 'android' && !readFlag(LS_EXACT)) {
        writeFlag(LS_EXACT, true)
        if (!await exactAlarmGranted()) await requestExactAlarm()
      }
    } else if (typeof Notification !== 'undefined') {
      ok = (await Notification.requestPermission()) === 'granted'
    }
    writeFlag(LS_GRANTED, ok)
    if (ok && isQbankSessionCurrent(session)) {
      // OS permission does not change the user's independent course-reminder preference.
      // Permission consent does not override a separate guardian opt-out, including the notification action.
      await restoreKeepAliveIfWanted().catch(() => undefined)
      await refreshAllReminders()
    }
    return ok
  } catch {
    writeFlag(LS_GRANTED, false)
    return false
  }
}

export type ReminderRefreshResult = {
  classCount: number
  examCount: number
  certCount: number
  todoCount: number
  status: 'scheduled' | 'degraded' | 'permissionDenied' | 'unavailable' | 'failed'
  health: ReminderHealth
  /** 真失败：需要用户处理，界面用阻塞弹层提示 */
  errors: string[]
  /**
   * 没排上但不算故障：例如课表缓存是空的，此刻 0 条提醒。
   * 以前这类消息被当成「正常空态」吞掉，用户以为提醒开着其实一条没排，所以单独拎出来做温和提示。
   */
  notices: string[]
}
let refreshFlight: { scope: string; promise: Promise<ReminderRefreshResult> } | null = null

export function refreshAllReminders(): Promise<ReminderRefreshResult> {
  const session = captureQbankSession(), scope = `${session.revision}:${session.uid}`
  if (refreshFlight?.scope === scope) return refreshFlight.promise
  const promise = reconcileReminders(session).finally(() => { if (refreshFlight?.promise === promise) refreshFlight = null })
  refreshFlight = { scope, promise }
  return promise
}

async function reconcileReminders(session: ReturnType<typeof captureQbankSession>): Promise<ReminderRefreshResult> {
  const health = await checkReminderHealth()
  const empty = { classCount: 0, examCount: 0, certCount: 0, todoCount: 0, health, errors: [] as string[], notices: [] as string[] }
  if (!isQbankSessionCurrent(session)) return { ...empty, status: 'unavailable' }
  // A cold-start guest is not a logout signal. Native plans await the restored owner.
  if (!session.uid) return { ...empty, status: 'unavailable', notices: ['等待登录状态确认后再刷新个人提醒'] }
  if (health.display !== 'granted') {
    // OS permission can be revoked while old alarms remain queued in the bridge.
    const errors: string[] = [], notices: string[] = []
    try { await clearPersonalReminders(session) }
    catch (error) { errors.push(`旧提醒撤销失败：${(error as Error)?.message || '请重试'}`) }
    try {
      const cleared = await clearReminderOverlays(session.uid, { preserveEnabled: true })
      if (cleared.lastError) notices.push(`桌面提醒撤销未完成：${cleared.lastError}`)
    } catch (error) { notices.push(`桌面提醒撤销失败：${(error as Error)?.message || '请重试'}；系统通知撤销结果独立报告。`) }
    try { await clearCourseReminderPlan(session.uid) }
    catch (error) { errors.push(`后台课表补排撤销失败：${(error as Error)?.message || '请重试'}`) }
    if (!isQbankSessionCurrent(session)) return { ...empty, status: 'unavailable' }
    return { ...empty, errors, notices, status: errors.length ? 'failed' : health.display === 'denied' ? 'permissionDenied' : 'unavailable' }
  }
  const errors: string[] = []
  const notices: string[] = []
  if (health.native && health.exactAlarm === false) notices.push('精确闹钟权限尚未允许，系统可能延后提醒；可在系统“闹钟和提醒”中检查。')
  const tasks = [
    ['上课', rescheduleClassReminders], ['考试', rescheduleExamReminders],
    ['考证', rescheduleCertReminders], ['待办', rescheduleTodoReminders],
  ] as const
  const counts: number[] = []
  // Some existing schedulers return a failure message instead of throwing. Keep those failures visible.
  const failed = /失败|未能|未授予|未允许|部分提醒/
  /** 正常空态：用户主动关闭、账号切换、本来就没有到期项——不必打扰。 */
  const benignEmpty = /已关闭|已撤销|未登录|暂无|没有待提醒|没有.*课程|时间已过|无待提醒|请改日期|网页版|已保存|已记录|打开 App|已清除/
  for (const [name, run] of tasks) {
    if (!isQbankSessionCurrent(session)) return { ...empty, status: 'unavailable' }
    try {
      const result: ClassReminderResult = await run()
      counts.push(result.count)
      if (name === '上课' && 'overlay' in result && result.overlay?.status === 'failed') {
        notices.push(`${name}：${result.count ? '系统通知已安排；' : ''}${result.overlay.message}`)
      }
      if (name === '上课' && result.plan?.status !== 'scheduled' && result.plan?.message) notices.push(result.plan.message)
      if (!result.message) continue
      if (failed.test(result.message)) errors.push(`${name}：${result.message}`)
      // 例如「请先同步课表」：一条都没排上，必须让用户看见，否则他以为提醒是开着的。
      else if (!result.count && !benignEmpty.test(result.message)) notices.push(`${name}：${result.message}`)
    } catch (error) {
      counts.push(0)
      errors.push(`${name}：${(error as Error)?.message || '安排失败'}`)
    }
  }
  return {
    classCount: counts[0], examCount: counts[1], certCount: counts[2], todoCount: counts[3], health, errors, notices,
    status: errors.length ? 'failed' : !health.native || health.exactAlarm === false ? 'degraded' : 'scheduled',
  }
}
