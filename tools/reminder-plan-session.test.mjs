import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const compile = () => ts.transpileModule(fs.readFileSync(new URL('../src/lib/reminder-plan.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const plain = value => JSON.parse(JSON.stringify(value))
const notice = (ownerUid = 'A', id = 43000) => ({ id, title: 'Synthetic course', body: 'Synthetic location', schedule: { at: new Date(Date.now() + 60_000), allowWhileIdle: true }, extra: { ownerUid, type: 'class' } })

function fixture({ uid = 'A', storedUid = 'A' } = {}) {
  let session = { uid, revision: 0 }
  const listeners = new Set(), events = new Map(), calls = { sync: [], clear: [] }, flags = { bootGate: null, bootError: null, readGate: null, syncGate: null }
  const state = { supported: true, ownerUid: storedUid, plannedCount: 2, activeCount: 2, nextRefreshAt: Date.now() + 100_000, lastError: null }
  const plugin = {
    getState: async () => { if (flags.readGate) await flags.readGate.promise; return { ...state } },
    sync: async options => {
      calls.sync.push(plain(options)); if (flags.syncGate) await flags.syncGate.promise
      state.ownerUid = options.ownerUid; state.plannedCount = options.notifications.length; return { ...state }
    },
    clear: async ({ ownerUid } = {}) => {
      calls.clear.push(ownerUid ?? null)
      if (!ownerUid || ownerUid === state.ownerUid) { state.ownerUid = null; state.plannedCount = 0; state.activeCount = 0; state.nextRefreshAt = null }
      return { ...state }
    },
  }
  const qbank = { captureQbankSession: () => session, isQbankSessionCurrent: captured => captured.uid === session.uid && captured.revision === session.revision, subscribeQbank: listener => { listeners.add(listener); return () => listeners.delete(listener) } }
  const module = { exports: {} }
  vm.runInNewContext(compile(), {
    module, exports: module.exports, Date, console,
    window: { addEventListener: (name, listener) => { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(listener) } },
    require: name => {
      if (name === './qbank') return qbank
      if (name === './reminder-boot') return { getReminderBootState: async () => { if (flags.bootError) throw flags.bootError; if (flags.bootGate) await flags.bootGate.promise; return { supported: true, ownerUid: session.uid, enabled: true, lastError: null } } }
      if (name === '@capacitor/core') return { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => true }, registerPlugin: () => plugin }
      throw new Error(`Unexpected import: ${name}`)
    },
  })
  return { api: module.exports, state, calls, flags, select(nextUid) { session = { uid: nextUid, revision: session.revision + 1 }; listeners.forEach(listener => listener()) }, emit(name, detail) { for (const listener of events.get(name) ?? []) listener({ detail }) } }
}

test('restoring the same native owner does not revoke its saved semester source', async () => {
  const f = fixture({ uid: '' }); f.select('A'); await flush()
  assert.deepEqual(f.calls.clear, []); assert.equal(f.state.plannedCount, 2)
})

test('persisted candidates have matching owner, unique class IDs and serializable date metadata', async () => {
  const f = fixture(), item = notice()
  const result = await f.api.syncCourseReminderPlan({ ownerUid: 'A', notifications: [item] })
  assert.equal(result.plannedCount, 1)
  assert.equal(f.calls.sync[0].notifications[0].atMs, item.schedule.at.getTime())
  assert.equal(f.calls.sync[0].notifications[0].schedule.at, item.schedule.at.toISOString())
  await assert.rejects(f.api.syncCourseReminderPlan({ ownerUid: 'A', notifications: [notice('B')] }), /无效/)
  await assert.rejects(f.api.syncCourseReminderPlan({ ownerUid: 'A', notifications: [notice('A', 51000)] }), /无效/)
  await assert.rejects(f.api.syncCourseReminderPlan({ ownerUid: 'A', notifications: [notice(), notice()] }), /无效/)
  assert.equal(f.calls.sync.length, 1)
})

test('account changes while boot metadata is awaited prevent any old source write', async () => {
  const f = fixture(), wait = deferred(); f.flags.bootGate = wait
  const job = f.api.syncCourseReminderPlan({ ownerUid: 'A', notifications: [notice()] })
  await flush(); f.select('B'); wait.resolve()
  const result = await job
  assert.match(result.lastError, /账号|账户/); assert.equal(f.calls.sync.length, 0)
})

test('a late native source write is removed before the next account can replace it', async () => {
  const f = fixture(), wait = deferred(); f.flags.syncGate = wait
  const old = f.api.syncCourseReminderPlan({ ownerUid: 'A', notifications: [notice()] })
  await flush(); f.select('B'); wait.resolve()
  assert.match((await old).lastError, /账号/)
  f.flags.syncGate = null
  await f.api.syncCourseReminderPlan({ ownerUid: 'B', notifications: [notice('B')] })
  assert.equal(f.state.ownerUid, 'B'); assert.equal(f.state.plannedCount, 1)
  assert.ok(f.calls.clear.includes('A'))
})

test('A to B to A invalidates an in-flight source request despite the repeated UID', async () => {
  const f = fixture(), wait = deferred(); f.flags.bootGate = wait
  const old = f.api.syncCourseReminderPlan({ ownerUid: 'A', notifications: [notice()] })
  await flush(); f.select('B'); f.select('A'); wait.resolve()
  assert.match((await old).lastError, /账号|账户/); assert.equal(f.calls.sync.length, 0)
})

test('a late explicit logout event for A cannot revoke B native source', async () => {
  const f = fixture({ uid: 'B', storedUid: 'B' })
  f.emit('ohhu-reminder-owner-logout', { ownerUid: 'A' }); await flush()
  assert.equal(f.state.ownerUid, 'B'); assert.equal(f.state.plannedCount, 2)
  assert.deepEqual(f.calls.clear, ['A'])
})

test('confirmed anonymity clears the persisted old source independently of an unavailable boot bridge', async () => {
  const f = fixture({ uid: '', storedUid: 'A' })
  f.flags.bootError = new Error('boot bridge unavailable')
  f.emit('ohhu-reminder-auth-anonymous'); await flush()
  assert.equal(f.state.ownerUid, null); assert.equal(f.state.plannedCount, 0)
  assert.deepEqual(f.calls.clear, ['A'])
})

test('anonymous source cleanup waiting on a native read cannot clear a newly restored B', async () => {
  const f = fixture({ uid: '', storedUid: 'A' }), wait = deferred()
  f.flags.readGate = wait
  f.emit('ohhu-reminder-auth-anonymous'); await flush()
  f.select('B'); f.state.ownerUid = 'B'; f.state.plannedCount = 4
  wait.resolve(); await flush()
  assert.equal(f.state.ownerUid, 'B'); assert.equal(f.state.plannedCount, 4)
  assert.deepEqual(f.calls.clear, [])
})
