import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const compile = path => ts.transpileModule(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const expiryModule = { exports: {} }
vm.runInNewContext(compile('src/lib/course-reminder-expiry.ts'), { module: expiryModule, exports: expiryModule.exports })
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
const action = ownerUid => ({ actionId: 'tap', notification: { id: 43000, extra: { type: 'class', ownerUid } } })

/** Execute the actual host with isolated hooks and fake native bridges; never post a notification. */
function fixture({ system = null, overlay = null, nextClass = null, otherReminders = false, exams = null, native = true, courseEffects = { sound: true, vibration: true, configured: false } } = {}) {
  let auth = { phase: 'booting', isSigned: false, user: null }
  const session = { uid: 'fixture-a', revision: 1 }, slots = []
  let cursor = 0, pendingEffects = [], pendingOverlay = overlay
  const navs = [], localCallbacks = [], calls = { refresh: 0, overlayAdds: 0, classRefresh: 0, examRefresh: 0, immediateClass: 0, alerts: 0, alertOptions: [] }
  const storage = new Map()
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) }
  let currentClass = nextClass ?? { status: 'done', name: '', timeLabel: '', hint: '', room: '' }
  let currentExams = exams ?? (otherReminders ? [{ name: '合成考试', datetime: '2030-01-02T09:00', room: '样例教室' }] : [])
  let now = new Date(2030, 0, 2, 8).getTime()
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now])) } static now() { return now } }
  const window = new EventTarget(), document = new EventTarget()
  Object.assign(window, { setTimeout: () => 1, setInterval: () => 1 })
  document.visibilityState = 'visible'
  const navigate = route => navs.push(route)
  const qbank = {
    captureQbankSession: () => ({ ...session }),
    isQbankSessionCurrent: captured => captured.uid === session.uid && captured.revision === session.revision,
    subscribeQbank: () => () => {},
  }
  const hooks = {
    useState: initial => {
      const index = cursor++
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next }]
    },
    useRef: initial => { const index = cursor++; return slots[index] ??= { current: initial } },
    useSyncExternalStore: (_, get) => { cursor++; return get() },
    useEffect: (callback, deps) => {
      const index = cursor++, old = slots[index]
      if (!old || !deps || !old.deps || deps.length !== old.deps.length || deps.some((dep, i) => !Object.is(dep, old.deps[i]))) {
        pendingEffects.push({ index, callback, deps })
      }
    },
  }
  const popup = { exports: {} }
  vm.runInNewContext(compile('src/lib/reminder-popup.ts'), { module: popup, exports: popup.exports, localStorage: { getItem: () => null }, window, Event })
  const schedule = {
    getNextClass: () => currentClass,
    classesOnDate: () => {
      const clocks = currentClass.timeLabel?.match(/\d{2}:\d{2}/g) || []
      if (clocks.length !== 2) return []
      const minutes = clock => { const [h, m] = clock.split(':').map(Number); return h * 60 + m }
      return [{ name: currentClass.name, timeLabel: currentClass.timeLabel, startMin: minutes(clocks[0]), endMin: minutes(clocks[1]) }]
    },
    SCHEDULE_CACHE_EVENT: 'schedule-event',
  }
  const classModule = { exports: {} }
  vm.runInNewContext(compile('src/lib/class-remind.ts'), {
    module: classModule, exports: classModule.exports, Date: FixedDate, window, localStorage, Event,
    require: name => {
      if (name === './course-reminder-expiry') return expiryModule.exports
      if (name === './qbank') return qbank
      if (name === './schedule-cache') return schedule
      if (['./reminder-presentation', './personal-reminders', './reminder-overlay', './reminder-plan', './alarm-notify'].includes(name)) return {}
      throw new Error(`Unexpected class dependency: ${name}`)
    },
  })
  const classPrefs = classModule.exports
  classPrefs.rescheduleClassReminders = async () => { calls.classRefresh++; return { count: 0, message: '' } }
  classPrefs.notifyClassNow = async () => { calls.immediateClass++; return { count: 0, message: '' } }
  const examPrefsModule = { exports: {} }
  vm.runInNewContext(compile('src/lib/exam-reminder-prefs.ts'), { module: examPrefsModule, exports: examPrefsModule.exports, localStorage, window, Event })
  const examPrefs = examPrefsModule.exports
  const examModule = { exports: {} }
  vm.runInNewContext(compile('src/lib/exam-utils.ts'), {
    module: examModule, exports: examModule.exports, Date: FixedDate,
    require: name => {
      if (name === './academic-cache') return { loadExamsCache: () => currentExams }
      if (name === './exam-reminder-prefs') return examPrefs
      if (['./reminder-presentation', './personal-reminders'].includes(name)) return {}
      throw new Error(`Unexpected exam dependency: ${name}`)
    },
  })
  examModule.exports.rescheduleExamReminders = async () => { calls.examRefresh++; return { count: 0, message: '' } }
  const blank = { classCount: 0, examCount: 0, certCount: 0, todoCount: 0, errors: [], notices: [], health: { display: 'granted' } }
  const removeHandle = () => ({ remove: async () => {} })
  const overrides = {
    react: hooks,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'react-router-dom': { Link: () => null, useNavigate: () => navigate },
    '../lib/notify-setup': { checkReminderHealth: async () => blank.health, wasNotifyConsentAsked: () => true, refreshAllReminders: async () => { calls.refresh++; return blank } },
    '../lib/class-remind': classPrefs,
    '../lib/schedule-cache': schedule,
    '../lib/keep-alive': { restoreKeepAliveIfWanted: async () => {}, updateKeepAliveText: async () => {}, DEFAULT_KEEP_ALIVE_TEXT: '' },
    '../lib/reminder-self-test': {},
    '../lib/exam-utils': examModule.exports,
    '../lib/exam-reminder-prefs': examPrefs,
    '../lib/cert-remind': { getDueCertReminders: () => otherReminders ? [{ certId: 'test-cert', date: '2030-01-02', name: '合成考证', note: '' }] : [] },
    '../lib/todo-remind': { checkInAppTodoPopup: () => otherReminders ? { id: 7, status: 'due', title: '合成待办', hint: '今天到期' } : null },
    '../lib/alert-effects': { fireAlertBurst: async options => { calls.alerts++; calls.alertOptions.push(options) } },
    '../lib/reminder-presentation': { getReminderStyle: () => 'normal', getClassReminderEffects: () => courseEffects },
    '../lib/reminder-popup': popup.exports,
    './ReminderPopup': {}, './ui/DialogLayer': {}, './RemindHost.module.css': {},
    '../lib/platform': { IS_NATIVE: native }, '../lib/auth': { useAuth: () => auth }, '../lib/qbank': qbank,
    '../lib/personal-reminders': { getPersonalReminderScope: () => `${session.revision}:${session.uid}`, PERSONAL_REMINDER_ERROR_EVENT: 'personal-error' },
    '../lib/academic-cache': { ACADEMIC_CACHE_EVENT: 'academic-event' },
    '../lib/reminder-overlay': {
      onReminderOverlayOpened: async callback => {
        calls.overlayAdds++
        if (pendingOverlay) { const event = pendingOverlay; pendingOverlay = null; callback(event) }
        return removeHandle()
      },
    },
    '@capacitor/app': { App: { addListener: async () => removeHandle() } },
    '@capacitor/local-notifications': {
      LocalNotifications: { addListener: async (_, callback) => {
        localCallbacks.push(callback)
        if (system) { const event = system; system = null; callback(event) }
        return removeHandle()
      } },
    },
  }
  const module = { exports: {} }
  vm.runInNewContext(compile('src/components/RemindHost.tsx') + '\nexports.__AccountHost = RemindAccountHost;', {
    module, exports: module.exports,
    require: name => { if (Object.hasOwn(overrides, name)) return overrides[name]; throw new Error(`Unexpected import: ${name}`) },
    window, document, console, Date: FixedDate, Event,
    CustomEvent: class extends Event { constructor(type, options) { super(type); this.detail = options?.detail } },
    sessionStorage: localStorage, clearTimeout: () => {}, clearInterval: () => {},
  })
  return {
    navs, calls, localCallbacks, classPrefs, examPrefs,
    cards: () => [...(slots.find(slot => Array.isArray(slot?.value))?.value ?? [])],
    setNextClass: value => { currentClass = value },
    notifyScheduleChanged: () => window.dispatchEvent(new Event(schedule.SCHEDULE_CACHE_EVENT)),
    setExams: value => { currentExams = value },
    setTime: (hour, minute = 0) => { now = new Date(2030, 0, 2, hour, minute).getTime() },
    focus: () => window.dispatchEvent(new Event('focus')),
    notifyAcademicChanged: () => window.dispatchEvent(new Event('academic-event')),
    invalidateSession: () => { session.revision++ },
    pendingOverlay: () => !!pendingOverlay,
    sign: () => { auth = { phase: 'signed', isSigned: true, user: { uid: session.uid } } },
    render: async () => {
      cursor = 0; pendingEffects = []
      module.exports.__AccountHost()
      for (const { index, callback, deps } of pendingEffects) {
        slots[index]?.cleanup?.()
        slots[index] = { deps, cleanup: callback() }
      }
      await flush()
    },
    dispose: () => { for (const slot of slots) slot?.cleanup?.() },
  }
}

