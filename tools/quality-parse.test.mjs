import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { qualityFromJson, qualityPersonalFilesBody, qualityToJson, parseQualityPayload } from '../src/lib/quality-parse.ts'

const payload = JSON.parse(readFileSync(new URL('./fixtures/quality-personalFiles.json', import.meta.url), 'utf8'))

test('公选 personalFiles：解析真实抓包响应', () => {
  const summary = parseQualityPayload(payload)
  assert.ok(summary)
  assert.equal(summary.totalCredit, 4.25)
  assert.equal(summary.type1, 0)
  assert.equal(summary.type2, 3.05)
  assert.equal(summary.type3, 1.2)
  assert.equal(summary.rank, '3614')
  assert.equal(summary.percent, '35.42')
  assert.equal(summary.semesters.length, 6)
  assert.equal(summary.details.length, 9)
})

test('公选 personalFiles：空响应不误判', () => {
  assert.equal(parseQualityPayload(null), null)
  assert.equal(parseQualityPayload({ statusCode: 10102, message: '未经授权' }), null)
})

test('公选 personalFiles：请求体必须带 outid', () => {
  assert.equal(qualityPersonalFilesBody('2023000000'), '{"outid":"2023000000"}')
  assert.equal(qualityPersonalFilesBody(' 2023000000 '), '{"outid":"2023000000"}')
})

test('公选：保存/读取不丢分类明细', () => {
  const summary = parseQualityPayload(payload)
  assert.ok(summary)
  const back = qualityFromJson(qualityToJson(summary))
  assert.ok(back)
  assert.equal(back.details.length, summary.details.length)
  assert.equal(back.details[0].name, summary.details[0].name)
  assert.equal(back.details[0].credit, summary.details[0].credit)
})
