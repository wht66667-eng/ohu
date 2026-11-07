import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { puCreditOf, puDisplayTotal, puRowsWithCredit, puSummaryFromJson } from '../src/lib/pocketuni-parse.ts'

const raw = JSON.parse(readFileSync(new URL('./fixtures/pu-summary.json', import.meta.url), 'utf8'))
const summary = puSummaryFromJson(raw)

test('PU 成绩：真实 API 数据回归', () => {
  assert.ok(summary)
  assert.equal(puDisplayTotal(summary), 4.85)
  assert.equal(summary.activityCredit, 4.25)
  assert.equal(summary.applyCredit, 0.6)
  assert.equal(summary.rows.length, 10)
  assert.equal(puRowsWithCredit(summary).length, 10)
  assert.equal(Number(puCreditOf(summary, 'b').toFixed(2)), 3.05)
  assert.equal(Number(puCreditOf(summary, 'c').toFixed(2)), 0.6)
  assert.equal(Number(puCreditOf(summary, 'labor').toFixed(2)), 1.2)
})

test('PU 成绩：空数据不误判为 0', () => {
  assert.equal(puSummaryFromJson(null), null)
  const empty = puSummaryFromJson({})
  assert.ok(empty)
  assert.equal(empty.totalCredit, null)
  assert.equal(empty.rows.length, 0)
})
