/** Exercise production preference reads/writes and ScheduleHome handlers with a real identity revision. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const compile = path => ts.transpileModule(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const flush = () => new Promise(setImmediate)
const walk = value => Array.isArray(value) ? value.flatMap(walk) : value && typeof value === 'object' ? [value, ...walk(value.props?.children)] : []
const text = value => Array.isArray(value) ? value.map(text).join('') : typeof value === 'string' || typeof value === 'number' ? String(value) : value?.props ? text(value.props.children) : ''

function service() {
  let uid = 'A', read = async () => ({ data: [], error: null }), write = async () => ({ error: null })
  const storage = new Map(), calls = { read: [], write: [], staleWrites: 0, reminders: 0 }
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }
  const cb = {
    cbAuth: () => ({ currentUser: uid ? { uid, isAnonymous: false } : null }),
    cbRdb: () => ({ from: table => ({
      select: async () => { calls.read.push({ table, uid }); return read() },
      upsert: async row => { calls.write.push(row); return write(row) },
    }) }),
  }
  function load(code, injected) {
    const module = { exports: {} }
    vm.runInNewContext(code, { module, exports: module.exports, localStorage, console, require: name => {
      if (Object.hasOwn(injected, name)) return injected[name]
      throw new Error(`Unexpected module ${name}`)
    } })
    return module.exports
  }
  const qbank = load(compile('src/lib/qbank.ts'), { './cb': cb })
  qbank.setQbankUid(uid)
  const prefs = load(compile('src/lib/schedule-prefs.ts'), { './cb': cb, './qbank': qbank })
  return { prefs, qbank, calls, storage,
    switchUid(next) { uid = next; qbank.setQbankUid(next) },
    read(next) { read = next }, write(next) { write = next },
  }
}

function pageFixture(f = service()) {
  let instance, tree, cursor = 0, sequence = 0
  const intervals = new Map(), noop = () => {}
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  const hooks = {
    useState(initial) {
      const i = cursor++, owner = instance
      owner.slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [owner.slots[i].value, value => {
        if (!owner.active) f.calls.staleWrites++
        const next = typeof value === 'function' ? value(owner.slots[i].value) : value
        if (!Object.is(next, owner.slots[i].value)) { owner.slots[i].value = next; owner.dirty = true }
      }]
    },
    useRef(initial) { return instance.slots[cursor++] ??= { current: initial } },
    useMemo(fn, deps) {
      const i = cursor++
      if (!instance.slots[i] || !same(instance.slots[i].deps, deps)) instance.slots[i] = { deps, value: fn() }
      return instance.slots[i].value
    },
    useEffect(fn, deps) {
      const i = cursor++
      if (!instance.slots[i] || !same(instance.slots[i].deps, deps)) instance.effects.push({ i, fn, deps })
    },
  }
  function jsx(type, props, key) {
    const node = { type, props: props || {}, key }
    if (props?.ref) props.ref.current = { querySelector: () => null }
    return node
  }
  const cached = [{ week: 6, day: 5, sections: [1, 2], name: '合成课程', teacher: '合成教师', room: '测试教室' }]
  const overrides = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-router-dom': { Link: 'link' },
    '../../lib/qbank': f.qbank, '../../lib/useQbankRevision': { useQbankRevision: noop },
    // This fixture exercises the private JOU period editor. School selection
    // and its separate wrapper hook lifecycle are covered in schedule-schools.
    '../../lib/schedule-schools': {}, './SchoolScheduleGuide': {},
    /* 「自动同步（免验证码）」按钮走 lib/auto-sync；本用例只渲染与交互，不触发真实同步 */
    '../../lib/auto-sync': {
      runAutoSync: async () => ({ ok: false, needCaptcha: false, passwordWrong: false, message: '合成桩：未调用' }),
    },
    /* 课表页用 auth.isSigned 区分「访客拿不到提醒」，桩里与 uid='A' 保持同语义 */
    '../../lib/auth': { useAuth: () => ({ isSigned: true }) },
    '../../lib/schedule-prefs': f.prefs,
    '../../lib/timetable': { fetchCaptcha: async () => ({ ok: true, sid: 'synthetic', image: 'data:image/png;base64,fixture' }) },
    '../../lib/schedule-cache': { loadScheduleCache: () => ({ rows: cached }), saveScheduleCache: () => true },
    '../../lib/schedule-credentials': { loadSavedStuid: () => '', loadSavedPassword: () => '', isRememberPasswordEnabled: () => false },
    '../../lib/schedule-calendar': {
      getDayStatus: date => ({ off: false, effectiveDay: date.getDay() || 7 }),
      listNearbyRules: () => [], toDateKey: () => '2026-10-09',
    },
    '../../lib/class-remind': { rescheduleClassReminders: async () => { f.calls.reminders++; return { count: 0 } } },
    '../../lib/exam-utils': { rescheduleExamReminders: async () => ({ count: 0 }) },
    /* 课表页的成绩 / 考试已同步计数用这三个；桩里返回空，保证 useState 初值可算 */
    '../../lib/academic-cache': {
      saveExamsCache: () => {}, saveGradesCache: () => {},
      loadGradesCache: () => [], loadExamsCache: () => [],
      ACADEMIC_CACHE_EVENT: 'ohhu-academic-cache',
    },
    '../../components/PageHeader': { PageHeader: 'page-header' },
    '@capacitor/core': { Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } },
    '../../components/ScheduleAiChangeSheet': { ScheduleAiChangeSheet: 'ai-change-sheet' },
    '../../components/ScheduleGroupSheet': { ScheduleGroupSheet: 'group-sheet' },
    '../../components/ScheduleImageImportSheet': { ScheduleImageImportSheet: 'image-import-sheet' },
    '../../components/fox/FoxSheetPose': { FoxSheetPose: 'fox-pose' },
    '../../components/fox/FoxRequestIndicator': { FoxRequestIndicator: 'fox-request' },
    '../../components/PasswordInput': { PasswordInput: 'password-input' }, '../../components/ScheduleTypeIcon': { ScheduleTypeIcon: 'course-icon' },
    '../../components/ui/StateViews': { EmptyState: 'empty-state', ErrorState: 'error-state', LoadingState: 'loading-state' },
    '../../components/ui/DialogLayer': { DialogLayer: 'dialog-layer' },
    './ScheduleHome.module.css': { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) },
  }
  const module = { exports: {} }
  vm.runInNewContext(compile('src/pages/schedule/ScheduleHome.tsx') + '\nexports.__Content = ScheduleHomeContent;', {
    module, exports: module.exports, console,
    /* 课表页监听 ACADEMIC_CACHE_EVENT 刷新成绩 / 考试计数，window 需要事件接口 */
    window: {
      setInterval: fn => { const id = ++sequence; intervals.set(id, fn); return id },
      clearInterval: id => intervals.delete(id),
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    setInterval: fn => { const id = ++sequence; intervals.set(id, fn); return id }, clearInterval: id => intervals.delete(id),
    setTimeout: () => 1, clearTimeout: noop,
    require: name => { if (Object.hasOwn(overrides, name)) return overrides[name]; throw new Error(`Unexpected dependency ${name}`) },
  })
  function render() {
    const session = f.qbank.captureQbankSession()
    const identityKey = `${session.uid}:${session.revision}`
    if (!instance || instance.key !== identityKey) {
      if (instance) { for (const slot of instance.slots) slot?.cleanup?.(); instance.active = false }
      instance = { key: identityKey, slots: [], effects: [], active: true, dirty: false }
    }
    cursor = 0; instance.dirty = false; instance.effects = []
    tree = module.exports.__Content({ schoolPicker: null })
    for (const pending of instance.effects) {
      instance.slots[pending.i]?.cleanup?.()
      instance.slots[pending.i] = { deps: pending.deps, cleanup: pending.fn() }
    }
    return tree
  }
  return { f,
    async render() { render(); await flush(); for (let i = 0; instance.dirty && i < 10; i++) { render(); await flush() } return tree },
    find(predicate) { return walk(tree).find(predicate) }, all(predicate) { return walk(tree).filter(predicate) },
    async open() { this.find(node => node.type === 'button' && text(node) === '节次时间').props.onClick(); await this.render() },
    modal() { return this.find(node => node.type === 'dialog-layer' && node.props.title === '节次时间') },
    save() { this.find(node => node.type === 'button' && node.props.className === 'tmSave').props.onClick() },
    dispose() { for (const slot of instance?.slots || []) slot?.cleanup?.(); if (instance) instance.active = false },
  }
}

