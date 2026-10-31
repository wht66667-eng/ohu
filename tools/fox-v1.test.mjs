import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const calendarSource = compile(fs.readFileSync(join(root, 'src/lib/fox-calendar.ts'), 'utf8'))
const summarySource = compile(fs.readFileSync(join(root, 'src/lib/fox-v1.ts'), 'utf8'))
const cacheKey = 'ohu.fox.verified-days.v1'
const noon = Date.parse('2026-10-27T04:00:00Z')
const plain = (value) => JSON.parse(JSON.stringify(value))
const dayBefore = (day, count) => new Date(Date.parse(`${day}T00:00:00Z`) - count * 86_400_000).toISOString().slice(0, 10)
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = () => new Promise((resolve) => setImmediate(resolve))

/** Every database response, clock, storage slot and identity is local to a test. */
function fixture({ uid = 'owner-a', now = noon, response = () => ({ data: [], error: null }) } = {}) {
  let currentUid = uid, revision = 1, clock = now, readsBlocked = false, writesBlocked = false
  const storage = new Map(), queries = [], writes = [], events = []
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])) }
    static now() { return clock }
  }
  const globals = {
    Date: Clock, Intl,
    localStorage: {
      getItem(key) { if (readsBlocked) throw new Error('storage denied'); return storage.get(key) ?? null },
      setItem(key, value) { if (writesBlocked) throw new Error('quota'); writes.push({ key, value }); storage.set(key, value) },
    },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail } },
    window: { dispatchEvent(event) { events.push(event); return true } },
  }
  const calendar = { exports: {} }
  vm.runInNewContext(calendarSource, { ...globals, module: calendar, exports: calendar.exports })
  const module = { exports: {} }
  vm.runInNewContext(summarySource, {
    ...globals, module, exports: module.exports,
    require(name) {
      if (name === './fox-calendar') return calendar.exports
      if (name === './qbank') return {
        captureQbankSession: () => ({ uid: currentUid, revision }),
        isQbankSessionCurrent: (session) => session.uid === currentUid && session.revision === revision,
      }
      assert.equal(name, './cb', 'no other application module or real connector is available')
      return { cbRdb: () => ({ from(table) {
        const query = { table, selected: null, filters: [], limit: null }
        const builder = {
          select(columns) { query.selected = columns; return builder },
          eq(column, value) { query.filters.push([column, value]); return builder },
          limit(count) { query.limit = count; queries.push(plain(query)); return response(query, queries.length - 1) },
        }
        return builder
      } }) }
    },
  })
  return {
    api: module.exports, calendar: calendar.exports, storage, queries, writes, events,
    seed(value) { storage.set(cacheKey, JSON.stringify(value)) },
    cached() { return JSON.parse(storage.get(cacheKey) || '{}') },
    setTime(value) { clock = value },
    setSession(value) { if (currentUid !== value) { currentUid = value; revision++ } },
    blockReads() { readsBlocked = true }, blockWrites() { writesBlocked = true },
  }
}

test('Shanghai natural days change at local midnight, including year and leap-day boundaries', () => {
  const { calendar } = fixture()
  for (const [instant, expected] of [
    ['2026-10-27T15:59:59.999Z', '2026-10-27'], ['2026-10-27T16:00:00.000Z', '2026-10-28'],
    ['2026-12-31T15:59:59.999Z', '2026-12-31'], ['2026-12-31T16:00:00.000Z', '2027-01-01'],
    ['2024-02-28T16:00:00.000Z', '2024-02-29'], ['2024-02-29T16:00:00.000Z', '2024-03-01'],
  ]) assert.equal(calendar.foxLocalDay(Date.parse(instant)), expected)
  assert.equal(calendar.foxLocalDay(Date.parse('2026-10-27T16:00:00Z'), 'UTC'), '2026-10-27')
})