test('retained system click waits for authentication and business refresh resumes on the same UID', async () => {
  const f = fixture({ system: action('fixture-a') })
  try {
    await f.render()
    assert.deepEqual(f.navs, [])
    assert.equal(f.calls.refresh, 0, 'an unresolved account must not refresh or clear native plans')
    f.sign(); await f.render()
    assert.deepEqual(f.navs, ['/schedule'])
    assert.ok(f.calls.refresh > 0, 'signed changes must rerun effects even when qbank UID is unchanged')
  } finally { f.dispose() }
})

test('qbank UID before authentication does not consume a retained overlay click', async () => {
  const f = fixture({ overlay: { route: '/schedule', ownerUid: 'fixture-a', preview: false } })
  try {
    await f.render()
    assert.equal(f.calls.overlayAdds, 0); assert.equal(f.pendingOverlay(), true); assert.deepEqual(f.navs, [])
    f.sign(); await f.render()
    assert.equal(f.calls.overlayAdds, 1); assert.equal(f.pendingOverlay(), false); assert.deepEqual(f.navs, ['/schedule'])
  } finally { f.dispose() }
})

test('a late callback from the unsigned listener forwards to the authenticated host', async () => {
  const f = fixture()
  try {
    await f.render(); const late = f.localCallbacks[0]
    f.sign(); await f.render()
    late(action('fixture-a'))
    assert.deepEqual(f.navs, ['/schedule'])
  } finally { f.dispose() }
})