test('an old remote period read cannot write global preferences after A to B to A', async () => {
  const f = service(), pending = deferred()
  const desired = f.prefs.getOfficialPeriods(); desired[0] = ['07:00', '07:45']
  f.read(() => pending.promise)
  const read = f.prefs.fetchRemotePeriods()
  f.switchUid('B'); f.switchUid('A')
  pending.resolve({ data: [{ period_times: desired }], error: null })
  assert.equal(await read, null)
  assert.equal(f.storage.has('schedule.periodTimes'), false)
  f.read(async () => ({ data: [{ period_times: desired }], error: null }))
  assert.equal((await f.prefs.fetchRemotePeriods())[0][0], '07:00')
  assert.equal(JSON.parse(f.storage.get('schedule.periodTimes'))[0][0], '07:00')
})

test('late cloud save success reports a switched session and preserves newer global local preferences', async () => {
  const f = service(), pending = deferred(), old = f.prefs.getOfficialPeriods()
  f.write(() => pending.promise)
  const save = f.prefs.savePeriods(old)
  f.switchUid('B')
  const newer = f.prefs.getOfficialPeriods(); newer[0] = ['07:10', '07:55']
  f.prefs.saveLocalPeriods(newer)
  f.switchUid('A')
  pending.resolve({ error: null })
  assert.match((await save).error, /账号已切换/)
  assert.equal(JSON.parse(f.storage.get('schedule.periodTimes'))[0][0], '07:10')
  assert.equal(f.calls.write[0].uid, 'A')
})

