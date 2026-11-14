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
test('tice imports 2026-2027 and all seven historical years with whitelisted fields', () => {
  const f = fixture(), api = load('physical-test-results', { './qbank': { captureQbankSession: f.capture, isQbankSessionCurrent: f.current } }, { localStorage: f.localStorage })
  const extra = { html: '<html>must-not-persist</html>', path: '/must-not-persist', studentNo: 'must-not-persist', secret: 'must-not-persist' }
  const item = { name: '50米跑', raw: '8.5秒', score: 80, note: '合格', ...extra }
  const current = { year: '2026-2027', total: 88, grade: '良好', bonus: 2, items: [item], doneCount: 1, totalCount: 1, ...extra }
  const history = Array.from({ length: 7 }, (_, i) => ({ ...current, year: `${2025 - i}-${2026 - i}`, total: 70 + i, bonus: 0, items: [{ ...item, raw: `${9 + i}秒` }] }))
  const rows = api.importTiceSummary({ current, history, hasCurrentDetail: true, ...extra })
  assert.deepEqual(Array.from(rows, r => r.academicYear), [current.year, ...history.map(r => r.year)])
  for (const [i, row] of rows.entries()) {
    assert.equal(row.id, `tice:${row.academicYear}`)
    assert.equal(row.testedAt, '')
    assert.equal(row.source, 'tice-import')
    assert.equal(row.totalScore, [current, ...history][i].total)
    assert.equal(row.events[0].result, [current, ...history][i].items[0].raw)
    assert.deepEqual(Object.keys(row.events[0]).sort(), ['name', 'note', 'result', 'score'])
  }
  assert.equal(api.listPhysicalTestResults().length, 8)
  assert.ok(!JSON.stringify([...f.storage]).includes('must-not-persist'))
})
test('unknown current persists, stays first, survives absent detail and disappears once assigned', () => {
  const f = fixture(), mocks = { './qbank': { captureQbankSession: f.capture, isQbankSessionCurrent: f.current } }
  const api = load('physical-test-results', mocks, { localStorage: f.localStorage })
  const current = { year: '', total: null, grade: '', bonus: 0, items: [{ name: '引体向上', raw: '0次', score: 0, note: '' }] }
  const history = [{ year: '2025-2026', total: 80, grade: '良好', bonus: 0, items: [] }]
  const rows = api.importTiceSummary({ current, history, hasCurrentDetail: true })
  assert.equal(rows[0].id, 'tice:current')
  assert.equal(rows[0].academicYear, '')
  assert.equal(rows[0].testedAt, '')
  assert.equal(rows[0].source, 'tice-import')
  assert.equal(rows[0].totalScore, null)
  assert.equal(rows[0].events[0].score, 0)
  const reloaded = load('physical-test-results', mocks, { localStorage: f.localStorage })
  assert.equal(JSON.stringify(reloaded.listPhysicalTestResults()), JSON.stringify(rows))
  api.savePhysicalTestResult({ academicYear: '2030-2031', testedAt: '2030-10-01', totalScore: 90, events: [] })
  assert.deepEqual(Array.from(api.listPhysicalTestResults(), r => r.academicYear), ['', '2030-2031', '2025-2026'])
  assert.equal(JSON.parse([...f.storage.values()][0])[0].id, 'tice:current')
  api.importTiceSummary({ current: { ...current, total: 0, items: [{ ...current.items[0], raw: '', score: null }] }, history: [], hasCurrentDetail: true })
  const replaced = api.listPhysicalTestResults()[0]
  assert.equal(replaced.totalScore, 0)
  assert.equal(replaced.events[0].result, '未计分')
  assert.equal(replaced.events[0].score, undefined)
  assert.equal(api.listPhysicalTestResults().filter(r => r.id === 'tice:current').length, 1)
  for (const hasCurrentDetail of [false, true]) {
    api.importTiceSummary({ current: null, history, hasCurrentDetail })
    assert.equal(JSON.stringify(api.listPhysicalTestResults()[0]), JSON.stringify(replaced))
  }
  const assigned = { ...current, year: '2026-2027' }
  api.importTiceSummary({ current: assigned, history, hasCurrentDetail: false })
  assert.equal(api.listPhysicalTestResults()[0].id, 'tice:current')
  api.importTiceSummary({ current: assigned, history, hasCurrentDetail: true })
  assert.deepEqual(Array.from(api.listPhysicalTestResults(), r => r.academicYear), ['2030-2031', '2026-2027', '2025-2026'])
  assert.ok(!JSON.stringify([...f.storage]).includes('tice:current'))
  api.importTiceSummary({ current, history: [], hasCurrentDetail: true })
  assert.equal(api.listPhysicalTestResults()[0].totalScore, null)
  api.importTiceSummary({ current: { ...current, items: [] }, history, hasCurrentDetail: true })
  assert.ok(api.listPhysicalTestResults().every(r => r.id !== 'tice:current'))
})
test('tice partial history preserves known school data, not manual fields or unknown stored fields', () => {
  const f = fixture(), api = load('physical-test-results', { './qbank': { captureQbankSession: f.capture, isQbankSessionCurrent: f.current } }, { localStorage: f.localStorage })
  const year = { year: '2025-2026', total: 78, grade: '旧学校等级', bonus: 4, items: [{ name: '50米跑', raw: '8秒', score: 90, note: '合格' }] }
  api.importTiceSummary({ current: null, history: [year, { ...year, year: '2023-2024' }], hasCurrentDetail: false })
  api.savePhysicalTestBatch([{ academicYear: year.year, testedAt: '2026-01-01', totalScore: null, events: [] }])
  const manual = ['2025-2026', '2024-2025'].map(academicYear => api.savePhysicalTestResult({ academicYear, testedAt: '2030-01-01', totalScore: 119, grade: '手动专用', bonus: 39, events: [{ name: '手动项目', result: '手动结果', score: 99, note: '手动备注' }] }))
  const [key, encoded] = [...f.storage][0], stored = JSON.parse(encoded)
  const old = stored.find(r => r.id === `tice:${year.year}`)
  Object.assign(old, { html: 'must-not-persist', path: 'must-not-persist', studentNo: 'must-not-persist' })
  Object.assign(old.events[0], { html: 'must-not-persist', path: 'must-not-persist', studentNo: 'must-not-persist' })
  f.localStorage.setItem(key, JSON.stringify(stored))
  const untouched = JSON.stringify(api.listPhysicalTestResults().find(r => r.academicYear === '2023-2024'))
  const partial = { year: year.year, total: null, grade: null, bonus: 0, items: [] }
  api.importTiceSummary({ current: null, history: [partial, { year: '2024-2025', items: [] }], hasCurrentDetail: false })
  const school = api.listPhysicalTestResults().filter(r => r.source && r.academicYear === year.year)
  assert.equal(school.length, 1)
  assert.equal(school[0].totalScore, 78)
  assert.equal(school[0].grade, year.grade)
  assert.equal(school[0].testedAt, '')
  assert.equal(school[0].bonus, undefined)
  assert.equal(school[0].events[0].result, '8秒')
  assert.equal(school[0].events[0].score, 90)
  assert.equal(school[0].events[0].note, '合格')
  assert.ok(!JSON.stringify([...f.storage]).includes('must-not-persist'))
  const noSchool = api.listPhysicalTestResults().find(r => r.id === 'tice:2024-2025')
  assert.equal(noSchool.totalScore, null)
  assert.equal(noSchool.grade, undefined)
  assert.equal(noSchool.bonus, undefined)
  assert.equal(noSchool.events.length, 0)
  for (const row of manual) assert.equal(JSON.stringify(api.listPhysicalTestResults().find(r => r.id === row.id)), JSON.stringify(row))
  assert.equal(JSON.stringify(api.listPhysicalTestResults().find(r => r.academicYear === '2023-2024')), untouched)
  api.importTiceSummary({ current: null, history: [{ ...partial, total: 0, grade: '新学校等级' }], hasCurrentDetail: false })
  api.importTiceSummary({ current: null, history: [{ year: year.year, items: [] }], hasCurrentDetail: false })
  const updated = api.listPhysicalTestResults().find(r => r.id === `tice:${year.year}`)
  assert.equal(updated.totalScore, 0)
  assert.equal(updated.grade, '新学校等级')
  assert.equal(updated.events[0].result, '8秒')
})
test('same-year current items and zero total override history; empty current items use history', () => {
  const f = fixture(), api = load('physical-test-results', { './qbank': { captureQbankSession: f.capture, isQbankSessionCurrent: f.current } }, { localStorage: f.localStorage })
  const year = { year: '2026-2027', total: 88, grade: '良好', bonus: 0, items: [{ name: '50米跑', raw: '旧明细', score: 80, note: '' }] }
  const current = { ...year, total: 0, items: [{ name: '引体向上', raw: '', score: 0, note: '' }] }
  const [row] = api.importTiceSummary({ current, history: [year], hasCurrentDetail: true })
  assert.equal(row.totalScore, 0)
  assert.equal(row.events.length, 1)
  assert.equal(row.events[0].name, '引体向上')
  assert.equal(row.events[0].result, '0')
  assert.equal(row.events[0].score, 0)
  const [fallback] = api.importTiceSummary({ current: { ...current, total: null, items: [] }, history: [year], hasCurrentDetail: false })
  assert.equal(fallback.totalScore, 88)
  assert.equal(fallback.events[0].result, '旧明细')
})
test('unknown-year exception stays strict and empty or invalid summaries do not write', () => {
  const f = fixture(), api = load('physical-test-results', { './qbank': { captureQbankSession: f.capture, isQbankSessionCurrent: f.current } }, { localStorage: f.localStorage })
  const current = { year: '', total: null, grade: '', bonus: 0, items: [{ name: '50米跑', raw: '8秒', score: 80, note: '' }] }
  const [valid] = api.importTiceSummary({ current, history: [], hasCurrentDetail: true })
  const before = JSON.stringify([...f.storage])
  for (const summary of [
    { current: null, history: [], hasCurrentDetail: false },
    { current: { ...current, items: [] }, history: [], hasCurrentDetail: true },
    { current: null, history: [current], hasCurrentDetail: false },
    { current: { ...current, year: 'invalid' }, history: [], hasCurrentDetail: true },
    { current: { ...current, total: -1 }, history: [], hasCurrentDetail: true },
    { current: { ...current, items: [{ ...current.items[0], score: 101 }] }, history: [], hasCurrentDetail: true },
  ]) {
    assert.throws(() => api.importTiceSummary(summary))
    assert.equal(JSON.stringify([...f.storage]), before)
  }
  assert.throws(() => api.savePhysicalTestResult({ academicYear: '', testedAt: '', totalScore: null, events: valid.events }))
  assert.throws(() => api.savePhysicalTestBatch([{ academicYear: '', testedAt: '', totalScore: null, events: valid.events }]))
  assert.equal(JSON.stringify([...f.storage]), before)
  const invalid = [
    { id: 'tice:' }, { source: 'jou-tice' }, { source: undefined }, { testedAt: '2026-01-01' },
    { academicYear: 'invalid' }, { events: [] }, { events: null }, { totalScore: -1 }, { totalScore: 121 },
    { grade: 'x'.repeat(21) }, { bonus: 41 }, { events: Array(17).fill(valid.events[0]) },
    { events: [{ name: '50米跑', result: '8秒', score: 101 }] },
    { events: [{ name: 'x'.repeat(25), result: '8秒' }] },
    { events: [{ name: '50米跑', result: 'x'.repeat(49) }] },
    { events: [{ name: '50米跑', result: '8秒', note: 'x'.repeat(49) }] },
  ].map(overrides => ({ ...valid, ...overrides }))
  f.localStorage.setItem([...f.storage.keys()][0], JSON.stringify([...invalid, valid]))
  assert.equal(JSON.stringify(api.listPhysicalTestResults()), JSON.stringify([valid]))
})
test('tice account changes before import or before the write leave storage untouched', () => {
  for (const switchBeforeImport of [true, false]) {
    const f = fixture(), expected = f.capture()
    let checks = 0
    const api = load('physical-test-results', { './qbank': { captureQbankSession: f.capture, isQbankSessionCurrent: s => {
      if (!switchBeforeImport && ++checks === 2) f.switch()
      return f.current(s)
    } } }, { localStorage: f.localStorage })
    const current = { year: '', total: null, grade: '', bonus: 0, items: [{ name: '50米跑', raw: '8秒', score: 80, note: '' }] }
    if (switchBeforeImport) f.switch()
    assert.throws(() => api.importTiceSummary({ current, history: [], hasCurrentDetail: true }, expected), /账号已/)
    assert.equal(f.storage.size, 0)
    assert.equal(api.listPhysicalTestResults().length, 0)
  }
})
test('learning partial sync preserves unqueried courses and discards signed URL fields', async () => {
  const f = fixture()
  let response
  const api = load('learning-sync', { './qbank': { captureQbankSession: f.capture, isQbankSessionCurrent: f.current }, './timetable': { TIMETABLE_API_BASE: 'https://fixture.invalid' }, './abort-signal': { withTimeout: signal => signal } }, { localStorage: f.localStorage, fetch: async () => ({ ok: true, json: async () => response }) })
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
  const api = load('learning-sync', { './qbank': { captureQbankSession: f.capture, isQbankSessionCurrent: f.current }, './timetable': { TIMETABLE_API_BASE: 'https://fixture.invalid' }, './abort-signal': { withTimeout: signal => signal } }, { localStorage: f.localStorage, fetch: async () => ({ ok: true, json: () => response }) })
  const pending = api.syncLearning('fixture', 'fixture', '', new AbortController().signal)
  f.switch(); finish({ ok: true, courses: [], homework: [], coveredCourseKeys: [], remainingCourseKeys: [], queriedAt: 1 })
  await assert.rejects(pending, /账号已切换/)
  assert.equal(f.storage.size, 0)
})
