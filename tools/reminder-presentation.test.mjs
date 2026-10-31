import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }
const plain = (value) => JSON.parse(JSON.stringify(value))
function fixture({ native = true, os = 'android', oldAndroid = false, uid = 'student-a' } = {}) {
  let session = { uid, revision: 1 }
  const storage = new Map(), channels = new Map(), pending = new Map(), delivered = new Map(), cache = new Map(), subscriptions = new Set()
  const calls = { create: [], nativeChannels: [], actions: [], scheduled: [], cancelled: [], permissions: 0, events: [], overlaySync: [], overlayClear: [], overlayClearOptions: [], planSync: [], planClear: [] }
  const flags = { atomic: false, listError: null, createGate: null, permissionGate: null, courseStartMin: 840, scheduleGate: null, planPauseGate: null, planError: null, losePending: false, failActions: false, overlayError: null, noCourses: false, onlyFutureCourses: false, storageError: null, exactAlarmAllowed: true }
  let now = new Date(2030, 0, 2, 8, 0).getTime()
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now])) } static now() { return now } }
  const plugin = {
    requestPermissions: async () => { calls.permissions++; if (flags.permissionGate) await flags.permissionGate.promise; return { display: 'granted' } },
    checkExactNotificationSetting: async () => ({ exact_alarm: flags.exactAlarmAllowed ? 'granted' : 'denied' }),
    listChannels: async () => { if (oldAndroid) throw Object.assign(new Error('Unavailable before Android 26'), { code: 'UNAVAILABLE' }); if (flags.listError) throw flags.listError; return { channels: [...channels.values()] } },
    createChannel: async (channel) => { calls.create.push(plain(channel)); if (flags.createGate) await flags.createGate.promise; channels.set(channel.id, { ...channel }) },
    registerActionTypes: async (options) => { calls.actions.push(plain(options)); if (flags.failActions) throw new Error('actions bridge failed') },
    schedule: async ({ notifications }) => { calls.scheduled.push(notifications); if (!flags.losePending) notifications.forEach((notice) => pending.set(notice.id, notice)); if (flags.scheduleGate) await flags.scheduleGate.promise },
    getPending: async () => ({ notifications: [...pending.values()] }),
    getDeliveredNotifications: async () => ({ notifications: [...delivered.values()] }),
    cancel: async ({ notifications }) => { calls.cancelled.push(notifications); notifications.forEach(({ id }) => pending.delete(id)) },
    removeDeliveredNotifications: async ({ notifications }) => { notifications.forEach(({ id }) => delivered.delete(id)) },
  }
  const qbank = { captureQbankSession: () => session, isQbankSessionCurrent: (captured) => captured.uid === session.uid && captured.revision === session.revision, subscribeQbank: (listener) => { subscriptions.add(listener); return () => subscriptions.delete(listener) } }
  const overrides = {
    '../data/study': { certCatalog: [] },
    './platform': { IS_NATIVE: native, PLATFORM: { native, os } }, './qbank': qbank,
    './schedule-cache': { loadScheduleCache: () => ({ rows: flags.noCourses ? [] : [{}] }), classesOnDate: (day) => flags.onlyFutureCourses && day.getTime() < now + 7 * 86400_000 ? [] : [{ name: '高等数学', room: 'B302', teacher: '周老师', startMin: flags.courseStartMin, endMin: flags.courseStartMin + 95, timeLabel: '14:00–15:35' }], getNextClass: () => ({ status: 'soon', name: '高等数学', room: 'B302', timeLabel: '14:00', hint: '10 分钟后' }) },
    './reminder-overlay': {
      syncReminderOverlays: async (plan) => { calls.overlaySync.push(plan); if (flags.overlayError) throw flags.overlayError; return { supported: true, enabled: true, permissionGranted: true, scheduledCount: plan.items.length, lastError: null } },
      clearReminderOverlays: async (ownerUid, options) => { calls.overlayClear.push(ownerUid); calls.overlayClearOptions.push(options); if (flags.overlayError) throw flags.overlayError; return { supported: true, enabled: true, permissionGranted: true, pendingCount: 0, lastError: null } },
    },
    './reminder-plan': {
      getCourseReminderPlanState: async () => ({ supported: true, atomicReplaceSupported: flags.atomic }),
      clearCourseReminderPlan: async (ownerUid) => { calls.planClear.push(ownerUid); if (flags.planPauseGate) await flags.planPauseGate.promise; return { supported: true, ownerUid: null, plannedCount: 0, activeCount: 0, lastError: null } },
      syncCourseReminderPlan: async (plan) => { calls.planSync.push(plan); if (flags.planError) throw flags.planError; if(flags.atomic) { for(const [id, row] of pending) if(row.extra?.type==='class' && row.extra.ownerUid===plan.ownerUid) pending.delete(id); plan.notifications.filter(row=>row.schedule.at.getTime()<=now+7*86400_000).forEach(row=>pending.set(row.id,row)) }; return { supported: true, ownerUid: plan.ownerUid, plannedCount: plan.notifications.length, activeCount: pending.size, lastError: null } },
    },
    '@capacitor/local-notifications': { LocalNotifications: plugin },
    './keep-alive': { ensureReminderChannel: async (options) => { calls.nativeChannels.push(plain(options)); channels.set(options.id, { id: options.id, name: options.name, importance: options.importance, vibration: options.vibration, sound: options.soundEnabled ? 'content://settings/system/notification_sound' : null }); return { supported: true, created: true } } },
  }
  function load(path) {
    if (cache.has(path)) return cache.get(path)
    const compiled = ts.transpileModule(fs.readFileSync(join(root, path), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const module = { exports: {} }
    cache.set(path, module.exports)
    vm.runInNewContext(compiled, {
      module, exports: module.exports, Date: FixedDate, console, Event,
      CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail } },
      localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { if (flags.storageError) throw flags.storageError; storage.set(key, value) } },
      window: { dispatchEvent: (event) => calls.events.push(event) },
      require: (name) => {
        if (name in overrides) return overrides[name]
        if (name.startsWith('./')) return load(`src/lib/${name.slice(2)}.ts`)
        throw new Error(`Unexpected import: ${name}`)
      },
    }, { filename: path })
    cache.set(path, module.exports)
    return module.exports
  }
  return { load, storage, channels, pending, delivered, calls, flags, plugin, get now() { return now }, advanceTime(ms) { now += ms }, switchAccount(uid) { session = { uid, revision: session.revision + 1 }; subscriptions.forEach((listener) => listener()) } }
}