test('a retained notification belonging to another account does not navigate', async () => {
  const f = fixture({ system: action('fixture-b') })
  try {
    await f.render(); f.sign(); await f.render()
    assert.deepEqual(f.navs, [])
  } finally { f.dispose() }
})

test('the isolated self-test click remains available before authentication', async () => {
  const f = fixture({ system: { actionId: 'tap', notification: { id: 70011, extra: { type: 'self-test' } } } })
  try {
    await f.render()
    assert.deepEqual(f.navs, ['/settings?section=reminders'])
    assert.equal(f.calls.refresh, 0)
  } finally { f.dispose() }
})

const upcomingClass = (minutes = 15, name = '合成课程') => ({ status: 'soon', name, room: '样例教室', timeLabel: `${String(8 + Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}–10:40`, hint: minutes >= 60 ? `${Math.floor(minutes / 60)} 小时后开始` : `${minutes} 分钟后开始` })
const currentClass = () => ({ status: 'now', name: '合成课程', room: '样例教室', timeLabel: '08:00–09:40', hint: '正在上课' })

test('a still-running class reopened after thirty minutes neither queues nor rings while other cards remain', async () => {
  const f = fixture({ nextClass: currentClass(), native: false, otherReminders: true })
  try {
    f.setTime(8, 31); f.sign(); await f.render(); await f.render()
    assert.equal(f.cards().some(card => card.kind.startsWith('class')), false)
    assert.equal(f.calls.immediateClass, 0)
    assert.ok(f.cards().some(card => card.kind === 'todo'))
  } finally { f.dispose() }
})

