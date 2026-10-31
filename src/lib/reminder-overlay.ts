import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { captureQbankSession, isQbankSessionCurrent, subscribeQbank } from './qbank'
import { clearReminderBootOwner } from './reminder-boot'

export type ReminderOverlayState = {
  supported: boolean
  enabled: boolean
  permissionGranted: boolean
  ownerUid: string | null
  pendingCount: number
  nextAt: number | null
  exactAlarmGranted: boolean
  lastError: string | null
}
export type ReminderOverlayItem = { id: number; title: string; body: string; at: Date | string | number; expiresAt?: Date | string | number; route?: string }
export type ReminderOverlaySyncResult = ReminderOverlayState & { scheduledCount: number; skippedExpired: number }
export type ReminderOverlayPermissionResult = ReminderOverlayState & { openedSettings: boolean }
export type ReminderOverlayPreviewResult = { shown: boolean; reason: string | null; state: ReminderOverlayState }
export type ReminderOverlayOpen = { route: string; ownerUid: string | null; preview: boolean }
export type ReminderOverlayClearOptions = { preserveEnabled?: boolean }

interface ReminderOverlayPlugin {
  getState(): Promise<ReminderOverlayState>
  requestPermission(): Promise<ReminderOverlayPermissionResult>
  setEnabled(options: { enabled: boolean }): Promise<ReminderOverlayState>
  sync(options: { ownerUid: string; items: Array<Omit<ReminderOverlayItem, 'at' | 'expiresAt'> & { at: number; expiresAt?: number }> }): Promise<ReminderOverlaySyncResult>
  clear(options: { ownerUid?: string; preserveEnabled?: boolean }): Promise<ReminderOverlayState>
  preview(): Promise<ReminderOverlayPreviewResult>
  addListener(eventName: 'openReminder', listener: (event: ReminderOverlayOpen) => void): Promise<PluginListenerHandle>
}
const ReminderOverlay = registerPlugin<ReminderOverlayPlugin>('ReminderOverlay')
const available = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('ReminderOverlay')
const emptyState = (): ReminderOverlayState => ({ supported: false, enabled: false, permissionGranted: false, ownerUid: null, pendingCount: 0, nextAt: null, exactAlarmGranted: false, lastError: null })
let identity = captureQbankSession()
let queue: Promise<unknown> = Promise.resolve()
function serialize<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.catch(() => undefined).then(run)
  queue = next
  return next
}
subscribeQbank(() => {
  const next = captureQbankSession(), previous = identity
  if (next.uid === previous.uid && next.revision === previous.revision) return
  identity = next
  // An empty identity while CloudBase is restoring is not a confirmed logout.
  // In particular, '' -> A must preserve A's persisted alarms and enabled flag.
  if (!next.uid) return
  void serialize(async () => {
    if (!available() || !isQbankSessionCurrent(next)) return
    const stored = await ReminderOverlay.getState()
    if (isQbankSessionCurrent(next) && stored.ownerUid && stored.ownerUid !== next.uid) {
      await ReminderOverlay.clear({ ownerUid: stored.ownerUid })
    }
  }).catch(error => console.error('[reminder-overlay] 旧账号桌面提醒清理失败', error))
})
if (typeof window !== 'undefined') window.addEventListener('ohhu-reminder-owner-logout', (event: Event) => {
  const ownerUid = (event as CustomEvent<{ ownerUid?: unknown }>).detail?.ownerUid
  if (typeof ownerUid !== 'string' || !ownerUid.trim()) return
  void clearReminderOverlays(ownerUid).catch(error => console.error('[reminder-overlay] 已退出账户提醒清理失败', error))
})
if (typeof window !== 'undefined') window.addEventListener('ohhu-reminder-auth-anonymous', () => {
  const session = captureQbankSession()
  if (session.uid) return
  void serialize(async () => {
    if (!available() || !isQbankSessionCurrent(session)) return
    const state = await ReminderOverlay.getState()
    if (state.ownerUid && isQbankSessionCurrent(session)) await ReminderOverlay.clear({ ownerUid: state.ownerUid })
  }).catch(error => console.error('[reminder-overlay] 匿名会话旧桌面提醒清理失败', error))
})

