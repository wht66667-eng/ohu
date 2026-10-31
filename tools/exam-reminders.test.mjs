/** Exercise real exam parsing and scheduling with synthetic native and identity bridges. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const compile = path => ts.transpileModule(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const codes = new Map(['exam-utils', 'exam-reminder-prefs', 'personal-reminders', 'reminder-presentation', 'alarm-notify'].map(name => [name, compile(`src/lib/${name}.ts`)]))
const plain = value => JSON.parse(JSON.stringify(value))
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const flush = () => new Promise(setImmediate)
const exam = (name, datetime) => ({ name, datetime, room: '测试教室', seat: '12' })

function fixture({ uid = 'student-a', exams = [exam('合成考试', '2030-01-04 09:00-11:00')] } = {}) {
  let session = { uid, revision: 1 }
  let now = new Date(2030, 0, 2, 8, 0).getTime()
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now])) } static now() { return now } }
  const modules = new Map(), storage = new Map(), channels = new Map(), pending = new Map(), delivered = new Map(), subscriptions = new Set()
  const flags = { createGate: null, scheduleGate: null, listError: null, actionsError: null, losePending: false }
  const calls = { permissions: 0, create: [], actions: [], schedule: [], cancel: [] }
  const plugin = {
    requestPermissions: async () => { calls.permissions++; return { display: 'granted' } },
    listChannels: async () => { if (flags.listError) throw flags.listError; return { channels: [...channels.values()] } },
    createChannel: async channel => { calls.create.push(channel); if (flags.createGate) await flags.createGate.promise; channels.set(channel.id, channel) },
    registerActionTypes: async options => { calls.actions.push(options); if (flags.actionsError) throw flags.actionsError },
    schedule: async ({ notifications }) => {
      calls.schedule.push(notifications)
      const gate = flags.scheduleGate
      if (gate) await gate.promise
      if (!flags.losePending) notifications.forEach(notice => pending.set(notice.id, notice))
    },
    getPending: async () => ({ notifications: [...pending.values()] }),
    getDeliveredNotifications: async () => ({ notifications: [...delivered.values()] }),
    cancel: async ({ notifications }) => { calls.cancel.push(notifications); notifications.forEach(({ id }) => pending.delete(id)) },
    removeDeliveredNotifications: async ({ notifications }) => { notifications.forEach(({ id }) => delivered.delete(id)) },
  }
  const dependencies = {
    './academic-cache': { loadExamsCache: () => exams },
    './platform': { IS_NATIVE: true, PLATFORM: { os: 'android' } },
    './qbank': { captureQbankSession: () => session, isQbankSessionCurrent: captured => captured.uid === session.uid && captured.revision === session.revision, subscribeQbank: listener => { subscriptions.add(listener); return () => subscriptions.delete(listener) } },
    '@capacitor/local-notifications': { LocalNotifications: plugin },
  }
  function load(name) {
    if (modules.has(name)) return modules.get(name)
    const module = { exports: {} }
    vm.runInNewContext(codes.get(name), {
      module, exports: module.exports, Date: FixedDate, Event, console,
      localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
      window: { addEventListener: () => {}, dispatchEvent: () => {} },
      CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail } },
      require: dependency => {
        if (Object.hasOwn(dependencies, dependency)) return dependencies[dependency]
        if (dependency.startsWith('./')) return load(dependency.slice(2))
        throw new Error(`Unexpected dependency ${dependency}`)
      },
    }, { filename: `src/lib/${name}.ts` })
    modules.set(name, module.exports)
    return module.exports
  }
  return { api: load('exam-utils'), prefs: load('exam-reminder-prefs'), styles: load('reminder-presentation'), calls, flags, channels, pending, delivered, now,
    select(nextUid) { session = { uid: nextUid, revision: session.revision + 1 }; subscriptions.forEach(listener => listener()) },
    setTime(day, hour, minute = 0, second = 0) { now = new Date(2030, 0, day, hour, minute, second).getTime() },
  }
}

test('explicit valid local dates, ranges and ISO offsets retain the real start time', () => {
  const { api } = fixture()
  for (const input of ['2030-01-08 09:00-11:00', '2030/1/8 9:00', '2030.1.8 09:00', '2030年1月8日09:00', '2030-01-08T09:00']) {
    const value = api.parseExamStart(input)
    assert(value, input)
    assert.deepEqual([value.getFullYear(), value.getMonth() + 1, value.getDate(), value.getHours(), value.getMinutes()], [2030, 1, 8, 9, 0])
  }
  assert.equal(api.parseExamStart('2028-02-29 09:00').getDate(), 29)
  assert.equal(api.parseExamStart('2030-01-08T17:45:30.12+08:00').getTime(), Date.UTC(2030, 0, 8, 9, 45, 30, 120))
  assert.equal(api.parseExamStart('2030-01-08T17:45:00Z').getTime(), Date.UTC(2030, 0, 8, 17, 45))
  assert.equal(api.parseExamStart('2030-01-08T17:45:00-02:30').getTime(), Date.UTC(2030, 0, 8, 20, 15))
})

test('missing times, invalid dates and clocks, and ambiguous formats never become an invented alarm time', () => {
  const { api } = fixture()
  for (const input of ['', '2030-01-08', '2030年1月8日', '时间待定', '2030-02-29 09:00', '2030-02-30 09:00', '2030-13-08 09:00', '2030-00-08 09:00', '2030-01-00 09:00', '2030-01-32 09:00', '2030-01-08 24:00', '2030-01-08 09:60', '2030-01-08 09:00:60', '2030-01-08 09:00-25:00', '2030-01-08 09:00 PM', '2030-02-30T17:45:00Z', '2030-01-08T17:45:00+24:00', '2030-01-08T17:45:00+08:99']) {
    assert.equal(api.parseExamStart(input), null, input)
    assert.equal(api.examCountdown(input).label, '时间待定', input)
  }
})

test('uncertain exams stay in the list but clear obsolete exam alarms without scheduling guessed times', async () => {
  const f = fixture({ exams: [exam('日期待确认', '2030-01-04'), exam('日期无效', '2030-02-30 09:00')] })
  f.pending.set(51000, { id: 51000, extra: { ownerUid: 'student-a' } })
  f.pending.set(43000, { id: 43000, extra: { ownerUid: 'student-a' } })
  assert.deepEqual(plain(f.api.getUpcomingExams()).map(row => row.name), ['日期待确认', '日期无效'])
  const result = await f.api.rescheduleExamReminders()
  assert.equal(result.count, 0); assert.match(result.message, /2 场考试时间待定/)
  assert.equal(f.calls.permissions, 0); assert.equal(f.calls.schedule.length, 0)
  assert.equal(f.pending.has(51000), false); assert.equal(f.pending.has(43000), true)
})

for (const style of ['normal', 'quiet', 'important']) {
  test(`real exam scheduling follows the saved ${style} exam style, owns its notices and opens the exam tab`, async () => {
    const f = fixture({ exams: [exam('合成考试', '2030-01-04 09:00-11:00'), exam('待确认考试', '2030-01-05')] })
    f.styles.setReminderStyle(style, 'exam')
    const result = await f.api.rescheduleExamReminders()
    assert.equal(result.count, 3); assert.match(result.message, /另有 1 场考试时间待定/)
    const notices = f.calls.schedule[0]
    assert.deepEqual(plain(notices.map(item => [item.schedule.at.getDate(), item.schedule.at.getHours(), item.schedule.at.getMinutes()])), [[3, 20, 0], [4, 7, 0], [4, 9, 0]])
    assert.deepEqual(plain(notices.map(item => item.id)), [51000, 51001, 51002])
    for (const notice of notices) {
      assert.equal(notice.channelId, `exam-remind-${style}-v3`)
      assert.equal(notice.actionTypeId, 'ohhu-exam-view-v1')
      assert.equal(notice.extra.type, 'exam'); assert.equal(notice.extra.ownerUid, 'student-a')
      assert.equal(notice.extra.reminderStyle, style); assert.equal(notice.extra.route, '/study?tab=exams')
      assert.equal(notice.extra.reminderAt, notice.schedule.at.toISOString())
    }
    assert.equal(f.calls.create[0].importance, style === 'quiet' ? 2 : style === 'normal' ? 3 : 4)
    assert.equal(f.calls.create[0].vibration, style !== 'quiet')
  })
}

test('changing class style keeps the untouched exam channel and changing exam style removes the previous exam plan', async () => {
  const f = fixture()
  f.styles.setReminderStyle('quiet', 'class')
  await f.api.rescheduleExamReminders()
  assert.equal(f.calls.schedule[0][0].channelId, 'exam-remind-v2')
  f.styles.setReminderStyle('normal', 'exam')
  await f.api.rescheduleExamReminders()
  assert.equal(f.calls.schedule[1][0].channelId, 'exam-remind-normal-v3')
  assert.equal(f.pending.size, 3)
  assert.equal(f.calls.cancel.length, 1)
})

test('a disabled exam channel or a failed channel/action bridge cannot report an arranged exam plan', async () => {
  const disabled = fixture()
  disabled.channels.set('exam-remind-v2', { id: 'exam-remind-v2', importance: 0 })
  const result = await disabled.api.rescheduleExamReminders()
  assert.equal(result.count, 0); assert.match(result.message, /考试通知渠道已关闭/)
  assert.equal(disabled.calls.schedule.length, 0); assert.equal(disabled.calls.create.length, 0)
  for (const flag of ['listError', 'actionsError']) {
    const f = fixture(); f.flags[flag] = new Error('synthetic bridge disconnected')
    const failure = await f.api.rescheduleExamReminders()
    assert.equal(failure.count, 0); assert.match(failure.message, /synthetic bridge disconnected/)
    assert.equal(f.calls.schedule.length, 0)
  }
})

test('an account revision during channel preparation cancels the old exam request even after A to B to A', async () => {
  const f = fixture(), wait = deferred()
  f.flags.createGate = wait
  const old = f.api.rescheduleExamReminders(); await flush()
  assert.equal(f.calls.create.length, 1)
  f.select('student-b'); f.select('student-a'); wait.resolve()
  assert.equal((await old).count, 0); assert.equal(f.calls.schedule.length, 0)
})

test('a late old exam schedule is revoked before the new account can replace the shared exam IDs', async () => {
  const f = fixture(), wait = deferred()
  f.flags.scheduleGate = wait
  const old = f.api.rescheduleExamReminders(); await flush()
  assert.equal(f.calls.schedule.length, 1)
  f.select('student-b'); f.flags.scheduleGate = null
  const newer = f.api.rescheduleExamReminders(); wait.resolve()
  assert.equal((await old).count, 0); assert.equal((await newer).count, 3)
  assert.equal(f.pending.size, 3)
  assert.equal([...f.pending.values()].every(notice => notice.extra.ownerUid === 'student-b'), true)
})

test('unconfirmed native exam scheduling returns failure through the shared scheduling check', async () => {
  const f = fixture(); f.flags.losePending = true
  const result = await f.api.rescheduleExamReminders()
  assert.equal(result.count, 0); assert.match(result.message, /部分提醒未能安排/)
  assert.equal(f.pending.size, 0)
})

test('selected evening time and lead hours determine the actual schedule and independent node IDs', async () => {
  const f = fixture()
  f.prefs.saveExamReminderPreferences({ ...f.prefs.getExamReminderPreferences(), eveningTime: '21:30', leadHours: 1.25, startEnabled: false })
  const result = await f.api.rescheduleExamReminders()
  assert.equal(result.count, 2)
  assert.deepEqual(plain(f.calls.schedule[0].map(notice => [notice.id, notice.schedule.at.getDate(), notice.schedule.at.getHours(), notice.schedule.at.getMinutes()])), [[51000, 3, 21, 30], [51001, 4, 7, 45]])
  const onlyStart = fixture()
  onlyStart.prefs.saveExamReminderPreferences({ ...onlyStart.prefs.getExamReminderPreferences(), eveningEnabled: false, leadEnabled: false })
  assert.equal((await onlyStart.api.rescheduleExamReminders()).count, 1)
  assert.deepEqual(plain(onlyStart.calls.schedule[0].map(notice => notice.id)), [51002])
})

test('disabling exams or every phase revokes the old exam plan without changing independent course notices', async () => {
  for (const selection of [{ enabled: false }, { eveningEnabled: false, leadEnabled: false, startEnabled: false }]) {
    const f = fixture()
    await f.api.rescheduleExamReminders()
    f.pending.set(43000, { id: 43000, extra: { ownerUid: 'student-a' } })
    f.prefs.saveExamReminderPreferences({ ...f.prefs.getExamReminderPreferences(), ...selection })
    const result = await f.api.rescheduleExamReminders()
    assert.equal(result.count, 0); assert.match(result.message, /关闭/)
    assert.deepEqual([...f.pending.keys()], [43000])
    assert.equal(f.calls.schedule.length, 1)
    assert.equal(f.api.getDueExamReminders().length, 0)
  }
})

test('in-app exam phases enter at their configured instant and expire at midnight, start or thirty minutes', () => {
  const f = fixture()
  for (const [day, hour, minute, second, phase] of [
    [3, 19, 59, 59, null], [3, 20, 0, 0, 'evening'], [3, 23, 59, 59, 'evening'], [4, 0, 0, 0, null],
    [4, 6, 59, 59, null], [4, 7, 0, 0, 'lead'], [4, 8, 59, 59, 'lead'], [4, 9, 0, 0, 'start'],
    [4, 9, 29, 59, 'start'], [4, 9, 30, 0, null],
  ]) {
    f.setTime(day, hour, minute, second)
    const due = f.api.getDueExamReminders()
    assert.equal(due.length, phase ? 1 : 0, `${day} ${hour}:${minute}:${second}`)
    if (phase) { assert.equal(due[0].kind, phase); assert.equal(due[0].exam.name, '合成考试') }
  }
})

test('overlapping exam nodes contribute only their newest phase and an expired newer phase never revives an old one', () => {
  const f = fixture({ exams: [exam('重叠考试', '2030-01-04 00:30')] })
  f.setTime(3, 22, 29, 59)
  assert.equal(f.api.getDueExamReminders()[0].kind, 'evening')
  f.setTime(3, 22, 30)
  let due = f.api.getDueExamReminders()
  assert.equal(due.length, 1); assert.equal(due[0].kind, 'lead')
  f.prefs.saveExamReminderPreferences({ ...f.prefs.getExamReminderPreferences(), eveningTime: '23:30', leadHours: 1.25 })
  f.setTime(3, 23, 31)
  due = f.api.getDueExamReminders()
  assert.equal(due.length, 1); assert.equal(due[0].kind, 'evening')
  f.setTime(4, 0)
  assert.equal(f.api.getDueExamReminders().length, 0)
  f.setTime(4, 0, 30)
  assert.equal(f.api.getDueExamReminders()[0].kind, 'start')
})

test('a 24-hour lead is available in-app and phase keys stay stable until the actual trigger policy changes', () => {
  const f = fixture()
  f.prefs.saveExamReminderPreferences({ ...f.prefs.getExamReminderPreferences(), leadHours: 24 })
  f.setTime(3, 9)
  const first = f.api.getDueExamReminders()[0]
  assert.equal(first.kind, 'lead'); assert.equal(first.at.getTime(), new Date(2030, 0, 3, 9).getTime())
  f.setTime(3, 9, 1)
  assert.equal(f.api.getDueExamReminders()[0].key, first.key)
  f.setTime(4, 8)
  f.prefs.saveExamReminderPreferences({ ...f.prefs.getExamReminderPreferences(), eveningEnabled: false, leadHours: 2 })
  const beforeChange = f.api.getDueExamReminders()[0]
  f.prefs.saveExamReminderPreferences({ ...f.prefs.getExamReminderPreferences(), leadHours: 1 })
  assert.notEqual(f.api.getDueExamReminders()[0].key, beforeChange.key)
  f.prefs.saveExamReminderPreferences({ ...f.prefs.getExamReminderPreferences(), leadEnabled: false })
  assert.equal(f.api.getDueExamReminders().length, 0)
})

test('due exam lists preserve the five-exam bound and never include an uncertain time', () => {
  const f = fixture({ exams: [exam('未知考试', '2030-01-04'), ...Array.from({ length: 6 }, (_, i) => exam(`合成考试 ${i}`, '2030-01-04 09:00'))] })
  f.setTime(4, 7)
  const due = f.api.getDueExamReminders()
  assert.equal(due.length, 5)
  assert.equal(due.every(item => item.kind === 'lead' && item.exam.name !== '未知考试'), true)
  assert.equal(new Set(due.map(item => item.key)).size, 5)
  f.prefs.saveExamReminderPreferences({ ...f.prefs.getExamReminderPreferences(), enabled: false })
  assert.equal(f.api.getDueExamReminders().length, 0)
})