for (const style of ['quiet', 'normal', 'important']) test(`actual todo scheduler uses selected ${style} channel and preserves ownership and action metadata`, async () => {
  const f = fixture(), presentation = f.load('src/lib/reminder-presentation.ts'), todo = f.load('src/lib/todo-remind.ts')
  presentation.setReminderStyle(style, 'todo')
  todo.syncTodoRemindCache([{ id: 17, title: '本地待办', due_at: new Date(f.now + 3600000).toISOString() }])
  await flush()
  const result = await todo.rescheduleTodoReminders()
  assert.ok(result.count > 0)
  for (const notice of f.calls.scheduled.at(-1)) {
    assert.equal(notice.channelId, `todo-remind-${style}-v3`)
    assert.equal(notice.extra.ownerUid, 'student-a'); assert.equal(notice.extra.todoId, 17)
    assert.equal(notice.extra.route, '/todo'); assert.equal(notice.extra.reminderStyle, style)
    assert.equal(notice.schedule.allowWhileIdle, true)
  }
  assert.equal(f.channels.get(`todo-remind-${style}-v3`).vibration, style !== 'quiet')
  assert.doesNotMatch(result.message, /也会震动/)
})

test('actual certificate scheduler registers all future phases with isolated owned IDs and idle-capable alarms', async () => {
  const f = fixture(), api = f.load('src/lib/cert-remind.ts')
  api.upsertCertReminder({ certId: 'local-cert', date: '2030-01-10', note: '合成日期，不写云端' })
  const result = await api.rescheduleCertReminders()
  assert.equal(result.count, 3)
  const scheduled = f.calls.scheduled.at(-1)
  assert.equal(new Set(scheduled.map(n => n.id)).size, 3)
  assert.deepEqual(plain(scheduled.map(n => [n.schedule.at.getDate(), n.schedule.at.getHours()])), [[3, 20], [9, 20], [10, 8]])
  for (const notice of scheduled) {
    assert.ok(notice.id >= 52000 && notice.id < 53000)
    assert.equal(notice.extra.ownerUid, 'student-a'); assert.equal(notice.extra.type, 'cert')
    assert.equal(notice.channelId, 'cert-remind-v2'); assert.equal(notice.schedule.allowWhileIdle, true)
  }
})

test('untouched and invalid preferences preserve the old channel; explicitly reselecting important chooses a new channel', () => {
  const f = fixture(), api = f.load('src/lib/reminder-presentation.ts')
  assert.equal(api.getReminderStyle(), 'important')
  assert.equal(api.getReminderPresentation('class-soon').channelId, 'class-remind-v2')
  f.storage.set('reminder.presentation.class', 'unknown')
  assert.equal(api.hasSavedReminderStyle(), false)
  assert.equal(api.getReminderPresentation('class-start').legacyChannel, true)
  api.setReminderStyle('important')
  assert.equal(api.hasSavedReminderStyle(), true)
  assert.equal(api.getReminderPresentation('class-soon').channelId, 'class-remind-important-v3')
  assert.equal(api.getReminderPresentation('class-start').legacyChannel, false)
  assert.throws(() => api.setReminderStyle('unexpected'), /未知/)
  assert.equal(api.getReminderStyle(), 'important')
  assert.equal(f.calls.permissions, 0)
  assert.equal(f.calls.scheduled.length, 0)
})

