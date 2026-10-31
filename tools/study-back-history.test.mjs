import test from 'node:test'
import assert from 'node:assert/strict'
import { createStudyBackHistory } from '../src/lib/study-back-history.ts'

test('focus back pops the existing hub; the following back returns to the source', () => {
  const history = createStudyBackHistory()
  history.record(0, '/services', 'POP')
  history.record(1, '/study', 'PUSH')
  history.record(2, '/study/focus', 'PUSH')
  assert.deepEqual(history.plan(2, '/study/focus'), { delta: -1 })
  history.record(1, '/study', 'POP')
  assert.deepEqual(history.plan(1, '/study'), { delta: -1 })
})
test('direct focus entry replaces with the hub and preserves its outside source', () => {
  const history = createStudyBackHistory()
  history.record(0, '/todo', 'POP')
  history.record(1, '/study/focus', 'PUSH')
  assert.deepEqual(history.plan(1, '/study/focus'), { to: '/study' })
  history.record(1, '/study', 'REPLACE')
  assert.deepEqual(history.plan(1, '/study'), { delta: -1 })
})
test('legacy repeated focus/hub records are skipped instead of reopening focus', () => {
  const history = createStudyBackHistory()
  for (const [index, route] of ['/','/study','/study/focus','/study','/study/focus','/study'].entries()) history.record(index, route, 'PUSH')
  assert.deepEqual(history.plan(5, '/study'), { delta: -5 })
})
test('cold startup and missing history fall back within the app', () => {
  const history = createStudyBackHistory()
  assert.deepEqual(history.plan(0, '/study/focus'), { to: '/study' })
  assert.deepEqual(history.plan(0, '/study'), { to: '/' })
  history.record(7, '/study', 'POP')
  assert.deepEqual(history.plan(7, '/study'), { to: '/' })
})
test('a new navigation branch drops obsolete forward entries', () => {
  const history = createStudyBackHistory()
  history.record(0, '/services', 'POP')
  history.record(1, '/study', 'PUSH')
  history.record(2, '/study/focus', 'PUSH')
  history.record(0, '/services', 'POP')
  history.record(1, '/market', 'PUSH')
  history.record(2, '/study/focus', 'PUSH')
  assert.deepEqual(history.plan(2, '/study/focus'), { to: '/study' })
  history.record(2, '/study', 'REPLACE')
  assert.deepEqual(history.plan(2, '/study'), { delta: -1 })
})
test('other routes keep their ordinary history semantics', () => {
  const history = createStudyBackHistory()
  assert.equal(history.plan(2, '/market'), null)
  assert.equal(history.plan(2, '/study/lesson'), null)
})
