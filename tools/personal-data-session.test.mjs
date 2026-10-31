import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function fixture({ uid = 'student-a' } = {}) {
  let session = { uid, revision: 1 }, writeFailure = false
  const storage = new Map(), listeners = new Set(), events = [], pending = new Map(), delivered = new Map()
  const qbank = { captureQbankSession: () => session, isQbankSessionCurrent: (captured) => captured.uid === session.uid && captured.revision === session.revision, subscribeQbank: (cb) => { listeners.add(cb); return () => listeners.delete(cb) } }
  const plugin = {
    getPending: async () => ({ notifications: [...pending.values()] }), cancel: async ({ notifications }) => { notifications.forEach(({ id }) => pending.delete(id)) },
    getDeliveredNotifications: async () => ({ notifications: [...delivered.values()] }), removeDeliveredNotifications: async ({ notifications }) => { notifications.forEach(({ id }) => delivered.delete(id)) },
    schedule: async ({ notifications }) => { notifications.forEach((notice) => pending.set(notice.id, notice)) },
    checkPermissions: async () => ({ display: 'granted' }), requestPermissions: async () => ({ display: 'granted' }),
  }
  const load = (path, overrides = {}) => {
    const compiled = ts.transpileModule(fs.readFileSync(join(root, path), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const module = { exports: {} }
    vm.runInNewContext(compiled, {
      module, exports: module.exports, Date, console,
      Event: class { constructor(type) { this.type = type } }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail } },
      localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { if (writeFailure) throw new Error('quota'); storage.set(key, value) } },
      sessionStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
      window: { dispatchEvent: (event) => events.push(event) },
      require: (name) => {
        if (Object.hasOwn(overrides, name)) return overrides[name]
        if (name === './qbank') return qbank
        if (name === './platform') return { IS_NATIVE: true, PLATFORM: { os: 'android' } }
        if (name === '@capacitor/local-notifications') return { LocalNotifications: plugin }
        throw new Error(`Unexpected module: ${name}`)
      },
    })
    return module.exports
  }
  return { load, storage, events, pending, delivered, plugin, session: () => session, blockStorage: () => { writeFailure = true }, switchUid: (uid) => { session = { uid, revision: session.revision + 1 }; listeners.forEach((cb) => cb()) } }
}
const personalIds = [40999, 41000, 49999, 51000, 51999, 52000, 52999, 60000, 60079]
function seedReminders(f) { [...personalIds, 30001, 60080, 70000].forEach((id) => { f.pending.set(id, { id }); f.delivered.set(id, { id }) }) }

test('switching identity cancels pending and delivered personal notices without touching business/focus IDs', async () => {
  const f = fixture(), api = f.load('src/lib/personal-reminders.ts')
  seedReminders(f); f.switchUid('student-b'); await api.clearPersonalReminders()
  assert.deepEqual([...f.pending.keys()], [30001, 60080, 70000])
  assert.deepEqual([...f.delivered.keys()], [30001, 60080, 70000])
})

test('a cold-start guest leaves native plans alone; restoring A keeps its owned plans, clears foreign/unknown owners, and true logout clears personal plans', async () => {
  const f = fixture({ uid: '' }), api = f.load('src/lib/personal-reminders.ts')
  for (const id of personalIds) {
    f.pending.set(id, { id, extra: { ownerUid: 'student-a' } })
    f.delivered.set(id, { id, extra: { ownerUid: 'student-a' } })
  }
  for (const notice of [{ id: 41001, extra: { ownerUid: 'student-b' } }, { id: 51001 }, { id: 30001, extra: { ownerUid: 'student-b' } }]) {
    f.pending.set(notice.id, notice); f.delivered.set(notice.id, notice)
  }
  let reads = 0, callbacks = 0
  const getPending = f.plugin.getPending
  f.plugin.getPending = async () => { reads++; return getPending() }
  const guest = await api.runPersonalReminder('exam', async () => { callbacks++; return { count: 1, message: 'should not run' } })
  assert.equal(guest.count, 0); assert.match(guest.message, /等待登录/)
  assert.equal(reads, 0); assert.equal(callbacks, 0)
  assert.equal(f.pending.size, personalIds.length + 3); assert.equal(f.delivered.size, personalIds.length + 3)
  f.switchUid('student-a'); await new Promise(setImmediate)
  assert.deepEqual([...f.pending.keys()], [...personalIds, 30001])
  assert.deepEqual([...f.delivered.keys()], [...personalIds, 30001])
  f.switchUid(''); await new Promise(setImmediate)
  assert.deepEqual([...f.pending.keys()], [30001])
  assert.deepEqual([...f.delivered.keys()], [30001])
})

