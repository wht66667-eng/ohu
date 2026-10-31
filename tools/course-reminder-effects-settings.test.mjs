import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const compile = path => ts.transpileModule(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

/** Actual component and effect preference policy; native boundaries are isolated. */
function fixture({ supported = true } = {}) {
  const slots = [], storage = new Map(), window = new EventTarget()
  let cursor = 0, pendingEffects = [], schedules = 0, reads = 0, session = { uid: 'student-a', revision: 1 }
  let read = async () => ({ supported, state: supported ? { courseChannelsSupported: true, courseAlarmClockSupported: true, notificationsEnabled: true, exactAlarmAllowed: true, batteryOptimizationIgnored: true, hasVibrator: true, ringerMode: 'normal', notificationVolume: 5, notificationMaxVolume: 7, interruptionFilter: 'all', channelExists: true, channelImportance: 4, channelSoundEnabled: true, channelVibrationEnabled: true } : null, ...(supported ? {} : { error: '安装新版 APK 后可查看手机权限与声音状态。' }) })
  let schedule = async () => ({ count: 2, message: '已安排 2 条提醒' })
  const hooks = {
    useState: initial => { const i = cursor++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next }] },
    useRef: initial => { const i = cursor++; return slots[i] ??= { current: initial } },
    useEffect: (callback, deps) => { const i = cursor++, previous = slots[i]; if (!previous || deps.some((value, j) => !Object.is(value, previous.deps[j]))) pendingEffects.push({ i, callback, deps }) },
  }
  const preferences = { exports: {} }
  vm.runInNewContext(compile('src/lib/reminder-presentation.ts'), { module: preferences, exports: preferences.exports, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) }, window, CustomEvent: class extends Event { constructor(type, opts) { super(type); this.detail = opts?.detail } }, require: () => ({}) })
  const classes = { isClassRemindEnabled: () => true, isClassSoonRemindEnabled: () => true, isClassStartRemindEnabled: () => true, isClassAlarmClockEnabled: () => storage.get('schedule.remind.alarmClock.enabled') !== '0', setClassAlarmClockEnabled: value => storage.set('schedule.remind.alarmClock.enabled', value ? '1' : '0'), getRemindMinutes: () => 15, rescheduleClassReminders: async () => { schedules++; return schedule() } }
  const keepAlive = { isAndroidNative: () => true, getReminderPermissionState: async channelId => { reads++; return read(channelId) }, openAutostartGuide: async () => null, openBatteryOptimization: async () => null, openChannelSettings: async () => null, openNotificationSettings: async () => null }
  const imports = { react: hooks, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }, '../lib/class-remind': classes, '../lib/qbank': { captureQbankSession: () => ({ ...session }), isQbankSessionCurrent: owner => owner.uid === session.uid && owner.revision === session.revision }, '../lib/useQbankRevision': { useQbankRevision: () => session.revision }, '../lib/platform': { IS_NATIVE: true }, '../lib/reminder-presentation': preferences.exports, '../lib/keep-alive': keepAlive, '../lib/alarm-notify': { requestExactAlarm: async () => true }, './CourseReminderSettings.module.css': new Proxy({}, { get: (_, key) => key }) }
  const module = { exports: {} }
  vm.runInNewContext(compile('src/components/CourseReminderSettings.tsx') + '\nexports.__Content = CourseReminderContent;', { module, exports: module.exports, window, require: name => { if (name in imports) return imports[name]; throw new Error(`Unexpected dependency ${name}`) } })
  let tree
  const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : []
  const texts = value => Array.isArray(value) ? value.map(texts).join(' ') : value && typeof value === 'object' ? texts(value.props?.children) : typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  const render = () => { cursor = 0; pendingEffects = []; tree = module.exports.__Content(); for (const { i, callback, deps } of pendingEffects) { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: callback() } } }
  return { render, prefs: preferences.exports, text: () => texts(tree), counts: () => ({ schedules, reads, writes: storage.size }), click: label => { const node = nodes(tree).find(value => value.props?.['aria-label'] === label); assert.ok(node); node.props.onClick() }, focus: () => window.dispatchEvent(new Event('focus')), setRead: operation => { read = operation }, setSchedule: operation => { schedule = operation }, switchAccount: () => { session = { uid: 'student-b', revision: session.revision + 1 } }, dispose: () => slots.forEach(slot => slot?.cleanup?.()) }
}

test('old APK rejects effect edits before writing preferences or cancelling the old course schedule', async () => {
  const f = fixture({ supported: false })
  try { f.render(); await flush(); f.click('课程铃声提醒'); await flush(); f.render(); assert.equal(f.counts().schedules, 0); assert.equal(f.counts().writes, 0); assert.equal(f.prefs.getClassReminderEffects().configured, false); assert.match(f.text(), /新版 APK/); assert.doesNotMatch(f.text(), /设置已保存/) } finally { f.dispose() }
})

test('pre-channel Android keeps existing preferences and plans even when the new native bridge is present', async () => {
  const f = fixture()
  try { f.setRead(async () => ({ supported: true, state: { courseChannelsSupported: false } })); f.render(); await flush(); f.click('课程震动提醒'); await flush(); f.render(); assert.equal(f.counts().writes, 0); assert.equal(f.counts().schedules, 0); assert.match(f.text(), /不支持独立课程通知渠道.*系统通知设置/) } finally { f.dispose() }
})

