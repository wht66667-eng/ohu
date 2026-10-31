import { test } from 'node:test'
import assert from 'node:assert/strict'
import { focusRemainingSeconds, pauseFocusSession, resumeFocusSession, extendFocusSession, restoreFocusSession } from '../src/lib/focus-timer.ts'

const start = 1_800_000_000_000
const session = () => ({ minutes: 25, startedAt: start, endsAt: start + 25 * 60000, phase: 'focus', title: '复习高数' })

test('background suspension does not add time to the countdown', () => {
  assert.equal(focusRemainingSeconds(session(), start + 12 * 60000 + 500), 780)
  assert.equal(focusRemainingSeconds(session(), start + 40 * 60000), 0)
})

test('pause survives a long absence and resume preserves fractional seconds', () => {
  const paused = pauseFocusSession(session(), start + 6500)
  assert.equal(focusRemainingSeconds(paused, start + 3600000), 1494)
  const resumed = resumeFocusSession(paused, start + 3600000)
  assert.equal(focusRemainingSeconds(resumed, start + 3601000), 1493)
  assert.equal(resumed.endsAt, start + 3600000 + 1493500)
})

test('extend paused and active sessions without exceeding the focus limit', () => {
  const paused = pauseFocusSession(session(), start + 60000)
  const extended = extendFocusSession(paused)
  assert.equal(extended.minutes, 30)
  assert.equal(focusRemainingSeconds(extended, start + 7200000), 29 * 60)
  assert.equal(extendFocusSession({ ...session(), minutes: 118 }).minutes, 120)
  assert.equal(extendFocusSession({ ...session(), minutes: 120 }).minutes, 120)
})

test('rest sessions have a separate thirty minute limit', () => {
  assert.equal(extendFocusSession({ ...session(), phase: 'break', minutes: 29 }).minutes, 30)
})

test('legacy sessions restore while corrupted storage is rejected', () => {
  const { phase, title, ...legacy } = session()
  assert.equal(restoreFocusSession(legacy).phase, 'focus')
  for (const broken of [null, {}, { ...legacy, endsAt: 'tomorrow' }, { ...legacy, minutes: 999 }, { ...legacy, pausedLeftMs: NaN }, { ...legacy, pausedLeftMs: -1 }]) {
    assert.equal(restoreFocusSession(broken), null)
  }
})