test('a few milliseconds across Shanghai midnight count as one missed natural day', () => {
  const { api } = fixture()
  const before = api.deriveFoxV1Summary('owner-a', ['2026-10-27'], Date.parse('2026-10-27T15:59:59.999Z'))
  const after = api.deriveFoxV1Summary('owner-a', ['2026-10-27'], Date.parse('2026-10-27T16:00:00.001Z'))
  assert.equal(before.isActiveToday, true)
  assert.equal(before.currentStreakDays, 1)
  assert.equal(after.isActiveToday, false)
  assert.equal(after.currentStreakDays, 0)
  assert.equal(after.missedDays, 1)
  assert.equal(after.moodId, 'miss_day_01')
})

test('unique valid dates are counted once; invalid calendar dates and future days do not count', () => {
  const { api } = fixture()
  const result = api.deriveFoxV1Summary('owner-a', [
    '2026-10-26', '2026-10-27', '2026-10-26', '2026-10-27', '2026-10-28', '2027-01-01',
    '2026-02-29', '2026-04-31', '2026-13-01', '2026-10-00', '2026-1-01', ' 2026-10-27',
    '2026-10-27T00:00:00Z', '', null, undefined, 20261027, {},
  ], noon)
  assert.equal(result.totalLoginDays, 2)
  assert.equal(result.currentStreakDays, 2)
  assert.equal(result.lastActiveDate, '2026-10-27')
  assert.equal(result.missedDays, 0)
  const noHistory = api.deriveFoxV1Summary('owner-a', ['2026-10-28', 'broken'], noon)
  assert.equal(noHistory.hasHistory, false)
  assert.equal(noHistory.totalLoginDays, 0)
  assert.equal(noHistory.lastActiveDate, null)
})

test('current streak stops at the first missing date and requires a real checkin today', () => {
  const { api } = fixture()
  const today = api.deriveFoxV1Summary('owner-a', ['2026-10-20', '2026-10-23', '2026-10-25', '2026-10-26', '2026-10-27'], noon)
  assert.equal(today.totalLoginDays, 5)
  assert.equal(today.currentStreakDays, 3)
  assert.equal(today.moodId, 'login_day_03')
  const absent = api.deriveFoxV1Summary('owner-a', ['2026-10-24', '2026-10-25', '2026-10-26'], noon)
  assert.equal(absent.currentStreakDays, 0)
  assert.equal(absent.totalLoginDays, 3)
  assert.equal(absent.moodId, 'miss_day_01')
})

test('login mood thresholds use real consecutive days at 1, 3, 7 and 30', () => {
  const { api } = fixture()
  for (const [count, stage] of [[1, '01'], [2, '01'], [3, '03'], [6, '03'], [7, '07'], [29, '07'], [30, '30'], [45, '30']]) {
    const result = api.deriveFoxV1Summary('owner-a', Array.from({ length: count }, (_, index) => dayBefore('2026-10-27', index)), noon)
    assert.equal(result.currentStreakDays, count)
    assert.equal(result.totalLoginDays, count)
    assert.equal(result.moodId, `login_day_${stage}`, `${count} consecutive days`)
  }
})

test('missed-day thresholds cover 1, 2, 3, 7, 15 and 30 without rounding by elapsed hours', () => {
  const { api } = fixture()
  for (const [count, stage] of [[1, '01'], [2, '02'], [3, '03'], [6, '03'], [7, '07'], [14, '07'], [15, '15'], [29, '15'], [30, '30'], [60, '30']]) {
    const result = api.deriveFoxV1Summary('owner-a', [dayBefore('2026-10-27', count)], noon)
    assert.equal(result.missedDays, count)
    assert.equal(result.currentStreakDays, 0)
    assert.equal(result.moodId, `miss_day_${stage}`, `${count} natural days away`)
  }
})