test('an empty or disabled category removes its previously pending and delivered reminders', async () => {
  const f = fixture(), api = f.load('src/lib/personal-reminders.ts'); seedReminders(f)
  const result = await api.runPersonalReminder('exam', async () => ({ count: 0, message: '暂无考试' }))
  assert.equal(result.count, 0)
  assert.equal(f.pending.has(51000), false); assert.equal(f.delivered.has(51999), false)
  assert.equal(f.pending.has(41000), true)
})

test('a late schedule result from an old account is removed before the new account replacement runs', async () => {
  const f = fixture(), api = f.load('src/lib/personal-reminders.ts'), wait = deferred()
  const original = f.plugin.schedule
  f.plugin.schedule = async (options) => { await wait.promise; await original(options) }
  const old = api.runPersonalReminder('todo', async ({ schedule, session }) => {
    const applied = await schedule({ notifications: [{ id: 60000, extra: { ownerUid: session.uid } }] })
    return { count: applied ? 1 : 0, message: applied ? 'done' : 'cancelled' }
  })
  await flush(); f.switchUid('student-b')
  f.plugin.schedule = original
  const next = api.runPersonalReminder('todo', async ({ schedule, session }) => {
    const applied = await schedule({ notifications: [{ id: 60000, extra: { ownerUid: session.uid } }] })
    return { count: applied ? 1 : 0, message: 'done' }
  })
  wait.resolve(); assert.equal((await old).count, 0); assert.equal((await next).count, 1)
  assert.equal(f.pending.get(60000).extra.ownerUid, 'student-b')
})

test('A -> B -> A invalidates a queued reminder request even though the UID again matches', async () => {
  const f = fixture(), api = f.load('src/lib/personal-reminders.ts'); let calls = 0
  const old = api.runPersonalReminder('exam', async () => { calls++; return { count: 1, message: 'done' } })
  f.switchUid('student-b'); f.switchUid('student-a')
  assert.equal((await old).count, 0); await api.clearPersonalReminders(); assert.equal(calls, 0)
})

test('a cancellation failure blocks replacement rather than adding more schedules over uncleared alarms', async () => {
  const f = fixture(), api = f.load('src/lib/personal-reminders.ts'); let schedules = 0
  f.pending.set(51000, { id: 51000 }); f.plugin.cancel = async () => { throw new Error('bridge unavailable') }
  await assert.rejects(api.runPersonalReminder('exam', async () => { schedules++; return { count: 1, message: 'done' } }), /bridge unavailable/)
  assert.equal(schedules, 0)
})

test('a bridge that accepts only part of a requested schedule is cleared and reported as a failure', async () => {
  const f = fixture(), api = f.load('src/lib/personal-reminders.ts')
  f.plugin.schedule = async ({ notifications }) => { f.pending.set(notifications[0].id, notifications[0]) }
  await assert.rejects(api.runPersonalReminder('exam', async ({ schedule }) => {
    await schedule({ notifications: [{ id: 51000 }, { id: 51001 }] })
    return { count: 2, message: 'done' }
  }), /部分提醒未能安排/)
  assert.equal(f.pending.has(51000), false)
})

test('immediate alarms already delivered by the bridge still count as confirmed schedules', async () => {
  const f = fixture(), api = f.load('src/lib/personal-reminders.ts')
  f.plugin.schedule = async ({ notifications }) => { notifications.forEach((notice) => f.delivered.set(notice.id, notice)) }
  const result = await api.runPersonalReminder('class-now', async ({ schedule }) => ({ count: await schedule({ notifications: [{ id: 40999 }] }) ? 1 : 0, message: 'done' }))
  assert.equal(result.count, 1)
})

