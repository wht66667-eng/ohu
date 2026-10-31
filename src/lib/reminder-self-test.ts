/**
 * 提醒自检：用户主动安排一条 N 秒后的通知，观察当前设备与当前渠道表现。
 * 普通测试不依赖登录/课表；重启测试需显式选择并绑定当前账号。
 * 单次结果不代表其他场景一定送达。
 */
import { IS_NATIVE, PLATFORM } from './platform'
import { buildReminderNotification, prepareReminderPresentation, type ReminderKind, type ReminderStyle } from './reminder-presentation'
import { captureQbankSession, isQbankSessionCurrent } from './qbank'

/** 避开真实提醒的 id 段：课表 41000+、考试 51000+、考证 52000+、待办 60000+、常驻 70501 */
const TEST_ID = 70011

export type ReminderTestOptions = { kind?: ReminderKind; style?: ReminderStyle; restoreAfterReboot?: boolean }
let testQueue: Promise<unknown> = Promise.resolve()
export async function scheduleTestReminder(seconds = 60, options: ReminderTestOptions = {}): Promise<{ ok: boolean; message: string }> {
  if (!IS_NATIVE) return { ok: false, message: '网页版关闭后无法准点响，请在 App 内自检' }
  const session = options.restoreAfterReboot ? captureQbankSession() : null
  if (session && !session.uid) return { ok: false, message: '请先登录，再安排重启提醒测试' }
  const current = () => !session || isQbankSessionCurrent(session)
  const cancelled = () => ({ ok: false, message: '账号已变化，重启测试未安排或已撤销，请重新操作' })
  const wait = Number.isFinite(seconds) ? Math.min(600, Math.max(10, Math.round(seconds))) : 60
  // Shared test ID: serialize requests so stale cleanup cannot cancel a newer account's test.
  const result = testQueue.catch(() => undefined).then(async () => {
  try {
    if (!current()) return cancelled()
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const perm = await LocalNotifications.requestPermissions()
    if (!current()) return cancelled()
    if (perm.display !== 'granted') return { ok: false, message: '请先允许通知权限，否则测试提醒也弹不出来' }
    // No style override uses the same current channel as the selected real event.
    const presentation = await prepareReminderPresentation(options.kind ?? 'class-soon', options.style)
    if (!current()) return cancelled()
    if (presentation.channelState.channel?.importance === 0) return { ok: false, message: '测试使用的通知渠道已关闭，请到系统通知设置开启' }
    await LocalNotifications.schedule({
      notifications: [buildReminderNotification(presentation, {
        id: TEST_ID,
        title: '提醒自检 · 请核对到达时间',
        body: `这条测试安排在 ${wait} 秒后。请记录当前设备的到达时间、横幅、锁屏和声音；一次结果不代表所有提醒场景。`,
        at: new Date(Date.now() + wait * 1000),
        selfTest: true,
        ...(session ? { ownerUid: session.uid, restoreAfterReboot: true } : {}),
      })],
    })
    if (!current()) { await LocalNotifications.cancel({ notifications: [{ id: TEST_ID }] }); return cancelled() }
    const pending = await LocalNotifications.getPending()
    if (!current()) { await LocalNotifications.cancel({ notifications: [{ id: TEST_ID }] }); return cancelled() }
    if (!pending.notifications.some((notice) => notice.id === TEST_ID && (!session || notice.extra?.ownerUid === session.uid && notice.extra?.restoreAfterReboot === true))) throw new Error('系统未保留测试提醒，请检查通知权限后重试')
    return { ok: true, message: `已安排 ${wait} 秒后的${presentation.styleLabel}${session ? '重启' : ''}测试；${session ? '可在到达时间前重启设备，保持同一账号并记录实际到达结果。' : '可锁屏或从最近任务划掉 App，记录实际到达结果。'}${!presentation.channelState.supported && PLATFORM.os === 'android' ? '旧系统的样式由通知管理控制；安静提醒请在系统中静音。' : ''}` }
  } catch (e) {
    return { ok: false, message: (e as Error)?.message || '测试提醒安排失败，请检查通知权限' }
  }
  })
  testQueue = result
  return result
}
