/**
 * 按壳聚合业务提醒：轮询站内通知，触发本地通知。
 * 2026-10 功能缩减：骑手 / 档口 / 小店实时池与提现徽标随交易链一并移除。
 */
import { getAppShell, type AppShell } from './app-shell'
import { fetchNotifications, type NotifyRow } from './notify'
import { fetchReports } from './reports'
import { fireAlertBurst } from './alert-effects'
import { pingAdminNotification } from './admin-notifications'
import { filterNotesForShell as filterScopeNotes } from './notification-scope'

export type ShellBadge = {
  orders: number
  messages: number
  adminPending: number
  label: string
}

const LS_SEEN = 'sc.shell.notify.seen.v1'

type SeenMap = Record<string, number>

function loadSeen(): SeenMap {
  try {
    return JSON.parse(localStorage.getItem(LS_SEEN) || '{}') as SeenMap
  } catch {
    return {}
  }
}

function saveSeen(m: SeenMap) {
  try {
    localStorage.setItem(LS_SEEN, JSON.stringify(m))
  } catch {
    /* ignore */
  }
}

function alreadySeen(key: string, id: number) { return (loadSeen()[key] || 0) >= id }
function markSeen(key: string, id: number) {
  const m = loadSeen()
  m[key] = id
  saveSeen(m)
}

async function localPing(title: string, body: string, shell: AppShell, uid: string) {
  if (shell === 'admin') return pingAdminNotification(title, body, uid)
  return (await fireAlertBurst({ title, body, notify: true })).notified
}

function emptyBadge(): ShellBadge {
  return { orders: 0, messages: 0, adminPending: 0, label: '' }
}

export async function pollShellAlerts(opts: {
  uid: string
  shell: AppShell
  isCurrent?: () => boolean
}): Promise<ShellBadge> {
  const badge = emptyBadge()
  const isCurrent = () => opts.isCurrent?.() !== false
  if (!opts.uid || !isCurrent()) return badge
  const key = (kind: string) => `${opts.uid}:${kind}`

  // 1) 站内通知
  const notes = await fetchNotifications(opts.uid, 40)
  if (!isCurrent()) return emptyBadge()
  if (notes.error) throw new Error(notes.error)
  const unread = filterScopeNotes(notes.rows.filter((n) => n.uid === opts.uid && !n.read_at), opts.shell)
  badge.messages = unread.length
  let notified = false

  for (const n of unread.slice(0, 3)) {
    if (!isCurrent()) return emptyBadge()
    const noteKey = key(`n:${opts.shell}`)
    if (!alreadySeen(noteKey, n.id)) {
      const delivered = await localPing(n.title || '新通知', n.body || '', opts.shell, opts.uid)
      if (!isCurrent()) return emptyBadge()
      if (delivered) { markSeen(noteKey, n.id); notified = true }
    }
  }

  if (opts.shell === 'admin') {
    const reports = await fetchReports('pending')
    if (!isCurrent()) return emptyBadge()
    if (reports.error) throw new Error(`举报同步失败：${reports.error}`)
    badge.adminPending = reports.rows.length
    badge.label = reports.rows.length > 0 ? `待处理举报 ${reports.rows.length}` : unread.length ? `管理通知 ${unread.length}` : ''
    const newestReport = Math.max(0, ...reports.rows.map((report) => report.id))
    const reportKey = key('admin-report-id')
    if (newestReport > 0 && !alreadySeen(reportKey, newestReport)) {
      const delivered = notified || await localPing('学生举报待处理', `有 ${reports.rows.length} 条待处理举报`, opts.shell, opts.uid)
      if (!isCurrent()) return emptyBadge()
      if (delivered) markSeen(reportKey, newestReport)
    }
  }

  if (opts.shell === 'user') {
    badge.label = unread.length ? `${unread.length} 条未读` : ''
  }

  return badge
}

export function filterNotesForShell(rows: NotifyRow[], shell: AppShell = getAppShell()): NotifyRow[] {
  return filterScopeNotes(rows, shell)
}
