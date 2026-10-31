import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const compile = path => ts.transpileModule(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const plain = value => JSON.parse(JSON.stringify(value))

/** Actual form and atomic preference code; scheduling is a local response only. */
function fixture() {
  const storage = new Map(), slots = [], window = new EventTarget()
  let cursor = 0, effects = [], writes = 0, schedules = 0, blockedStorage = false
  let session = { uid: 'fixture-a', revision: 1 }, scheduleResult = async () => ({ count: 3, message: '已安排 3 条考试提醒' })
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { if (blockedStorage) throw new Error('本机存储不可用'); writes++; storage.set(key, String(value)) },
  }
  const qbank = { captureQbankSession: () => ({ ...session }), isQbankSessionCurrent: owner => owner.uid === session.uid && owner.revision === session.revision }
  const hooks = {
    useState: initial => {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next }]
    },
    useRef: initial => { const index = cursor++; return slots[index] ??= { current: initial } },
    useEffect: (callback, deps) => {
      const index = cursor++, previous = slots[index]
      if (!previous || !deps || !previous.deps || deps.some((value, i) => !Object.is(value, previous.deps[i]))) effects.push({ index, callback, deps })
    },
  }
  const preferenceModule = { exports: {} }
  vm.runInNewContext(compile('src/lib/exam-reminder-prefs.ts'), { module: preferenceModule, exports: preferenceModule.exports, localStorage, window, Event })
  const prefs = preferenceModule.exports
  const imports = {
    react: hooks,
    'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    '../lib/qbank': qbank,
    '../lib/useQbankRevision': { useQbankRevision: () => session.revision },
    '../lib/exam-reminder-prefs': prefs,
    '../lib/exam-utils': { rescheduleExamReminders: async () => { schedules++; return scheduleResult() } },
    './ExamReminderSettings.module.css': new Proxy({}, { get: (_, name) => name }),
  }
  const module = { exports: {} }
  vm.runInNewContext(compile('src/components/ExamReminderSettings.tsx') + '\nexports.__Content = ExamReminderContent;', {
    module, exports: module.exports,
    require: name => { if (Object.hasOwn(imports, name)) return imports[name]; throw new Error(`Unexpected dependency: ${name}`) },
  })
  let tree
  function render() {
    cursor = 0; effects = []
    tree = module.exports.__Content()
    for (const { index, callback, deps } of effects) { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: callback() } }
    return tree
  }
  function nodes(value) {
    if (Array.isArray(value)) return value.flatMap(item => nodes(item))
    if (!value || typeof value !== 'object') return []
    return [value, ...nodes(value.props?.children)]
  }
  const find = predicate => { const node = nodes(tree).find(predicate); assert.ok(node, 'Expected form control to exist'); return node }
  return {
    prefs, render,
    counts: () => ({ writes, schedules }),
    toggle: label => { find(node => node.props?.role === 'switch' && node.props['aria-label'] === label).props.onClick(); render() },
    change: (id, value) => { find(node => node.props?.id === id).props.onChange({ target: { value } }); render() },
    input: id => find(node => node.props?.id === id),
    submit: () => find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }),
    text: () => nodes(tree).flatMap(node => typeof node.props?.children === 'string' ? [node.props.children] : []).join(' '),
    key: () => module.exports.ExamReminderSettings().key,
    setSchedule: operation => { scheduleResult = operation },
    blockStorage: () => { blockedStorage = true },
    switchUid: uid => { session = { uid, revision: session.revision + 1 } },
    dispose: () => { for (const slot of slots) slot?.cleanup?.() },
  }
}

test('all node and time edits stay in a draft until one atomic save refreshes the exam plan', async () => {
  const f = fixture()
  try {
    f.render()
    f.toggle('开考时提醒')
    f.change('exam-reminder-evening', '21:15')
    f.change('exam-reminder-hours', '0.5')
    assert.deepEqual(f.counts(), { writes: 0, schedules: 0 })
    assert.equal(f.prefs.getExamReminderPreferences().startEnabled, true)
    await f.submit(); f.render()
    assert.deepEqual(f.counts(), { writes: 1, schedules: 1 })
    assert.deepEqual(plain(f.prefs.getExamReminderPreferences()), { enabled: true, eveningEnabled: true, eveningTime: '21:15', leadEnabled: true, leadHours: 0.5, startEnabled: false })
    assert.match(f.text(), /设置已保存。已安排 3 条考试提醒/)
  } finally { f.dispose() }
})

