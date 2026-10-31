/** Exercise atomic exam policy persistence without browser or native notifications. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const code = ts.transpileModule(fs.readFileSync(new URL('../src/lib/exam-reminder-prefs.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const plain = value => JSON.parse(JSON.stringify(value))
const defaultPolicy = { enabled: true, eveningEnabled: true, eveningTime: '20:00', leadEnabled: true, leadHours: 2, startEnabled: true }
const key = 'exam.remind.preferences.v1'

function fixture() {
  const storage = new Map(), writes = [], events = [], flags = { writeError: null, readError: null }
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports, Event,
    localStorage: {
      getItem: record => { if (flags.readError) throw flags.readError; return storage.get(record) ?? null },
      setItem: (record, value) => { if (flags.writeError) throw flags.writeError; writes.push({ record, value }); storage.set(record, value) },
    },
    window: { dispatchEvent: event => events.push({ type: event.type, saved: JSON.parse(storage.get(key)) }) },
  })
  return { api: module.exports, storage, writes, events, flags }
}

test('missing and malformed preferences preserve the legacy default cadence without mutating stored data', () => {
  const f = fixture()
  assert.deepEqual(plain(f.api.getExamReminderPreferences()), defaultPolicy)
  const mutable = f.api.getExamReminderPreferences(); mutable.enabled = false
  assert.deepEqual(plain(f.api.getExamReminderPreferences()), defaultPolicy)
  for (const malformed of ['{', 'null', JSON.stringify({ ...defaultPolicy, eveningTime: '24:00' }), JSON.stringify({ enabled: true })]) {
    f.storage.set(key, malformed)
    assert.deepEqual(plain(f.api.getExamReminderPreferences()), defaultPolicy)
    assert.equal(f.storage.get(key), malformed)
  }
  assert.equal(f.writes.length, 0); assert.equal(f.events.length, 0)
})

test('a complete valid policy is saved in one write before the preference event observes it', () => {
  const f = fixture(), policy = { ...defaultPolicy, eveningTime: '21:30', leadHours: 1.25, startEnabled: false }
  assert.equal(f.api.saveExamReminderPreferences(policy), undefined)
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].record, key)
  assert.deepEqual(plain(f.api.getExamReminderPreferences()), policy)
  assert.deepEqual(f.events, [{ type: f.api.EXAM_REMIND_PREF_EVENT, saved: policy }])
})

test('invalid values cannot leave a partial write or publish a policy change', () => {
  const f = fixture()
  f.api.saveExamReminderPreferences(defaultPolicy)
  const original = f.storage.get(key)
  for (const invalid of [
    null, {}, { ...defaultPolicy, enabled: 'yes' }, { ...defaultPolicy, eveningEnabled: 1 },
    { ...defaultPolicy, leadEnabled: null }, { ...defaultPolicy, startEnabled: 1 },
    ...['24:00', '07:60', '7:00', '', '20:00:00'].map(eveningTime => ({ ...defaultPolicy, eveningTime })),
    ...[NaN, Infinity, -Infinity, 0, 0.249, 24.01, 1.001, '2'].map(leadHours => ({ ...defaultPolicy, leadHours })),
  ]) {
    assert.throws(() => f.api.saveExamReminderPreferences(invalid), /考试提醒设置无效/)
    assert.equal(f.storage.get(key), original)
    assert.equal(f.writes.length, 1); assert.equal(f.events.length, 1)
  }
})

test('the allowed endpoints and exact integer-minute fractions round-trip, including an all-off policy', () => {
  const f = fixture()
  for (const leadHours of [0.25, 24, 1 / 3]) {
    f.api.saveExamReminderPreferences({ ...defaultPolicy, leadHours })
    assert.equal(f.api.getExamReminderPreferences().leadHours, leadHours)
  }
  const off = { ...defaultPolicy, enabled: false, eveningEnabled: false, leadEnabled: false, startEnabled: false }
  f.api.saveExamReminderPreferences(off)
  assert.deepEqual(plain(f.api.getExamReminderPreferences()), off)
})

test('storage failures are explicit on save and leave the prior atomic policy and events intact', () => {
  const f = fixture()
  f.api.saveExamReminderPreferences(defaultPolicy)
  f.flags.writeError = new Error('synthetic quota failure')
  assert.throws(() => f.api.saveExamReminderPreferences({ ...defaultPolicy, enabled: false }), /synthetic quota failure/)
  assert.deepEqual(plain(f.api.getExamReminderPreferences()), defaultPolicy)
  assert.equal(f.events.length, 1); assert.equal(f.writes.length, 1)
  f.flags.readError = new Error('synthetic blocked read')
  assert.deepEqual(plain(f.api.getExamReminderPreferences()), defaultPolicy)
})
