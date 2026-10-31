import { Capacitor, registerPlugin } from '@capacitor/core'
import type { LocalNotificationSchema } from '@capacitor/local-notifications'
import { captureQbankSession, isQbankSessionCurrent, subscribeQbank } from './qbank'
import { getReminderBootState } from './reminder-boot'

export type CourseReminderPlanState = { supported: boolean; atomicReplaceSupported?: boolean; ownerUid: string | null; plannedCount: number; activeCount: number; nextRefreshAt: number | null; lastError: string | null }
interface ReminderPlanPlugin {
  getState(): Promise<CourseReminderPlanState>
  sync(options: { ownerUid: string; notifications: Record<string, unknown>[] }): Promise<CourseReminderPlanState>
  clear(options: { ownerUid?: string }): Promise<CourseReminderPlanState>
}
const ReminderPlan = registerPlugin<ReminderPlanPlugin>('ReminderPlan')
const available = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('ReminderPlan')
const empty = (): CourseReminderPlanState => ({ supported: false, ownerUid: null, plannedCount: 0, activeCount: 0, nextRefreshAt: null, lastError: null })
let queue: Promise<unknown> = Promise.resolve()
function serialize<T>(run: () => Promise<T>): Promise<T> { const next = queue.catch(() => undefined).then(run); queue = next; return next }
let identity = captureQbankSession()
subscribeQbank(() => {
  const next = captureQbankSession(), previous = identity; identity = next
  if (previous.uid && next.uid && previous.uid !== next.uid) void clearCourseReminderPlan(previous.uid).catch(() => undefined)
})
if (typeof window !== 'undefined') window.addEventListener('ohhu-reminder-owner-logout', (event) => {
  const owner = (event as CustomEvent<{ ownerUid?: unknown }>).detail?.ownerUid
  if (typeof owner === 'string' && owner) void clearCourseReminderPlan(owner).catch(() => undefined)
})
if (typeof window !== 'undefined') window.addEventListener('ohhu-reminder-auth-anonymous', () => {
  const session = captureQbankSession()
  if (session.uid) return
  void serialize(async () => {
    if (!available() || !isQbankSessionCurrent(session)) return
    const state = await ReminderPlan.getState()
    if (state.ownerUid && isQbankSessionCurrent(session)) await ReminderPlan.clear({ ownerUid: state.ownerUid })
  }).catch(error => console.error('[reminder-plan] 匿名会话旧课表补排清理失败', error))
})
export async function getCourseReminderPlanState(): Promise<CourseReminderPlanState> { await queue.catch(() => undefined); return available() ? ReminderPlan.getState() : empty() }
/** Persists a bounded snapshot of this semester, while native code arms only the next seven days. */
export async function syncCourseReminderPlan(options: { ownerUid: string; notifications: LocalNotificationSchema[] }): Promise<CourseReminderPlanState> {
  if (!available()) return empty()
  if (!options.ownerUid || options.notifications.length > 3360) throw new Error('后台课程计划无效')
  const session = captureQbankSession(), current = () => session.uid === options.ownerUid && isQbankSessionCurrent(session)
  const ids = new Set<number>()
  const notifications = options.notifications.map((notice) => {
    const at = notice.schedule?.at
    if (!(at instanceof Date) || !Number.isFinite(at.getTime()) || notice.extra?.ownerUid !== options.ownerUid || notice.extra?.type !== 'class' || notice.id < 41000 || notice.id >= 50000 || ids.has(notice.id)) throw new Error('后台课程计划含无效条目')
    ids.add(notice.id)
    return { ...notice, atMs: at.getTime(), schedule: { at: at.toISOString(), allowWhileIdle: true } }
  })
  return serialize(async () => {
    if (!current()) return { ...empty(), lastError: '账号已变化，后台课程计划未保存' }
    const boot = await getReminderBootState()
    if (!current() || boot.ownerUid !== session.uid) return { ...empty(), lastError: '后台提醒账户尚未就绪，请重试' }
    const state = await ReminderPlan.sync({ ownerUid: options.ownerUid, notifications })
    if (!current()) return { ...await ReminderPlan.clear({ ownerUid: options.ownerUid }), lastError: '账号已变化，旧后台计划已撤销' }
    return state
  })
}
export async function clearCourseReminderPlan(ownerUid?: string): Promise<CourseReminderPlanState> {
  return serialize(async () => available() ? ReminderPlan.clear({ ownerUid }) : empty())
}
