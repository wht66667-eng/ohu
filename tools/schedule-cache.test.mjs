import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText

function scheduleApi() {
  const storage = new Map()
  const events = []
  const modules = new Map()
  let writesBlocked = false
  const window = new EventTarget()
  const dispatch = window.dispatchEvent.bind(window)
  window.dispatchEvent = (event) => { events.push(event.type); return dispatch(event) }
  const globals = { Date, Event, localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { if (writesBlocked) throw new Error('quota'); storage.set(key, value) }, removeItem: (key) => storage.delete(key) }, window }
  const read = (name) => {
    if (name === './cb') return {}
    if (modules.has(name)) return modules.get(name)
    const module = { exports: {} }
    vm.runInNewContext(compile(fs.readFileSync(join(root, 'src/lib', `${name.replace('./', '')}.ts`), 'utf8')), { ...globals, module, exports: module.exports, require: read })
    modules.set(name, module.exports)
    return module.exports
  }
  return { api: read('./schedule-cache'), identity: read('./qbank'), storage, events, blockWrites: () => { writesBlocked = true } }
}

const rows = [{ week: 18, day: 1, sections: [1, 2], name: '高等数学', room: 'A101', teacher: '老师' }]
const snapshot = () => ({ rows: structuredClone(rows), meta: { stuid: '20260001', savedAt: '2026-08-31T01:00:00.000Z', termStart: '2026-08-31', ownerUid: '' } })
const today = new Date('2026-10-02T12:00:00')

test('a matching academic binding preserves an older snapshot without an invented TTL', () => {
  const { api } = scheduleApi()
  const result = api.validateScheduleSnapshot(snapshot(), ' ２０２６０００１ ', today)
  assert.equal(result.status, 'ready')
  assert.equal(result.rows[0].name, '高等数学')
})

test('switching or removing the academic binding hides another student’s courses immediately', () => {
  const { api } = scheduleApi()
  for (const [owner, status] of [['20260002', 'owner-mismatch'], ['', 'unbound']]) {
    const result = api.validateScheduleSnapshot(snapshot(), owner, today)
    assert.equal(result.status, status)
    assert.equal(result.rows.length, 0)
    assert.equal(result.meta, null)
  }
})

test('an account-owned synced timetable stays visible when remembering the student number is off', () => {
  const { api } = scheduleApi()
  const owned = { ...snapshot(), meta: { ...snapshot().meta, ownerUid: 'student-a' } }
  const studentId = api.scheduleStudentIdForSnapshot(owned, '', 'student-a')
  assert.equal(studentId, '20260001')
  assert.equal(api.validateScheduleSnapshot(owned, studentId, today, undefined, 'student-a').status, 'ready')
  assert.equal(api.scheduleStudentIdForSnapshot(owned, '', 'student-b'), '')
  assert.equal(api.scheduleStudentIdForSnapshot(owned, '', ''), '')
  assert.equal(api.scheduleStudentIdForSnapshot(owned, '20260002', 'student-a'), '20260002')
  assert.equal(api.validateScheduleSnapshot(owned, '20260002', today, undefined, 'student-a').status, 'owner-mismatch')
})

test('a snapshot for another known term is not used for today’s course-free state', () => {
  const { api } = scheduleApi()
  const cache = snapshot()
  cache.meta.termStart = '2026-02-23'
  assert.equal(api.validateScheduleSnapshot(cache, '20260001', today).status, 'term-mismatch')
})

test('before-term and beyond-returned-week states are distinct from a verified empty day', () => {
  const { api } = scheduleApi()
  assert.equal(api.validateScheduleSnapshot(snapshot(), '20260001', new Date('2026-08-30T23:59:00')).status, 'before-term')
  const lastSunday = new Date('2027-01-03T23:59:00')
  assert.equal(api.validateScheduleSnapshot(snapshot(), '20260001', lastSunday).status, 'ready')
  assert.equal(api.validateScheduleSnapshot(snapshot(), '20260001', new Date('2027-01-04T00:00:00')).status, 'outside-coverage')
})

