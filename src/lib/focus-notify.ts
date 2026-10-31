import { Capacitor } from '@capacitor/core'
import { isNativeApp } from './native'
import { checkReminderHealth } from './notify-setup'
import { focusEnsureReminderChannels, focusScheduleNotifications, focusCancelNotifications } from './focus-lock'
import { FOCUS_NOTIFICATION_IDS, focusNotificationPlan } from './focus-notification-plan'
import type { FocusSession } from '../services/focus'

export type FocusReminderState = { scheduled: boolean; text: string }
export async function cancelFocusNotifications() {
  if (!isNativeApp()) return
  if (Capacitor.getPlatform() === 'android') {
    await focusCancelNotifications()
    // Failure cleaning a legacy adapter must not block cancellation of the active native alarms.
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      await LocalNotifications.cancel({ notifications: FOCUS_NOTIFICATION_IDS.map((id) => ({ id })) })
    } catch { /* no active plan depends on this adapter */ }
  } else {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.cancel({ notifications: FOCUS_NOTIFICATION_IDS.map((id) => ({ id })) })
  }
}

/** Called in the Provider's serial queue, so old requests cannot overwrite a newer session. */
export async function syncFocusNotifications(session: FocusSession | null, requestPermission = false): Promise<FocusReminderState> {
  if (!isNativeApp()) return { scheduled: false, text: session?.reminder === 'none' ? '本次不提醒' : '浏览器仅支持页面内到时提醒' }
  // Cancel both phases before replacing; pause/end must leave no stale break alarm.
  await cancelFocusNotifications()
  if (!session) return { scheduled: false, text: '计时开始后安排提醒' }
  if (session.pausedLeftMs != null) return { scheduled: false, text: '已暂停，到时提醒已取消' }
  if (session.reminder === 'none') return { scheduled: false, text: '本次不提醒' }
  const { LocalNotifications } = await import('@capacitor/local-notifications')
  if (requestPermission) {
    const permissions = await LocalNotifications.checkPermissions()
    if (permissions.display === 'prompt' || permissions.display === 'prompt-with-rationale') await LocalNotifications.requestPermissions()
  }
  const health = await checkReminderHealth()
  if (health.display !== 'granted' || !health.canSchedule) return { scheduled: false, text: '通知未获授权，仅在页面内提醒；可到设置开启' }
  const channelId = session.reminder === 'vibrate' ? 'sc-focus-vibrate-v3' : 'sc-focus-sound-v3'
  let channelHint = ''
  if (Capacitor.getPlatform() === 'android') {
    const { channels } = await focusEnsureReminderChannels()
    const channel = channels.find((item) => item.id === channelId)
    // Android 23–25 have no channel API and return an empty list; native delivery uses PRIORITY_HIGH.
    if (channels.length && (!channel || channel.importance === 0)) return { scheduled: false, text: '专注通知渠道未开启，请检查系统通知设置' }
    if (channel && channel.importance < 4) channelHint = '；系统已降低通知优先级'
    if (channel && session.reminder === 'sound' && !channel.soundAllowed) channelHint += '；系统已关闭此渠道铃声'
    if (channel && session.reminder === 'vibrate' && !channel.vibration) channelHint += '；系统已关闭此渠道震动'
  }
  const plan = focusNotificationPlan(session)
  if (!plan.length) return { scheduled: false, text: '已到时，正在恢复统计' }
  if (Capacitor.getPlatform() === 'android') {
    const result = await focusScheduleNotifications({ notifications: plan, reminder: session.reminder === 'vibrate' ? 'vibrate' : 'sound' })
    if (!plan.every((notice) => result.scheduledIds.includes(notice.id))) throw new Error('系统未保留专注提醒计划')
    return { scheduled: true, text: (result.exact ? '系统提醒已安排；休眠时短休息提醒可能延迟' : '系统提醒已安排；未授权精确闹钟，可能延迟') + channelHint }
  }
  await LocalNotifications.schedule({ notifications: plan.map((item) => ({
    id: item.id, title: item.title, body: item.body,
    schedule: { at: new Date(item.at), allowWhileIdle: true },
    channelId,
    ...(Capacitor.getPlatform() === 'ios' && session.reminder === 'vibrate' ? { sound: '' } : {}),
    extra: { route: '/study/focus', sessionId: item.sessionId, phase: item.phase },
  })) })
  const pending = await LocalNotifications.getPending()
  if (!plan.every((item) => pending.notifications.some((notice) => notice.id === item.id))) throw new Error('系统未保留专注提醒计划')
  return { scheduled: true, text: health.exactAlarm === false ? '系统提醒已安排；未授权精确闹钟，可能延迟' : '系统提醒已安排；休眠时短休息提醒可能延迟' }
}