test('the guest default ignores private mirrors and makes no database read or write', async () => {
  const run = fixture({ uid: '' })
  run.seed({ 'owner-a': { dates: ['2026-10-26', '2026-10-27'], verifiedAt: noon } })
  const direct = run.api.deriveFoxV1Summary('', ['2026-10-26', '2026-10-27'], noon)
  const local = run.api.getFoxV1Summary()
  const refreshed = await run.api.refreshFoxV1Summary()
  for (const result of [direct, local, refreshed]) {
    assert.equal(result.userId, '')
    assert.equal(result.hasHistory, false)
    assert.equal(result.totalLoginDays, 0)
    assert.equal(result.currentStreakDays, 0)
    assert.equal(result.lastActiveDate, null)
  }
  assert.equal(run.queries.length, 0)
  assert.equal(run.writes.length, 0)
  assert.equal(run.events.length, 0)
})

test('cache reads stay within the active UID and expire at Shanghai midnight', () => {
  const run = fixture({ now: Date.parse('2026-10-27T15:59:59Z') })
  run.seed({
    'owner-a': { dates: ['2026-10-26', '2026-10-27'], verifiedAt: noon },
    'owner-b': { dates: ['2026-10-27'], verifiedAt: noon },
  })
  assert.equal(run.api.getFoxV1Summary().totalLoginDays, 2)
  assert.equal(run.api.getFoxV1Summary().pendingSync, false)
  run.setSession('owner-b')
  assert.equal(run.api.getFoxV1Summary().totalLoginDays, 1)
  run.setSession('uncached-owner')
  assert.equal(run.api.getFoxV1Summary().hasHistory, false)
  assert.equal(run.api.getFoxV1Summary().pendingSync, true)
  run.setSession('owner-a')
  run.setTime(Date.parse('2026-10-27T16:00:00Z'))
  const stale = run.api.getFoxV1Summary()
  assert.equal(stale.localDate, '2026-10-28')
  assert.equal(stale.totalLoginDays, 2)
  assert.equal(stale.isActiveToday, false)
  assert.equal(stale.pendingSync, true)
  assert.equal(stale.missedDays, 1)
})

test('broken or inaccessible cache never creates a history or a successful sync', () => {
  for (const raw of ['{', 'null', JSON.stringify({ 'owner-a': { dates: 'wrong', verifiedAt: noon } }), JSON.stringify({ 'owner-a': { dates: ['2026-10-27'], verifiedAt: 'today' } })]) {
    const run = fixture()
    run.storage.set(cacheKey, raw)
    assert.equal(run.api.getFoxV1Summary().hasHistory, false)
    assert.equal(run.api.getFoxV1Summary().pendingSync, true)
  }
  const denied = fixture()
  denied.blockReads()
  assert.equal(denied.api.getFoxV1Summary().hasHistory, false)
  assert.equal(denied.api.getFoxV1Summary().pendingSync, true)
})

test('refresh reads only the active UID user-shell checkin dates, then announces verified data', async () => {
  const run = fixture({ response: () => ({ data: [{ date: '2026-10-27' }, { date: '2026-10-26' }, { date: '2026-10-27' }, { date: 'bad' }, { date: '2026-02-29' }, { date: '2026-10-28' }], error: null }) })
  run.seed({ 'owner-b': { dates: ['2026-10-01'], verifiedAt: noon } })
  const result = await run.api.refreshFoxV1Summary()
  assert.deepEqual(run.queries, [{ table: 'checkins', selected: 'date', filters: [['uid', 'owner-a'], ['shell', 'user']], limit: 10000 }])
  assert.equal(result.totalLoginDays, 2)
  assert.equal(result.currentStreakDays, 2)
  assert.equal(result.pendingSync, false)
  assert.equal(run.cached()['owner-b'].dates[0], '2026-10-01')
  assert.equal(run.writes.length, 1)
  assert.equal(run.events.length, 1)
  assert.equal(run.events[0].type, run.api.FOX_V1_EVENT)
  assert.deepEqual(plain(run.events[0].detail), plain(result))
  assert.equal(run.api.getFoxV1Summary().totalLoginDays, 2)
})