function notifyFixture({ uid = 'student-a' } = {}) {
  const f = fixture({ uid }), personal = f.load('src/lib/personal-reminders.ts')
  let exactAlarm = true
  const overlayClears = [], planClears = []
  let overlayClearError = null
  let planClearError = null
  let scheduleCalls = 0, result = { count: 0, message: '暂无提醒' }
  const run = async () => { scheduleCalls++; return result }
  const api = f.load('src/lib/notify-setup.ts', {
    './personal-reminders': personal, './alarm-notify': { exactAlarmGranted: async () => exactAlarm, requestExactAlarm: async () => {} },
    './class-remind': { setClassRemindEnabled: () => {}, rescheduleClassReminders: run }, './exam-utils': { rescheduleExamReminders: run },
    './cert-remind': { rescheduleCertReminders: run }, './todo-remind': { rescheduleTodoReminders: run },
    './keep-alive': { restoreKeepAliveIfWanted: async () => {} },
    './reminder-overlay': { clearReminderOverlays: async (ownerUid, options) => { overlayClears.push({ ownerUid, options }); if (overlayClearError) throw overlayClearError; return { lastError: null } } },
    './reminder-plan': { clearCourseReminderPlan: async (ownerUid) => { planClears.push(ownerUid); if (planClearError) throw planClearError; return { supported: true, ownerUid: null, plannedCount: 0, lastError: null } } },
  })
  return { ...f, api, overlayClears, planClears, setOverlayClearError: (value) => { overlayClearError = value }, setPlanClearError: (value) => { planClearError = value }, calls: () => scheduleCalls, setResult: (value) => { result = value }, setExactAlarm: (value) => { exactAlarm = value } }
}

test('guest reconciliation cannot treat an unresolved cold-start identity as permission-revoked logout', async () => {
  const f = notifyFixture({ uid: '' }); seedReminders(f)
  f.plugin.checkPermissions = async () => ({ display: 'denied' })
  const result = await f.api.refreshAllReminders()
  assert.equal(result.status, 'unavailable'); assert.equal(f.calls(), 0)
  assert.match(result.notices[0], /等待登录/)
  assert.equal(f.overlayClears.length, 0)
  assert.equal(f.planClears.length, 0)
  assert.equal(f.pending.size, personalIds.length + 3); assert.equal(f.delivered.size, personalIds.length + 3)
})

test('revoked OS notification permission clears old alarms and returns a permission failure', async () => {
  const f = notifyFixture(); seedReminders(f)
  f.plugin.checkPermissions = async () => ({ display: 'denied' })
  const result = await f.api.refreshAllReminders()
  assert.equal(result.status, 'permissionDenied'); assert.equal(f.calls(), 0)
  assert.equal(f.pending.has(41000), false); assert.equal(f.delivered.has(60000), false)
  assert.equal(f.overlayClears[0].ownerUid, 'student-a')
  assert.equal(f.overlayClears[0].options.preserveEnabled, true)
  assert.deepEqual(f.planClears, ['student-a'])
})

test('failure to remove notifications after OS permission revocation remains visible', async () => {
  const f = notifyFixture(); f.pending.set(41000, { id: 41000 })
  f.plugin.checkPermissions = async () => ({ display: 'denied' }); f.plugin.cancel = async () => { throw new Error('cancel failed') }
  f.setOverlayClearError(new Error('overlay unavailable'))
  const result = await f.api.refreshAllReminders()
  assert.equal(result.status, 'failed'); assert.match(result.errors[0], /旧提醒撤销失败/)
  assert.equal(result.errors.length, 1); assert.doesNotMatch(result.errors[0], /overlay/)
  assert.match(result.notices[0], /桌面提醒撤销失败.*overlay unavailable/)
  assert.deepEqual(f.planClears, ['student-a'], 'an overlay bridge failure must not prevent stopping the background source')
})

test('revoked permissions still attempt background-source cleanup when only the overlay bridge fails', async () => {
  const f = notifyFixture(); seedReminders(f)
  f.plugin.checkPermissions = async () => ({ display: 'denied' }); f.setOverlayClearError(new Error('overlay unavailable'))
  const result = await f.api.refreshAllReminders()
  assert.equal(result.status, 'permissionDenied'); assert.equal(f.calls(), 0)
  assert.equal(f.pending.has(41000), false)
  assert.deepEqual(f.planClears, ['student-a'])
  assert.match(result.notices.join('；'), /overlay unavailable/)
})

