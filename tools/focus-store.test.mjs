import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FocusRepository, focusDayKey } from '../src/lib/focus-store.ts'
import { focusNotificationPlan, FOCUS_NOTIFICATION_IDS } from '../src/lib/focus-notification-plan.ts'
import { pauseFocusSession, resumeFocusSession, extendFocusSession } from '../src/lib/focus-timer.ts'

const at = 1_800_000_000_000
const session = (uid = 'student-a', id = 'session-1') => ({ version: 3, sessionId: id, userId: uid, minutes: 25, startedAt: at, endsAt: at + 1500000, phase: 'focus', title: '复习高数', breakMinutes: 5, reminder: 'sound', pausedLeftMs: null })
function storage() {
  const data = new Map()
  let writes = 0
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { writes++; data.set(key, value) }, removeItem: (key) => data.delete(key), writes: () => writes }
}
test('completion and next phase persist in a single write and cannot be claimed twice after restart', () => {
  const disk = storage(), repository = new FocusRepository(disk, 'student-a'), active = session()
  repository.save(active)
  const rest = { ...active, sessionId: 'session-1:break', phase: 'break', minutes: 5, startedAt: active.endsAt, endsAt: active.endsAt + 300000 }
  const before = disk.writes()
  assert.deepEqual(repository.finish(active, rest), { recorded: true, durable: true, applied: true, active: rest })
  assert.equal(disk.writes(), before + 1)
  const reopened = new FocusRepository(disk, 'student-a')
  assert.equal(reopened.read().active.sessionId, 'session-1:break')
  assert.equal(reopened.finish(active).recorded, false)
  assert.deepEqual(reopened.read().stats[focusDayKey(active.endsAt)], { minutes: 25, sessions: 1 })
  assert.equal(reopened.finish(rest).recorded, false)
  assert.equal(reopened.read().active, null)
})
test('account isolation protects active sessions and statistics', () => {
  const disk = storage(), first = new FocusRepository(disk, 'student-a'), other = new FocusRepository(disk, 'student-b')
  first.save(session())
  assert.equal(other.read().active, null)
  assert.equal(other.finish(session()).recorded, false)
  first.finish(session())
  assert.deepEqual(other.read().stats, {})
})
test('legacy history has one owner and invalid data cannot poison statistics', () => {
  const disk = storage()
  disk.setItem('focus.stats.v2', JSON.stringify({ '2026-10-01': { minutes: 45, sessions: 2 }, 'bad': { minutes: 100, sessions: 1 }, '2026-10-02': { minutes: 'oops', sessions: 3 } }))
  const first = new FocusRepository(disk, 'student-a'), other = new FocusRepository(disk, 'student-b')
  const { sessionId, userId, ...legacy } = session()
  first.migrate(legacy); other.migrate(legacy)
  assert.equal(first.read().active.userId, 'student-a')
  assert.equal(first.read().active.sessionId, `legacy-${at}`)
  assert.deepEqual(first.read().stats, { '2026-10-01': { minutes: 45, sessions: 2 } })
  assert.deepEqual(other.read().stats, {})
  assert.equal(other.read().active, null)
})
test('storage failure is reported and remains idempotent for the current process', () => {
  const disk = storage()
  disk.setItem = () => { throw new Error('quota') }
  const repository = new FocusRepository(disk, 'student-a')
  assert.equal(repository.save(session()), false)
  assert.deepEqual(repository.finish(session()), { recorded: true, durable: false, applied: true, active: null })
  assert.equal(repository.finish(session()).recorded, false)
  assert.equal(repository.read().stats[focusDayKey(session().endsAt)].minutes, 25)
})
test('notification plan prearranges focus and break, pause cancels, resume and extend replace deadlines', () => {
  const active = session(), notices = focusNotificationPlan(active, at)
  assert.deepEqual(notices.map((n) => n.id), [...FOCUS_NOTIFICATION_IDS])
  assert.deepEqual(notices.map((n) => n.at), [at + 1500000, at + 1800000])
  const paused = pauseFocusSession(active, at + 10000)
  assert.deepEqual(focusNotificationPlan(paused, at), [])
  const resumed = resumeFocusSession(paused, at + 3600000)
  assert.equal(focusNotificationPlan(resumed, at + 3600000)[0].at, at + 5090000)
  const extended = extendFocusSession(resumed)
  assert.equal(focusNotificationPlan(extended, at + 3600000)[1].at, extended.endsAt + 300000)
  assert.deepEqual(focusNotificationPlan({ ...active, reminder: 'none' }, at), [])
  assert.deepEqual(focusNotificationPlan(active, at + 1900000), [])
})
test('malformed stored records restore no active session', () => {
  const disk = storage(), repository = new FocusRepository(disk, 'student-a')
  disk.setItem(repository.key, '{broken')
  assert.equal(repository.read().active, null)
  const { sessionId, ...missingId } = session()
  disk.setItem(repository.key, JSON.stringify({ version: 3, active: missingId, stats: {}, completed: {} }))
  assert.equal(repository.read().active, null)
  disk.setItem(repository.key, JSON.stringify({ version: 3, active: { ...session(), pausedLeftMs: 'not-a-number' }, stats: null, completed: [] }))
  assert.equal(repository.read().active, null)
})

test('a stale completion cannot erase an extension or a pause with the same session ID', () => {
  const disk = storage(), repository = new FocusRepository(disk, 'student-a'), previous = session()
  const extended = extendFocusSession(previous)
  repository.save(extended)
  assert.equal(repository.finish(previous).applied, false)
  assert.equal(repository.read().active.endsAt, extended.endsAt)
  assert.deepEqual(repository.read().stats, {})
  const paused = pauseFocusSession(previous, at + 5000)
  repository.save(paused)
  assert.equal(repository.finish(previous).applied, false)
  assert.equal(repository.read().active.pausedLeftMs, paused.pausedLeftMs)
})
