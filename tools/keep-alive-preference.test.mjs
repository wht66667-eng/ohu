import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

/** Run the real preference and permission coordinators; every OS boundary stays in memory. */
function fixture({ webWanted = true, nativeWanted = true } = {}) {
  const storage = new Map([['sc.keepalive.enabled.v1', webWanted ? '1' : '0']])
  const calls = { starts: 0, restores: 0, stops: 0, refreshes: 0 }
  const native = { wanted: nativeWanted, running: false }
  const hooks = {}
  const plugin = {
    start: async () => { calls.starts++; native.wanted = true; native.running = true; return { running: true } },
    stop: async () => { calls.stops++; native.wanted = false; native.running = false; return { running: false } },
    isRunning: async () => ({ wanted: native.wanted, running: native.running }),
    restore: async options => {
      calls.restores++
      if (hooks.restore) return hooks.restore(options)
      if (native.wanted == null) native.wanted = options.defaultWanted
      native.running = native.wanted
      return { wanted: native.wanted, running: native.running }
    },
  }
  const modules = new Map()
  const session = { uid: 'synthetic-only-student', revision: 1 }
  const refresh = async () => { calls.refreshes++; return { count: 0, message: '暂无待提醒项' } }
  const mocks = {
    '@capacitor/core': { Capacitor: { getPlatform: () => 'android' }, registerPlugin: () => plugin },
    './platform': { IS_NATIVE: true, PLATFORM: { os: 'android' } },
    './qbank': { captureQbankSession: () => session, isQbankSessionCurrent: snapshot => snapshot === session },
    '@capacitor/local-notifications': { LocalNotifications: { requestPermissions: async () => ({ display: 'granted' }), checkPermissions: async () => ({ display: 'granted' }) } },
    './alarm-notify': { exactAlarmGranted: async () => true, requestExactAlarm: async () => true },
    './class-remind': { rescheduleClassReminders: refresh },
    './exam-utils': { rescheduleExamReminders: refresh },
    './cert-remind': { rescheduleCertReminders: refresh },
    './todo-remind': { rescheduleTodoReminders: refresh },
    './personal-reminders': { clearPersonalReminders: async () => {} },
    './reminder-overlay': { clearReminderOverlays: async () => ({ lastError: null }) },
    './reminder-plan': { clearCourseReminderPlan: async () => {} },
  }
  function load(name) {
    if (modules.has(name)) return modules.get(name)
    const module = { exports: {} }
    const code = ts.transpileModule(fs.readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    vm.runInNewContext(code, {
      module, exports: module.exports, console,
      localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
      require: dependency => dependency === './keep-alive' ? load('keep-alive') : mocks[dependency] ?? (() => { throw Error(`Unexpected import ${dependency}`) })(),
    })
    modules.set(name, module.exports)
    return module.exports
  }
  return { api: load('keep-alive'), load, storage, calls, native, hooks }
}

test('notification-bar opt-out wins over an older enabled web preference on cold recovery', async () => {
  const f = fixture({ nativeWanted: false })
  await f.api.restoreKeepAliveIfWanted()
  assert.equal(f.native.wanted, false)
  assert.equal(f.native.running, false)
  assert.equal(f.api.isKeepAliveWanted(), false)
  assert.equal(f.calls.starts, 0)
})

test('process death keeps opt-in and automatic recovery distinct from explicit enable', async () => {
  const f = fixture()
  await f.api.restoreKeepAliveIfWanted()
  assert.equal(f.native.running, true)
  assert.equal(f.api.isKeepAliveWanted(), true)
  assert.equal(f.calls.restores, 1)
  assert.equal(f.calls.starts, 0)
})

test('an explicitly disabled web preference is retained and cancels a leftover native service', async () => {
  const f = fixture({ webWanted: false })
  await f.api.restoreKeepAliveIfWanted()
  assert.equal(f.calls.stops, 1)
  assert.equal(f.calls.restores, 0)
  assert.equal(f.native.wanted, false)
  assert.equal(f.api.isKeepAliveWanted(), false)
})

test('explicit enable after notification opt-out restores both preferences', async () => {
  const f = fixture({ nativeWanted: false })
  await f.api.restoreKeepAliveIfWanted()
  assert.equal(f.api.isKeepAliveWanted(), false)
  assert.equal((await f.api.startKeepAlive()).ok, true)
  assert.equal(f.native.wanted, true)
  assert.equal(f.api.isKeepAliveWanted(), true)
  await f.api.restoreKeepAliveIfWanted()
  assert.equal(f.native.running, true)
})

test('read-only status refresh synchronizes a notification opt-out without starting the service', async () => {
  const f = fixture({ nativeWanted: false })
  assert.equal(await f.api.isKeepAliveRunning(), false)
  assert.equal(f.api.isKeepAliveWanted(), false)
  assert.equal(f.calls.starts, 0)
  assert.equal(f.calls.restores, 0)
})

test('older native bridges never fall back to start and overwrite an unreadable system opt-out', async () => {
  const f = fixture({ nativeWanted: false })
  f.hooks.restore = async () => { throw { code: 'UNIMPLEMENTED' } }
  await f.api.restoreKeepAliveIfWanted()
  assert.equal(f.calls.starts, 0)
  assert.equal(f.native.wanted, false)
  assert.equal(f.api.isKeepAliveWanted(), true, 'unknown native state must not manufacture an enabled/disabled web choice')
})

test('a failed native preference read remains visible without changing the stored choice', async () => {
  const f = fixture()
  f.hooks.restore = async () => { throw new Error('synthetic native failure') }
  await assert.rejects(f.api.restoreKeepAliveIfWanted(), /synthetic native failure/)
  assert.equal(f.calls.starts, 0)
  assert.equal(f.api.isKeepAliveWanted(), true)
})

test('late automatic recovery feedback cannot undo a newer explicit enable', async () => {
  const f = fixture({ nativeWanted: false }), gate = deferred()
  f.hooks.restore = () => gate.promise
  const old = f.api.restoreKeepAliveIfWanted()
  await f.api.startKeepAlive()
  gate.resolve({ wanted: false, running: false })
  await old
  assert.equal(f.api.isKeepAliveWanted(), true)
})

test('late automatic recovery feedback cannot undo a newer explicit stop', async () => {
  const f = fixture(), gate = deferred()
  f.hooks.restore = () => gate.promise
  const old = f.api.restoreKeepAliveIfWanted()
  await f.api.stopKeepAlive()
  gate.resolve({ wanted: true, running: false })
  await old
  assert.equal(f.api.isKeepAliveWanted(), false)
  assert.equal(f.native.wanted, false)
})

for (const choice of ['web', 'notification']) {
  test(`granting notification permission preserves a prior ${choice} guardian opt-out`, async () => {
    const f = fixture({ webWanted: choice !== 'web', nativeWanted: choice !== 'notification' })
    assert.equal(await f.load('notify-setup').requestNotifyPermission(), true)
    assert.equal(f.calls.starts, 0)
    assert.equal(f.native.wanted, false)
    assert.equal(f.native.running, false)
    assert.equal(f.api.isKeepAliveWanted(), false)
    assert.equal(f.calls.refreshes, 4, 'guardian opt-out must not disable independent course and other alarms')
  })
}