test('background-source cleanup failure is visible while independent overlay cleanup still runs', async () => {
  const f = notifyFixture()
  f.plugin.checkPermissions = async () => ({ display: 'denied' }); f.setPlanClearError(new Error('source unavailable'))
  const result = await f.api.refreshAllReminders()
  assert.deepEqual(f.planClears, ['student-a']); assert.equal(f.overlayClears.length, 1)
  assert.match([...result.errors, ...result.notices].join('；'), /source unavailable/)
})

test('partially scheduled reminders never become an all-success status just because count is positive', async () => {
  const f = notifyFixture(); f.setResult({ count: 1, message: '部分提醒未能安排，请重试' })
  const result = await f.api.refreshAllReminders()
  assert.equal(result.status, 'failed'); assert.equal(result.errors.length, 4)
})

test('overlay failure remains a notice alongside confirmed system schedules instead of turning them into failed notifications', async () => {
  const f = notifyFixture()
  f.setResult({ count: 3, message: '系统提醒已安排', overlay: { status: 'failed', count: 0, message: '桌面覆盖权限已撤销，覆盖提醒未更新' } })
  const result = await f.api.refreshAllReminders()
  assert.equal(result.status, 'scheduled'); assert.equal(result.classCount, 3)
  assert.equal(result.errors.length, 0); assert.equal(result.notices.length, 1)
  assert.match(result.notices[0], /系统通知已安排.*桌面覆盖权限已撤销/)
})

test('missing exact-alarm permission adds a gentle delay notice while leaving confirmed schedules visible', async () => {
  const f = notifyFixture()
  f.setExactAlarm(false); f.setResult({ count: 2, message: '已安排提醒' })
  const result = await f.api.refreshAllReminders()
  assert.equal(result.status, 'degraded'); assert.equal(result.classCount, 2)
  assert.equal(result.errors.length, 0)
  assert.match(result.notices[0], /精确闹钟权限尚未允许.*可能延后/)
})

const grade = { year: '2026', term: '1', code: 'C1', name: '本人课程', nature: '', credit: '2', score: '90', gpa: '4' }
const exam = { year: '2026', term: '1', code: 'C1', name: '本人考试', datetime: '2099-12-01 09:00', room: 'A101', form: '', seat: '1', campus: '', teacher: '' }
test('grades and exams are isolated per UID while old unowned rows are preserved', () => {
  const f = fixture(), api = f.load('src/lib/academic-cache.ts')
  f.storage.set('study.grades.v1', '["unowned"]')
  assert.equal(api.loadGradesCache().length, 0)
  assert.equal(api.saveGradesCache([grade], '20260001'), true)
  assert.equal(api.saveExamsCache([exam], '20260001'), true)
  f.switchUid('student-b'); assert.equal(api.loadGradesCache().length, 0); assert.equal(api.loadExamsCache().length, 0)
  f.switchUid('student-a'); assert.equal(api.loadGradesCache()[0].score, '90'); assert.equal(api.loadExamsCache()[0].seat, '1')
  assert.equal(f.storage.get('study.grades.v1'), '["unowned"]')
})

test('an empty exam sync clears only exam rows and keeps independent grades metadata', () => {
  const f = fixture(), api = f.load('src/lib/academic-cache.ts')
  api.saveGradesCache([grade], 'grade-owner'); api.saveExamsCache([exam], 'exam-owner')
  assert.equal(api.saveExamsCache([], 'exam-owner'), true)
  assert.equal(api.loadExamsCache().length, 0); assert.equal(api.loadGradesCache().length, 1)
  assert.equal(api.loadAcademicMeta('grades').stuid, 'grade-owner'); assert.equal(api.loadAcademicMeta('exams').stuid, 'exam-owner')
})

test('stale academic writes and storage failures cannot replace saved rows or report success', () => {
  const f = fixture(), api = f.load('src/lib/academic-cache.ts'); const session = f.session()
  api.saveGradesCache([grade], '20260001'); f.switchUid('student-b'); f.switchUid('student-a')
  assert.equal(api.saveGradesCache([], '20260001', session), false)
  f.blockStorage(); assert.equal(api.saveGradesCache([], '20260001'), false)
  assert.equal(api.loadGradesCache().length, 1)
})