/** Read-only. Neither this method nor synchronization opens system settings. */
export async function getReminderOverlayState(): Promise<ReminderOverlayState> {
  return available() ? ReminderOverlay.getState() : emptyState()
}
/** Call only from the user's explicit "授权桌面提醒" action. Returning from settings does not enable the feature. */
export async function requestReminderOverlayPermission(): Promise<ReminderOverlayPermissionResult> {
  return available() ? ReminderOverlay.requestPermission() : { ...emptyState(), openedSettings: false }
}
/** Default is off. Native code refuses enabling without the system overlay grant. */
export async function setReminderOverlayEnabled(enabled: boolean): Promise<ReminderOverlayState> {
  const session = captureQbankSession()
  return serialize(async () => {
    if (!available()) return emptyState()
    if (!isQbankSessionCurrent(session) || (enabled && !session.uid)) return { ...await ReminderOverlay.getState(), lastError: '账号已变化或尚未登录，请重新操作' }
    const before = await ReminderOverlay.getState()
    if (!isQbankSessionCurrent(session)) return { ...before, lastError: '账号已变化，请重新操作' }
    if (enabled && before.ownerUid !== session.uid) {
      await ReminderOverlay.clear({ ownerUid: before.ownerUid || undefined })
      if (!isQbankSessionCurrent(session)) return ReminderOverlay.getState()
      await ReminderOverlay.sync({ ownerUid: session.uid, items: [] })
    }
    const state = await ReminderOverlay.setEnabled({ enabled })
    if (!isQbankSessionCurrent(session)) return session.uid ? ReminderOverlay.clear({ ownerUid: session.uid }) : ReminderOverlay.getState()
    return state
  })
}
/** Mirrors this account's future local-notification plan; does not play sound or vibrate. */
export async function syncReminderOverlays(options: { ownerUid: string; items: ReminderOverlayItem[] }): Promise<ReminderOverlaySyncResult> {
  if (!available()) return { ...emptyState(), scheduledCount: 0, skippedExpired: 0 }
  if (!options.ownerUid.trim() || options.items.length > 512) throw new Error('桌面提醒计划无效')
  const ids = new Set<number>()
  const items = options.items.map(item => {
    const at = item.at instanceof Date ? item.at.getTime() : typeof item.at === 'number' ? item.at : new Date(item.at).getTime()
    const expiresAt = item.expiresAt === undefined ? undefined : item.expiresAt instanceof Date ? item.expiresAt.getTime() : typeof item.expiresAt === 'number' ? item.expiresAt : new Date(item.expiresAt).getTime()
    if (!Number.isSafeInteger(item.id) || item.id <= 0 || item.id > 2147483647 || ids.has(item.id) || !Number.isFinite(at) || (expiresAt !== undefined && (!Number.isFinite(expiresAt) || expiresAt <= at))) throw new Error('桌面提醒计划包含无效条目')
    ids.add(item.id)
    return { id: item.id, title: item.title, body: item.body, at, ...(expiresAt === undefined ? {} : { expiresAt }), route: item.route || '/schedule' }
  })
  const session = captureQbankSession()
  const current = () => session.uid === options.ownerUid && isQbankSessionCurrent(session)
  return serialize(async () => {
    if (!current()) return { ...await ReminderOverlay.getState(), scheduledCount: 0, skippedExpired: 0, lastError: '账号已变化，旧桌面提醒已撤销' }
    const before = await ReminderOverlay.getState()
    if (!current()) return { ...before, scheduledCount: 0, skippedExpired: 0, lastError: '账号已变化，旧桌面提醒已撤销' }
    if (before.ownerUid && before.ownerUid !== options.ownerUid) await ReminderOverlay.clear({ ownerUid: before.ownerUid })
    if (!current()) return { ...await ReminderOverlay.getState(), scheduledCount: 0, skippedExpired: 0, lastError: '账号已变化，旧桌面提醒已撤销' }
    const result = await ReminderOverlay.sync({ ownerUid: options.ownerUid, items })
    if (!current()) return { ...await ReminderOverlay.clear({ ownerUid: options.ownerUid }), scheduledCount: 0, skippedExpired: 0, lastError: '账号已变化，旧桌面提醒已撤销' }
    return result
  })
}
/** A confirmed logout clears the owner and opt-in; an empty class plan may retain them. */
export async function clearReminderOverlays(ownerUid?: string, options: ReminderOverlayClearOptions = {}): Promise<ReminderOverlayState> {
  return serialize(async () => {
    try {
      return available() ? await ReminderOverlay.clear({ ownerUid, preserveEnabled: options.preserveEnabled === true }) : emptyState()
    } finally {
      // A failure clearing one native feature must not leave boot recovery signed in.
      if (!options.preserveEnabled && ownerUid) await clearReminderBootOwner(ownerUid)
    }
  })
}
/** Explicit manual preview. No notification, vibration, ringtone or automatic permission request. */
export async function showReminderOverlayPreview(): Promise<ReminderOverlayPreviewResult> {
  return available() ? ReminderOverlay.preview() : { shown: false, reason: '当前环境不支持安卓桌面覆盖提醒', state: emptyState() }
}
/** Retained native click event lets the app navigate after a cold start as well as while it is running. */
export async function onReminderOverlayOpened(listener: (event: ReminderOverlayOpen) => void): Promise<PluginListenerHandle> {
  return available() ? ReminderOverlay.addListener('openReminder', listener) : { remove: async () => {} }
}