test('resuming at the one-minute boundary removes an already queued class without another course sound', async () => {
  const f = fixture({ nextClass: currentClass(), native: false })
  try {
    f.setTime(8, 0); f.sign(); await f.render(); await f.render()
    assert.equal(f.cards().filter(card => card.kind.startsWith('class')).length, 1)
    const effects = f.calls.alerts
    f.setTime(8, 1); f.focus(); await f.render()
    assert.equal(f.cards().some(card => card.kind.startsWith('class')), false)
    assert.equal(f.calls.alerts, effects)
    f.notifyScheduleChanged(); await f.render()
    assert.equal(f.cards().some(card => card.kind.startsWith('class')), false)
  } finally { f.dispose() }
})

test('turning the start phase off removes its queued card immediately and preserves exams, todos and certifications', async () => {
  const f = fixture({ nextClass: currentClass(), otherReminders: true })
  try {
    f.sign(); await f.render()
    assert.deepEqual(f.cards().map(item => item.kind), ['class-start', 'exam', 'todo', 'cert'])
    f.classPrefs.setClassStartRemindEnabled(false)
    assert.deepEqual(f.cards().map(item => item.kind), ['exam', 'todo', 'cert'])
    assert.equal(f.calls.immediateClass, 0, 'native preferences must never produce a second immediate notification')
  } finally { f.dispose() }
})

test('shortening a lead window removes an early queued course without removing unrelated cards', async () => {
  const f = fixture({ nextClass: upcomingClass(), otherReminders: true })
  try {
    f.sign(); await f.render()
    assert.equal(f.cards()[0].kind, 'class-soon')
    f.classPrefs.setRemindMinutes(5)
    assert.deepEqual(f.cards().map(item => item.kind), ['exam', 'todo', 'cert'])
    assert.equal(f.calls.immediateClass, 0)
  } finally { f.dispose() }
})

test('turning the soon phase off removes its queued card while leaving the start phase and unrelated cards enabled', async () => {
  const f = fixture({ nextClass: upcomingClass(), otherReminders: true })
  try {
    f.sign(); await f.render()
    f.classPrefs.setClassSoonRemindEnabled(false)
    assert.deepEqual(f.cards().map(item => item.kind), ['exam', 'todo', 'cert'])
    assert.equal(f.classPrefs.isClassStartRemindEnabled(), true)
    assert.equal(f.calls.immediateClass, 0)
  } finally { f.dispose() }
})

test('a valid sixty-minute course stays queued after another phase changes despite an hour-rounded display hint', async () => {
  const f = fixture({ nextClass: upcomingClass(60) })
  try {
    f.classPrefs.setRemindMinutes(60)
    f.sign(); await f.render()
    assert.equal(f.cards()[0].kind, 'class-soon')
    f.classPrefs.setClassStartRemindEnabled(false)
    assert.equal(f.cards()[0].kind, 'class-soon')
    f.classPrefs.setRemindMinutes(59)
    assert.equal(f.cards().length, 0)
    assert.equal(f.calls.immediateClass, 0)
  } finally { f.dispose() }
})

test('expanding the window or enabling a previously disabled phase checks the current course without waiting for a poll', async () => {
  const f = fixture({ nextClass: upcomingClass() })
  try {
    f.classPrefs.setRemindMinutes(5)
    f.classPrefs.setClassSoonRemindEnabled(false)
    f.sign(); await f.render()
    assert.equal(f.cards().length, 0)
    f.classPrefs.setRemindMinutes(15)
    assert.equal(f.cards().length, 0)
    f.classPrefs.setClassSoonRemindEnabled(true)
    assert.equal(f.cards()[0].kind, 'class-soon')
    assert.equal(f.calls.immediateClass, 0)
  } finally { f.dispose() }
})