test('course alarm-clock choice reaches both active and semester plans without changing the effects channel', async () => {
  const f = fixture(), courses = f.load('src/lib/class-remind.ts'), presentation = f.load('src/lib/reminder-presentation.ts')
  presentation.setClassReminderEffects({ sound: false, vibration: true })
  await courses.rescheduleClassReminders()
  for (const batch of [f.calls.scheduled.at(-1), f.calls.planSync.at(-1).notifications]) {
    assert.ok(batch.length)
    assert.ok(batch.every(item => item.extra.courseAlarmClock === true && item.channelId === 'class-remind-important-s0v1-v4'))
    assert.ok(batch.every(item => item.extra.reminderAt === item.schedule.at.toISOString()))
  }
  courses.setClassAlarmClockEnabled(false)
  await courses.rescheduleClassReminders()
  for (const batch of [f.calls.scheduled.at(-1), f.calls.planSync.at(-1).notifications]) assert.ok(batch.every(item => item.extra.courseAlarmClock === false && item.channelId === 'class-remind-important-s0v1-v4'))
  assert.deepEqual(plain(presentation.getClassReminderEffects()), { sound: false, vibration: true, configured: true })
})

test('a denied exact grant reports best-effort course scheduling instead of promising timely delivery', async () => {
  const f = fixture(), courses = f.load('src/lib/class-remind.ts')
  f.flags.exactAlarmAllowed = false
  const result = await courses.rescheduleClassReminders()
  assert.ok(result.count > 0); assert.match(result.message, /精确闹钟权限未开启.*系统可能延后/)
  assert.doesNotMatch(result.message, /准点响|准时送达|保证/)
})

test('class style leaves exams and todos unchanged, and the payload keeps distinct event meaning and ownership', () => {
  const f = fixture(), api = f.load('src/lib/reminder-presentation.ts')
  api.setReminderStyle('quiet')
  assert.equal(api.getReminderPresentation('exam').channelId, 'exam-remind-v2')
  assert.equal(api.getReminderPresentation('todo').channelId, 'todo-remind-v1')
  const at = new Date(f.now + 60_000)
  const soon = api.buildReminderNotification(api.getReminderPresentation('class-soon'), { id: 43000, title: '课前', body: 'B302', at, ownerUid: 'student-a' })
  const start = api.buildReminderNotification(api.getReminderPresentation('class-start'), { id: 43001, title: '开课', body: 'B302', at, ownerUid: 'student-a' })
  assert.equal(soon.channelId, start.channelId)
  assert.equal(soon.extra.type, 'class'); assert.equal(soon.extra.ownerUid, 'student-a'); assert.equal(soon.extra.route, '/schedule')
  assert.equal(soon.extra.reminderKind, 'class-soon'); assert.equal(start.extra.reminderKind, 'class-start')
  assert.equal(soon.schedule.allowWhileIdle, true)
  assert.equal(soon.summaryText, '课前提醒'); assert.equal(start.summaryText, '开课提醒')
  assert.equal(soon.actionTypeId, 'ohhu-class-view-v1')
  assert.equal('sound' in soon, false)
})

test('course notification metadata preserves real start/end and phase expiry through moved alarm times', () => {
  const f=fixture(),api=f.load('src/lib/reminder-presentation.ts'),start=new Date(f.now+3600_000),end=new Date(start.getTime()+10*60_000)
  const soon=api.buildReminderNotification(api.getReminderPresentation('class-soon'),{id:43000,title:'课前',body:'',at:new Date(start.getTime()-15*60_000+1000),reminderAt:new Date(start.getTime()-15*60_000),classStartAt:start,classEndAt:end})
  assert.equal(soon.extra.classStartAt,start.toISOString());assert.equal(soon.extra.classEndAt,end.toISOString());assert.equal(soon.extra.expiresAt,new Date(start.getTime()-14*60_000).toISOString())
  const current=api.buildReminderNotification(api.getReminderPresentation('class-start'),{id:43001,title:'开课',body:'',at:new Date(start.getTime()+1000),reminderAt:start,classStartAt:start,classEndAt:end})
  assert.equal(current.extra.expiresAt,new Date(start.getTime()+60_000).toISOString());assert.equal(current.extra.reminderAt,start.toISOString())
  assert.throws(()=>api.buildReminderNotification(api.getReminderPresentation('class-start'),{id:43001,title:'坏数据',body:'',at:start,classStartAt:start,classEndAt:new Date(NaN)}),/起止时间无效/)
  const legacy=api.buildReminderNotification(api.getReminderPresentation('class-start'),{id:43001,title:'旧记录',body:'',at:start})
  assert.equal(legacy.extra.expiresAt,new Date(start.getTime()+60_000).toISOString())
})

