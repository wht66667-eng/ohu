import { IS_NATIVE } from './platform'
import { captureImSession, currentImSession } from './im-session'
import type { OwnerTicket } from './async-owner'

export const ADMIN_NOTIFICATION_CHANNEL = 'admin-work-v1'
export const ADMIN_NOTIFICATION_RUN = `${Date.now()}-${Math.random().toString(36).slice(2)}`
let nextId = 2000000 + Math.floor(Math.random() * 1000000)
const webNotifications = new Set<Notification>()
let clearing: Promise<void> = Promise.resolve()

export function validAdminNotificationOwner(extra: Record<string, unknown> | undefined, session: OwnerTicket | null): boolean {
  return !!session && currentImSession(session) && extra?.type === 'admin-work' && extra.ownerUid === session.owner &&
    typeof extra.ownerRun === 'string' && extra.ownerRun.length > 0 && typeof extra.ownerRevision === 'number' && Number.isSafeInteger(extra.ownerRevision) && extra.ownerRevision >= 0 &&
    (extra.ownerRun !== ADMIN_NOTIFICATION_RUN || extra.ownerRevision === session.revision)
}

/** Only this app's management notification family is cleared, never course or unrelated channels. */
export async function clearAdminNotifications(): Promise<void> {
  const task = clearing.catch(() => undefined).then(clearManagementNotifications)
  clearing = task
  return task
}
async function clearManagementNotifications(): Promise<void> {
  for (const notification of webNotifications) notification.close()
  webNotifications.clear()
  if (!IS_NATIVE) return
  const { LocalNotifications } = await import('@capacitor/local-notifications')
  const [pending, delivered] = await Promise.all([LocalNotifications.getPending(), LocalNotifications.getDeliveredNotifications()])
  const waiting = pending.notifications.filter((item) => item.extra?.type === 'admin-work').map(({ id }) => ({ id }))
  const shown = delivered.notifications.filter((item) => item.extra?.type === 'admin-work')
  if (waiting.length) await LocalNotifications.cancel({ notifications: waiting })
  if (shown.length) await LocalNotifications.removeDeliveredNotifications({ notifications: shown })
}

export async function ensureAdminNotificationChannel(): Promise<void> {
  if (!IS_NATIVE) return
  const { LocalNotifications } = await import('@capacitor/local-notifications')
  try {
    const existing = await LocalNotifications.listChannels()
    if (existing.channels.some((channel) => channel.id === ADMIN_NOTIFICATION_CHANNEL)) return
    await LocalNotifications.createChannel({
      id: ADMIN_NOTIFICATION_CHANNEL, name: '哦狐管理工作通知',
      description: '学生举报与校园内容治理消息', importance: 4, visibility: 0, vibration: true,
    })
  } catch (error) {
    const code = (error as { code?: string })?.code
    if (code !== 'UNAVAILABLE' && code !== 'UNIMPLEMENTED') throw error
  }
}

export async function adminNotificationPermission(request = false): Promise<'granted' | 'denied' | 'prompt' | 'unavailable'> {
  if (IS_NATIVE) {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const status = request ? await LocalNotifications.requestPermissions() : await LocalNotifications.checkPermissions()
    if (status.display === 'granted') { await ensureAdminNotificationChannel(); return 'granted' }
    return status.display === 'denied' ? 'denied' : 'prompt'
  }
  if (typeof Notification === 'undefined') return 'unavailable'
  const status = request ? await Notification.requestPermission() : Notification.permission
  return status === 'default' ? 'prompt' : status
}

/** Background delivery needs a server push channel; polling only runs while the app can execute. */
export async function pingAdminNotification(title: string, body: string, uid: string, link = '/admin/reports'): Promise<boolean> {
  const session = captureImSession(uid)
  if (!session) return false
  if (await adminNotificationPermission() !== 'granted') return false
  if (!currentImSession(session)) return false
  if (IS_NATIVE) {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    if (!currentImSession(session)) return false
    const id = nextId++
    await LocalNotifications.schedule({ notifications: [{
      id, title: `哦狐管理 · ${title}`, body,
      channelId: ADMIN_NOTIFICATION_CHANNEL,
      extra: { type: 'admin-work', link, ownerUid: session.owner, ownerRevision: session.revision, ownerRun: ADMIN_NOTIFICATION_RUN },
    }] })
    if (!currentImSession(session)) { await LocalNotifications.cancel({ notifications: [{ id }] }); return false }
    return true
  }
  const notification = new Notification(`哦狐管理 · ${title}`, { body, tag: `ohhu-admin-work:${uid}` })
  webNotifications.add(notification)
  notification.onclose = () => webNotifications.delete(notification)
  return true
}
