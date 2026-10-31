import type { NotifyRow } from './notify'
import type { AppShell } from './app-shell'

/** Keep management work separate even when one account also uses the student app. */
export function filterNotesForShell(rows: NotifyRow[], shell: AppShell): NotifyRow[] {
  const kinds = shell === 'admin'
    ? new Set(['report_new'])
    : new Set(['todo_due', 'cat_point', 'cat_exchange', 'role_review'])
  return rows.filter((row) => kinds.has(row.kind))
}

/** Notification payloads cannot send the administrator into a student or external page. */
export function adminNotificationPath(link: string): string {
  if (/^\/admin\/(?:content|news|reports|members)(?:[/?#]|$)/.test(link)) return link
  return '/admin/reports'
}
