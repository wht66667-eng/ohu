/** NON-PRODUCTION. Real local preferences, synthetic notification feedback, no system bridge calls. */
import { useSyncExternalStore } from 'react'
import { getPreviewIdentity, captureQbankSession, isQbankSessionCurrent } from './ui-review-fixtures'
import { isClassRemindEnabled, isClassSoonRemindEnabled, isClassStartRemindEnabled, getRemindMinutes } from '../src/lib/class-remind'
import { getReminderPresentation } from '../src/lib/reminder-presentation'
import { getExamReminderPreferences } from '../src/lib/exam-reminder-prefs'

// These source functions only read/write local preference storage. Scheduling exports below are inert.
export { isClassRemindEnabled, setClassRemindEnabled, isClassSoonRemindEnabled, setClassSoonRemindEnabled, isClassStartRemindEnabled, setClassStartRemindEnabled, isClassAlarmClockEnabled, setClassAlarmClockEnabled, getRemindMinutes, setRemindMinutes, CLASS_REMIND_PREF_EVENT, classReminderExpiresAt, isClassReminderTipCurrent } from '../src/lib/class-remind'
export { getReminderStyle, setReminderStyle, getClassReminderEffects, setClassReminderEffects, getReminderPresentation, REMINDER_STYLE_EVENT, REMINDER_STYLE_OPTIONS, buildReminderNotification } from '../src/lib/reminder-presentation'
export * from './ui-review-fixtures'
export type ReminderPreviewMode = 'ready' | 'denied' | 'failed' | 'slow'
export const REMINDER_PREVIEW_MODES: ReadonlyArray<{ value: ReminderPreviewMode; label: string }> = [
  { value: 'ready', label: '正常 · 合成安排反馈' }, { value: 'denied', label: '模拟权限拒绝' }, { value: 'failed', label: '模拟桥接失败' }, { value: 'slow', label: '4 秒保存延迟' },
]
let previewMode: ReminderPreviewMode = 'ready'
const listeners = new Set<() => void>()
export function useReminderPreviewMode() { return useSyncExternalStore(notify => { listeners.add(notify); return () => { listeners.delete(notify) } }, () => previewMode, () => previewMode) }
export function setReminderPreviewMode(value: ReminderPreviewMode) { previewMode = value; listeners.forEach(notify => notify()) }
const wait = () => new Promise<void>(resolve => setTimeout(resolve, previewMode === 'slow' ? 4000 : 180))

