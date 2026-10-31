import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')
const compiled = ts.transpileModule(fs.readFileSync(join(root, 'src/lib/health.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
function health({ native = true, granted = true, startOk = true } = {}) {
  let qbankSession = { uid: 'test-runner', revision: 1 }, writeFailure = false
  const identityListeners = new Set()
  let total = 100, event, gets = 0, starts = 0, stops = 0, removals = 0
  const storage = new Map(), motion = new Set()
  const plugin = {
    requestActivityRecognition: async () => ({ granted }),
    getStepCount: async () => { gets++; return { available: true, steps: total } },
    startStepListening: async () => { starts++; return { ok: startOk } },
    stopStepListening: async () => { stops++; return { ok: true } },
    addListener: async (_name, callback) => { event = callback; return { remove: async () => { removals++; if (event === callback) event = undefined } } },
  }
  const module = { exports: {} }
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Date, console,
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => { if (writeFailure) throw new Error('quota'); storage.set(key, value) } },
    window: { DeviceMotionEvent: {}, addEventListener: (name, listener) => { if (name === 'devicemotion') motion.add(listener) }, removeEventListener: (name, listener) => { if (name === 'devicemotion') motion.delete(listener) } },
    DeviceMotionEvent: { requestPermission: async () => granted ? 'granted' : 'denied' },
    require: (name) => {
      if (name === '@capacitor/core') return { registerPlugin: () => plugin }
      if (name === './qbank') return { captureQbankSession: () => qbankSession, isQbankSessionCurrent: (s) => s === qbankSession, subscribeQbank: (cb) => { identityListeners.add(cb); return () => identityListeners.delete(cb) } }
      return { IS_NATIVE: native, PLATFORM: { os: native ? 'android' : 'web' } }
    },
  })
  return { api: module.exports, plugin, storage, blockStorage: () => { writeFailure = true }, switchUid: (uid) => { qbankSession = { uid, revision: qbankSession.revision + 1 }; identityListeners.forEach((cb) => cb()) }, total: (value) => { total = value }, fire: (value) => event?.({ steps: value }), captured: () => event, counts: () => ({ gets, starts, stops, removals }), motion, motionEvent: (value) => motion.forEach((listener) => listener({ accelerationIncludingGravity: { x: value, y: 0, z: 0 } })) }
}