test('disabling the course master switch removes only course cards, and re-enabling does not replay a seen event', async () => {
  const f = fixture({ nextClass: upcomingClass(), otherReminders: true })
  try {
    f.sign(); await f.render()
    f.classPrefs.setClassRemindEnabled(false)
    assert.deepEqual(f.cards().map(item => item.kind), ['exam', 'todo', 'cert'])
    f.classPrefs.setClassRemindEnabled(true)
    assert.deepEqual(f.cards().map(item => item.kind), ['exam', 'todo', 'cert'])
    assert.equal(f.calls.immediateClass, 0)
  } finally { f.dispose() }
})

test('a course-cache change replaces the stale queued class and adds no extra scheduling source', async () => {
  const f = fixture({ nextClass: upcomingClass() })
  try {
    f.sign(); await f.render()
    assert.equal(f.cards()[0].name, '合成课程')
    f.setNextClass(upcomingClass(15, '更新后的合成课程'))
    f.notifyScheduleChanged()
    assert.deepEqual(f.cards().map(item => item.name), ['更新后的合成课程'])
    assert.equal(f.calls.classRefresh, 1, 'only the existing cache listener should schedule a system plan')
    assert.equal(f.calls.immediateClass, 0)
  } finally { f.dispose() }
})

test('a same-ID course keeps its current room and hint after cache refresh without replaying its web alert', async () => {
  const f = fixture({ nextClass: upcomingClass(), native: false })
  try {
    f.sign(); await f.render(); await f.render()
    const before = f.cards()[0]
    assert.match(before.detail, /样例教室/)
    assert.equal(f.calls.alerts, 1); assert.equal(f.calls.immediateClass, 1)
    f.setNextClass({ ...upcomingClass(), room: '更新后的教室', hint: '15 分钟后开始（教室已调整）' })
    f.notifyScheduleChanged(); await f.render()
    const after = f.cards()[0]
    assert.equal(after.id, before.id); assert.equal(after.name, '合成课程')
    assert.equal(after.detail, '08:15–10:40 · 更新后的教室')
    assert.equal(after.hint, '15 分钟后开始（教室已调整）')
    assert.equal(f.calls.alerts, 1); assert.equal(f.calls.immediateClass, 1)
    assert.equal(f.calls.classRefresh, 1)
  } finally { f.dispose() }
})

for (const sound of [false, true]) for (const vibration of [false, true]) test(`web courses honor independent sound=${sound} vibration=${vibration} without speech or an extra system alert`, async () => {
  const f = fixture({ nextClass: upcomingClass(), native: false, courseEffects: { sound, vibration, configured: true } })
  try {
    f.sign(); await f.render(); await f.render()
    assert.equal(f.calls.alerts, 1)
    assert.equal(f.calls.alertOptions[0].ring, sound)
    assert.equal(f.calls.alertOptions[0].vibrate, vibration)
    assert.equal(f.calls.alertOptions[0].speak, false)
    assert.equal(f.calls.alertOptions[0].notify, false)
  } finally { f.dispose() }
})

test('a preference event captured by an obsolete account revision cannot alter its queue', async () => {
  const f = fixture({ nextClass: currentClass() })
  try {
    f.sign(); await f.render()
    const before = f.cards().map(item => item.id)
    f.invalidateSession()
    f.classPrefs.setClassStartRemindEnabled(false)
    assert.deepEqual(f.cards().map(item => item.id), before)
    assert.equal(f.calls.immediateClass, 0)
  } finally { f.dispose() }
})

test('closing exam reminders clears only exam cards immediately while retaining classes, todos and certifications', async () => {
  const f = fixture({ nextClass: currentClass(), otherReminders: true })
  try {
    f.sign(); await f.render()
    assert.deepEqual(f.cards().map(item => item.kind), ['class-start', 'exam', 'todo', 'cert'])
    f.examPrefs.saveExamReminderPreferences({ ...f.examPrefs.getExamReminderPreferences(), enabled: false })
    assert.deepEqual(f.cards().map(item => item.kind), ['class-start', 'todo', 'cert'])
    assert.equal(f.calls.immediateClass, 0)
  } finally { f.dispose() }
})