test('the enabled preference emits after a successful save; getters and rejected writes do not publish changes', () => {
  const f = fixture(), api = f.load('src/lib/class-remind.ts')
  assert.equal(api.isClassRemindEnabled(), true)
  assert.equal(f.calls.events.length, 0)
  api.setClassRemindEnabled(false)
  assert.equal(api.isClassRemindEnabled(), false)
  assert.equal(f.calls.events.length, 1)
  assert.equal(f.calls.events[0].type, api.CLASS_REMIND_PREF_EVENT)
  f.flags.storageError = new Error('storage full')
  assert.throws(() => api.setClassRemindEnabled(true), /storage full/)
  assert.equal(api.isClassRemindEnabled(), false)
  assert.equal(f.calls.events.length, 1)
})

test('new channels use separate policies without raw/default sound or posting a notification', async () => {
  const f = fixture(), api = f.load('src/lib/reminder-presentation.ts')
  for (const style of ['normal', 'quiet', 'important']) await api.prepareReminderPresentation('class-soon', style)
  assert.deepEqual(f.calls.create.map(({ id, importance, vibration }) => [id, importance, vibration]), [
    ['class-remind-normal-v3', 3, true], ['class-remind-quiet-v3', 2, false], ['class-remind-important-v3', 4, true],
  ])
  assert.equal(f.calls.create.some((channel) => 'sound' in channel), false)
  assert.equal(f.calls.actions.length, 1)
  assert.equal(f.calls.actions[0].types[0].actions[0].id, 'view-reminder')
  assert.equal(f.calls.scheduled.length, 0)
  assert.equal(f.calls.permissions, 0)
})

for (const sound of [false, true]) for (const vibration of [false, true]) test(`explicit course effects sound=${sound} vibration=${vibration} select an isolated channel for both course phases`, async () => {
  const f = fixture(), api = f.load('src/lib/reminder-presentation.ts'), courses = f.load('src/lib/class-remind.ts')
  api.setClassReminderEffects({ sound, vibration })
  const expectedId = `class-remind-important-s${Number(sound)}v${Number(vibration)}-v4`
  const result = await courses.rescheduleClassReminders()
  assert.equal(result.count, 14)
  assert.equal(f.calls.nativeChannels.length, 1)
  assert.equal(f.calls.nativeChannels[0].soundEnabled, sound)
  assert.equal(f.calls.nativeChannels[0].vibration, vibration)
  assert.equal(f.calls.create.length, 0, 'Capacitor cannot create truly silent channels')
  assert.equal(f.calls.scheduled[0].every(notice => notice.channelId === expectedId), true)
  assert.equal(f.calls.planSync[0].notifications.every(notice => notice.channelId === expectedId), true)
  assert.equal(api.getReminderPresentation('exam').channelId, 'exam-remind-v2')
  assert.equal(api.getReminderPresentation('todo').channelId, 'todo-remind-v1')
})

test('explicit sound or vibration lifts quiet courses above low importance while untouched quiet remains silent', async () => {
  const f = fixture(), api = f.load('src/lib/reminder-presentation.ts')
  api.setReminderStyle('quiet')
  assert.equal(api.getReminderPresentation('class-soon').channel.importance, 2)
  assert.equal(api.getClassReminderEffects().configured, false)
  for (const effects of [{ sound: true, vibration: false }, { sound: false, vibration: true }, { sound: true, vibration: true }]) {
    api.setClassReminderEffects(effects)
    const presentation = await api.prepareReminderPresentation('class-soon')
    assert.equal(presentation.channel.importance, 3)
    assert.equal(f.calls.nativeChannels.at(-1).importance, 3)
  }
  api.setClassReminderEffects({ sound: false, vibration: false })
  assert.equal(api.getReminderPresentation('class-start').channel.importance, 2)
  assert.equal(api.getReminderStyle(), 'quiet', 'effect choices must not rewrite the chosen style')
})

test('effect preference storage failure retains the old channel and does not announce a save', () => {
  const f = fixture(), api = f.load('src/lib/reminder-presentation.ts')
  f.flags.storageError = new Error('storage full')
  assert.throws(() => api.setClassReminderEffects({ sound: false, vibration: true }), /storage full/)
  assert.equal(api.getClassReminderEffects().configured, false)
  assert.equal(api.getReminderPresentation('class-soon').channelId, 'class-remind-v2')
  assert.equal(f.calls.events.length, 0)
  assert.throws(() => api.setClassReminderEffects({ sound: 'no', vibration: true }), /无效/)
})

test('existing user-modified combination channels are never recreated or reset', async () => {
  const f = fixture(), api = f.load('src/lib/reminder-presentation.ts')
  api.setClassReminderEffects({ sound: true, vibration: true })
  const id = 'class-remind-important-s1v1-v4'
  f.channels.set(id, { id, importance: 0, sound: null, vibration: false })
  const result = await api.prepareReminderPresentation('class-soon')
  assert.equal(result.channelState.channel.importance, 0)
  assert.equal(result.channelState.channel.sound, null)
  assert.equal(f.calls.nativeChannels.length, 0)
  assert.match(result.stateHint, /渠道已关闭/)
})

