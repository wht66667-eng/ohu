import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNotice } from '../src/lib/notice-parser.ts'

const now = new Date('2026-10-28T03:00:00Z')
test('extracts an explicit deadline and HTTPS link without a network request', () => {
  const result = parseNotice('提交实验报告，截止2026年10月30日下午五点，入口 https://example.com/work。', now)
  assert.equal(result.candidates.length, 1)
  assert.deepEqual(result.candidates[0].dates.map(({ date, time }) => ({ date, time })), [{ date: '2026-10-30', time: '17:00' }])
  assert.deepEqual(result.candidates[0].links, ['https://example.com/work'])
})
test('date without a time leaves time empty and asks for confirmation', () => {
  const [item] = parseNotice('阅读文章，截止10月30日', now).candidates
  assert.equal(item.dates[0].time, '')
  assert.ok(item.warnings.some(message => message.includes('未写具体时间')))
  assert.ok(item.warnings.some(message => message.includes('未写年份')))
})
test('half hours and unqualified weekdays are represented without hiding ambiguity', () => {
  const [item] = parseNotice('周五下午五点半提交', now).candidates
  assert.deepEqual(item.dates.map(x => [x.date, x.time]), [['2026-10-30', '17:30'], ['2026-11-06', '17:30']])
  assert.ok(item.warnings.some(x => x.includes('本周还是下周')))
})
test('relative dates use Beijing and retain multiple possibilities', () => {
  const midnight = new Date('2026-10-28T16:30:00Z')
  const [item] = parseNotice('今天准备材料，明天截止', midnight).candidates
  assert.deepEqual(item.dates.map(x => x.date), ['2026-10-29', '2026-10-30'])
  assert.ok(item.warnings.some(x => x.includes('多个日期')))
})
test('explicit numbered tasks split, while ambiguous prose does not', () => {
  const split = parseNotice('作业清单\n1. 写报告，截止明天18:30\n2. 上传图片，截止下周五20:00', now)
  assert.equal(split.candidates.length, 2)
  assert.equal(split.candidates[0].dates[0].date, '2026-10-29')
  assert.equal(split.candidates[1].dates[0].date, '2026-11-06')
  const ambiguous = parseNotice('写报告\n明天交材料，后天交图片', now)
  assert.equal(ambiguous.candidates.length, 1)
  assert.ok(ambiguous.warnings.length)
})
test('rejects invalid dates and credentials embedded in a URL', () => {
  const result = parseNotice('截止2026年2月30日，请访问 https://user:secret@example.com/a', now)
  assert.equal(result.candidates[0].dates.length, 0)
  assert.equal(result.candidates[0].links.length, 0)
  assert.ok(result.candidates[0].warnings.some(x => x.includes('无效')))
})
test('limits input size and requires input', () => {
  assert.deepEqual(parseNotice('', now).candidates, [])
  assert.deepEqual(parseNotice('字'.repeat(10001), now).candidates, [])
})