test('denied permission remains denied and does not implicitly start a sensor', async () => {
  const run = health({ granted: false })
  assert.equal(await run.api.requestActivityRecognition(), false)
  assert.equal(run.counts().starts, 0)
})
test('native startup checks the plugin result and removes a failed listener', async () => {
  const run = health({ startOk: false })
  assert.equal(await run.api.startNativeStepListening(), false)
  assert.equal(run.counts().starts, 1)
  assert.equal(run.counts().removals, 1)
  assert.equal(run.captured(), undefined)
})
test('a listener registration failure cannot report native counting as active', async () => {
  const run = health()
  run.plugin.addListener = async () => { throw new Error('listener unavailable') }
  await assert.rejects(run.api.startNativeStepListening(), /listener unavailable/)
  assert.equal(run.counts().starts, 0)
  assert.equal(run.counts().stops, 1)
})
test('duplicate starts share a single pending operation and physical listener', async () => {
  const run = health()
  const first = run.api.startNativeStepListening(), second = run.api.startNativeStepListening()
  assert.equal(first, second)
  assert.equal(await first, true)
  assert.equal(await run.api.startNativeStepListening(), true)
  assert.equal(run.counts().starts, 1)
})
test('native events update saved steps and subscribers without one-shot sensor reads', async () => {
  const run = health(); let updates = 0, renders = 0
  const off = run.api.subscribeSports(() => { renders++ })
  await run.api.startNativeStepListening(() => { updates++ })
  await run.api.syncStepsFromNative()
  run.fire(105); await flush()
  assert.equal(run.api.getTodaySteps().steps, 5)
  assert.equal(run.api.getTodaySteps().distance, .004)
  assert.equal(run.counts().gets, 1)
  assert.equal(updates, 1)
  assert.equal(renders, 2)
  const staleEvent = run.captured()
  await run.api.stopNativeStepListening(); off()
  staleEvent({ steps: 110 }); await flush()
  assert.equal(run.api.getTodaySteps().steps, 5)
  assert.equal(renders, 2)
})
test('unmount/stop during a pending start removes the eventual listener', async () => {
  const run = health(), wait = deferred()
  run.plugin.startStepListening = () => wait.promise
  const start = run.api.startNativeStepListening()
  await flush()
  const stop = run.api.stopNativeStepListening()
  wait.resolve({ ok: true })
  assert.equal(await start, false)
  await stop
  assert.equal(run.captured(), undefined)
  assert.ok(run.counts().removals >= 1)
})
test('an older cleanup cannot stop a newer queued session', async () => {
  const run = health(), wait = deferred()
  run.plugin.startStepListening = () => wait.promise
  const first = run.api.startNativeStepListening()
  await flush()
  const stop = run.api.stopNativeStepListening()
  run.plugin.startStepListening = async () => ({ ok: true })
  const next = run.api.startNativeStepListening()
  wait.resolve({ ok: true })
  assert.equal(await first, false); await stop
  assert.equal(await next, true)
  await run.api.syncStepsFromNative(100)
  run.fire(103); await flush()
  assert.equal(run.api.getTodaySteps().steps, 3)
  assert.equal(typeof run.captured(), 'function')
})
test('a stopped or superseded async read cannot overwrite newer daily data', async () => {
  const run = health(), wait = deferred()
  await run.api.syncStepsFromNative(100)
  run.plugin.getStepCount = () => wait.promise
  const older = run.api.syncStepsFromNative()
  await run.api.syncStepsFromNative(105)
  wait.resolve({ available: true, steps: 103 })
  assert.equal((await older).cancelled, true)
  assert.equal(run.api.getTodaySteps().steps, 5)
  const stoppedWait = deferred(); run.plugin.getStepCount = () => stoppedWait.promise
  const pending = run.api.syncStepsFromNative()
  await run.api.stopNativeStepListening()
  stoppedWait.resolve({ available: true, steps: 150 })
  assert.equal((await pending).cancelled, true)
  assert.equal(run.api.getTodaySteps().steps, 5)
})
test('manual records survive first activation and recalibration after a manual adjustment', async () => {
  const run = health()
  run.api.updateTodaySteps({ steps: 400, source: 'manual' })
  assert.equal((await run.api.syncStepsFromNative(1000)).steps, 400)
  assert.equal((await run.api.syncStepsFromNative(1005)).steps, 405)
  assert.equal(run.api.getTodaySteps().hasManualSteps, true)
  run.api.updateTodaySteps({ steps: 900, source: 'manual', hasManualSteps: true })
  assert.equal((await run.api.syncStepsFromNative(1006)).steps, 900)
  assert.equal((await run.api.syncStepsFromNative(1008)).steps, 902)
})
test('counter reset after a device reboot preserves already stored daily steps', async () => {
  const run = health()
  await run.api.syncStepsFromNative(100)
  await run.api.syncStepsFromNative(105)
  assert.equal((await run.api.syncStepsFromNative(2)).steps, 5)
  assert.equal((await run.api.syncStepsFromNative(5)).steps, 8)
})
test('DeviceMotion replacement and stale cleanup leave only the current listener', () => {
  const run = health({ native: false }); let first = 0, second = 0
  const staleStop = run.api.startStepSensor(() => { first++ })
  run.motionEvent(14)
  const currentStop = run.api.startStepSensor(() => { second++ })
  staleStop()
  assert.equal(run.motion.size, 1)
  run.motionEvent(14)
  assert.equal(first, 1); assert.equal(second, 1)
  currentStop(); run.motionEvent(9); run.motionEvent(14)
  assert.equal(run.motion.size, 0); assert.equal(second, 1)
})
test('invalid native readings are rejected without changing the daily count', async () => {
  const run = health()
  await run.api.syncStepsFromNative(100)
  assert.equal((await run.api.syncStepsFromNative(Number.NaN)).ok, false)
  assert.equal((await run.api.syncStepsFromNative(-2)).ok, false)
  assert.equal(run.api.getTodaySteps().steps, 0)
})
test('a stale route owner cannot stop the active route after ownership has transferred', async () => {
  const run = health(), older = {}, current = {}
  await run.api.startNativeStepListening(undefined, undefined, older)
  await run.api.startNativeStepListening(undefined, undefined, current)
  await run.api.syncStepsFromNative(100)
  await run.api.stopNativeStepListening(older)
  run.fire(105); await flush()
  assert.equal(run.counts().stops, 0)
  assert.equal(run.api.getTodaySteps().steps, 5)
  await run.api.stopNativeStepListening(current)
  assert.equal(run.counts().stops, 1)
})