test('existing user-modified or disabled channels are returned without recreating them', async () => {
  const f = fixture(), api = f.load('src/lib/reminder-presentation.ts')
  const userChannel = { id: 'class-remind-v2', name: '我的上课提醒', importance: 0, sound: 'content://user-selected', vibration: false }
  f.channels.set(userChannel.id, userChannel)
  const result = await api.prepareReminderPresentation('class-soon')
  assert.equal(result.channelState.created, false)
  assert.deepEqual(plain(result.channelState.channel), userChannel)
  assert.equal(f.calls.create.length, 0)
  assert.match(result.stateHint, /保留原通知渠道/)
})

test('channel-less old Android is distinguished from a real bridge failure, and failed action registration can retry', async () => {
  const older = fixture({ oldAndroid: true }), oldApi = older.load('src/lib/reminder-presentation.ts')
  const result = await oldApi.prepareReminderPresentation('class-soon', 'quiet')
  assert.equal(result.channelState.supported, false)
  assert.match(result.stateHint, /旧系统.*静音/)
  assert.equal(older.calls.create.length, 0)
  const f = fixture(), api = f.load('src/lib/reminder-presentation.ts')
  f.flags.listError = new Error('bridge disconnected')
  await assert.rejects(api.prepareReminderPresentation('class-soon'), /bridge disconnected/)
  f.flags.listError = null; f.flags.failActions = true
  await assert.rejects(api.prepareReminderPresentation('class-soon'), /actions bridge failed/)
  f.flags.failActions = false
  await api.prepareReminderPresentation('class-soon')
  assert.equal(f.calls.actions.length, 2)
})

test('class scheduling retains account-owned cleanup and both phases; disabling clears its pending notices only', async () => {
  const f = fixture(), api = f.load('src/lib/class-remind.ts'), styles = f.load('src/lib/reminder-presentation.ts')
  f.pending.set(41001, { id: 41001 }); f.pending.set(51001, { id: 51001 }); f.pending.set(70011, { id: 70011 })
  styles.setReminderStyle('normal')
  const result = await api.rescheduleClassReminders()
  assert.equal(result.count, 14)
  assert.equal(f.pending.has(41001), false)
  assert.equal(f.pending.has(51001), true); assert.equal(f.pending.has(70011), true)
  const notices = f.calls.scheduled[0]
  assert.equal(notices[0].extra.reminderKind, 'class-soon'); assert.equal(notices[1].extra.reminderKind, 'class-start')
  assert.equal(notices.every((notice) => notice.extra.ownerUid === 'student-a' && notice.channelId === 'class-remind-normal-v3'), true)
  assert.equal(notices[1].schedule.at.getTime() - notices[0].schedule.at.getTime(), 15 * 60_000)
  assert.equal(result.overlay.status, 'scheduled'); assert.equal(result.overlay.count, 14)
  assert.equal(f.calls.overlaySync[0].ownerUid, 'student-a')
  assert.deepEqual(f.calls.overlaySync[0].items.map((notice) => [notice.id, notice.title, notice.at.getTime(), notice.route]), notices.map((notice) => [notice.id, notice.title, notice.schedule.at.getTime(), notice.extra.route]))
  assert.doesNotMatch(result.message, /也会震动|一定|准点/)
  assert.equal(result.plan.status, 'scheduled'); assert.equal(result.plan.count, 420)
  assert.equal(f.calls.planSync[0].ownerUid, 'student-a')
  assert.equal(f.calls.planSync[0].notifications.every(notice => notice.id >= 41000 && notice.id < 50000 && notice.extra.ownerUid === 'student-a'), true)
  api.setClassRemindEnabled(false)
  assert.equal((await api.rescheduleClassReminders()).count, 0)
  assert.deepEqual([...f.pending.keys()], [51001, 70011])
  assert.deepEqual(f.calls.overlayClear, ['student-a'])
  assert.deepEqual(plain(f.calls.overlayClearOptions), [{ preserveEnabled: true }])
})

for (const gate of ['permissionGate', 'createGate']) test(`crossing 09:00 during ${gate} retains one safe start in both the active window and semester source`, async () => {
  const f = fixture(), api = f.load('src/lib/class-remind.ts'), wait = deferred()
  f.flags.courseStartMin = 540
  f.advanceTime(59 * 60_000 + 50_000) // 08:59:50, ten seconds before class.
  f.flags[gate] = wait
  const operation = api.rescheduleClassReminders()
  await new Promise(setImmediate)
  f.advanceTime(20_000) // permission/channel preparation resumes at 09:00:10.
  wait.resolve()
  const result = await operation
  assert.equal(result.count, 13)
  const notices = f.calls.scheduled[0], near = notices.find(notice => notice.id === 43001)
  assert.ok(near, 'the upcoming start must survive replacement of the previous plan')
  assert.equal(near.schedule.at.getTime(), f.now + 1_000)
  assert.equal(notices.some(notice => notice.id === 43000), false, 'the already-past 08:45 lead is never replayed')
  assert.equal(f.calls.planSync[0].notifications.find(notice => notice.id === 43001).schedule.at.getTime(), near.schedule.at.getTime())
  assert.equal(f.calls.overlaySync[0].items.find(notice => notice.id === 43001).at.getTime(), near.schedule.at.getTime())
})

