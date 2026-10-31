/** Account-owned local alarms. Keep business and focus IDs untouched. */
import type { DeliveredNotificationSchema, LocalNotificationsPlugin, ScheduleOptions } from '@capacitor/local-notifications'
import { IS_NATIVE } from './platform'
import { captureQbankSession, isQbankSessionCurrent, subscribeQbank } from './qbank'

export type PersonalReminderKind = 'class' | 'class-now' | 'exam' | 'todo' | 'cert' | 'bus'
export type ReminderResult = { count: number; message: string }
const kinds: PersonalReminderKind[] = ['class', 'class-now', 'exam', 'todo', 'cert', 'bus']
const revisions: Record<PersonalReminderKind, number> = { class: 0, 'class-now': 0, exam: 0, todo: 0, cert: 0, bus: 0 }
let queue: Promise<unknown> = Promise.resolve()
let identity = captureQbankSession()
export const PERSONAL_REMINDER_ERROR_EVENT = 'ohhu-personal-reminder-error'
export const getPersonalReminderScope = () => {
  const session = captureQbankSession()
  return `${session.revision}:${session.uid}`
}

function ownsId(kind: PersonalReminderKind, id: number): boolean {
  return kind === 'class' ? id >= 41000 && id < 50000
    : kind === 'class-now' ? id === 40999
    : kind === 'exam' ? id >= 51000 && id < 52000
    : kind === 'cert' ? id >= 52000 && id < 53000
    : kind === 'bus' ? id >= 730000 && id < 2_000_730_000 : id >= 60000 && id < 60080
}
function serialize<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.catch(() => undefined).then(run)
  queue = next
  return next
}
async function clearOwned(plugin: LocalNotificationsPlugin, selected: PersonalReminderKind[], options: { keepOwnerUid?: string; current?: () => boolean } = {}) {
  const owned = (id: number) => selected.some((kind) => ownsId(kind, id))
  const shouldClear = (notice: { id: number; extra?: { ownerUid?: unknown } }) => owned(notice.id) && (!options.keepOwnerUid || notice.extra?.ownerUid !== options.keepOwnerUid)
  // Removing delivered notices is separate from cancelling scheduled alarms in Capacitor 7.
  if (options.current && !options.current()) return
  const pending = await plugin.getPending()
  if (options.current && !options.current()) return
  const old = pending.notifications.filter(shouldClear)
  if (old.length) await plugin.cancel({ notifications: old.map(({ id }) => ({ id })) })
  if (options.current && !options.current()) return
  const delivered = await plugin.getDeliveredNotifications()
  if (options.current && !options.current()) return
  const visible = delivered.notifications.filter(shouldClear)
  if (visible.length) await plugin.removeDeliveredNotifications({ notifications: visible })
}

/** A restored account keeps its native plan; legacy/unowned or other-account notices cannot be claimed. */
function clearOtherAccountReminders(session: ReturnType<typeof captureQbankSession>): Promise<void> {
  kinds.forEach((kind) => { revisions[kind]++ })
  return serialize(async () => {
    const current = () => isQbankSessionCurrent(session)
    if (!IS_NATIVE || !session.uid || !current()) return
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await clearOwned(LocalNotifications, kinds, { keepOwnerUid: session.uid, current })
  })
}
export function clearPersonalReminders(session?: ReturnType<typeof captureQbankSession>): Promise<void> {
  kinds.forEach((kind) => { revisions[kind]++ })
  return serialize(async () => {
    if (!IS_NATIVE) return
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await clearOwned(LocalNotifications, kinds, { current: session ? () => isQbankSessionCurrent(session) : undefined })
  })
}
if (typeof window !== 'undefined') window.addEventListener?.('ohhu-reminder-auth-anonymous', () => {
  const session = captureQbankSession()
  if (!session.uid) void clearPersonalReminders(session).catch(error => console.error('[reminders] 匿名会话旧个人提醒清理失败', error))
})

// Auth selects this existing synchronous identity before publishing its new React user.
subscribeQbank(() => {
  const next = captureQbankSession()
  if (next.uid === identity.uid && next.revision === identity.revision) return
  const previous = identity
  identity = next
  // Cold start begins with no JS identity, while native alarms can already belong to
  // the account being restored. A real departure from a known account still clears all.
  const cleanup = previous.uid && previous.uid !== next.uid
    ? clearPersonalReminders()
    : next.uid ? clearOtherAccountReminders(next) : Promise.resolve()
  void cleanup.catch((error) => {
    console.error('[reminders] 旧账号提醒清理失败', error)
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PERSONAL_REMINDER_ERROR_EVENT, { detail: '旧账号提醒清理失败，请重试。' }))
  })
})

export type PersonalReminderContext = {
  session: ReturnType<typeof captureQbankSession>
  current: () => boolean
  plugin: LocalNotificationsPlugin | null
  clear: () => Promise<void>
  schedule: (options: ScheduleOptions) => Promise<boolean>
}
const cancelled = (): ReminderResult => ({ count: 0, message: '账号已变化，旧提醒已撤销' })