let bootEnabled = true, overlayEnabled = false, overlayPermission = false, activeCount = 0, plannedCount = 0
export async function rescheduleClassReminders() {
  const mode = previewMode, session = captureQbankSession()
  await wait()
  if (!isQbankSessionCurrent(session)) return { count: 0, message: '本地合成反馈：账号已变化，旧样例安排已停止。' }
  if (mode === 'denied') throw new Error('本地合成反馈：模拟通知权限未授予，请允许后重试。')
  if (mode === 'failed') throw new Error('本地合成反馈：模拟通知桥接失败；本次没有发送或安排系统通知。')
  const phases = Number(isClassSoonRemindEnabled()) + Number(isClassStartRemindEnabled())
  activeCount = isClassRemindEnabled() && getPreviewIdentity() ? 6 * phases : 0
  plannedCount = activeCount ? 120 * phases : 0
  const timing = [isClassSoonRemindEnabled() ? `课前 ${getRemindMinutes()} 分钟` : '', isClassStartRemindEnabled() ? '开课时再次提醒' : ''].filter(Boolean).join('、')
  return { count: activeCount, message: activeCount ? `本地合成反馈：已模拟 ${activeCount} 条课程提醒，${timing}；没有发送或安排系统通知。` : '本地合成反馈：模拟计划已清空；没有发送或安排系统通知。', plan: { status: activeCount ? 'scheduled' as const : 'inactive' as const, count: plannedCount, message: '本地合成后台计划，不会在系统中运行。' }, overlay: { status: overlayEnabled ? 'scheduled' as const : 'inactive' as const, count: overlayEnabled ? activeCount : 0, message: '本地合成覆盖状态，不会覆盖手机桌面。' } }
}
export async function rescheduleExamReminders() {
  const mode = previewMode, session = captureQbankSession(), preferences = getExamReminderPreferences()
  await wait()
  if (!isQbankSessionCurrent(session)) return { count: 0, message: '本地合成反馈：账号已变化，旧考试样例安排已停止。' }
  if (mode === 'failed') throw new Error('本地合成反馈：模拟考试通知桥接失败；本次没有发送或安排系统通知。')
  if (!session.uid) return { count: 0, message: '本地合成反馈：请登录当前样例账号；没有发送或安排系统通知。' }
  const nodes = [preferences.eveningEnabled ? `前一天晚上 ${preferences.eveningTime}` : '', preferences.leadEnabled ? `考前 ${preferences.leadHours} 小时` : '', preferences.startEnabled ? '开考时提醒' : ''].filter(Boolean)
  if (!preferences.enabled || !nodes.length) return { count: 0, message: '本地合成反馈：模拟考试提醒计划已清空；没有发送或安排系统通知。' }
  if (mode === 'denied') throw new Error('本地合成反馈：模拟考试通知权限未授予，请允许后重试。')
  // Two wholly synthetic exams, one sample reminder per selected phase. No academic record is read.
  return { count: nodes.length * 2, message: `本地合成反馈：已模拟 ${nodes.length * 2} 条考试提醒，${nodes.join('、')}；没有发送或安排系统通知。` }
}
export const checkInAppClassPopup = () => null
export const notifyClassNow = async () => ({ count: 0, message: '本地预览禁止系统通知' })
export const getReminderBootState = async () => ({ supported: true, enabled: bootEnabled, ownerUid: getPreviewIdentity() || null, lastError: null })
export const setReminderBootRestoreEnabled = async (enabled: boolean) => { await wait(); bootEnabled = enabled; return getReminderBootState() }
export const clearReminderBootOwner = async () => { bootEnabled = false; return getReminderBootState() }
export const getCourseReminderPlanState = async () => ({ supported: true, ownerUid: getPreviewIdentity() || null, plannedCount, activeCount, nextRefreshAt: null, lastError: null })
export const clearCourseReminderPlan = async () => { activeCount = 0; plannedCount = 0; return getCourseReminderPlanState() }
export const syncCourseReminderPlan = async () => { throw new Error('本地预览禁止写入后台课程计划') }
export const getReminderOverlayState = async () => ({ supported: true, enabled: overlayEnabled, permissionGranted: overlayPermission, ownerUid: getPreviewIdentity() || null, pendingCount: overlayEnabled ? activeCount : 0, nextAt: null, exactAlarmGranted: true, lastError: null })
export const requestReminderOverlayPermission = async () => { await wait(); overlayPermission = true; return { ...await getReminderOverlayState(), openedSettings: false } }
export const setReminderOverlayEnabled = async (enabled: boolean) => { await wait(); overlayEnabled = enabled && overlayPermission; return getReminderOverlayState() }
export const clearReminderOverlays = async () => { overlayEnabled = false; return getReminderOverlayState() }
export const syncReminderOverlays = async () => { throw new Error('本地预览禁止写入桌面覆盖计划') }
export const showReminderOverlayPreview = async () => ({ shown: false, reason: '本地预览不覆盖桌面；可使用 App 内弹窗预览。', state: await getReminderOverlayState() })
export const scheduleTestReminder = async () => ({ ok: false, message: '本地预览不安排系统自检通知；此处仅验证设置界面。' })
export const prepareReminderPresentation = async (kind: Parameters<typeof getReminderPresentation>[0]) => { const presentation = getReminderPresentation(kind); return { ...presentation, channelState: { supported: true, created: false, channel: presentation.channel } } }
export const isAndroidNative = () => true // Synthetic capability only, used by settings controls.
export const restoreKeepAliveIfWanted = async (): Promise<void> => {} // No native service in preview.
export const updateKeepAliveText = async (): Promise<void> => {}
export const DEFAULT_KEEP_ALIVE_TEXT = '本地预览不会启动提醒服务'
export const onReminderOverlayOpened = async () => ({ remove: async () => {} })
export const openChannelSettings = async () => '本地预览没有打开系统铃声或震动设置。'
export const openAutostartGuide = async () => '本地预览没有打开手机自启动设置。'
export const openBatteryOptimization = async () => '本地预览没有打开手机电池设置。'
export const openNotificationSettings = async () => '本地预览没有打开手机通知设置。'
export const getReminderPermissionState = async () => ({ supported: true, state: { courseChannelsSupported: true, notificationsEnabled: previewMode !== 'denied', exactAlarmAllowed: previewMode !== 'denied', batteryOptimizationIgnored: true, hasVibrator: true, ringerMode: 'normal' as const, notificationVolume: 5, notificationMaxVolume: 7, interruptionFilter: 'all' as const, channelExists: true, channelImportance: 4, channelSoundEnabled: true, channelVibrationEnabled: true } })
export const IS_NATIVE = true // Only the isolated settings component import resolves to this value.
export const PLATFORM = { native: true, target: 'capacitor' as const, os: 'android' }
