import type { FocusSession } from '../services/focus'

/** Deadlines, rather than interval counts, keep timers correct after background suspension. */
export function focusRemainingMs(session: FocusSession, now = Date.now()): number {
  return Math.max(0, session.pausedLeftMs ?? session.endsAt - now)
}

export function focusRemainingSeconds(session: FocusSession, now = Date.now()): number {
  return Math.ceil(focusRemainingMs(session, now) / 1000)
}

export function pauseFocusSession(session: FocusSession, now = Date.now()): FocusSession {
  return { ...session, pausedLeftMs: focusRemainingMs(session, now) }
}

export function resumeFocusSession(session: FocusSession, now = Date.now()): FocusSession {
  if (session.pausedLeftMs == null) return session
  return { ...session, endsAt: now + session.pausedLeftMs, pausedLeftMs: null }
}

export function extendFocusSession(session: FocusSession, byMinutes = 5): FocusSession {
  const limit = session.phase === 'break' ? 30 : 120
  const added = Number.isFinite(byMinutes) ? Math.max(0, Math.min(Math.floor(byMinutes), limit - session.minutes)) : 0
  return {
    ...session,
    minutes: session.minutes + added,
    endsAt: session.endsAt + added * 60000,
    pausedLeftMs: session.pausedLeftMs == null ? null : session.pausedLeftMs + added * 60000,
  }
}

/** Accept old sessions, but never allow malformed storage to create an endless timer. */
export function restoreFocusSession(value: unknown): FocusSession | null {
  if (!value || typeof value !== 'object') return null
  const s = value as FocusSession
  const limit = s.phase === 'break' ? 30 : 120
  if (![s.minutes, s.startedAt, s.endsAt].every(Number.isFinite)) return null
  if (!Number.isInteger(s.minutes) || s.minutes <= 0 || s.minutes > limit || s.startedAt <= 0 || s.endsAt <= s.startedAt || s.endsAt > 8.64e15) return null
  if (s.phase != null && s.phase !== 'focus' && s.phase !== 'break') return null
  if (s.sessionId != null && (typeof s.sessionId !== 'string' || !s.sessionId || s.sessionId.length > 160)) return null
  if (s.userId != null && (typeof s.userId !== 'string' || !s.userId || s.userId.length > 200)) return null
  if (s.pausedLeftMs != null && (!Number.isFinite(s.pausedLeftMs) || s.pausedLeftMs < 0 || s.pausedLeftMs > s.minutes * 60000)) return null
  return {
    ...s,
    phase: s.phase === 'break' ? 'break' : 'focus',
    title: typeof s.title === 'string' ? s.title.slice(0, 120) : '学习',
    breakMinutes: Number.isInteger(s.breakMinutes) ? Math.max(0, Math.min(30, s.breakMinutes!)) : 0,
    noise: typeof s.noise === 'string' ? s.noise : 'off',
    reminder: s.reminder === 'none' || s.reminder === 'vibrate' ? s.reminder : 'sound',
    todoId: Number.isInteger(s.todoId) ? s.todoId : null,
  }
}

export function formatFocusClock(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : 0
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}
