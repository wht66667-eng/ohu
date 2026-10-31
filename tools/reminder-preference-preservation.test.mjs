import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const sourceFiles = new Set(['course-reminder-expiry', 'class-remind', 'personal-reminders', 'notify-setup', 'auto-sync'])
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const settle = () => new Promise(setImmediate)

/** Real preference, permission, synchronization and cleanup code; all device/network boundaries are in memory. */
function fixture() {
  const storage = new Map(), pending = new Map(), delivered = new Map(), modules = new Map(), listeners = new Set()
  const calls = { schedules: 0, classPlanClears: 0, classOverlayClears: 0, exams: 0, certs: 0, todos: 0, keepAlive: 0, saves: 0 }
  let session = { uid: 'local:test-student', revision: 1 }, planCount = 0, overlayCount = 0, permission = 'granted', requestPermission = async () => permission
  const now = new Date(2030, 0, 2, 8).getTime()
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now])) } static now() { return now } }
  const schoolData = { rows: [{ week: 1, day: 3, sections: [3, 4], name: '合成课程' }], grades: [], exams: [] }
  const qbank = {
    captureQbankSession: () => ({ ...session }),
    isQbankSessionCurrent: captured => captured.uid === session.uid && captured.revision === session.revision,
    subscribeQbank: notify => { listeners.add(notify); return () => listeners.delete(notify) },
  }
  const plugin = {
    requestPermissions: async () => ({ display: await requestPermission() }),
    checkPermissions: async () => ({ display: permission }),
    getPending: async () => ({ notifications: [...pending.values()] }),
    getDeliveredNotifications: async () => ({ notifications: [...delivered.values()] }),
    cancel: async ({ notifications }) => notifications.forEach(({ id }) => pending.delete(id)),
    removeDeliveredNotifications: async ({ notifications }) => notifications.forEach(({ id }) => delivered.delete(id)),
    schedule: async ({ notifications }) => { calls.schedules++; notifications.forEach(notice => pending.set(notice.id, notice)) },
  }
  const refreshOther = name => async () => { calls[name]++; return { count: 0, message: '暂无待提醒项' } }
  const save = () => { calls.saves++; return true }
  const mocks = {
    './qbank': qbank,
    './platform': { IS_NATIVE: true, PLATFORM: { os: 'android' } },
    '@capacitor/local-notifications': { LocalNotifications: plugin },
    './alarm-notify': { exactAlarmGranted: async () => true, requestExactAlarm: async () => true },
    './keep-alive': { restoreKeepAliveIfWanted: async () => { calls.keepAlive++ } },
    './exam-utils': { rescheduleExamReminders: refreshOther('exams') },
    './cert-remind': { rescheduleCertReminders: refreshOther('certs') },
    './todo-remind': { rescheduleTodoReminders: refreshOther('todos') },
    './academic-cache': { saveGradesCache: save, saveExamsCache: save },
    './campus-account': { loadCampusAccount: () => ({ stuid: 'TEST-ONLY', jwPassword: 'synthetic-placeholder' }) },
    './timetable': { autoQueryAcademic: async () => schoolData, queryAcademic: async () => schoolData, fetchCaptcha: async () => { throw new Error('No external captcha calls in this fixture') } },
    './schedule-cache': {
      loadScheduleCache: () => ({ rows: schoolData.rows, meta: { stuid: 'TEST-ONLY', ownerUid: session.uid } }),
      saveScheduleCache: save,
      classesOnDate: () => [{ name: '合成课程', room: '样例教室', teacher: '', startMin: 600, endMin: 695, timeLabel: '10:00–11:35' }],
      getNextClass: () => ({ status: 'done' }),
    },
    './reminder-overlay': {
      clearReminderOverlays: async () => { calls.classOverlayClears++; overlayCount = 0; return { supported: true, enabled: false, lastError: null } },
      syncReminderOverlays: async () => ({ supported: true, enabled: false, scheduledCount: 0, lastError: null }),
    },
    './reminder-plan': {
      getCourseReminderPlanState: async () => ({ supported: true, atomicReplaceSupported: false }),
      clearCourseReminderPlan: async () => { calls.classPlanClears++; planCount = 0; return { supported: true, plannedCount: 0, lastError: null } },
      syncCourseReminderPlan: async ({ notifications }) => { planCount = notifications.length; return { supported: true, plannedCount: planCount, lastError: null } },
    },
    './reminder-presentation': {
      prepareReminderPresentation: async () => ({ kind: 'class-soon', extra: { type: 'class' }, channelState: { channel: { importance: 4 } } }),
      buildReminderNotification: (presentation, item) => ({ ...item, schedule: { at: item.at }, extra: { ...presentation.extra, ownerUid: item.ownerUid, route: '/schedule' } }),
    },
  }
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) }
  const window = new EventTarget()
  function load(name) {
    if (modules.has(name)) return modules.get(name)
    if (!sourceFiles.has(name)) throw new Error(`Unapproved real dependency: ${name}`)
    const module = { exports: {} }
    modules.set(name, module.exports)
    const code = ts.transpileModule(fs.readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    vm.runInNewContext(code, {
      module, exports: module.exports, Date: FixedDate, console, Event, window, localStorage,
      CustomEvent: class extends Event { constructor(type, options) { super(type); this.detail = options?.detail } },
      require: path => {
        if (Object.hasOwn(mocks, path)) return mocks[path]
        if (path.startsWith('./')) return load(path.slice(2))
        throw new Error(`Unexpected external dependency: ${path}`)
      },
    }, { filename: `${name}.ts` })
    return module.exports
  }
  const classApi = load('class-remind')
  function seedDisabledClass() {
    classApi.setClassRemindEnabled(false)
    pending.set(43000, { id: 43000, extra: { ownerUid: session.uid } })
    delivered.set(43001, { id: 43001, extra: { ownerUid: session.uid } })
    pending.set(51000, { id: 51000, extra: { ownerUid: session.uid } })
    planCount = 2; overlayCount = 2
  }
  function assertDisabledAndCleared() {
    assert.equal(classApi.isClassRemindEnabled(), false)
    assert.equal(storage.get('schedule.remind.enabled'), '0')
    assert.equal(pending.has(43000), false)
    assert.equal(delivered.has(43001), false)
    assert.equal(pending.has(51000), true, 'class cleanup must preserve exam notifications')
    assert.equal(calls.schedules, 0, 'disabled courses must not create a replacement notification')
    assert.equal(planCount, 0); assert.equal(overlayCount, 0)
    assert.ok(calls.classPlanClears > 0); assert.ok(calls.classOverlayClears > 0)
  }
  return {
    load, classApi, calls, storage, pending, seedDisabledClass, assertDisabledAndCleared,
    setPermission: next => { permission = next },
    setPermissionRequest: request => { requestPermission = request },
    switchAccount: () => { session = { uid: 'local:test-other', revision: session.revision + 1 }; listeners.forEach(notify => notify()) },
  }
}