test('a long permission dialog skips the old event without rolling back the remaining future batch', async () => {
  const f = fixture(), api = f.load('src/lib/class-remind.ts'), wait = deferred()
  f.flags.courseStartMin = 540; f.advanceTime(59 * 60_000 + 50_000)
  f.flags.permissionGate = wait
  const operation = api.rescheduleClassReminders()
  await new Promise(setImmediate)
  f.advanceTime(120_000) // now 09:01:50, beyond the bounded one-minute grace.
  wait.resolve()
  const result = await operation
  assert.equal(result.count, 12)
  assert.equal(f.calls.scheduled[0].some(notice => notice.id === 43001 || notice.id === 43000), false)
  assert.equal(f.calls.planSync[0].notifications.some(notice => notice.id === 43001 || notice.id === 43000), false)
  assert.equal(f.pending.size, 12)
})

test('chosen class phases are mirrored consistently into system notifications, overlays and the semester source', async () => {
  const f = fixture(), api = f.load('src/lib/class-remind.ts')
  api.setClassStartRemindEnabled(false)
  let result = await api.rescheduleClassReminders()
  assert.equal(result.count, 7); assert.equal(result.message.includes('开课时提醒'), false)
  assert.equal(f.calls.scheduled[0].every(notice => notice.extra.reminderKind === 'class-soon'), true)
  assert.equal(f.calls.overlaySync[0].items.length, 7)
  assert.equal(f.calls.planSync[0].notifications.every(notice => notice.extra.reminderKind === 'class-soon'), true)
  assert.equal(f.calls.planSync[0].notifications.length, 210)
  api.setClassSoonRemindEnabled(false); api.setClassStartRemindEnabled(true)
  result = await api.rescheduleClassReminders()
  assert.equal(result.count, 7); assert.equal(result.message.includes('提前'), false)
  assert.match(result.message, /开课时提醒/)
  assert.equal(f.calls.scheduled[1].every(notice => notice.extra.reminderKind === 'class-start'), true)
  assert.equal(f.calls.overlaySync[1].items.length, 7)
  assert.equal(f.calls.planSync[1].notifications.every(notice => notice.extra.reminderKind === 'class-start'), true)
  assert.equal(f.calls.planSync[1].notifications.length, 210)
})

test('turning off both course phases removes the current notices and old mirror sources without a new schedule', async () => {
  const f = fixture(), api = f.load('src/lib/class-remind.ts')
  await api.rescheduleClassReminders()
  assert.equal(f.pending.size, 14)
  api.setClassSoonRemindEnabled(false); api.setClassStartRemindEnabled(false)
  const result = await api.rescheduleClassReminders()
  assert.equal(result.count, 0); assert.match(result.message, /课前和开课提醒均已关闭/)
  assert.equal(f.pending.size, 0); assert.equal(f.calls.scheduled.length, 1)
  assert.deepEqual(plain(f.calls.overlayClear), ['student-a'])
  assert.deepEqual(plain(f.calls.overlayClearOptions), [{ preserveEnabled: true }])
  assert.equal(f.calls.planClear.every(uid => uid === 'student-a'), true)
  assert.equal(f.calls.planSync.length, 1)
})

test('an old account request cannot bind the new UID after awaiting native source pause', async () => {
  const f = fixture(), api = f.load('src/lib/class-remind.ts'), wait = deferred()
  f.flags.planPauseGate = wait
  const old = api.rescheduleClassReminders(); await new Promise(setImmediate)
  f.switchAccount('student-b'); wait.resolve()
  const result = await old
  assert.equal(result.count, 0); assert.match(result.message, /账号已变化/)
  assert.deepEqual(f.calls.planClear, ['student-a'])
  assert.equal(f.calls.permissions, 1); assert.equal(f.calls.scheduled.length, 0); assert.equal(f.calls.planSync.length, 0)
})

test('a week without classes still persists future semester candidates after confirming an empty active window', async () => {
  const f = fixture(), api = f.load('src/lib/class-remind.ts')
  f.flags.onlyFutureCourses = true
  const result = await api.rescheduleClassReminders()
  assert.equal(result.count, 0); assert.equal(result.plan.status, 'scheduled')
  assert.equal(f.calls.scheduled.length, 1); assert.equal(f.calls.scheduled[0].length, 0)
  assert.equal(f.calls.planSync.length, 1); assert.ok(result.plan.count > 0)
  assert.match(result.message, /本周暂无课程.*后台补排/)
})

test('background source persistence failure preserves the confirmed current window and is reported separately', async () => {
  const f = fixture(), api = f.load('src/lib/class-remind.ts')
  f.flags.planError = new Error('source unavailable')
  const result = await api.rescheduleClassReminders()
  assert.equal(result.count, 14); assert.equal(f.pending.size, 14)
  assert.equal(result.plan.status, 'failed'); assert.match(result.plan.message, /source unavailable/)
  assert.equal(result.overlay.status, 'scheduled')
})