test('closing a due exam phase removes its old card, and increasing the lead window evaluates another exam immediately', async () => {
  const f = fixture({ otherReminders: true })
  try {
    f.sign(); await f.render()
    f.examPrefs.saveExamReminderPreferences({ ...f.examPrefs.getExamReminderPreferences(), leadEnabled: false })
    assert.deepEqual(f.cards().map(item => item.kind), ['todo', 'cert'])
    f.setExams([{ code: 'B', name: '下午合成考试', datetime: '2030-01-02T13:00' }])
    f.examPrefs.saveExamReminderPreferences({ ...f.examPrefs.getExamReminderPreferences(), leadEnabled: true, leadHours: 6 })
    assert.equal(f.cards().filter(item => item.kind === 'exam')[0].name, '下午合成考试')
    assert.equal(f.calls.examRefresh, 0, 'queue preference handling must not add a second system scheduling source')
  } finally { f.dispose() }
})

test('all currently due exams enter the queue with owner-prefixed stable stage keys and survive unrelated setting changes', async () => {
  const f = fixture({ exams: [{ code: 'A', name: '合成考试甲', datetime: '2030-01-02T09:00' }, { code: 'B', name: '合成考试乙', datetime: '2030-01-02T10:00' }] })
  try {
    f.sign(); await f.render()
    const before = f.cards().map(item => item.id)
    assert.equal(before.length, 2)
    assert.equal(before.every(id => id.startsWith('exam-pop:fixture-a:exam:')), true)
    f.classPrefs.setClassStartRemindEnabled(false)
    assert.deepEqual(f.cards().map(item => item.id), before)
    f.examPrefs.saveExamReminderPreferences({ ...f.examPrefs.getExamReminderPreferences(), eveningEnabled: false })
    assert.deepEqual(f.cards().map(item => item.id), before)
  } finally { f.dispose() }
})

test('an exam-cache change removes a cancelled exam and adds its replacement without another scheduling source', async () => {
  const f = fixture({ otherReminders: true })
  try {
    f.sign(); await f.render()
    f.setExams([{ code: 'REPLACED', name: '更新后的合成考试', datetime: '2030-01-02T09:30' }])
    f.notifyAcademicChanged()
    assert.deepEqual(f.cards().filter(item => item.kind === 'exam').map(item => item.name), ['更新后的合成考试'])
    assert.equal(f.calls.examRefresh, 1)
    assert.equal(f.cards().some(item => item.kind === 'todo'), true)
    assert.equal(f.cards().some(item => item.kind === 'cert'), true)
  } finally { f.dispose() }
})

test('a same-ID exam refreshes its room, seat and countdown without replaying its web alert', async () => {
  const row = { code: 'UNCHANGED', name: '合成考试', datetime: '2030-01-02T13:00', room: '旧考场', seat: '1' }
  const f = fixture({ exams: [row], native: false })
  try {
    f.examPrefs.saveExamReminderPreferences({ ...f.examPrefs.getExamReminderPreferences(), leadHours: 6 })
    f.sign(); await f.render(); await f.render()
    const before = f.cards()[0]
    assert.match(before.detail, /旧考场 · 座位 1/)
    assert.equal(before.hint, '5 小时后')
    assert.equal(f.calls.alerts, 1)
    f.setTime(9); f.setExams([{ ...row, room: '更新后的考场', seat: '18' }])
    f.notifyAcademicChanged(); await f.render()
    const after = f.cards()[0]
    assert.equal(after.id, before.id); assert.equal(after.name, '合成考试')
    assert.equal(after.detail, '2030-01-02T13:00 · 更新后的考场 · 座位 18')
    assert.equal(after.hint, '4 小时后')
    assert.equal(f.calls.alerts, 1); assert.equal(f.calls.immediateClass, 0)
    assert.equal(f.calls.examRefresh, 1)
  } finally { f.dispose() }
})

test('obsolete account revisions cannot consume exam-preference events or alter a queued exam', async () => {
  const f = fixture({ otherReminders: true })
  try {
    f.sign(); await f.render()
    const before = f.cards().map(item => item.id)
    f.invalidateSession()
    f.examPrefs.saveExamReminderPreferences({ ...f.examPrefs.getExamReminderPreferences(), enabled: false })
    assert.deepEqual(f.cards().map(item => item.id), before)
  } finally { f.dispose() }
})