test('current signed saves and guest local saves retain the existing shared preference semantics', async () => {
  const f = service(), times = f.prefs.getOfficialPeriods()
  assert.equal((await f.prefs.savePeriods(times, { custom: false })).error, null)
  assert.equal(f.storage.has('schedule.periodTimes.custom'), false)
  f.switchUid('')
  times[0] = ['07:30', '08:15']
  assert.equal((await f.prefs.savePeriods(times)).error, null)
  assert.equal(f.calls.write.length, 1)
  assert.equal(f.storage.get('schedule.periodTimes.custom'), '1')
})

test('a slow period save locks close and every time input, rejects duplicate submits and preserves draft on failure', async () => {
  const p = pageFixture(), pending = deferred()
  try {
    await p.render(); await p.open()
    p.find(node => node.type === 'input' && node.props['aria-label'] === '第1节开始').props.onChange({ target: { value: '07:00' } })
    await p.render()
    p.f.write(() => pending.promise)
    p.save(); p.save(); await p.render()
    assert.equal(p.f.calls.write.length, 1)
    assert.equal(p.modal().props.allowClose, false)
    assert.equal(p.find(node => node.props?.['aria-label'] === '关闭节次时间设置').props.disabled, true)
    assert.equal(p.all(node => node.type === 'input' && node.props.type === 'time').length, 22)
    assert(p.all(node => node.type === 'input' && node.props.type === 'time').every(node => node.props.disabled))
    pending.resolve({ error: { message: 'synthetic network failure' } }); await p.render()
    assert.equal(p.modal().props.allowClose, true)
    assert.equal(p.find(node => node.props?.['aria-label'] === '第1节开始').props.value, '07:00')
    assert(text(p.modal()).includes('本机已生效'))
  } finally { p.dispose() }
})

test('an obsolete save cannot close or unlock a newly opened saving modal after A to B to A', async () => {
  const p = pageFixture(), old = deferred(), current = deferred()
  try {
    await p.render(); await p.open(); p.f.write(() => old.promise)
    p.save(); await p.render()
    p.f.switchUid('B'); p.f.switchUid('A'); await p.render(); await p.open()
    p.f.write(() => current.promise); p.save(); await p.render()
    old.resolve({ error: null }); await p.render()
    assert(p.modal()); assert.equal(p.modal().props.allowClose, false)
    assert.equal(p.f.calls.staleWrites, 0)
    current.resolve({ error: null }); await p.render()
    assert.equal(p.modal(), undefined)
  } finally { p.dispose() }
})

test('an obsolete restore-official result cannot update a new editor after an identity revision', async () => {
  const p = pageFixture(), old = deferred()
  try {
    await p.render(); await p.open(); p.f.write(() => old.promise)
    p.find(node => node.type === 'button' && text(node) === '恢复官方').props.onClick(); await p.render()
    p.f.switchUid('B'); p.f.switchUid('A'); await p.render(); await p.open()
    p.find(node => node.props?.['aria-label'] === '第1节开始').props.onChange({ target: { value: '07:05' } }); await p.render()
    old.resolve({ error: null }); await p.render()
    assert(p.modal()); assert.equal(p.find(node => node.props?.['aria-label'] === '第1节开始').props.value, '07:05')
    assert.equal(p.f.calls.staleWrites, 0)
  } finally { p.dispose() }
})
