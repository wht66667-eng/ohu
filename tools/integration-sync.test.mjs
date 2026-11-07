import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
const ts = createRequire(import.meta.url)('typescript')
function load(path, mocks, context = {}) {
  const module = { exports: {} }
  const source = ts.transpileModule(fs.readFileSync(new URL(`../src/lib/${path}.ts`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(source, { module, exports: module.exports, require: name => mocks[name], Date, JSON, Set, Map, AbortSignal, ...context })
  return module.exports
}
function fixture() {
  let uid = 'fixture-a', revision = 1
  const storage = new Map()
  return { storage, capture: () => ({ uid, revision }), switch: () => { uid = 'fixture-b'; revision++ },
    current: s => s.uid === uid && s.revision === revision,
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) } }
}
test('fitness import validates whole batch, preserves manual records, and accepts unknown dates', () => {
  const f = fixture(), api = load('physical-test-results', { './qbank': { captureQbankSession: f.capture, isQbankSessionCurrent: f.current } }, { localStorage: f.localStorage })
  const row = { academicYear: '2026', testedAt: '', totalScore: 105, events: [] }
  api.savePhysicalTestResult({ academicYear: '2025-2026', testedAt: '2026-01-01', totalScore: 80, events: [] })
  api.savePhysicalTestBatch([row], f.capture())
  assert.equal(api.listPhysicalTestResults().length, 2)
  const before = JSON.stringify([...f.storage])
  assert.throws(() => api.savePhysicalTestBatch([row, { ...row, totalScore: -1 }], f.capture()))
  assert.equal(JSON.stringify([...f.storage]), before)
  api.savePhysicalTestBatch([{ ...row, totalScore: 108, secret: 'must-not-persist' }], f.capture())
  assert.equal(api.listPhysicalTestResults().filter(r => r.source === 'jou-tice').length, 1)
  assert.ok(!JSON.stringify([...f.storage]).includes('must-not-persist'))
  const old = f.capture(); f.switch()
  assert.throws(() => api.savePhysicalTestBatch([row], old))
  assert.equal(api.listPhysicalTestResults().length, 0)
})
test('learning partial sync preserves unqueried courses and discards signed URL fields', async () => {
  const f = fixture()
  let response
  const api = load('learning-sync', { './qbank': { captureQbankSession: f.capture, isQbankSessionCurrent: f.current }, './timetable': { TIMETABLE_API_BASE: 'https://fixture.invalid' } }, { localStorage: f.localStorage, fetch: async () => ({ ok: true, json: async () => response }) })
  const courses = [{ key: '1:2:3', name: 'Course A', teacher: '' }, { key: '4:5:6', name: 'Course B', teacher: '' }]
  const task = (key, courseKey) => ({ key, courseKey, title: 'Fixture', status: '未交', dueAt: null, deadlineText: '' })
  response = { ok: true, courses, homework: [task('a', '1:2:3'), task('b', '4:5:6')], coveredCourseKeys: courses.map(c => c.key), remainingCourseKeys: [], queriedAt: 1 }
  await api.syncLearning('fixture', 'fixture', '', new AbortController().signal)
  response = { ...response, homework: [{ ...task('a2', '1:2:3'), url: 'https://fixture.invalid/?secret=must-not-persist' }], coveredCourseKeys: ['1:2:3'], remainingCourseKeys: ['4:5:6'], queriedAt: 2 }
  const result = await api.syncLearning('fixture', 'fixture', '', new AbortController().signal)
  assert.deepEqual(Array.from(result.homework, h => h.key).sort(), ['a2', 'b'])
  assert.ok(!JSON.stringify([...f.storage]).includes('must-not-persist'))
})
test('late learning response cannot write into a different app account', async () => {
  const f = fixture(); let finish
  const response = new Promise(resolve => { finish = resolve })
  const api = load('learning-sync', { './qbank': { captureQbankSession: f.capture, isQbankSessionCurrent: f.current }, './timetable': { TIMETABLE_API_BASE: 'https://fixture.invalid' } }, { localStorage: f.localStorage, fetch: async () => ({ ok: true, json: () => response }) })
  const pending = api.syncLearning('fixture', 'fixture', '', new AbortController().signal)
  f.switch(); finish({ ok: true, courses: [], homework: [], coveredCourseKeys: [], remainingCourseKeys: [], queriedAt: 1 })
  await assert.rejects(pending, /账号已切换/)
  assert.equal(f.storage.size, 0)
})
