import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

// Actual scheduler, synthetic account identities, and an in-memory bridge only.
const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const compiled = ts.transpileModule(fs.readFileSync(new URL('../src/lib/personal-reminders.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const plain = value => JSON.parse(JSON.stringify(value))
const notice = (id, ownerUid = 'synthetic-a') => ({ id, title: 'Synthetic reminder', body: 'In-memory test only', extra: { ownerUid } })
const unrelated = [40999, 41000, 49999, 52000, 52999, 60000, 60079, 30001, 60080, 70000, 70011]

function fixture() {
  let session = { uid: 'synthetic-a', revision: 1 }
  const listeners = new Set(), pending = new Map(), delivered = new Map()
  const calls = { schedule: [], cancel: [], remove: [], events: [] }
  const plugin = {
    getPending: async () => ({ notifications: [...pending.values()] }),
    getDeliveredNotifications: async () => ({ notifications: [...delivered.values()] }),
    schedule: async ({ notifications }) => { calls.schedule.push(notifications); notifications.forEach(row => pending.set(row.id, row)) },
    cancel: async ({ notifications }) => { calls.cancel.push(notifications.map(row => row.id)); notifications.forEach(({ id }) => pending.delete(id)) },
    removeDeliveredNotifications: async ({ notifications }) => { calls.remove.push(notifications.map(row => row.id)); notifications.forEach(({ id }) => delivered.delete(id)) },
  }
  const module = { exports: {} }
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Date, console,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail } },
    window: { addEventListener() {}, dispatchEvent: event => calls.events.push(event) },
    require(name) {
      if (name === './platform') return { IS_NATIVE: true }
      if (name === './qbank') return { captureQbankSession: () => session, isQbankSessionCurrent: capture => capture.uid === session.uid && capture.revision === session.revision, subscribeQbank: listener => { listeners.add(listener); return () => listeners.delete(listener) } }
      if (name === '@capacitor/local-notifications') return { LocalNotifications: plugin }
      throw new Error(`Unexpected import: ${name}`)
    },
  })
  function seedOtherCategories() { unrelated.forEach(id => { pending.set(id, notice(id)); delivered.set(id, notice(id)) }) }
  const run = (ids = [51000, 51001]) => module.exports.runPersonalReminder('exam', async ({ schedule, session }) => {
    const applied = await schedule({ notifications: ids.map(id => notice(id, session.uid)) })
    return { count: applied ? ids.length : 0, message: applied ? 'confirmed' : 'cancelled' }
  })
  return { api: module.exports, plugin, pending, delivered, calls, run, seedOtherCategories, select(uid) { session = { uid, revision: session.revision + 1 }; listeners.forEach(listener => listener()) } }
}
function assertOtherCategoriesUntouched(f) {
  assert.deepEqual([...f.pending.keys()].filter(id => unrelated.includes(id)), unrelated)
  assert.deepEqual([...f.delivered.keys()].filter(id => unrelated.includes(id)), unrelated)
  assert.equal(f.calls.cancel.flat().some(id => unrelated.includes(id)), false)
  assert.equal(f.calls.remove.flat().some(id => unrelated.includes(id)), false)
}

test('a bridge that partially writes pending and delivered alarms before rejecting rolls back only its category and preserves the original error', async () => {
  const f = fixture(), original = new Error('synthetic schedule rejection')
  f.seedOtherCategories(); f.pending.set(51999, notice(51999)); f.delivered.set(51999, notice(51999))
  f.plugin.schedule = async ({ notifications }) => {
    f.pending.set(notifications[0].id, notifications[0]); f.delivered.set(notifications[1].id, notifications[1])
    throw original
  }
  await assert.rejects(f.run(), error => error === original)
  assert.equal(f.pending.has(51999), false); assert.equal(f.delivered.has(51999), false)
  assert.equal(f.pending.has(51000), false); assert.equal(f.delivered.has(51001), false)
  assertOtherCategoriesUntouched(f)
})

test('failed post-write pending enumeration still cancels the known batch IDs without cancelling other categories', async () => {
  const f = fixture(), original = new Error('synthetic pending read failure')
  f.seedOtherCategories()
  const schedule = f.plugin.schedule
  f.plugin.schedule = async options => { await schedule(options); f.plugin.getPending = async () => { throw original } }
  await assert.rejects(f.run(), error => error.cause === original && /pending read failure.*清理未完成.*待发提醒读取失败/.test(error.message))
  assert.equal(f.pending.has(51000), false); assert.equal(f.pending.has(51001), false)
  assertOtherCategoriesUntouched(f)
})