test('invalid active times and fractional minutes fail clearly before any write or scheduling', async () => {
  const f = fixture()
  try {
    f.render(); f.change('exam-reminder-evening', '25:30'); f.change('exam-reminder-hours', '0.251')
    await f.submit(); f.render()
    assert.equal(f.input('exam-reminder-evening').props['aria-invalid'], true)
    assert.equal(f.input('exam-reminder-hours').props['aria-invalid'], true)
    assert.deepEqual(f.counts(), { writes: 0, schedules: 0 })
    f.change('exam-reminder-evening', '20:00'); f.change('exam-reminder-hours', '24.1')
    await f.submit(); f.render()
    assert.match(f.text(), /0.25～24 小时/)
    assert.deepEqual(f.counts(), { writes: 0, schedules: 0 })
  } finally { f.dispose() }
})

test('integer-minute conversion uses the same floating-point tolerance as the stored policy', async () => {
  const f = fixture()
  try {
    f.render(); f.change('exam-reminder-hours', String(20 / 60))
    await f.submit(); f.render()
    assert.equal(f.prefs.getExamReminderPreferences().leadHours, 20 / 60)
    assert.deepEqual(f.counts(), { writes: 1, schedules: 1 })
  } finally { f.dispose() }
})

test('a repeated submit during a pending refresh neither rewrites settings nor creates a second plan', async () => {
  const f = fixture(), wait = deferred()
  try {
    f.setSchedule(() => wait.promise)
    f.render()
    const first = f.submit(), second = f.submit()
    assert.deepEqual(f.counts(), { writes: 1, schedules: 1 })
    wait.resolve({ count: 3, message: '已更新' })
    await Promise.all([first, second]); f.render()
    assert.match(f.text(), /设置已保存/)
  } finally { f.dispose() }
})

test('preference write failure keeps the previous policy and never attempts an exam refresh', async () => {
  const f = fixture()
  try {
    f.render(); f.toggle('考试提醒'); f.blockStorage()
    await f.submit(); f.render()
    assert.equal(f.prefs.getExamReminderPreferences().enabled, true)
    assert.deepEqual(f.counts(), { writes: 0, schedules: 0 })
    assert.match(f.text(), /设置未保存：本机存储不可用/)
  } finally { f.dispose() }
})

test('returned permission failures and thrown bridge failures report saved preferences separately from a failed schedule', async () => {
  for (const result of [async () => ({ count: 0, message: '未授予通知权限' }), async () => { throw new Error('通知桥接失败') }]) {
    const f = fixture()
    try {
      f.setSchedule(result); f.render(); f.toggle('开考时提醒')
      await f.submit(); f.render()
      assert.equal(f.prefs.getExamReminderPreferences().startEnabled, false)
      assert.match(f.text(), /设置已保存，但考试提醒未能更新/)
      assert.deepEqual(f.counts(), { writes: 1, schedules: 1 })
    } finally { f.dispose() }
  }
})

test('turning all exam reminders off is not blocked by an unfinished inactive time field', async () => {
  const f = fixture()
  try {
    f.setSchedule(async () => ({ count: 0, message: '考试提醒已关闭' }))
    f.render(); f.change('exam-reminder-evening', ''); f.change('exam-reminder-hours', '')
    f.toggle('考试提醒')
    await f.submit(); f.render()
    const saved = f.prefs.getExamReminderPreferences()
    assert.equal(saved.enabled, false); assert.equal(saved.eveningTime, '20:00'); assert.equal(saved.leadHours, 2)
    assert.match(f.text(), /设置已保存。考试提醒已关闭/)
  } finally { f.dispose() }
})

test('A to B to A invalidates a pending save response and changes the form identity key', async () => {
  const f = fixture(), wait = deferred()
  try {
    f.setSchedule(() => wait.promise); f.render()
    const key = f.key(), pending = f.submit()
    f.switchUid('fixture-b'); f.switchUid('fixture-a')
    assert.notEqual(f.key(), key)
    wait.resolve({ count: 3, message: '旧账号的安排成功' })
    await pending; f.render()
    assert.doesNotMatch(f.text(), /旧账号的安排成功|设置已保存/)
  } finally { f.dispose() }
})