test('missing, empty, malformed metadata and invalid course rows never establish “no courses”', () => {
  const { api } = scheduleApi()
  assert.equal(api.validateScheduleSnapshot({ rows: [], meta: null }, '20260001', today).status, 'missing')
  assert.equal(api.validateScheduleSnapshot({ ...snapshot(), rows: [] }, '20260001', today).status, 'missing')
  for (const broken of [
    { ...snapshot(), meta: { ...snapshot().meta, savedAt: 'unknown' } },
    { ...snapshot(), rows: [{ ...rows[0], day: 8 }] },
    { ...snapshot(), rows: [{ ...rows[0], sections: [] }] },
    { ...snapshot(), rows: [{ ...rows[0], week: 0 }] },
    { ...snapshot(), rows: [{ ...rows[0], room: { title: '损坏教室' } }] },
  ]) {
    const result = api.validateScheduleSnapshot(broken, '20260001', today)
    assert.equal(result.status, 'invalid')
    assert.equal(result.rows.length, 0)
  }
})

test('a successful empty sync is distinct from a legacy empty record and stays account-bound', () => {
  const { api, identity } = scheduleApi()
  identity.setQbankUid('student-a')
  assert.equal(api.saveScheduleCache([], '20260001'), true)
  const empty = api.loadScheduleCache()
  assert.equal(empty.meta.confirmedEmpty, true)
  assert.equal(api.validateScheduleSnapshot(empty, '20260001', today, undefined, 'student-a').status, 'ready')
  identity.setQbankUid('student-b')
  assert.equal(api.loadScheduleCache().meta, null)
})

test('a valid snapshot may have no classes on a particular day without deleting stored courses', () => {
  const { api } = scheduleApi()
  const cache = snapshot()
  const valid = api.validateScheduleSnapshot(cache, '20260001', today)
  assert.equal(valid.status, 'ready')
  assert.equal(api.classesOnDate(new Date('2026-09-01T12:00:00'), valid.rows).length, 0)
  assert.equal(cache.rows.length, 1)
})

test('existing save/load/clear calls stay compatible and announce a local snapshot change', () => {
  const { api, storage, events } = scheduleApi()
  api.saveScheduleCache(rows, '20260001')
  assert.equal(api.loadScheduleCache().meta.stuid, '20260001')
  assert.equal(api.loadScheduleCache().rows[0].name, '高等数学')
  assert.equal(events.at(-1), api.SCHEDULE_CACHE_EVENT)
  api.clearScheduleCache()
  assert.equal(storage.size, 0)
  assert.equal(api.loadScheduleCache().rows.length, 0)
  assert.equal(events.filter((name) => name === api.SCHEDULE_CACHE_EVENT).length, 2)
})

test('App UID switching with an unchanged saved student number hides courses and preserves each owner’s snapshot', () => {
  const { api, identity } = scheduleApi()
  identity.setQbankUid('student-a')
  assert.equal(api.saveScheduleCache(rows, '20260001'), true)
  const a = api.loadScheduleCache()
  identity.setQbankUid('student-b')
  assert.equal(api.loadScheduleCache().rows.length, 0)
  assert.equal(api.validateScheduleSnapshot(a, '20260001', today).status, 'owner-mismatch')
  assert.equal(api.saveScheduleCache([{ ...rows[0], name: 'B的课程' }], '20260001'), true)
  assert.equal(api.loadScheduleCache().rows[0].name, 'B的课程')
  identity.setQbankUid('student-a')
  assert.equal(api.loadScheduleCache().rows[0].name, '高等数学')
})

test('a reply from before A -> B -> A cannot replace the current snapshot', () => {
  const { api, identity } = scheduleApi()
  identity.setQbankUid('student-a')
  const oldRequest = identity.captureQbankSession()
  api.saveScheduleCache(rows, '20260001')
  identity.setQbankUid('student-b')
  identity.setQbankUid('student-a')
  assert.equal(api.saveScheduleCache([{ ...rows[0], name: '旧请求课程' }], '20260001', oldRequest), false)
  assert.equal(api.loadScheduleCache().rows[0].name, '高等数学')
})

test('unowned legacy global records remain recoverable on disk and are not claimed by the first login', () => {
  const { api, identity, storage } = scheduleApi()
  const legacy = snapshot()
  delete legacy.meta.ownerUid
  const original = JSON.stringify(legacy.rows)
  storage.set('schedule.cachedRows', original)
  storage.set('schedule.cacheMeta', JSON.stringify(legacy.meta))
  assert.equal(api.loadScheduleCache().rows.length, 0)
  assert.equal(api.validateScheduleSnapshot(legacy, '20260001', today).status, 'owner-unverified')
  identity.setQbankUid('student-a')
  assert.equal(api.loadScheduleCache().rows.length, 0)
  assert.equal(api.saveScheduleCache(rows, '20260001'), true)
  api.clearScheduleCache()
  assert.equal(storage.get('schedule.cachedRows'), original)
  assert.equal(storage.get('schedule.cacheMeta'), JSON.stringify(legacy.meta))
})