test('a verified empty result stays empty and does not invent a first login day', async () => {
  const run = fixture()
  const result = await run.api.refreshFoxV1Summary()
  assert.equal(result.pendingSync, false)
  assert.equal(result.hasHistory, false)
  assert.equal(result.totalLoginDays, 0)
  assert.equal(result.currentStreakDays, 0)
})

test('network, permission, malformed and truncated responses stay pending and preserve verified history', async () => {
  for (const response of [
    () => Promise.reject(new Error('offline')),
    () => ({ data: [{ date: '2026-10-27' }], error: { message: 'permission denied' } }),
    () => ({ data: null, error: null }),
    () => ({ data: { date: '2026-10-27' }, error: null }),
    () => ({ data: Array.from({ length: 10000 }, () => ({ date: '2026-10-27' })), error: null }),
  ]) {
    const run = fixture({ response })
    run.seed({ 'owner-a': { dates: ['2026-10-26'], verifiedAt: noon } })
    const result = await run.api.refreshFoxV1Summary()
    assert.equal(result.pendingSync, true)
    assert.equal(result.totalLoginDays, 1)
    assert.equal(result.isActiveToday, false)
    assert.equal(run.writes.length, 0)
    assert.equal(run.cached()['owner-a'].dates[0], '2026-10-26')
    assert.equal(run.events.length, 1)
    assert.equal(run.events[0].detail.pendingSync, true)
  }
})

test('storage failure after a real read stays pending and does not publish unsaved new counts', async () => {
  const run = fixture({ response: () => ({ data: [{ date: '2026-10-27' }, { date: '2026-10-26' }], error: null }) })
  run.seed({ 'owner-a': { dates: ['2026-10-26'], verifiedAt: noon } })
  run.blockWrites()
  const result = await run.api.refreshFoxV1Summary()
  assert.equal(result.pendingSync, true)
  assert.equal(result.totalLoginDays, 1)
  assert.equal(result.isActiveToday, false)
  assert.equal(run.writes.length, 0)
})

test('concurrent refreshes for one session share a read and a completed read can be retried', async () => {
  const wait = deferred()
  const run = fixture({ response: () => wait.promise })
  const first = run.api.refreshFoxV1Summary(), second = run.api.refreshFoxV1Summary()
  assert.equal(first, second)
  await flush()
  assert.equal(run.queries.length, 1)
  wait.resolve({ data: [{ date: '2026-10-27' }], error: null })
  await first
  const third = run.api.refreshFoxV1Summary()
  assert.notEqual(third, first)
  await third
  assert.equal(run.queries.length, 2)
})

test('a late success from A cannot write or announce after A -> B -> A', async () => {
  const wait = deferred()
  const run = fixture({ response: () => wait.promise })
  run.seed({ 'owner-a': { dates: ['2026-10-25'], verifiedAt: noon } })
  const pending = run.api.refreshFoxV1Summary()
  await flush()
  run.setSession('owner-b'); run.setSession('owner-a')
  wait.resolve({ data: [{ date: '2026-10-27' }, { date: '2026-10-26' }], error: null })
  const result = await pending
  assert.equal(result.totalLoginDays, 1)
  assert.equal(result.lastActiveDate, '2026-10-25')
  assert.equal(run.writes.length, 0)
  assert.equal(run.events.length, 0)
})

test('a late success from A returns only B’s current summary after switching owners', async () => {
  const wait = deferred()
  const run = fixture({ response: () => wait.promise })
  run.seed({ 'owner-b': { dates: ['2026-10-27'], verifiedAt: noon } })
  const pending = run.api.refreshFoxV1Summary()
  await flush()
  run.setSession('owner-b')
  wait.resolve({ data: [{ date: '2026-10-25' }, { date: '2026-10-26' }], error: null })
  const result = await pending
  assert.equal(result.userId, 'owner-b')
  assert.equal(result.totalLoginDays, 1)
  assert.equal(result.lastActiveDate, '2026-10-27')
  assert.equal(run.writes.length, 0)
  assert.equal(run.events.length, 0)
})

