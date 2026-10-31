/** Exercise real course preference persistence, horizon building and in-app phase selection. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const code = ts.transpileModule(fs.readFileSync(new URL('../src/lib/class-remind.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const plain = value => JSON.parse(JSON.stringify(value))
const expiryModule = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/course-reminder-expiry.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: expiryModule, exports: expiryModule.exports })

function fixture() {
  let now = new Date(2030, 0, 2, 8, 0).getTime()
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now])) } static now() { return now } }
  const storage = new Map(), events = [], flags = { storageError: null, uid: 'student-a' }
  const next = { status: 'soon', name: '合成课程', room: '测试教室', timeLabel: '09:00', hint: '10 分钟后' }
  const rows = [{}]
  const dependencies = {
    './schedule-cache': {
      loadScheduleCache: () => ({ rows }),
      classesOnDate: () => { const clock = next.timeLabel.match(/^(\d{2}):(\d{2})/); const startMin = clock ? Number(clock[1]) * 60 + Number(clock[2]) : NaN; return [{ name: next.name, room: next.room, teacher: '合成教师', timeLabel: next.timeLabel, startMin, endMin: next.endMin ?? startMin + 95 }] },
      getNextClass: () => next,
    },
    './qbank': { captureQbankSession: () => ({ uid: flags.uid, revision: 1 }) },
    './reminder-presentation': {}, './personal-reminders': {}, './reminder-overlay': {}, './reminder-plan': {}, './alarm-notify': {},
    './course-reminder-expiry': expiryModule.exports,
  }
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports, Date: FixedDate, Event,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { if (flags.storageError) throw flags.storageError; storage.set(key, value) } },
    window: { dispatchEvent: event => events.push(event.type) },
    require: name => { if (Object.hasOwn(dependencies, name)) return dependencies[name]; throw new Error(`Unexpected dependency ${name}`) },
  })
  const api = module.exports
  return { api, storage, events, flags, next, rows,
    build(days = 1) { return api.buildHorizonReminders(rows, api.getRemindMinutes(), days) },
    setTime(hour, minute, second = 0) { now = new Date(2030, 0, 2, hour, minute, second).getTime() },
  }
}

test('legacy preferences retain a 15-minute lead and both course phases for the week and semester', () => {
  const f = fixture()
  assert.equal(f.api.getRemindMinutes(), 15)
  assert.equal(f.api.isClassSoonRemindEnabled(), true); assert.equal(f.api.isClassStartRemindEnabled(), true)
  const notices = f.build()
  assert.deepEqual(plain(notices.map(item => [item.kind, item.id, item.at.getHours(), item.at.getMinutes()])), [['class-soon', 43000, 8, 45], ['class-start', 43001, 9, 0]])
  assert.equal(f.build(7).length, 14); assert.equal(f.build(210).length, 420)
  assert.equal(f.events.length, 0)
})

test('lead minutes stay within 5 to 60 and every successful save publishes the preference event', () => {
  const f = fixture()
  for (const [input, expected] of [[30, 30], [-10, 5], [100, 60], [10.9, 10]]) {
    f.api.setRemindMinutes(input)
    assert.equal(f.api.getRemindMinutes(), expected)
    assert.equal(f.storage.get('schedule.remind.minutes'), String(expected))
  }
  assert.deepEqual(f.events, Array(4).fill(f.api.CLASS_REMIND_PREF_EVENT))
  f.api.setRemindMinutes(10)
  assert.equal(f.build()[0].at.getMinutes(), 50)
  f.storage.set('schedule.remind.minutes', 'invalid')
  assert.equal(f.api.getRemindMinutes(), 15)
})

test('invalid lead values and rejected storage writes preserve prior preferences without publishing an event', () => {
  const f = fixture()
  f.api.setRemindMinutes(20)
  for (const invalid of [NaN, Infinity, -Infinity, undefined, '15']) {
    assert.throws(() => f.api.setRemindMinutes(invalid), /分钟数无效/)
    assert.equal(f.api.getRemindMinutes(), 20)
    assert.equal(f.events.length, 1)
  }
  f.flags.storageError = new Error('synthetic full storage')
  for (const operation of [() => f.api.setRemindMinutes(5), () => f.api.setClassSoonRemindEnabled(false), () => f.api.setClassStartRemindEnabled(false)]) {
    assert.throws(operation, /synthetic full storage/)
    assert.equal(f.events.length, 1)
  }
  assert.equal(f.api.getRemindMinutes(), 20)
  assert.equal(f.api.isClassSoonRemindEnabled(), true); assert.equal(f.api.isClassStartRemindEnabled(), true)
})

test('disabling the start phase keeps only lead notices for both horizons and preserves the saved lead', () => {
  const f = fixture()
  f.api.setClassStartRemindEnabled(false)
  assert.equal(f.storage.get('schedule.remind.start.enabled'), '0')
  assert.equal(f.api.isClassStartRemindEnabled(), false)
  assert.equal(f.api.getRemindMinutes(), 15)
  for (const days of [7, 210]) {
    const notices = f.build(days)
    assert.equal(notices.length, days)
    assert.equal(notices.every(item => item.kind === 'class-soon' && item.id % 2 === 0), true)
  }
  assert.deepEqual(f.events, [f.api.CLASS_REMIND_PREF_EVENT])
})

test('disabling the lead phase supports start-only schedules and disabling both produces no course notices', () => {
  const f = fixture()
  f.api.setClassSoonRemindEnabled(false)
  assert.equal(f.storage.get('schedule.remind.soon.enabled'), '0')
  for (const days of [7, 210]) {
    const notices = f.build(days)
    assert.equal(notices.length, days)
    assert.equal(notices.every(item => item.kind === 'class-start' && item.id % 2 === 1), true)
  }
  f.api.setClassStartRemindEnabled(false)
  assert.equal(f.build(210).length, 0)
  f.api.setClassSoonRemindEnabled(true); f.api.setClassStartRemindEnabled(true)
  assert.equal(f.build().length, 2)
  assert.deepEqual(f.events, Array(4).fill(f.api.CLASS_REMIND_PREF_EVENT))
})

test('in-app reminders honor both phase switches and do not consume a disabled phase before it is enabled', () => {
  const f = fixture()
  f.next.timeLabel = '08:10'
  f.setTime(8, 10)
  f.api.setClassStartRemindEnabled(false); f.next.status = 'now'
  assert.equal(f.api.checkInAppClassPopup(), null)
  assert.equal([...f.storage.keys()].some(key => key.startsWith('schedule.remind.lastPop')), false)
  f.api.setClassStartRemindEnabled(true)
  assert.equal(f.api.checkInAppClassPopup().status, 'now')
  assert.equal(f.api.checkInAppClassPopup(), null)
  f.setTime(7, 55)
  f.next.status = 'soon'; f.api.setClassSoonRemindEnabled(false)
  assert.equal(f.api.checkInAppClassPopup(), null)
  f.api.setClassSoonRemindEnabled(true)
  assert.equal(f.api.checkInAppClassPopup().status, 'soon')
})

test('the lead window, master switch, guest guard and account-specific popup deduplication stay active', () => {
  const f = fixture()
  f.next.timeLabel = '08:15'
  f.api.setRemindMinutes(5)
  assert.equal(f.api.checkInAppClassPopup(), null)
  f.api.setRemindMinutes(15)
  assert.equal(f.api.checkInAppClassPopup().name, '合成课程')
  assert.equal(f.api.checkInAppClassPopup(), null)
  f.flags.uid = 'student-b'
  assert.equal(f.api.checkInAppClassPopup().name, '合成课程')
  f.flags.uid = ''; f.next.status = 'now'
  assert.equal(f.api.checkInAppClassPopup(), null)
  f.flags.uid = 'student-b'; f.api.setClassRemindEnabled(false)
  assert.equal(f.api.checkInAppClassPopup(), null)
})

test('the 60-minute boundary uses the actual start clock rather than the rounded hour hint', () => {
  const exactly = fixture()
  exactly.api.setRemindMinutes(60)
  exactly.next.timeLabel = '09:00–10:35'; exactly.next.hint = '1 小时后开始'
  assert.equal(exactly.api.checkInAppClassPopup().status, 'soon')
  const early = fixture()
  early.api.setRemindMinutes(60)
  early.next.timeLabel = '09:01–10:35'; early.next.hint = '1 小时后开始'
  assert.equal(early.api.checkInAppClassPopup(), null)
  early.next.timeLabel = '09:00–10:35'
  assert.equal(early.api.checkInAppClassPopup().status, 'soon')
})

test('arbitrary lead windows use exact remaining seconds and never infer a start from a rounded hint', () => {
  const f = fixture()
  f.api.setRemindMinutes(59)
  f.next.timeLabel = '09:00–10:35'; f.next.hint = '59 分钟后开始'
  f.setTime(8, 0, 59)
  assert.equal(f.api.checkInAppClassPopup(), null)
  f.setTime(8, 1)
  assert.equal(f.api.checkInAppClassPopup().status, 'soon')
  const invalid = fixture()
  invalid.api.setRemindMinutes(60); invalid.next.timeLabel = '时间待定'; invalid.next.hint = '1 小时后开始'
  assert.equal(invalid.api.checkInAppClassPopup(), null)
})

test('restoring at 08:59:50 retains the 09:00 start instead of dropping the last fifteen seconds', () => {
  const f = fixture()
  f.setTime(8, 59, 50)
  const notices = f.build()
  assert.equal(notices.length, 1)
  assert.equal(notices[0].kind, 'class-start')
  assert.equal(notices[0].at.getHours(), 9)
  assert.equal(notices[0].at.getMinutes(), 0)
  f.setTime(9, 0)
  assert.equal(f.build().length, 0, 'already due events are not replayed by a fresh plan')
  f.setTime(9, 0, 10)
  assert.equal(f.build().length, 0)
})

test('a lead reminder ten seconds away survives, while already past lead events never return', () => {
  const f = fixture()
  f.setTime(8, 44, 50)
  assert.deepEqual(plain(f.build().map(notice => notice.kind)), ['class-soon', 'class-start'])
  f.setTime(8, 45)
  assert.deepEqual(plain(f.build().map(notice => notice.kind)), ['class-start'])
})

test('a bounded bridge delay moves only this plan’s future events to a safe native time', () => {
  const f = fixture(), plannedAt = new Date(2030, 0, 2, 8, 59, 50).getTime()
  f.setTime(8, 59, 50)
  const items = f.build()
  const justAfter = plannedAt + 20_000
  const notices = f.api.normalizeClassReminderTimes(items, plannedAt, justAfter)
  assert.equal(notices.length, 1)
  assert.equal(notices[0].at.getTime(), justAfter + 1_000)
  assert.equal(notices[0].reminderAt.getTime(), plannedAt + 10_000, 'the safety shift cannot reset the original event lifetime')
  assert.equal(items[0].at.getTime(), plannedAt + 10_000, 'original plan remains unchanged')
  assert.equal(f.api.normalizeClassReminderTimes(items, plannedAt, plannedAt + 70_001).length, 0, 'permission dialogs cannot cause unbounded old-course alerts')
  const alreadyPast = { ...items[0], at: new Date(plannedAt - 1) }
  assert.equal(f.api.normalizeClassReminderTimes([alreadyPast], plannedAt, plannedAt + 100).length, 0)
})

test('system alarm-clock preference defaults on, is independently reversible and respects failed writes', () => {
  const f = fixture()
  assert.equal(f.api.isClassAlarmClockEnabled(), true); assert.equal(f.storage.size, 0)
  f.api.setClassAlarmClockEnabled(false)
  assert.equal(f.api.isClassAlarmClockEnabled(), false); assert.equal(f.api.isClassSoonRemindEnabled(), true); assert.equal(f.api.isClassStartRemindEnabled(), true)
  assert.deepEqual(f.events, [f.api.CLASS_REMIND_PREF_EVENT])
  f.flags.storageError = new Error('storage full')
  assert.throws(() => f.api.setClassAlarmClockEnabled(true), /storage full/)
  assert.equal(f.api.isClassAlarmClockEnabled(), false); assert.equal(f.events.length, 1)
})

test('both course phases expire one minute after due time, or at an earlier class boundary', () => {
  const f=fixture();f.next.endMin=550
  const notices=f.build()
  assert.equal(notices.length,2)
  for(const item of notices){assert.equal(item.classStartAt.getHours(),9);assert.equal(item.classEndAt.getHours(),9);assert.equal(item.classEndAt.getMinutes(),10)}
  const start=new Date(2030,0,2,9).getTime(),end=start+10*60_000
  const soon={name:'短课',room:'',timeLabel:'09:00–09:10',hint:'',status:'soon',classStartAt:start,classEndAt:end,reminderAt:start-30_000}
  assert.equal(f.api.classReminderExpiresAt(soon,start-1),start)
  assert.equal(f.api.isClassReminderTipCurrent(soon,start-1),true)
  assert.equal(f.api.isClassReminderTipCurrent(soon,start),false,'a lead reminder cannot arrive at or after class starts')
  const current={...soon,status:'now',reminderAt:start}
  assert.equal(f.api.classReminderExpiresAt(current,start),start+60_000)
  assert.equal(f.api.isClassReminderTipCurrent(current,start+59_999),true)
  assert.equal(f.api.isClassReminderTipCurrent(current,start+60_000),false,'one-minute boundary is expired')
  assert.equal(f.api.classReminderExpiresAt({...current,classEndAt:start+30_000},start),start+30_000)
  assert.equal(f.api.classReminderExpiresAt({...current,classEndAt:start+90*60_000},start),start+60_000)
  assert.equal(f.api.isClassReminderTipCurrent({...current,classEndAt:NaN},start),false)
})

test('normalization cannot move a lead reminder beyond class start and legacy records remain bounded', () => {
  const f=fixture(),start=new Date(2030,0,2,9).getTime(),planned=start-10_000
  const item={kind:'class-soon',id:43000,title:'课前',body:'',at:new Date(start-2000),classStartAt:new Date(start),classEndAt:new Date(start+600_000)}
  assert.equal(f.api.normalizeClassReminderTimes([item],planned,start-500).length,0)
  const legacy={...item,kind:'class-start',classStartAt:undefined,classEndAt:undefined}
  assert.equal(f.api.normalizeClassReminderTimes([legacy],planned,start+1000).length,1)
  assert.equal(expiryModule.exports.courseReminderExpiry('class-start',start),start+60_000)
  assert.equal(expiryModule.exports.courseReminderExpiry('class-start',start,start,start-1),NaN)
})

test('a still-running course expires at one minute and never consumes a new popup after that', () => {
  const f = fixture(); f.next.status = 'now'; f.next.timeLabel = '09:00–10:40'
  f.setTime(9, 0, 59)
  assert.equal(f.api.checkInAppClassPopup().status, 'now')
  f.flags.uid = 'another-student'; f.setTime(9, 1)
  assert.equal(f.api.checkInAppClassPopup(), null)
  f.setTime(9, 59)
  assert.equal(f.api.checkInAppClassPopup(), null)
  assert.equal(f.storage.has('schedule.remind.lastPop:uid:another-student'), false)
})

test('a long lead popup expires one minute after its own original due time', () => {
  const f = fixture(); f.api.setRemindMinutes(60); f.next.timeLabel = '09:00–10:40'
  f.setTime(8, 0, 59); assert.equal(f.api.checkInAppClassPopup().status, 'soon')
  f.flags.uid = 'another-student'; f.setTime(8, 1)
  assert.equal(f.api.checkInAppClassPopup(), null)
  assert.equal(f.api.classReminderExpiresAt({ ...f.next, status: 'soon' }), new Date(2030, 0, 2, 8, 1).getTime())
})

test('an expired immediate course notification is refused before any native scheduling or sound effect', async () => {
  const f = fixture(); f.next.status = 'now'; f.next.timeLabel = '09:00–10:40'; f.setTime(9, 30)
  const result = await f.api.notifyClassNow({ ...f.next })
  assert.equal(result.count, 0); assert.match(result.message, /已过期/)
})