test('account changes during channel preparation cannot schedule notices for the previous account', async () => {
  const f = fixture(), api = f.load('src/lib/class-remind.ts')
  f.flags.createGate = deferred()
  const resultPromise = api.rescheduleClassReminders()
  await new Promise(setImmediate)
  assert.equal(f.calls.create.length, 1)
  f.switchAccount('student-b')
  f.flags.createGate.resolve()
  const result = await resultPromise
  await f.load('src/lib/personal-reminders.ts').clearPersonalReminders()
  assert.equal(result.count, 0)
  assert.equal(f.calls.scheduled.length, 0)
  assert.equal(f.calls.overlaySync.length, 0)
  assert.equal(f.calls.planSync.length, 0)
  assert.deepEqual(f.calls.overlayClear, [])
  assert.equal(result.overlay, undefined)
  assert.equal(f.pending.size, 0)
})

test('overlay bridge failures remain separate from successful system notifications, and empty courses clear only the captured owner', async () => {
  const f = fixture(), api = f.load('src/lib/class-remind.ts')
  f.flags.overlayError = new Error('overlay unavailable')
  const result = await api.rescheduleClassReminders()
  assert.equal(result.count, 14)
  assert.equal(result.overlay.status, 'failed')
  assert.match(result.overlay.message, /overlay unavailable/)
  assert.doesNotMatch(result.message, /失败/)
  f.flags.noCourses = true
  const empty = await api.rescheduleClassReminders()
  assert.equal(empty.count, 0)
  assert.equal(empty.overlay.status, 'failed')
  assert.deepEqual(f.calls.overlayClear, ['student-a'])
})

test('a disabled actual channel prevents both class scheduling and self-test instead of reporting success', async () => {
  const f = fixture(), api = f.load('src/lib/class-remind.ts'), selfTest = f.load('src/lib/reminder-self-test.ts')
  f.channels.set('class-remind-v2', { id: 'class-remind-v2', name: '上课提醒', importance: 0 })
  await assert.rejects(api.rescheduleClassReminders(), /通知渠道已关闭/)
  const result = await selfTest.scheduleTestReminder(60)
  assert.equal(result.ok, false)
  assert.match(result.message, /渠道已关闭/)
  assert.equal(f.calls.scheduled.length, 0)
  assert.deepEqual(f.calls.overlayClear, [])
})

test('unconfirmed system scheduling clears the old overlay plan and retains its original error even when overlay cleanup fails', async () => {
  const f = fixture(), api = f.load('src/lib/class-remind.ts')
  f.flags.losePending = true
  f.flags.overlayError = new Error('overlay cleanup failed')
  await assert.rejects(api.rescheduleClassReminders(), /部分提醒未能安排.*本次排程已撤销/)
  assert.deepEqual(f.calls.overlayClear, ['student-a'])
  assert.equal(f.calls.planSync.length, 0, 'unconfirmed current window must not persist background candidates')
  assert.equal(f.calls.overlaySync.length, 0)
  assert.deepEqual(plain(f.calls.overlayClearOptions), [{ preserveEnabled: true }])
  assert.equal(f.pending.size, 0)
})

test('self-test uses the selected real channel without claiming universal delivery, validates pending and normalizes invalid delay', async () => {
  const f = fixture(), styles = f.load('src/lib/reminder-presentation.ts'), api = f.load('src/lib/reminder-self-test.ts')
  styles.setReminderStyle('quiet')
  const result = await api.scheduleTestReminder(Number.NaN)
  assert.equal(result.ok, true)
  const notice = f.calls.scheduled[0][0]
  assert.equal(notice.channelId, 'class-remind-quiet-v3')
  assert.equal(notice.extra.type, 'self-test'); assert.equal(notice.extra.route, '/settings')
  assert.equal(notice.actionTypeId, 'ohhu-self-test-view-v1')
  assert.equal(f.calls.actions[0].types.find((type) => type.id === notice.actionTypeId).actions[0].title, '查看提醒设置')
  assert.equal('ownerUid' in notice.extra, false)
  assert.equal('restoreAfterReboot' in notice.extra, false)
  assert.equal(notice.schedule.at.getTime() - f.now, 60_000)
  assert.doesNotMatch(notice.title + notice.body, /已生效|也照样|说明提醒不依赖/)
  await api.scheduleTestReminder(9999, { kind: 'exam', style: 'normal' })
  assert.equal(f.calls.scheduled[1][0].channelId, 'exam-remind-normal-v3')
  assert.equal(f.calls.scheduled[1][0].schedule.at.getTime() - f.now, 600_000)
  f.pending.clear(); f.flags.losePending = true
  assert.equal((await api.scheduleTestReminder(10)).ok, false)
})

