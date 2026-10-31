import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')
const compiled = ts.transpileModule(fs.readFileSync(join(root, 'src/lib/adaptive-polling.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve() }
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function clock({ active = true, random = 0 } = {}) {
  let now = 0, id = 0, unsubscribed = 0
  const timers = new Map(), listeners = new Set(), delays = []
  const host = {
    now: () => now, random: () => random, isActive: () => active,
    setTimeout: (callback, delay) => { const key = ++id; timers.set(key, { callback, at: now + delay }); delays.push(delay); return key },
    clearTimeout: key => timers.delete(key),
    subscribeResume: listener => { listeners.add(listener); return () => { unsubscribed++; listeners.delete(listener) } },
  }
  return {
    host, timers, delays,
    now: () => now,
    active(value, notify = true) { active = value; if (notify) listeners.forEach(listener => listener()) },
    signal: () => listeners.forEach(listener => listener()),
    listeners: () => listeners.size,
    unsubscribed: () => unsubscribed,
    async advance(milliseconds) {
      const end = now + milliseconds
      await flush()
      while (true) {
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        now = next[1].at; timers.delete(next[0]); next[1].callback(); await flush()
      }
      now = end; await flush()
    },
  }
}
function api(globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(compiled, { module, exports: module.exports, Date, Math, Promise, ...globals })
  return module.exports.startAdaptivePolling
}
const startAdaptivePolling = api()

test('foreground initial read is immediate and the next timer starts after settlement', async () => {
  const time = clock(), first = deferred(), calls = []
  const polling = startAdaptivePolling(() => { calls.push(time.now()); return calls.length === 1 ? first.promise : Promise.resolve() }, { intervalMs: 8000, host: time.host })
  await flush()
  assert.deepEqual(calls, [0]); assert.equal(time.timers.size, 0)
  await time.advance(20000)
  assert.equal(calls.length, 1)
  first.resolve(); await flush()
  assert.equal(time.delays.at(-1), 8000)
  await time.advance(7999); assert.equal(calls.length, 1)
  await time.advance(1); assert.deepEqual(calls, [0, 28000])
  polling.stop()
})

test('initial hidden/offline host makes no request, including manual refresh', async () => {
  const time = clock({ active: false }); let calls = 0
  const polling = startAdaptivePolling(async () => { calls++ }, { intervalMs: 8000, host: time.host })
  await polling.refresh(); await time.advance(100000)
  assert.equal(calls, 0); assert.equal(time.timers.size, 0)
  time.active(true); await time.advance(999); assert.equal(calls, 0)
  await time.advance(1); assert.equal(calls, 1)
  polling.stop()
})

test('resume events coalesce for one second and repeated active events cause no extra reads', async () => {
  const time = clock(); let calls = 0
  const polling = startAdaptivePolling(async () => { calls++ }, { intervalMs: 8000, host: time.host })
  await flush(); time.active(false)
  assert.equal(time.timers.size, 0)
  time.active(true)
  for (let i = 0; i < 30; i++) time.signal()
  assert.equal(time.timers.size, 1)
  await time.advance(500)
  for (let i = 0; i < 30; i++) time.signal()
  await time.advance(500); assert.equal(calls, 2)
  for (let i = 0; i < 30; i++) time.signal()
  await time.advance(7999); assert.equal(calls, 2)
  await time.advance(1); assert.equal(calls, 3)
  polling.stop()
})

test('a pause cancels its resume cooldown and resuming later starts a fresh cooldown', async () => {
  const time = clock({ active: false }); let calls = 0
  const polling = startAdaptivePolling(async () => { calls++ }, { host: time.host })
  time.active(true); await time.advance(500); time.active(false)
  await time.advance(5000); assert.equal(calls, 0)
  time.active(true); await time.advance(999); assert.equal(calls, 0)
  await time.advance(1); assert.equal(calls, 1)
  polling.stop()
})

test('manual refresh shares one flight with automatic and other manual requests', async () => {
  const time = clock(), pending = deferred(); let calls = 0
  const polling = startAdaptivePolling(async () => { calls++; await pending.promise }, { host: time.host })
  const one = polling.refresh(), two = polling.refresh()
  assert.equal(one, two)
  await flush(); assert.equal(calls, 1)
  time.active(false); time.active(true)
  await time.advance(50000); assert.equal(calls, 1); assert.equal(time.timers.size, 0)
  pending.resolve(); await one
  assert.equal(time.timers.size, 1)
  polling.stop()
})

test('false results and exceptions exponentially back off to the configured maximum', async () => {
  const time = clock(); let calls = 0
  const polling = startAdaptivePolling(async () => { calls++; if (calls % 2 === 0) throw new Error('fake offline'); return false }, { intervalMs: 1000, maxIntervalMs: 8000, jitterRatio: 0, host: time.host })
  await flush(); assert.equal(time.delays.at(-1), 2000)
  await time.advance(2000); assert.equal(time.delays.at(-1), 4000)
  await time.advance(4000); assert.equal(time.delays.at(-1), 8000)
  await time.advance(8000); assert.equal(time.delays.at(-1), 8000)
  assert.equal(calls, 4)
  polling.stop()
})

test('successful true or void results restore the ordinary interval after failure', async () => {
  const time = clock(), results = [false, true, undefined]
  const polling = startAdaptivePolling(async () => results.shift(), { intervalMs: 1000, jitterRatio: 0, host: time.host })
  await flush(); assert.equal(time.delays.at(-1), 2000)
  await time.advance(2000); assert.equal(time.delays.at(-1), 1000)
  await time.advance(1000); assert.equal(time.delays.at(-1), 1000)
  polling.stop()
})

test('manual refresh resets old backoff, cancels the pending timer and then resumes normal scheduling', async () => {
  const time = clock(); let calls = 0
  const polling = startAdaptivePolling(async () => { calls++; return false }, { intervalMs: 1000, jitterRatio: 0, host: time.host })
  await flush(); await time.advance(2000)
  assert.equal(time.delays.at(-1), 4000)
  await polling.refresh()
  assert.equal(calls, 3); assert.equal(time.delays.at(-1), 2000); assert.equal(time.timers.size, 1)
  await time.advance(2000); assert.equal(calls, 4)
  polling.stop()
})

test('default maximum is 120 seconds before positive-only jitter capped at twenty percent', async () => {
  const time = clock({ random: 1 })
  const polling = startAdaptivePolling(async () => false, { intervalMs: 100000, jitterRatio: 5, host: time.host })
  await flush()
  assert.equal(time.delays.at(-1), 144000)
  polling.stop()
  const withoutJitter = clock({ random: -1 })
  const other = startAdaptivePolling(async () => undefined, { intervalMs: 1000, jitterRatio: .2, host: withoutJitter.host })
  await flush(); assert.equal(withoutJitter.delays.at(-1), 1000)
  other.stop()
})

test('a host becoming inactive without a delivered event is checked before each request', async () => {
  const time = clock(); let calls = 0
  const polling = startAdaptivePolling(async () => { calls++ }, { intervalMs: 1000, host: time.host })
  await flush(); time.active(false, false)
  await time.advance(1000); assert.equal(calls, 1); assert.equal(time.timers.size, 0)
  time.active(true); await time.advance(1000); assert.equal(calls, 2)
  polling.stop()
})

test('an in-flight read that settles while inactive does not schedule further work', async () => {
  const time = clock(), pending = deferred(); let calls = 0
  const polling = startAdaptivePolling(async () => { calls++; if (calls === 1) await pending.promise }, { host: time.host })
  await flush(); time.active(false); pending.resolve(); await flush()
  assert.equal(time.timers.size, 0)
  await time.advance(60000); assert.equal(calls, 1)
  time.active(true); await time.advance(1000); assert.equal(calls, 2)
  polling.stop()
})

test('stop removes timers/listeners once and prevents refresh or late settlement from restarting', async () => {
  const time = clock(), pending = deferred(); let calls = 0
  const polling = startAdaptivePolling(async () => { calls++; await pending.promise }, { host: time.host })
  await flush(); polling.stop(); polling.stop(); pending.reject(new Error('late fixture failure'))
  await flush(); await polling.refresh(); await time.advance(100000)
  assert.equal(calls, 1); assert.equal(time.timers.size, 0)
  assert.equal(time.listeners(), 0); assert.equal(time.unsubscribed(), 1)
})

test('stop before the initial microtask prevents the first read', async () => {
  const time = clock(); let calls = 0
  const polling = startAdaptivePolling(async () => { calls++ }, { host: time.host })
  polling.stop(); await flush()
  assert.equal(calls, 0); assert.equal(time.timers.size, 0)
})

test('default browser host checks visibility and online state and cleans up every event listener', async () => {
  const time = clock(), events = new Map()
  const target = prefix => ({
    addEventListener(name, listener) { events.set(`${prefix}:${name}`, listener) },
    removeEventListener(name, listener) { if (events.get(`${prefix}:${name}`) === listener) events.delete(`${prefix}:${name}`) },
  })
  const document = { ...target('document'), visibilityState: 'hidden' }, navigator = { onLine: true }, window = target('window')
  const start = api({ document, navigator, window })
  let calls = 0
  const { isActive: _active, subscribeResume: _subscribe, ...timerHost } = time.host
  const polling = start(async () => { calls++ }, { intervalMs: 1000, host: timerHost })
  await flush(); assert.equal(calls, 0); assert.equal(events.size, 4)
  document.visibilityState = 'visible'; navigator.onLine = false
  events.get('document:visibilitychange')(); await time.advance(3000); assert.equal(calls, 0)
  navigator.onLine = true; events.get('window:online')()
  await time.advance(1000); assert.equal(calls, 1)
  polling.stop(); assert.equal(events.size, 0); assert.equal(time.timers.size, 0)
})
