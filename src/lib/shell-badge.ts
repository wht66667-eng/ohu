import type { OwnerTicket } from './async-owner'
import { currentImSession, subscribeImSession } from './im-session'

const COUNT_KEY = 'sc.shell.badge.n'
const STATE_KEY = 'sc.shell.badge.v1'
const EVENT = 'sc-shell-badge-change'

/** Persisted and remote values must be finite, non-negative integer counts. */
function validCount(value: unknown): number {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return typeof number === 'number' && Number.isSafeInteger(number) && number >= 0 ? number : 0
}

function restore(): { owner: string; count: number } {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null')
    const owner = typeof saved?.owner === 'string' ? saved.owner : ''
    return { owner, count: owner ? validCount(saved.count) : 0 }
  } catch {
    return { owner: '', count: 0 }
  }
}

let { owner, count } = restore()
// A persisted identity is only a cache; session revisions are never restored.
let ownerSession: OwnerTicket | null = null

function sameSession(a: OwnerTicket | null, b: OwnerTicket | null): boolean {
  return !!a && !!b && a.owner === b.owner && a.revision === b.revision
}

function ownsSession(ownerKey: string, session: OwnerTicket | null): boolean {
  if (!session || !currentImSession(session)) return false
  try {
    const identity = JSON.parse(ownerKey)
    return Array.isArray(identity) && identity[0] === session.owner
  } catch { return false }
}

function publish(changed: boolean) {
  try {
    // Keep identity and count in one write; the old number key remains a compatibility mirror.
    sessionStorage.setItem(STATE_KEY, JSON.stringify({ owner, count }))
    sessionStorage.setItem(COUNT_KEY, String(count))
  } catch { /* The in-memory snapshot still updates when storage is unavailable. */ }
  if (changed && typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
}

export function shellBadgeOwnerKey(uid: string, shell: string): string {
  return uid ? JSON.stringify([uid, shell]) : ''
}

/** Scoped reads return zero during account changes, before the host effect runs. */
export function getShellBadgeCount(ownerKey?: string): number {
  if (ownerSession && !currentImSession(ownerSession)) return 0
  return ownerKey !== undefined && (!ownerKey || ownerKey !== owner) ? 0 : count
}

export function setShellBadgeOwner(nextOwner: string, session: OwnerTicket | null) {
  if (nextOwner && !ownsSession(nextOwner, session)) return
  if (owner === nextOwner && (nextOwner ? sameSession(ownerSession, session) : !ownerSession)) return
  const changed = count !== 0
  owner = nextOwner
  ownerSession = nextOwner ? session : null
  count = 0
  publish(changed)
}

/** A late response from the previous account or shell cannot replace the current badge. */
export function updateShellBadgeCount(ownerKey: string, value: unknown, session: OwnerTicket): boolean {
  if (!ownerKey || ownerKey !== owner || !sameSession(ownerSession, session) || !ownsSession(ownerKey, session)) return false
  const next = validCount(value)
  if (next === count) return false
  count = next
  publish(true)
  return true
}

export function clearShellBadgeOwner(ownerKey: string, session: OwnerTicket | null) {
  if (ownerKey === owner && sameSession(ownerSession, session)) setShellBadgeOwner('', null)
}

// Auth selects IM synchronously, including A → B → A before React can render.
subscribeImSession(() => setShellBadgeOwner('', null))

export function subscribeShellBadge(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}

export function shellBadgeText(label: string, value: number): string {
  const unread = validCount(value)
  return `${label}，${unread ? `${unread} 条未读` : '全部已读'}`
}
