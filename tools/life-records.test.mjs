/**
 * 本机生活记录纯函数回归：金额以分存储、饮水量校验、同日汇总由记录重算。
 * 被测模块为零副作用 .ts（IndexedDB 仅在函数体内引用），Node 24 按类型擦除加载。
 * 运行：`node --test tools/life-records.test.mjs`。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  parseAmountCents,
  formatCents,
  clampWaterMl,
  summarizeLifeRecords,
  describeLifeRecord,
  formatRecordTime,
  mealLabel,
  defaultEdgeForPreset,
  PHOTO_PRESETS,
} from '../src/lib/life-records.ts'

test('parseAmountCents 接受最多两位小数的正数并转为分', () => {
  assert.equal(parseAmountCents('12.5'), 1250)
  assert.equal(parseAmountCents('12'), 1200)
  assert.equal(parseAmountCents('0.01'), 1)
  assert.equal(parseAmountCents(' 12.50 '), 1250)
  assert.equal(parseAmountCents('¥12.50'), 1250)
  assert.equal(parseAmountCents('￥3'), 300)
  assert.equal(parseAmountCents('1000000'), 100_000_000)
})

test('parseAmountCents 拒绝非法、零、负数、超精度与溢出', () => {
  for (const bad of ['', 'abc', '-5', '0', '0.00', '12.555', '1.2.3', '1000000.01', '1e3', '  ']) {
    assert.equal(parseAmountCents(bad), null, `应拒绝 ${JSON.stringify(bad)}`)
  }
})

test('formatCents 以两位小数还原元', () => {
  assert.equal(formatCents(1250), '12.50')
  assert.equal(formatCents(1), '0.01')
  assert.equal(formatCents(100_000_000), '1000000.00')
})

test('clampWaterMl 仅接受 1–10000 的整数毫升', () => {
  assert.equal(clampWaterMl(250), 250)
  assert.equal(clampWaterMl(10000), 10000)
  for (const bad of [0, -1, 1.5, 10001, NaN, Infinity]) {
    assert.equal(clampWaterMl(bad), null, `应拒绝 ${bad}`)
  }
})

test('summarizeLifeRecords 由记录重算同日汇总且不修改输入', () => {
  const records = [
    { kind: 'water', ml: 250 },
    { kind: 'water', ml: 500 },
    { kind: 'meal', mealType: 'lunch', name: '食堂午饭' },
    { kind: 'expense', amountCents: 1250, direction: 'out', category: '餐饮' },
    { kind: 'expense', amountCents: 5000, direction: 'in', category: '生活费' },
    { kind: 'note', text: '今天不错' },
  ]
  const snapshot = JSON.stringify(records)
  const summary = summarizeLifeRecords(records)
  assert.deepEqual(summary, {
    count: 6, waterMl: 750, mealCount: 1, expenseOutCents: 1250, expenseInCents: 5000, noteCount: 1,
  })
  assert.equal(JSON.stringify(records), snapshot, '汇总不应修改原始记录')
  assert.deepEqual(summarizeLifeRecords(records), summary, '重复汇总结果一致（不累计）')
})

test('summarizeLifeRecords 空记录全为零', () => {
  assert.deepEqual(summarizeLifeRecords([]), {
    count: 0, waterMl: 0, mealCount: 0, expenseOutCents: 0, expenseInCents: 0, noteCount: 0,
  })
})

test('describeLifeRecord 四类记录各生成可读描述', () => {
  assert.equal(describeLifeRecord({ kind: 'water', ml: 500 }), '喝水 500 mL')
  assert.equal(describeLifeRecord({ kind: 'meal', mealType: 'dinner', name: '食堂晚饭' }), '晚餐 · 食堂晚饭')
  assert.equal(describeLifeRecord({ kind: 'expense', amountCents: 1250, direction: 'out', category: '交通' }), '支出 ¥12.50 · 交通')
  assert.equal(describeLifeRecord({ kind: 'expense', amountCents: 10000, direction: 'in', category: '生活费' }), '收入 ¥100.00 · 生活费')
  assert.equal(describeLifeRecord({ kind: 'note', text: '今天图书馆很安静' }), '今天图书馆很安静')
})

test('mealLabel 覆盖四餐次', () => {
  assert.equal(mealLabel('breakfast'), '早餐')
  assert.equal(mealLabel('lunch'), '午餐')
  assert.equal(mealLabel('dinner'), '晚餐')
  assert.equal(mealLabel('snack'), '加餐')
})

test('formatRecordTime 以本机时区输出补零的 HH:MM', () => {
  assert.equal(formatRecordTime(new Date(2026, 10, 12, 9, 5).getTime()), '09:05')
  assert.equal(formatRecordTime(new Date(2026, 10, 12, 23, 59).getTime()), '23:59')
  assert.equal(formatRecordTime(new Date(2026, 10, 12, 0, 0).getTime()), '00:00')
})

test('PHOTO_PRESETS 覆盖三类预设，杯子／餐食默认纸边、普通照片默认无白边', () => {
  assert.deepEqual(PHOTO_PRESETS.map(item => item.value), ['cup', 'meal', 'photo'])
  assert.equal(defaultEdgeForPreset('cup'), 'paper')
  assert.equal(defaultEdgeForPreset('meal'), 'paper')
  assert.equal(defaultEdgeForPreset('photo'), 'none')
})

test('附带照片贴纸不改变同日汇总与记录描述', () => {
  const photo = { id: 'p1', original: 'data:image/jpeg;base64,x', sticker: 'data:image/png;base64,y', preset: 'meal', edge: 'paper' }
  const plain = [
    { kind: 'water', ml: 250 },
    { kind: 'meal', mealType: 'lunch', name: '食堂午饭' },
  ]
  const withPhoto = [{ ...plain[0], photo }, { ...plain[1], photo }]
  assert.deepEqual(summarizeLifeRecords(withPhoto), summarizeLifeRecords(plain))
  assert.equal(describeLifeRecord(withPhoto[1]), '午餐 · 食堂午饭')
})