test('steps, health metrics, settings and sensor baselines belong only to their App UID', async () => {
  const run = health()
  run.storage.set('xm_sports_daily', JSON.stringify([{ steps: 99999 }]))
  assert.equal(run.api.getTodaySteps().steps, 0)
  run.api.updateTodaySteps({ steps: 400, source: 'manual' })
  run.api.addMetric({ type: 'weight', value: 60, unit: 'kg', timestamp: 1, source: 'manual' })
  run.api.updateSettings({ stepGoal: 8000 })
  await run.api.syncStepsFromNative(100)
  const originalScope = run.api.getSportsScope()
  run.switchUid('student-b')
  assert.equal(run.api.getTodaySteps().steps, 0)
  assert.equal(run.api.getLatestMetric('weight'), null)
  assert.equal(run.api.getSettings().stepGoal, 10000)
  run.api.updateTodaySteps({ steps: 80 })
  run.switchUid('test-runner')
  assert.equal(run.api.getTodaySteps().steps, 400)
  assert.equal(run.api.getLatestMetric('weight').value, 60)
  assert.equal(run.api.getSettings().stepGoal, 8000)
  assert.notEqual(run.api.getSportsScope(), originalScope)
  assert.equal(run.storage.has('xm_sports_daily'), true)
})

test('an identity switch cancels native and web listeners and invalidates a late one-shot read', async () => {
  const run = health(), wait = deferred()
  await run.api.startNativeStepListening()
  run.api.startStepSensor(() => {})
  run.plugin.getStepCount = () => wait.promise
  const stale = run.api.syncStepsFromNative()
  run.switchUid('student-b')
  wait.resolve({ available: true, steps: 900 })
  assert.equal((await stale).cancelled, true)
  await flush()
  assert.equal(run.motion.size, 0)
  assert.equal(run.captured(), undefined)
  assert.equal(run.api.getTodaySteps().steps, 0)
})

test('a quota failure rejects manual and native persistence rather than reporting a successful save', async () => {
  const run = health()
  run.api.updateTodaySteps({ steps: 100 })
  run.blockStorage()
  assert.throws(() => run.api.updateTodaySteps({ steps: 200 }), /未能保存/)
  assert.throws(() => run.api.addMetric({ type: 'weight', value: 60 }), /未能保存/)
  assert.throws(() => run.api.updateSettings({ stepGoal: 8000 }), /未能保存/)
  await assert.rejects(run.api.syncStepsFromNative(100), /未能保存/)
  assert.equal(run.api.getTodaySteps().steps, 100)
})

test('an unreadable health history is preserved rather than overwritten with a new empty list', () => {
  const run = health(), key = 'xm_sports_daily.v2:uid:test-runner'
  run.storage.set(key, '{broken')
  assert.equal(run.api.getTodaySteps().steps, 0)
  assert.throws(() => run.api.updateTodaySteps({ steps: 100 }), /无法读取/)
  assert.equal(run.storage.get(key), '{broken')
})
