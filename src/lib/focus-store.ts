import { restoreFocusSession } from './focus-timer.ts'
import type { FocusSession } from '../services/focus'

export type FocusDay = { minutes: number; sessions: number }
type Store = { version: 3; active: FocusSession | null; stats: Record<string, FocusDay>; completed: Record<string, number> }
export type FocusStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const blank = (): Store => ({ version: 3, active: null, stats: {}, completed: {} })
export function focusDayKey(at: number) {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function validStats(value: unknown): Record<string, FocusDay> {
  const result: Record<string, FocusDay> = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const [day, data] of Object.entries(value)) {
    const v = data as FocusDay
    if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(v?.minutes) && Number.isInteger(v?.sessions) && v.minutes >= 0 && v.sessions >= 0) {
      result[day] = { minutes: Math.min(960, Math.round(v.minutes)), sessions: Math.min(10000, v.sessions) }
    }
  }
  return result
}

/** One record makes completion, its de-duplication key and statistics one atomic write. */
export class FocusRepository {
  readonly key: string
  readonly scope: string
  private storage: FocusStorage | null
  private fallback: Store | null = null
  durable = true
  constructor(storage: FocusStorage | null, scope: string) {
    this.storage = storage
    this.scope = scope
    this.key = `sc.focus.state.v3:${encodeURIComponent(scope)}`
  }
  read(): Store {
    if (this.fallback) return structuredClone(this.fallback)
    try {
      const raw = JSON.parse(this.storage?.getItem(this.key) || 'null')
      if (!raw || raw.version !== 3) return blank()
      const completed: Record<string, number> = {}
      if (raw.completed && typeof raw.completed === 'object') {
        for (const [id, at] of Object.entries(raw.completed)) if (id.length <= 180 && Number.isFinite(at)) completed[id] = at as number
      }
      const active = restoreFocusSession(raw.active)
      return { version: 3, active: active?.version === 3 && active.sessionId && active.userId === this.scope ? active : null, stats: validStats(raw.stats), completed }
    } catch { return blank() }
  }
  write(value: Store): boolean {
    try {
      if (!this.storage) throw new Error('Storage unavailable')
      this.storage.setItem(this.key, JSON.stringify(value))
      this.fallback = null
      this.durable = true
    } catch { this.fallback = structuredClone(value); this.durable = false }
    return this.durable
  }
  save(active: FocusSession | null) {
    const state = this.read()
    state.active = active ? { ...active, userId: this.scope } : null
    return this.write(state)
  }
  finish(session: FocusSession, next: FocusSession | null = null): { recorded: boolean; durable: boolean; applied: boolean; active: FocusSession | null } {
    const state = this.read()
    // A stale callback or a different account must not record someone else's session.
    if (session.userId !== this.scope || !session.sessionId || state.active?.sessionId !== session.sessionId ||
      state.active.endsAt !== session.endsAt || state.active.minutes !== session.minutes ||
      (state.active.phase || 'focus') !== (session.phase || 'focus') || state.active.pausedLeftMs != null) {
      return { recorded: false, durable: this.durable, applied: false, active: state.active }
    }
    const recorded = session.phase !== 'break' && !state.completed[session.sessionId]
    if (recorded) {
      const day = focusDayKey(session.endsAt)
      const old = state.stats[day] || { minutes: 0, sessions: 0 }
      state.stats[day] = { minutes: Math.min(960, old.minutes + session.minutes), sessions: old.sessions + 1 }
      state.completed[session.sessionId] = session.endsAt
    }
    state.active = next ? { ...next, userId: this.scope } : null
    return { recorded, durable: this.write(state), applied: true, active: state.active }
  }
  add(minutes: number, at: number) {
    if (!Number.isFinite(minutes) || !Number.isFinite(at) || minutes <= 0) return
    const state = this.read(), key = focusDayKey(at), old = state.stats[key] || { minutes: 0, sessions: 0 }
    state.stats[key] = { minutes: Math.min(960, old.minutes + Math.round(minutes)), sessions: old.sessions + 1 }
    this.write(state)
  }
  clearStats() { const state = this.read(); state.stats = {}; this.write(state) }
  migrate(legacySession: unknown) {
    if (!this.storage || this.storage.getItem(this.key)) return
    const state = blank()
    // Unscoped history belongs to its first migrating account only.
    const ownerKey = 'sc.focus.legacy-owner.v3'
    const owner = this.storage.getItem(ownerKey)
    if (!owner || owner === this.scope) {
      try { state.stats = validStats(JSON.parse(this.storage.getItem('focus.stats.v2') || '{}')) } catch { /* invalid legacy history */ }
      const active = restoreFocusSession(legacySession)
      if (active) state.active = { ...active, userId: this.scope, sessionId: active.sessionId || `legacy-${active.startedAt}`, version: 3 }
      // Assign ownership before importing, so a crash cannot duplicate unscoped history.
      this.storage.setItem(ownerKey, this.scope)
    }
    this.write(state)
  }
}

let scope = 'device'
const repositories = new Map<string, FocusRepository>()
export function currentFocusRepository() {
  let repository = repositories.get(scope)
  if (!repository) {
    let storage: Storage | null = null
    try { storage = typeof localStorage === 'undefined' ? null : localStorage } catch { /* blocked storage */ }
    repository = new FocusRepository(storage, scope)
    repositories.set(scope, repository)
  }
  return repository
}
export function setFocusScope(next: string, migrate = true) {
  scope = next
  const repository = currentFocusRepository()
  try {
    let legacy: unknown = null
    try { legacy = JSON.parse(sessionStorage.getItem('pet.focus.session') || 'null') } catch { /* no legacy session */ }
    if (migrate) {
      repository.migrate(legacy)
      sessionStorage.removeItem('pet.focus.session')
    }
  } catch { repository.durable = false }
  notifyFocusStats()
  return repository
}
export function notifyFocusStats() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('focus-stats-change'))
  window.dispatchEvent(new CustomEvent('focus-stats-changed'))
}
