import { Capacitor, registerPlugin } from '@capacitor/core'
import { captureQbankSession, isQbankSessionCurrent, subscribeQbank } from './qbank'

export type ReminderBootState = { supported: boolean; enabled: boolean; ownerUid: string | null; lastError: string | null }
interface ReminderBootPlugin {
  getState(): Promise<ReminderBootState>
  selectOwner(options: { ownerUid: string }): Promise<ReminderBootState>
  setEnabled(options: { ownerUid: string; enabled: boolean }): Promise<ReminderBootState>
  clearOwner(options: { ownerUid: string }): Promise<ReminderBootState>
}
const ReminderBoot = registerPlugin<ReminderBootPlugin>('ReminderBoot')
const available = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('ReminderBoot')
const emptyState = (): ReminderBootState => ({ supported: false, enabled: false, ownerUid: null, lastError: null })
let queue: Promise<unknown> = Promise.resolve()
function serialize<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.catch(() => undefined).then(run)
  queue = next
  return next
}
let identity = captureQbankSession()
function selectSessionOwner() {
  const session = captureQbankSession()
  // Empty during authentication restoration does not prove that the user signed out.
  if (!session.uid) return
  void serialize(async () => {
    if (!available() || !isQbankSessionCurrent(session)) return
    const state = await ReminderBoot.getState()
    if (isQbankSessionCurrent(session) && state.ownerUid !== session.uid) await ReminderBoot.selectOwner({ ownerUid: session.uid })
  }).catch(error => console.error('[reminder-boot] 开机提醒账户对齐失败', error))
}
subscribeQbank(() => {
  const next = captureQbankSession()
  if (next.uid === identity.uid && next.revision === identity.revision) return
  identity = next
  selectSessionOwner()
})
selectSessionOwner()
if (typeof window !== 'undefined') window.addEventListener('ohhu-reminder-auth-anonymous', () => {
  const session = captureQbankSession()
  if (session.uid) return
  void serialize(async () => {
    if (!available() || !isQbankSessionCurrent(session)) return
    const state = await ReminderBoot.getState()
    if (state.ownerUid && isQbankSessionCurrent(session)) await ReminderBoot.clearOwner({ ownerUid: state.ownerUid })
  }).catch(error => console.error('[reminder-boot] 匿名会话旧提醒恢复清理失败', error))
})

/** Read-only: the switch restores saved future alarms, never launches the app or permission UI. */
export async function getReminderBootState(): Promise<ReminderBootState> {
  await queue.catch(() => undefined)
  return available() ? ReminderBoot.getState() : emptyState()
}
/** Off affects reboot recovery only; already scheduled alarms remain active until reboot. */
export async function setReminderBootRestoreEnabled(enabled: boolean): Promise<ReminderBootState> {
  const session = captureQbankSession()
  return serialize(async () => {
    if (!available()) return emptyState()
    if (!session.uid || !isQbankSessionCurrent(session)) return { ...await ReminderBoot.getState(), lastError: '请登录当前账户后修改开机恢复设置' }
    const before = await ReminderBoot.getState()
    if (!isQbankSessionCurrent(session)) return { ...before, lastError: '账号已变化，请重新操作' }
    if (before.ownerUid !== session.uid) await ReminderBoot.selectOwner({ ownerUid: session.uid })
    if (!isQbankSessionCurrent(session)) return { ...await ReminderBoot.getState(), lastError: '账号已变化，请重新操作' }
    const result = await ReminderBoot.setEnabled({ ownerUid: session.uid, enabled })
    return isQbankSessionCurrent(session) ? result : { ...await ReminderBoot.getState(), lastError: '账号已变化，请重新操作' }
  })
}
/** Internal confirmed-logout coordination. Old account work cannot clear the new owner's choice. */
export async function clearReminderBootOwner(ownerUid: string): Promise<ReminderBootState> {
  if (!ownerUid.trim()) return getReminderBootState()
  return serialize(async () => available() ? ReminderBoot.clearOwner({ ownerUid }) : emptyState())
}
