import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')
const key = 'ohhu.schedule.school.v1'
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText

function schoolApi({ stored, failRead = false, failWrite = false, unavailable = false } = {}) {
  const storage = new Map(stored === undefined ? [] : [[key, stored]])
  const writes = []
  const module = { exports: {} }
  const globals = { module, exports: module.exports }
  if (!unavailable) globals.localStorage = {
    getItem(name) { if (failRead) throw new Error('storage blocked'); return storage.get(name) ?? null },
    setItem(name, value) { if (failWrite) throw new Error('quota'); writes.push([name, value]); storage.set(name, value) },
  }
  vm.runInNewContext(compile(fs.readFileSync(join(root, 'src/lib/schedule-schools.ts'), 'utf8')), globals)
  return { api: module.exports, storage, writes }
}

test('the five schools have unique identities and JOU alone retains the integrated adapter', () => {
  const { api } = schoolApi()
  const expected = {
    jou: '江苏海洋大学', nmukd: '南京医科大学康达学院', lygsf: '连云港师范学院',
    lygtc: '连云港职业技术学院', jscfa: '江苏财会职业学院',
  }
  assert.deepEqual(Object.fromEntries(api.SCHEDULE_SCHOOLS.map(school => [school.id, school.name])), expected)
  assert.equal(api.SCHEDULE_SCHOOLS.length, 5)
  assert.deepEqual(Array.from(api.SCHEDULE_SCHOOLS.filter(school => school.mode === 'integrated'), school => school.id), ['jou'])
  for (const id of Object.keys(expected)) assert.equal(api.findScheduleSchool(id).name, expected[id])
  for (const id of ['', 'unknown', '__proto__', 'JOU', ' jou ']) assert.equal(api.findScheduleSchool(id), undefined)
})

test('every official guide supplies actionable steps, access limits, help and source links', () => {
  const { api } = schoolApi()
  for (const school of api.SCHEDULE_SCHOOLS.filter(school => school.id !== 'jou')) {
    assert.equal(school.mode, 'official')
    for (const field of ['summary', 'access', 'help', 'syncUnavailableReason']) assert.ok(school[field].trim(), `${school.id}: ${field}`)
    assert.ok(school.steps.length >= 2, `${school.id}: query steps`)
    assert.ok(school.steps.every(step => typeof step === 'string' && step.trim()), school.id)
    assert.ok(school.links.length > 0, `${school.id}: official entry`)
    assert.ok(school.sourceUrls.length > 0, `${school.id}: public source`)
  }
})

test('school links use public HTTP(S) addresses on their own school domains', () => {
  const { api } = schoolApi()
  const domains = {
    jou: ['jou.edu.cn'], nmukd: ['nmukd.edu.cn', 'njmu.edu.cn'], lygsf: ['lygsf.edu.cn', 'lygsf.cn'],
    lygtc: ['lygtc.edu.cn'], jscfa: ['jscfa.edu.cn'],
  }
  for (const school of api.SCHEDULE_SCHOOLS) {
    const addresses = [...school.links.map(link => link.href), ...school.sourceUrls]
    for (const href of addresses) {
      const url = new URL(href)
      assert.ok(['http:', 'https:'].includes(url.protocol), `${school.id}: ${href}`)
      assert.equal(url.username + url.password, '', 'official links must not embed credentials')
      assert.ok(domains[school.id].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)), `${school.id}: ${href}`)
      assert.ok(!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(url.hostname), 'do not publish internal IP addresses as public query entries')
      if (school.id !== 'jou') assert.ok(!/(?:^|\.)jou\.edu\.cn$/.test(url.hostname), `${school.id} must not reuse the JOU adapter login`)
    }
    for (const link of school.links) assert.ok(link.label.trim(), `${school.id}: link label`)
  }
})

test('missing and invalid saved school selections fall back to JOU without modifying storage', () => {
  for (const stored of [undefined, '', 'unknown', '__proto__', 'JOU', ' jou ', '{"id":"nmukd"}']) {
    const { api, writes } = schoolApi({ stored })
    assert.equal(api.readScheduleSchool(), 'jou')
    assert.equal(writes.length, 0)
  }
})

test('each school selection survives reloading through the dedicated preference key', () => {
  const { api, storage, writes } = schoolApi()
  for (const school of api.SCHEDULE_SCHOOLS) {
    api.saveScheduleSchool(school.id)
    assert.equal(api.readScheduleSchool(), school.id)
    assert.equal(storage.get(key), school.id)
    assert.equal(schoolApi({ stored: storage.get(key) }).api.readScheduleSchool(), school.id)
  }
  assert.equal(writes.length, 5)
  assert.ok(writes.every(([writtenKey]) => writtenKey === key))
})

test('invalid writes fail before touching a previously valid selection', () => {
  const { api, storage, writes } = schoolApi({ stored: 'nmukd' })
  for (const id of ['', 'unknown', '__proto__', 'JOU', null, undefined]) {
    assert.throws(() => api.saveScheduleSchool(id), /未知/)
    assert.equal(storage.get(key), 'nmukd')
  }
  assert.equal(writes.length, 0)
})