test('a late rejection from a signed account cannot return private dates to a guest', async () => {
  const wait = deferred()
  const run = fixture({ response: () => wait.promise })
  run.seed({ 'owner-a': { dates: ['2026-10-25', '2026-10-26'], verifiedAt: noon } })
  const pending = run.api.refreshFoxV1Summary()
  await flush()
  run.setSession('')
  wait.reject(new Error('late network failure'))
  const result = await pending
  assert.equal(result.userId, '')
  assert.equal(result.hasHistory, false)
  assert.equal(result.totalLoginDays, 0)
  assert.equal(result.lastActiveDate, null)
  assert.equal(run.writes.length, 0)
  assert.equal(run.events.length, 0)
})

test('an old request settling cannot clear the newer session’s in-flight read', async () => {
  const a = deferred(), b = deferred()
  const run = fixture({ response: (_, index) => index === 0 ? a.promise : b.promise })
  const first = run.api.refreshFoxV1Summary()
  await flush()
  run.setSession('owner-b')
  const second = run.api.refreshFoxV1Summary()
  await flush()
  assert.equal(run.queries.length, 2)
  a.resolve({ data: [], error: null }); await first
  assert.equal(run.api.refreshFoxV1Summary(), second)
  b.resolve({ data: [{ date: '2026-10-27' }], error: null }); await second
  assert.equal(run.events.length, 1)
  assert.equal(run.events[0].detail.userId, 'owner-b')
})

test('the startup consumer shows only confirmed counts and does not restart a chosen layout', () => {
  const run = fixture()
  let summary = run.api.deriveFoxV1Summary('', [], noon)
  const elements = new Map()
  const splash = { dataset: {} }
  const element = (id) => {
    if (id === 'boot-splash') return splash
    if (!elements.has(id)) elements.set(id, { textContent: '', src: '', getAttribute() { return this.src } })
    return elements.get(id)
  }
  const assets = { FOX_V1_STICKERS: [{ id: 'login_day_01' }, { id: 'login_day_03' }, { id: 'random_study' }, { id: 'random_chaos' }], foxV1StickerUrl: (id) => `/${id}.png` }
  const module = { exports: {} }
  const source = fs.readFileSync(join(root, 'src/lib/startup-cover.ts'), 'utf8').replaceAll('import.meta.env.DEV', 'true')
  vm.runInNewContext(compile(source), {
    module, exports: module.exports, URLSearchParams,
    require: (name) => name === './fox-v1-assets' ? assets : { getFoxV1Summary: () => summary },
    window: { location: { search: '?preview=boot&startup=achievement' } }, document: { getElementById: element },
  })
  module.exports.updateStartupCover()
  assert.equal(element('boot-total-days').textContent, '—')
  assert.equal(element('boot-streak-days').textContent, '—')
  assert.equal(splash.dataset.layout, 'achievement')
  summary = run.api.deriveFoxV1Summary('owner-a', ['2026-10-25', '2026-10-26', '2026-10-27'], noon, true)
  module.exports.updateStartupCover()
  assert.equal(element('boot-total-days').textContent, '—', 'stale or unconfirmed mirrors do not claim a count')
  summary = { ...summary, pendingSync: false }
  module.exports.updateStartupCover()
  assert.equal(element('boot-total-days').textContent, '3')
  assert.equal(element('boot-streak-days').textContent, '3')
  assert.equal(splash.dataset.layout, 'achievement')
  summary = run.api.deriveFoxV1Summary('', [], noon)
  module.exports.updateStartupCover()
  assert.equal(element('boot-total-days').textContent, '—', 'sign-out removes the former account’s visible count')
})