test('a successful effect edit saves one independent combination and reports confirmed scheduling', async () => {
  const f = fixture()
  try { f.render(); await flush(); f.click('课程铃声提醒'); await flush(); f.render(); assert.equal(f.prefs.getClassReminderEffects().sound, false); assert.equal(f.prefs.getClassReminderEffects().vibration, true); assert.equal(f.counts().schedules, 1); assert.match(f.text(), /设置已保存。已安排 2 条提醒/) } finally { f.dispose() }
})

test('bridge failure after saving is reported separately from successful preference persistence', async () => {
  const f = fixture()
  try { f.setSchedule(async () => { throw new Error('排程桥断开') }); f.render(); await flush(); f.click('课程震动提醒'); await flush(); f.render(); assert.equal(f.prefs.getClassReminderEffects().vibration, false); assert.match(f.text(), /设置已保存，但提醒未能更新：排程桥断开/) } finally { f.dispose() }
})

test('a slow old-channel permission read cannot replace a newer focus refresh', async () => {
  const f = fixture(), old = deferred()
  try { f.setRead(() => old.promise); f.render(); f.setRead(async () => ({ supported: true, state: { notificationsEnabled: false, ringerMode: 'silent', notificationVolume: 0, notificationMaxVolume: 7, interruptionFilter: 'none', channelExists: false } })); f.focus(); await flush(); f.render(); assert.match(f.text(), /静音模式/); old.resolve({ supported: true, state: { notificationsEnabled: true, ringerMode: 'normal', notificationVolume: 7, notificationMaxVolume: 7, interruptionFilter: 'all' } }); await flush(); f.render(); assert.match(f.text(), /静音模式/); assert.doesNotMatch(f.text(), /正常响铃/) } finally { f.dispose() }
})

test('low-importance channels report quiet delivery even when a ringtone URI is configured', async () => {
  const f = fixture()
  try { f.setRead(async () => ({ supported: true, state: { courseChannelsSupported: true, channelExists: true, channelImportance: 2, channelSoundEnabled: true, channelVibrationEnabled: false, ringerMode: 'normal', interruptionFilter: 'all' } })); f.render(); await flush(); f.render(); assert.match(f.text(), /声音已配置.*安静通知，不发声/); assert.doesNotMatch(f.text(), /铃声开/) } finally { f.dispose() }
})

test('an account change during capability checking cannot save the old action into the new account', async () => {
  const f = fixture(), wait = deferred()
  try { f.render(); await flush(); f.setRead(() => wait.promise); f.click('课程铃声提醒'); f.switchAccount(); wait.resolve({ supported: true, state: {} }); await flush(); f.render(); assert.equal(f.counts().writes, 0); assert.equal(f.counts().schedules, 0) } finally { f.dispose() }
})

test('system alarm-clock edits reject the 129 bridge before changing a preference or plan', async () => {
  const f = fixture()
  try {
    f.setRead(async () => ({ supported: true, state: { courseChannelsSupported: true, exactAlarmAllowed: true } }))
    f.render(); await flush(); f.render()
    assert.match(f.text(), /当前 APK 未提供新的准时排程能力/)
    f.click('系统闹钟准时提醒'); await flush(); f.render()
    assert.equal(f.counts().writes, 0); assert.equal(f.counts().schedules, 0)
    assert.match(f.text(), /1\.2\.130/)
  } finally { f.dispose() }
})

test('a new APK can turn alarm-clock mode off and on without changing sound or vibration preferences', async () => {
  const f = fixture()
  try {
    f.render(); await flush(); f.click('系统闹钟准时提醒'); await flush(); f.render()
    assert.equal(f.counts().schedules, 1); assert.equal(f.counts().writes, 1)
    assert.match(f.text(), /使用普通课程通知排程/)
    assert.equal(f.prefs.getClassReminderEffects().configured, false)
    f.click('系统闹钟准时提醒'); await flush(); f.render()
    assert.equal(f.counts().schedules, 2); assert.match(f.text(), /系统会显示下次闹钟图标/)
  } finally { f.dispose() }
})

test('denied exact permission never claims alarm-clock mode is active', async () => {
  const f = fixture()
  try {
    f.setRead(async () => ({ supported: true, state: { courseAlarmClockSupported: true, exactAlarmAllowed: false } }))
    f.render(); await flush(); f.render()
    assert.match(f.text(), /精确闹钟未允许，暂按普通通知安排，系统可能延后/)
    assert.doesNotMatch(f.text(), /当前 APK 未提供/)
  } finally { f.dispose() }
})

test('a temporary diagnostic failure is unknown, not evidence that the installed APK is old', async () => {
  const f = fixture()
  try {
    f.setRead(async () => ({ supported: false, state: null, error: '系统状态读取暂时失败' }))
    f.render(); await flush(); f.render()
    assert.match(f.text(), /尚未确认手机准时提醒能力/); assert.match(f.text(), /系统状态读取暂时失败/)
    assert.doesNotMatch(f.text(), /当前 APK 未提供|请先安装 1\.2\.130/)
    f.click('系统闹钟准时提醒'); await flush(); f.render()
    assert.equal(f.counts().writes, 0); assert.equal(f.counts().schedules, 0)
  } finally { f.dispose() }
})