test('blocked, full and unavailable storage do not prevent opening or choosing a school', () => {
  for (const options of [{ failRead: true }, { failWrite: true }, { unavailable: true }]) {
    const { api } = schoolApi(options)
    assert.equal(api.readScheduleSchool(), 'jou')
    assert.doesNotThrow(() => api.saveScheduleSchool('lygtc'))
    assert.equal(api.readScheduleSchool(), 'jou')
  }
  const { api } = schoolApi({ stored: 'jscfa', failWrite: true })
  assert.doesNotThrow(() => api.saveScheduleSchool('nmukd'))
  assert.equal(api.readScheduleSchool(), 'jscfa', 'a failed write preserves the earlier preference')
})

function renderSchedule({ query = '', stored, uid = 'test-account' } = {}) {
  const { api, storage } = schoolApi({ stored })
  const params = new URLSearchParams(query)
  const navigation = []
  const stateUpdates = []
  const guide = function SchoolScheduleGuide() {}
  const picker = function ScheduleSchoolPicker() {}
  const forbidden = name => () => { throw new Error(`The official guide must not call ${name}`) }
  const jsx = (type, props, nodeKey) => ({ type, props, key: nodeKey })
  const mocks = {
    react: {
      useState: initial => [typeof initial === 'function' ? initial() : initial, value => stateUpdates.push(value)],
      // The release wrapper now owns the phone-login gate and its cleanup ref.
      // Register effects without running the child school/data side effects.
      useEffect: effect => assert.equal(typeof effect, 'function'),
      useRef: current => ({ current }), useMemo: forbidden('JOU memo'),
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-router-dom': { useSearchParams: () => [params, (next, options) => navigation.push({ next, options })] },
    '../../lib/schedule-schools': api,
    '../../lib/qbank': { captureQbankSession: () => ({ uid, revision: 1 }) },
    '../../lib/useQbankRevision': { useQbankRevision: () => {} },
    '../../lib/auth': { useAuth: () => ({
      isSigned: !!uid,
      ensureSignedIn: forbidden('an automatic phone-login prompt while browsing'),
      openLogin: forbidden('an automatic phone-login prompt while browsing'),
    }) },
    '../../lib/schedule-cache': { loadScheduleCache: forbidden('JOU cached courses') },
    '../../lib/timetable': { fetchCaptcha: forbidden('JOU captcha'), queryAcademic: forbidden('JOU academic query') },
    './SchoolScheduleGuide': { SchoolScheduleGuide: guide, ScheduleSchoolPicker: picker },
  }
  const module = { exports: {} }
  vm.runInNewContext(compile(fs.readFileSync(join(root, 'src/pages/schedule/ScheduleHome.tsx'), 'utf8')), {
    module, exports: module.exports, URLSearchParams, require: name => mocks[name] || {},
  })
  return { node: module.exports.ScheduleHome(), guide, picker, storage, navigation, stateUpdates }
}

test('release excludes the unpublished school guide even when an old school query or preference remains', () => {
  for (const id of ['nmukd', 'lygsf', 'lygtc', 'jscfa']) {
    for (const options of [{ query: `school=${id}` }, { stored: id }]) {
      const { node, guide, navigation, stateUpdates } = renderSchedule(options)
      assert.notEqual(node.type, guide)
      assert.equal(node.type.name, 'ScheduleHomeContent')
      assert.equal(node.props.schoolPicker, undefined)
      assert.equal(node.key, 'test-account:1')
      assert.equal(navigation.length, 0)
      assert.equal(stateUpdates.length, 0)
    }
  }
})

test('the existing single-school binding remains the release screen for every query', () => {
  for (const options of [{}, { query: 'school=jou', stored: 'nmukd' }, { query: 'school=unknown', stored: 'nmukd' }]) {
    const { node } = renderSchedule(options)
    assert.equal(node.type.name, 'ScheduleHomeContent')
    assert.equal(node.props.schoolPicker, undefined)
  }
})

test('guest school queries keep the same release screen without starting phone or school login', () => {
  for (const id of ['jou', 'nmukd', 'lygsf', 'lygtc', 'jscfa']) {
    const { node, guide, picker, navigation, stateUpdates } = renderSchedule({ query: `school=${id}`, uid: '' })
    assert.equal(node.type.name, 'ScheduleHomeContent')
    assert.notEqual(node.type, guide)
    assert.notEqual(node.type, picker)
    assert.equal(node.props.schoolPicker, undefined)
    assert.equal(node.key, ':1')
    assert.equal(typeof node.props.requestAction, 'function', 'the phone-login gate remains available for explicit actions')
    assert.equal(navigation.length, 0)
    assert.equal(stateUpdates.length, 0)
  }
})

test('release does not rewrite retained draft preferences or change the current URL', () => {
  const { node, storage, navigation, stateUpdates } = renderSchedule({ query: 'school=nmukd&view=day', stored: 'nmukd' })
  assert.equal(node.props.onChange, undefined)
  assert.equal(storage.get(key), 'nmukd')
  assert.equal(navigation.length, 0)
  assert.equal(stateUpdates.length, 0)
})
