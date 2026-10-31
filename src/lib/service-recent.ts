import { findCampusService } from './service-catalog'

export const RECENT_SERVICE_EVENT = 'ohhu-recent-services'
const PREFIX = 'ohhu.services.recent.v1:'
const LIMIT = 6
export const recentServiceKey = (uid: string) => `${PREFIX}${encodeURIComponent(uid)}`

/** Only store whitelisted service destinations, never a cross-account guest list. */
export function readRecentServices(uid: string): string[] {
  if (!uid) return []
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(recentServiceKey(uid)) || '[]')
    if (!Array.isArray(rows)) return []
    return [...new Set(rows.filter((to): to is string => typeof to === 'string' && !!findCampusService(to)))].slice(0, LIMIT)
  } catch { return [] }
}

/** Call only on an intentional service click, not on route mounting or redirects. */
export function recordRecentService(uid: string, to: string): void {
  if (!uid || !findCampusService(to)) return
  const next = [to, ...readRecentServices(uid).filter((value) => value !== to)].slice(0, LIMIT)
  try {
    localStorage.setItem(recentServiceKey(uid), JSON.stringify(next))
    window.dispatchEvent(new CustomEvent(RECENT_SERVICE_EVENT, { detail: uid }))
  } catch { /* Storage unavailable: opening the service still works. */ }
}