test('web self-test never requests native permissions or schedules notifications', async () => {
  const f = fixture({ native: false, os: 'web' }), api = f.load('src/lib/reminder-self-test.ts')
  assert.equal((await api.scheduleTestReminder()).ok, false)
  assert.equal(f.calls.permissions, 0)
  assert.equal(f.calls.create.length, 0)
  assert.equal(f.calls.scheduled.length, 0)
})

test('the opt-in 180-second reboot test binds the current signed owner; ordinary tests stay ownerless and guests cannot opt in', async () => {
  const f = fixture(), api = f.load('src/lib/reminder-self-test.ts')
  const result = await api.scheduleTestReminder(180, { restoreAfterReboot: true })
  assert.equal(result.ok, true); assert.match(result.message, /重启.*同一账号/)
  const notice = f.calls.scheduled[0][0]
  assert.equal(notice.extra.ownerUid, 'student-a'); assert.equal(notice.extra.restoreAfterReboot, true)
  assert.equal(notice.extra.type, 'self-test'); assert.equal(notice.id, 70011)
  assert.equal(notice.schedule.at.getTime() - f.now, 180_000)
  const guest = fixture({ uid: '' }), guestApi = guest.load('src/lib/reminder-self-test.ts')
  assert.equal((await guestApi.scheduleTestReminder(180, { restoreAfterReboot: true })).ok, false)
  assert.equal(guest.calls.permissions, 0); assert.equal(guest.calls.scheduled.length, 0)
})

test('a reboot test captured before A -> B -> A cannot schedule after channel preparation', async () => {
  const f = fixture(), api = f.load('src/lib/reminder-self-test.ts')
  f.flags.createGate = deferred()
  const resultPromise = api.scheduleTestReminder(180, { restoreAfterReboot: true })
  await flush(); assert.equal(f.calls.create.length, 1)
  f.switchAccount('student-b'); f.switchAccount('student-a')
  f.flags.createGate.resolve()
  assert.equal((await resultPromise).ok, false)
  assert.equal(f.calls.scheduled.length, 0)
})

test('a late reboot test for A is cancelled before the queued test for B schedules with the shared test ID', async () => {
  const f = fixture(), api = f.load('src/lib/reminder-self-test.ts'), gate = deferred()
  f.flags.scheduleGate = gate
  const old = api.scheduleTestReminder(180, { restoreAfterReboot: true })
  await new Promise(setImmediate); assert.equal(f.calls.scheduled.length, 1)
  f.switchAccount('student-b'); f.flags.scheduleGate = null
  const next = api.scheduleTestReminder(180, { restoreAfterReboot: true })
  gate.resolve()
  assert.equal((await old).ok, false); assert.equal((await next).ok, true)
  assert.equal(f.pending.get(70011).extra.ownerUid, 'student-b')
  assert.equal(f.pending.get(70011).extra.restoreAfterReboot, true)
  assert.deepEqual(plain(f.calls.cancelled), [[{ id: 70011 }]])
})


test('native course replacement preserves the old confirmed window throughout delayed preflight', async () => {
  const f=fixture(), api=f.load('src/lib/class-remind.ts'); f.flags.atomic=true;
  f.pending.set(43000,{id:43000,title:'old',extra:{type:'class',ownerUid:'student-a'}});
  const gate=deferred();f.flags.permissionGate=gate;
  const job=api.rescheduleClassReminders();await new Promise(setImmediate);
  assert.equal(f.pending.get(43000).title,'old');assert.equal(f.calls.cancelled.length,0);assert.equal(f.calls.planClear.length,0);
  gate.resolve();const result=await job;
  assert.equal(result.plan.status,'scheduled');assert.equal(f.calls.scheduled.length,0);assert.equal(f.calls.planSync.length,1);assert.equal(f.pending.size,14);
});

test('failed native preflight never deletes the previously confirmed class source or alarms', async () => {
  const f=fixture(), api=f.load('src/lib/class-remind.ts');f.flags.atomic=true;
  const old={id:43000,title:'confirmed-old',extra:{type:'class',ownerUid:'student-a'}};f.pending.set(old.id,old);
  f.plugin.requestPermissions=async()=>{throw new Error('temporary permission bridge failure')};
  await assert.rejects(api.rescheduleClassReminders(),/permission bridge failure/);
  assert.equal(f.pending.get(43000),old);assert.equal(f.calls.planClear.length,0);assert.equal(f.calls.cancelled.length,0);assert.equal(f.calls.overlayClear.length,0);
});

test('failed native source replacement stays visible without erasing the recoverable prior plan', async () => {
  const f=fixture(), api=f.load('src/lib/class-remind.ts');f.flags.atomic=true;
  const old={id:43000,title:'confirmed-old',extra:{type:'class',ownerUid:'student-a'}};f.pending.set(old.id,old);
  f.flags.planError=new Error('source persistence failed');
  await assert.rejects(api.rescheduleClassReminders(),/source persistence failed/);
  assert.equal(f.pending.get(43000),old);assert.equal(f.calls.planClear.length,0);assert.equal(f.calls.cancelled.length,0);assert.equal(f.calls.scheduled.length,0);
});