test('todo mirrors do not auto-claim old cached rows, and a late reply cannot populate another UID', () => {
  const f = fixture(), api = f.load('src/lib/todo-remind.ts', {
    './personal-reminders': {}, './reminder-presentation': {},
    './todo': { fetchTodoReminderCandidates: async () => { throw new Error('Todo queries are not configured in this local-cache fixture') } },
    './todo-data-events': f.load('src/lib/todo-data-events.ts'),
  })
  const rows = [{ id: 8, title: '本人待办', due_at: new Date(Date.now() + 3600000).toISOString(), done: false }]
  f.storage.set('todo.remind.cache.v1', JSON.stringify(rows)); assert.equal(api.loadTodoRemindCache().length, 0)
  const old = f.session(); assert.equal(api.syncTodoRemindCache(rows, old), true)
  f.switchUid('student-b'); assert.equal(api.loadTodoRemindCache().length, 0); assert.equal(api.syncTodoRemindCache(rows, old), false)
  f.switchUid('student-a'); assert.equal(api.loadTodoRemindCache()[0].title, '本人待办')
  f.blockStorage(); assert.equal(api.syncTodoRemindCache([], f.session()), false)
  assert.equal(api.loadTodoRemindCache().length, 1)
})

test('cert dates remain owned by their account and failed writes do not report a saved date', () => {
  const f = fixture(), api = f.load('src/lib/cert-remind.ts', { '../data/study': { certCatalog: [{ id: 'cet4', name: 'CET-4' }] }, './personal-reminders': {}, './alarm-notify': {} })
  f.storage.set('study.cert-reminders.v1', '["unowned"]')
  assert.equal(api.loadCertReminders().length, 0); api.upsertCertReminder({ certId: 'cet4', date: '2099-12-01' })
  f.switchUid('student-b'); assert.equal(api.loadCertReminders().length, 0)
  f.switchUid('student-a'); assert.equal(api.getCertReminder('cet4').date, '2099-12-01')
  f.blockStorage(); assert.throws(() => api.removeCertReminder('cet4'), /保存失败/)
  assert.equal(api.loadCertReminders().length, 1)
})

test('unreadable cert reminder storage stays intact when adding another date fails', () => {
  const f = fixture(), api = f.load('src/lib/cert-remind.ts', { '../data/study': { certCatalog: [] }, './personal-reminders': {}, './alarm-notify': {} })
  const key = 'study.cert-reminders.v2:uid:student-a'
  f.storage.set(key, '{broken')
  assert.equal(api.loadCertReminders().length, 0)
  assert.throws(() => api.upsertCertReminder({ certId: 'cet4', date: '2099-12-01' }), /无法读取/)
  assert.equal(f.storage.get(key), '{broken')
})

test('a late todo-order reply cannot save or display the previous account order', async () => {
  const f = fixture(), wait = deferred()
  const query = { select() { return this }, eq() { return this }, limit() { return wait.promise } }
  const api = f.load('src/lib/todo-order.ts', { './cb': { cbRdb: () => ({ from: () => query }) } })
  f.storage.set('todo.order', '[999]'); assert.equal(api.loadTodoOrderLocal().length, 0)
  const response = api.pullTodoOrder('student-a'); f.switchUid('student-b')
  wait.resolve({ data: [{ pref_value: { ids: [8, 9] } }] })
  assert.equal((await response).length, 0); assert.equal(api.loadTodoOrderLocal().length, 0)
  assert.equal(f.storage.has('todo.order.v2:uid:student-a'), false)
  assert.equal(f.storage.get('todo.order'), '[999]')
})

test('todo sorting uses separate local lists for the guest and each signed-in identity', () => {
  const f = fixture(), api = f.load('src/lib/todo-order.ts', { './cb': {} })
  api.saveTodoOrderLocal([1, 2]); f.switchUid('student-b'); assert.equal(api.loadTodoOrderLocal().length, 0)
  api.saveTodoOrderLocal([7]); f.switchUid(''); assert.equal(api.loadTodoOrderLocal().length, 0)
  f.switchUid('student-a'); assert.equal(api.loadTodoOrderLocal().join(','), '1,2')
})