function errorText(error: unknown): string {
  if (typeof error === 'string') return error
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' ? message : '系统提醒操作失败'
}

/** A rejected bridge can have written part of its batch. Known IDs remain cancellable even if enumeration fails. */
async function revokeUnconfirmedPlan(plugin: LocalNotificationsPlugin, kind: PersonalReminderKind, options: ScheduleOptions): Promise<string[]> {
  const requested = options.notifications.filter(({ id }) => ownsId(kind, id))
  const pendingIds = new Set(requested.map(({ id }) => id))
  const visible = new Map<number, DeliveredNotificationSchema>(requested.map(({ id, title, body }) => [id, { id, title, body: body || '' }]))
  const failures: string[] = []
  try {
    const pending = await plugin.getPending()
    pending.notifications.filter(({ id }) => ownsId(kind, id)).forEach(({ id }) => pendingIds.add(id))
  } catch (error) { failures.push(`待发提醒读取失败：${errorText(error)}`) }
  try {
    if (pendingIds.size) await plugin.cancel({ notifications: [...pendingIds].map(id => ({ id })) })
  } catch (error) { failures.push(`待发提醒撤销失败：${errorText(error)}`) }
  try {
    const delivered = await plugin.getDeliveredNotifications()
    delivered.notifications.filter(({ id }) => ownsId(kind, id)).forEach(notice => visible.set(notice.id, notice))
  } catch (error) { failures.push(`已送达提醒读取失败：${errorText(error)}`) }
  try {
    if (visible.size) await plugin.removeDeliveredNotifications({ notifications: [...visible.values()] })
  } catch (error) { failures.push(`已送达提醒撤销失败：${errorText(error)}`) }
  return failures
}

function withCleanupFailure(error: unknown, failures: string[]): Error {
  return new Error(`${errorText(error)}；本次提醒清理未完成：${failures.join('；')}。请重试。`, { cause: error })
}

/** Wait for identity first; a signed-in category replaces its plan in one queue. */
export function runPersonalReminder(kind: PersonalReminderKind, run: (context: PersonalReminderContext) => Promise<ReminderResult>, options: { preserveExisting?: boolean } = {}): Promise<ReminderResult> {
  const session = captureQbankSession(), revision = ++revisions[kind]
  const current = () => isQbankSessionCurrent(session) && revision === revisions[kind]
  return serialize(async () => {
    if (!current()) return cancelled()
    // Guest/cold-start code must not revoke a plan before Auth has restored its owner.
    // Actual logout is handled by the identity subscriber and explicit account cleanup.
    if (!session.uid) return { count: 0, message: '等待登录状态确认后再刷新个人提醒' }
    const plugin = IS_NATIVE ? (await import('@capacitor/local-notifications')).LocalNotifications : null
    let cleared = false
    const clearBeforeWrite = async () => {
      if (plugin && !cleared && current()) {
        await clearOwned(plugin, [kind], { current })
        cleared = true
      }
    }
    // Native course replacement owns its durable source and active window. Keep
    // those alarms alive while permissions and the replacement are prepared.
    if (!options.preserveExisting) await clearBeforeWrite()
    if (!current()) return cancelled()
    return run({ session, current, plugin, clear: clearBeforeWrite, schedule: async (options) => {
      if (!plugin || !current()) return false
      if (options.notifications.some(({ id }) => !ownsId(kind, id))) throw new Error('提醒编号不属于当前类别，已停止排程。')
      await clearBeforeWrite()
      if (!current()) return false
      let incomplete = false
      try {
        await plugin.schedule(options)
        // A stale batch is rolled back inside this queue before the next owner can replace it.
        if (current()) {
          const pending = await plugin.getPending()
          if (current()) {
            const confirmed = new Set(pending.notifications.map(({ id }) => id))
            // An immediate reminder can already be delivered before the pending read returns.
            if (options.notifications.some(({ id }) => !confirmed.has(id))) {
              const delivered = await plugin.getDeliveredNotifications()
              delivered.notifications.forEach(({ id }) => confirmed.add(id))
            }
            if (current()) {
              if (options.notifications.every(({ id }) => confirmed.has(id))) return true
              incomplete = true
              throw new Error('部分提醒未能安排，请检查系统权限后重试。')
            }
          }
        }
      } catch (error) {
        const failures = await revokeUnconfirmedPlan(plugin, kind, options)
        if (failures.length) throw withCleanupFailure(error, failures)
        if (incomplete) throw new Error('部分提醒未能安排，本次排程已撤销，请检查系统权限后重试。', { cause: error })
        throw error
      }
      const failures = await revokeUnconfirmedPlan(plugin, kind, options)
      if (failures.length) throw withCleanupFailure(new Error('账号已变化，旧提醒需要撤销'), failures)
      return false
    } })
  })
}
