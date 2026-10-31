import test from 'node:test'
import assert from 'node:assert/strict'
import { saveNoticeBatch } from '../src/lib/notice-todo-batch.ts'

const entries = [
  { index: 0, title: '提交作业', date: '2026-10-30', time: '18:00', link: 'https://example.edu/task' },
  { index: 1, title: '读课文', date: '', time: '', link: '' },
  { index: 2, title: '第三项', date: '', time: '', link: '' },
]
test('only confirmed fields reach the writer, with explicit Beijing time', async () => {
  const writes = [], marked = []
  const result = await saveNoticeBatch(entries.slice(0, 2), () => true, async row => { writes.push(row); return { error: null } }, index => marked.push(index))
  assert.deepEqual(result, { saved: 2, changed: false, error: null })
  assert.deepEqual(writes, [{ title: '提交作业', note: '作业链接：https://example.edu/task', due_at: '2026-10-30T10:00:00.000Z' }, { title: '读课文', note: '', due_at: '' }])
  assert.deepEqual(marked, [0, 1])
})
test('partial failure stops immediately and retains completed indexes', async () => {
  const writes = [], marked = []
  const result = await saveNoticeBatch(entries, () => true, async row => { writes.push(row); return { error: writes.length === 2 ? '网络中断' : null } }, index => marked.push(index))
  assert.equal(writes.length, 2); assert.deepEqual(marked, [0]); assert.equal(result.saved, 1); assert.equal(result.error, '网络中断')
})
test('account change while first write is pending prevents additional writes', async () => {
  let current = true, count = 0
  const result = await saveNoticeBatch(entries, () => current, async () => { count++; current = false; return { error: null } }, () => assert.fail('old account result must not reach UI'))
  assert.equal(count, 1); assert.equal(result.changed, true)
})