test('guest and signed-in school identities do not share a matching student-number snapshot', () => {
  const { api, identity } = scheduleApi()
  api.saveScheduleCache(rows, '20260001')
  identity.setQbankUid('local:20260001')
  assert.equal(api.loadScheduleCache().rows.length, 0)
  identity.setQbankUid(null)
  assert.equal(api.loadScheduleCache().rows[0].name, '高等数学')
})

test('storage failure reports false and leaves the previous atomic snapshot intact', () => {
  const { api, identity, blockWrites, events } = scheduleApi()
  identity.setQbankUid('student-a')
  api.saveScheduleCache(rows, '20260001')
  const before = api.loadScheduleCache()
  const eventCount = events.length
  blockWrites()
  assert.equal(api.saveScheduleCache([{ ...rows[0], name: '不能写入的课程' }], '20260002'), false)
  assert.deepEqual(api.loadScheduleCache(), before)
  assert.equal(events.length, eventCount)
})

test('the mounted homepage signals readiness while its task and listing requests are still pending', () => {
  const effects = []
  const ready = []
  const jsx = (type, props) => ({ type, props })
  const actual = scheduleApi()
  const prefs = { campus: '', services: ['schedule', 'grades', 'english', 'tasks', 'market', 'food'], cards: ['schedule', 'tasks', 'services', 'community'] }
  const options = prefs.services.map((id) => ({ id, label: id, artwork: id, to: `/${id}` }))
  const mocks = {
    'react': { lazy: (loader) => loader, Suspense: 'div', useEffect: (effect) => effects.push(effect), useMemo: (read) => read(), useRef: (value) => ({ current: value }), useState: (value) => [typeof value === 'function' ? value() : value, () => {}] },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-router-dom': { Link: 'a', useNavigate: () => () => {}, useSearchParams: () => [new URLSearchParams(), () => {}] },
    'motion/react': { motion: { div: 'div', header: 'header' }, useReducedMotion: () => true },
    '../lib/auth': { useAuth: () => ({ phase: 'signed', isSigned: true, user: { uid: 'student-a' } }) },
    '../lib/use-campus-preference': { useCampusPreference: () => ({ campus: '', setCampus: () => {} }) },
    '../lib/useQbankRevision': { useQbankRevision: () => 0 },
    '../lib/hooks': { usePollingRows: () => ({ rows: [], loading: true, error: null, reload: () => {} }) },
    '../lib/boot': { markBootReady: (key) => ready.push(key) },
    '../lib/schedule-cache': actual.api,
    '../lib/schedule-credentials': { loadSavedStuid: () => '' },
    '../lib/theme': { getStoredTheme: () => 'light' },
    '../lib/fox-dock-pref': { isFoxDockOn: () => false },
    '../lib/animations': { fadeUp: () => ({}) },
    './home/home-preferences': { DEFAULT_HOME_SERVICE_IDS: prefs.services, HOME_SERVICE_OPTIONS: options, DEFAULT_HOME_CARD_IDS: prefs.cards, HOME_CARD_OPTIONS: prefs.cards.map(id => ({ id, label: id })), loadHomePreferences: () => prefs },
    './home/home-data': { nearestOpenTodo: () => null },
    '../lib/fox-art': { foxAssetUrl: () => 'fox.png' },
    '../lib/ui-variant': { useUiVariant: () => 'classic', foxCampusAssetUrl: () => '', themeAssetUrl: () => '', isFoxFreeVariant: () => false },
  }
  const module = { exports: {} }
  vm.runInNewContext(compile(fs.readFileSync(join(root, 'src/pages/HomePage.tsx'), 'utf8')), { module, exports: module.exports, require: (name) => mocks[name] || {}, Intl, Date })
  module.exports.HomePage()
  const effect = effects.find((callback) => callback.toString().includes('markBootReady'))
  assert.ok(effect, 'homepage should own its mounted-frame readiness')
  effect()
  assert.deepEqual(ready, ['home'])
})