test('granting notifications keeps explicitly disabled classes off and clears their old plans while refreshing other categories', async () => {
  const f = fixture(); f.seedDisabledClass()
  const api = f.load('notify-setup')
  assert.equal(await api.requestNotifyPermission(), true)
  f.assertDisabledAndCleared()
  assert.equal(f.calls.keepAlive, 1)
  assert.equal(f.calls.exams, 1); assert.equal(f.calls.certs, 1); assert.equal(f.calls.todos, 1)
  assert.equal(api.isNotifyConsentGranted(), true)
})

for (const mode of ['automatic', 'captcha']) {
  test(`${mode} academic synchronization saves synthetic data and refreshes without overriding disabled class reminders`, async () => {
    const f = fixture(); f.seedDisabledClass()
    f.storage.set('notify.consent.granted.v1', '1')
    const api = f.load('auto-sync')
    const options = { stuid: 'TEST-ONLY', password: 'synthetic-placeholder' }
    const result = mode === 'automatic'
      ? await api.runAutoSync(options)
      : await api.runCaptchaSync({ ...options, sid: 'test-only-session', captcha: '0000' })
    await settle()
    assert.equal(result.ok, true)
    assert.equal(f.calls.saves, 3)
    f.assertDisabledAndCleared()
    assert.equal(f.calls.exams, 1)
  })
}

test('untouched class preferences remain enabled by default when notifications are granted', async () => {
  const f = fixture(), api = f.load('notify-setup')
  assert.equal(f.storage.has('schedule.remind.enabled'), false)
  assert.equal(await api.requestNotifyPermission(), true)
  assert.equal(f.classApi.isClassRemindEnabled(), true)
  assert.equal(f.storage.has('schedule.remind.enabled'), false, 'authorization should not manufacture a user preference')
  assert.equal(f.calls.schedules, 1)
})

test('an account change while notification authorization is pending cannot refresh the new account from the old request', async () => {
  const f = fixture(); f.classApi.setClassRemindEnabled(false)
  const wait = deferred(); f.setPermissionRequest(() => wait.promise)
  const api = f.load('notify-setup'), request = api.requestNotifyPermission()
  f.switchAccount(); wait.resolve('granted')
  assert.equal(await request, true)
  assert.equal(f.classApi.isClassRemindEnabled(), false)
  assert.equal(f.calls.keepAlive, 0); assert.equal(f.calls.exams, 0); assert.equal(f.calls.schedules, 0)
})

test('denied notification authorization preserves disabled preferences without starting services or refreshes', async () => {
  const f = fixture(); f.classApi.setClassRemindEnabled(false); f.setPermission('denied')
  const api = f.load('notify-setup')
  assert.equal(await api.requestNotifyPermission(), false)
  assert.equal(f.classApi.isClassRemindEnabled(), false)
  assert.equal(api.isNotifyConsentGranted(), false)
  assert.equal(f.calls.keepAlive, 0); assert.equal(f.calls.exams, 0); assert.equal(f.calls.schedules, 0)
})
