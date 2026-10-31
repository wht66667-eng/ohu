export type ReminderPopupStyle = 'banner' | 'sheet' | 'dialog'
export type ReminderCard = {
  id: string
  kind: 'class-soon' | 'class-start' | 'exam' | 'cert' | 'todo'
  title: string
  name: string
  detail: string
  hint: string
  route: string
  actionLabel: string
}
const KEY = 'reminder.popup.style'
const EVENT = 'ohhu-reminder-popup-change'
export const REMINDER_POPUP_OPTIONS: readonly { value: ReminderPopupStyle; label: string; hint: string }[] = [
  { value: 'banner', label: '顶部横幅', hint: '保持当前操作，点开查看详情' },
  { value: 'sheet', label: '底部卡片', hint: '展示完整安排，一次确认一条' },
  { value: 'dialog', label: '居中弹窗', hint: '突出当前提醒，适合重要节点' },
]
export function getReminderPopupStyle(): ReminderPopupStyle {
  try { const value = localStorage.getItem(KEY); return value === 'sheet' || value === 'dialog' ? value : 'banner' } catch { return 'banner' }
}
export function setReminderPopupStyle(value: ReminderPopupStyle) {
  if (!REMINDER_POPUP_OPTIONS.some((option) => option.value === value)) throw new Error('未知的弹窗样式')
  localStorage.setItem(KEY, value)
  window.dispatchEvent(new Event(EVENT))
}
export function subscribeReminderPopup(callback: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) callback() }
  window.addEventListener(EVENT, callback)
  window.addEventListener('storage', storage)
  return () => { window.removeEventListener(EVENT, callback); window.removeEventListener('storage', storage) }
}
/** Stable FIFO: a repeated event updates content without displacing the visible card. */
export function enqueueReminderCards(queue: readonly ReminderCard[], incoming: readonly ReminderCard[]): ReminderCard[] {
  const next = [...queue]
  for (const item of incoming) {
    const position = next.findIndex((old) => old.id === item.id)
    if (position === -1) next.push(item)
    else next[position] = item
  }
  return next
}
/** Notification extras are data: never navigate to an arbitrary supplied URL. */
export function reminderActionRoute(action: { actionId?: string; notification?: { id?: number; extra?: Record<string, unknown> } }, uid: string): string | null {
  if (action.actionId !== 'tap' && action.actionId !== 'view-reminder') return null
  const notice = action.notification, extra = notice?.extra
  if (!extra) return null
  if (extra.type === 'self-test' && notice?.id === 70011) return '/settings?section=reminders'
  if (!uid || extra.ownerUid !== uid) return null
  switch (extra.type) {
    case 'class': return '/schedule'
    case 'exam': return '/study?tab=exams'
    case 'cert': return '/study?tab=certs'
    case 'todo': return '/todo'
    default: return null
  }
}