test('failed delivered enumeration after an immediate bridge write still removes the requested delivered IDs', async () => {
  const f = fixture(), original = new Error('synthetic delivered read failure')
  f.seedOtherCategories()
  f.plugin.schedule = async ({ notifications }) => {
    notifications.forEach(row => f.delivered.set(row.id, row))
    f.plugin.getDeliveredNotifications = async () => { throw original }
  }
  await assert.rejects(f.run(), error => error.cause === original && /delivered read failure.*清理未完成.*已送达提醒读取失败/.test(error.message))
  assert.equal(f.delivered.has(51000), false); assert.equal(f.delivered.has(51001), false)
  assertOtherCategoriesUntouched(f)
})

test('pending rollback failure does not skip delivered rollback and is reported alongside the original scheduling failure', async () => {
  const f = fixture(), original = new Error('synthetic partial bridge failure')
  f.seedOtherCategories()
  f.plugin.schedule = async ({ notifications }) => {
    f.pending.set(notifications[0].id, notifications[0]); f.delivered.set(notifications[1].id, notifications[1])
    f.plugin.cancel = async () => { throw new Error('synthetic cancel failure') }
    throw original
  }
  await assert.rejects(f.run(), error => error.cause === original && /partial bridge failure.*清理未完成.*cancel failure/.test(error.message))
  assert.equal(f.pending.has(51000), true, 'bridge cancellation really failed, so success must not be claimed')
  assert.equal(f.delivered.has(51001), false, 'independent delivered cleanup must still run')
  assertOtherCategoriesUntouched(f)
})

test('delivered rollback failure keeps the original error and reports cleanup failure after pending rollback succeeds', async () => {
  const f = fixture(), original = new Error('synthetic schedule failure')
  f.seedOtherCategories()
  f.plugin.schedule = async ({ notifications }) => {
    f.pending.set(notifications[0].id, notifications[0]); f.delivered.set(notifications[1].id, notifications[1])
    f.plugin.removeDeliveredNotifications = async () => { throw new Error('synthetic delivered removal failure') }
    throw original
  }
  await assert.rejects(f.run(), error => error.cause === original && /schedule failure.*清理未完成.*delivered removal failure/.test(error.message))
  assert.equal(f.pending.has(51000), false); assert.equal(f.delivered.has(51001), true)
  assertOtherCategoriesUntouched(f)
})

test('an unconfirmed partial batch reports successful rollback only after the missing alarms have been cancelled', async () => {
  const f = fixture(); f.seedOtherCategories()
  f.plugin.schedule = async ({ notifications }) => { f.pending.set(notifications[0].id, notifications[0]) }
  await assert.rejects(f.run(), /部分提醒未能安排.*本次排程已撤销/)
  assert.equal(f.pending.has(51000), false); assertOtherCategoriesUntouched(f)
})

test('a missing confirmation followed by failed cancellation cannot claim the partial batch was revoked', async () => {
  const f = fixture()
  f.plugin.schedule = async ({ notifications }) => { f.pending.set(notifications[0].id, notifications[0]); f.plugin.cancel = async () => { throw new Error('synthetic cancel failure') } }
  await assert.rejects(f.run(), error => /部分提醒未能安排.*清理未完成/.test(error.message) && !/已撤销/.test(error.message))
  assert.equal(f.pending.has(51000), true)
})

test('a rejected late write is rolled back before the next account schedules the same category IDs', async () => {
  const f = fixture(), gate = deferred(), original = new Error('synthetic old-owner bridge failure')
  const schedule = f.plugin.schedule
  f.plugin.schedule = async options => { await gate.promise; await schedule(options); throw original }
  const old = f.run([51000]); await flush()
  f.select('synthetic-b'); f.plugin.schedule = schedule
  const next = f.run([51000]); gate.resolve()
  await assert.rejects(old, error => error === original)
  assert.equal((await next).count, 1)
  assert.equal(f.pending.get(51000).extra.ownerUid, 'synthetic-b')
  assert.deepEqual(plain(f.calls.schedule.map(rows => rows[0].extra.ownerUid)), ['synthetic-a', 'synthetic-b'])
})

test('A to B to A during a successful bridge write invalidates the old revision before the new A plan can run', async () => {
  const f = fixture(), gate = deferred(), schedule = f.plugin.schedule
  f.plugin.schedule = async options => { await gate.promise; await schedule(options) }
  const old = f.run([51000]); await flush()
  f.select('synthetic-b'); f.select('synthetic-a'); f.plugin.schedule = schedule
  const next = f.run([51001]); gate.resolve()
  assert.equal((await old).count, 0); assert.equal((await next).count, 1)
  assert.equal(f.pending.has(51000), false); assert.equal(f.pending.get(51001).extra.ownerUid, 'synthetic-a')
})

test('a foreign category or focus ID is rejected before the bridge can write it', async () => {
  const f = fixture(); f.seedOtherCategories()
  await assert.rejects(f.run([51000, 70000]), /编号不属于当前类别/)
  assert.equal(f.calls.schedule.length, 0); assertOtherCategoriesUntouched(f)
})
