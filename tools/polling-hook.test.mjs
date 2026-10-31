import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')
const code = ts.transpileModule(fs.readFileSync(join(root, 'src/lib/hooks.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve() }
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

/**
 * Hook state/effect lifetimes are real fixture lifetimes. Reads are controlled by
 * the fixture; timing/backoff are covered independently by adaptive-polling tests.
 * All data, authentication, browser events and refresh controllers are doubles.
 */
function hook({ phase = 'ready', uid = 'fixture-a', online = true, load = async () => ({ rows: [], error: null }), deps = [], intervalMs } = {}) {
  const slots = [], controllers = [], refreshSubscribers = new Set(), windowEvents = new Map()
  const navigator = { onLine: online }
  let auth = { phase, user: uid ? { uid } : null }, currentLoad = load, currentDeps = deps, currentInterval = intervalMs
  let cursor = 0, pendingEffects = [], dirty = false, mounted = true, stateWrites = 0, lateStateWrites = 0, view
  const sameDeps = (previous, next) => previous && next && previous.length === next.length && previous.every((item, index) => Object.is(item, next[index]))
  const react = {
    useState(initial) {
      const id = cursor++
      if (!(id in slots)) slots[id] = { kind: 'state', value: typeof initial === 'function' ? initial() : initial }
      return [slots[id].value, next => {
        stateWrites++
        if (!mounted) { lateStateWrites++; return }
        const value = typeof next === 'function' ? next(slots[id].value) : next
        if (!Object.is(value, slots[id].value)) { slots[id].value = value; dirty = true }
      }]
    },
    useRef(initial) {
      const id = cursor++
      if (!(id in slots)) slots[id] = { kind: 'ref', ref: { current: initial } }
      return slots[id].ref
    },
    useCallback(callback, deps) {
      const id = cursor++, previous = slots[id]
      if (!previous || !sameDeps(previous.deps, deps)) slots[id] = { kind: 'callback', value: callback, deps: [...deps] }
      return slots[id].value
    },
    useEffect(effect, deps) {
      const id = cursor++, previous = slots[id]
      if (previous && sameDeps(previous.deps, deps)) return
      const next = { kind: 'effect', deps: deps ? [...deps] : null, cleanup: null }
      slots[id] = next
      pendingEffects.push(() => { previous?.cleanup?.(); next.cleanup = effect() })
    },
  }
  const window = {
    addEventListener(name, listener) {
      if (!windowEvents.has(name)) windowEvents.set(name, new Set())
      windowEvents.get(name).add(listener)
    },
    removeEventListener(name, listener) { windowEvents.get(name)?.delete(listener) },
  }
  const module = { exports: {} }
  vm.runInNewContext(code, {
    module, exports: module.exports, navigator, window, console,
    require(name) {
      if (name === 'react') return react
      if (name === './auth') return { useAuth: () => auth }
      if (name === './native') return { onAppRefresh: listener => { refreshSubscribers.add(listener); return () => refreshSubscribers.delete(listener) } }
      if (name === './adaptive-polling') return { startAdaptivePolling: (run, options) => {
        let flight = null
        const controller = {
          run, options, refreshCalls: 0, stopCalls: 0, stopped: false,
          refresh() {
            controller.refreshCalls++
            if (controller.stopped || navigator.onLine === false) return Promise.resolve()
            if (flight) return flight
            flight = Promise.resolve().then(run).then(() => undefined).finally(() => { flight = null })
            return flight
          },
          stop() { controller.stopCalls++; controller.stopped = true },
        }
        controllers.push(controller)
        return controller
      } }
      throw new Error(`Unexpected hook dependency: ${name}`)
    },
  })
  function render() {
    if (!mounted) return view
    let count = 0
    do {
      if (++count > 10) throw new Error('Fixture render loop')
      dirty = false; cursor = 0; pendingEffects = []
      view = module.exports.usePollingRows(currentLoad, currentDeps, currentInterval)
      for (const effect of pendingEffects) effect()
    } while (dirty)
    return view
  }
  render()
  return {
    render, controllers, navigator,
    snapshot() {
      render()
      return { rows: Array.from(view.rows, row => typeof row === 'object' && row !== null ? { ...row } : row), error: view.error, loading: view.loading }
    },
    reload: () => view.reload(),
    reloadFunction: () => view.reload,
    pullRefresh: () => Promise.all([...refreshSubscribers].map(listener => listener())).then(() => undefined),
    subscribers: () => refreshSubscribers.size,
    listeners: name => windowEvents.get(name)?.size || 0,
    writes: () => stateWrites,
    lateWrites: () => lateStateWrites,
    offline() { navigator.onLine = false; for (const listener of [...(windowEvents.get('offline') || [])]) listener() },
    update({ phase, uid, load, deps, intervalMs } = {}) {
      if (phase !== undefined) auth = { ...auth, phase }
      if (uid !== undefined) auth = { ...auth, user: uid ? { uid } : null }
      if (load !== undefined) currentLoad = load
      if (deps !== undefined) currentDeps = deps
      if (intervalMs !== undefined) currentInterval = intervalMs
      return render()
    },
    unmount() {
      if (!mounted) return
      mounted = false
      for (const slot of slots) if (slot?.kind === 'effect') slot.cleanup?.()
    },
  }
}

test('authentication boot schedules no read and subscribes to no pull refresh until ready', async () => {
  let calls = 0
  const fixture = hook({ phase: 'booting', load: async () => { calls++; return { rows: [], error: null } } })
  assert.equal(fixture.controllers.length, 0); assert.equal(fixture.subscribers(), 0)
  assert.equal(fixture.snapshot().loading, true)
  fixture.reload(); await fixture.pullRefresh(); assert.equal(calls, 0)
  fixture.update({ phase: 'ready' })
  assert.equal(fixture.controllers.length, 1); assert.equal(fixture.subscribers(), 1)
  assert.equal(await fixture.controllers[0].run(), true); assert.equal(calls, 1)
  fixture.unmount()
})

test('successful read returns true, replaces rows, clears error and finishes loading', async () => {
  const fixture = hook({ load: async () => ({ rows: [{ id: 1, title: '合成记录' }], error: null }) })
  assert.equal(await fixture.controllers[0].run(), true)
  assert.deepEqual(fixture.snapshot(), { rows: [{ id: 1, title: '合成记录' }], error: null, loading: false })
  fixture.unmount()
})

test('returned read error reports false while retaining the last successful rows', async () => {
  const results = [{ rows: [{ id: 1 }], error: null }, { rows: [], error: '合成读取失败' }]
  const fixture = hook({ load: async () => results.shift() })
  assert.equal(await fixture.controllers[0].run(), true)
  assert.equal(await fixture.controllers[0].run(), false)
  assert.deepEqual(fixture.snapshot(), { rows: [{ id: 1 }], error: '合成读取失败', loading: false })
  fixture.unmount()
})

test('thrown read error reports false, keeps successful rows and displays a readable error', async () => {
  let calls = 0
  const fixture = hook({ load: async () => { if (++calls === 1) return { rows: [{ id: 2 }], error: null }; throw new Error('fixture failure') } })
  await fixture.controllers[0].run()
  assert.equal(await fixture.controllers[0].run(), false)
  const state = fixture.snapshot()
  assert.deepEqual(state.rows, [{ id: 2 }]); assert.equal(state.loading, false); assert.ok(state.error)
  fixture.unmount()
})

test('cleanup prevents a late successful response from writing state', async () => {
  const pending = deferred(), fixture = hook({ load: () => pending.promise })
  const read = fixture.controllers[0].run()
  fixture.unmount()
  const writes = fixture.writes()
  pending.resolve({ rows: [{ id: 99 }], error: null })
  assert.equal(await read, false)
  assert.equal(fixture.writes(), writes); assert.equal(fixture.lateWrites(), 0)
  assert.equal(fixture.controllers[0].stopCalls, 1)
})

test('cleanup prevents a late rejected response and its finally block from writing state', async () => {
  const pending = deferred(), fixture = hook({ load: () => pending.promise })
  const read = fixture.controllers[0].run()
  fixture.unmount()
  const writes = fixture.writes()
  pending.reject(new Error('late fixture failure'))
  assert.equal(await read, false)
  assert.equal(fixture.writes(), writes); assert.equal(fixture.lateWrites(), 0)
})

test('an account change clears former rows and rejects an old account response after new data arrives', async () => {
  const pending = deferred(), fixture = hook({ load: () => pending.promise })
  const oldRead = fixture.controllers[0].run()
  fixture.update({ uid: 'fixture-b', load: async () => ({ rows: [{ owner: 'fixture-b' }], error: null }) })
  assert.equal(fixture.controllers.length, 2); assert.equal(fixture.controllers[0].stopCalls, 1)
  assert.deepEqual(fixture.snapshot().rows, [])
  assert.equal(await fixture.controllers[1].run(), true)
  const writes = fixture.writes()
  pending.resolve({ rows: [{ owner: 'fixture-a' }], error: null })
  assert.equal(await oldRead, false); assert.equal(fixture.writes(), writes)
  assert.deepEqual(fixture.snapshot().rows, [{ owner: 'fixture-b' }])
  assert.equal(fixture.subscribers(), 1)
  fixture.unmount()
})

test('reload and native pull refresh both use the same controller refresh and pull waits for settlement', async () => {
  const pending = deferred(); let reads = 0
  const fixture = hook({ load: async () => { reads++; return pending.promise } })
  fixture.reload()
  let settled = false
  const pull = fixture.pullRefresh().then(() => { settled = true })
  await flush()
  assert.equal(fixture.controllers[0].refreshCalls, 2); assert.equal(reads, 1); assert.equal(settled, false)
  pending.resolve({ rows: [{ id: 7 }], error: null })
  await pull
  assert.equal(settled, true); assert.deepEqual(fixture.snapshot().rows, [{ id: 7 }])
  fixture.unmount()
})

test('stable reload and existing pull subscriber target the replacement account controller', async () => {
  const fixture = hook({ load: async () => ({ rows: [], error: null }) }), reload = fixture.reloadFunction()
  fixture.update({ uid: 'fixture-b' })
  assert.equal(fixture.reloadFunction(), reload)
  reload(); await fixture.pullRefresh()
  assert.equal(fixture.controllers[0].refreshCalls, 0); assert.equal(fixture.controllers[1].refreshCalls, 2)
  assert.equal(fixture.subscribers(), 1)
  fixture.unmount()
})

test('default read interval is thirty seconds and an explicit eight-second interval is preserved', () => {
  const normal = hook(), explicit = hook({ intervalMs: 8000 })
  assert.equal(normal.controllers[0].options.intervalMs, 30000)
  assert.equal(explicit.controllers[0].options.intervalMs, 8000)
  normal.unmount(); explicit.unmount()
})

test('a changed load callback with identical dependencies is used without creating another scheduler', async () => {
  const fixture = hook({ load: async () => ({ rows: [{ value: 'old' }], error: null }) })
  fixture.update({ load: async () => ({ rows: [{ value: 'new' }], error: null }) })
  assert.equal(fixture.controllers.length, 1)
  await fixture.controllers[0].run()
  assert.deepEqual(fixture.snapshot().rows, [{ value: 'new' }])
  fixture.unmount()
})

test('a dependency or interval change stops the former scheduler while keeping one pull subscription', () => {
  const fixture = hook({ deps: ['first'] })
  fixture.update({ deps: ['second'] })
  fixture.update({ intervalMs: 8000 })
  assert.equal(fixture.controllers.length, 3)
  assert.equal(fixture.controllers[0].stopCalls, 1); assert.equal(fixture.controllers[1].stopCalls, 1)
  assert.equal(fixture.controllers[2].options.intervalMs, 8000)
  assert.equal(fixture.subscribers(), 1); assert.equal(fixture.listeners('offline'), 1)
  fixture.unmount()
})

test('initial offline state ends loading and displays an error without making a read', async () => {
  let calls = 0
  const fixture = hook({ online: false, load: async () => { calls++; return { rows: [], error: null } } })
  const state = fixture.snapshot()
  assert.equal(state.loading, false); assert.ok(state.error)
  fixture.reload(); await fixture.pullRefresh(); assert.equal(calls, 0)
  fixture.unmount()
})

test('offline event retains prior rows, sets an error, ends loading and its listener is removed on cleanup', async () => {
  const fixture = hook({ load: async () => ({ rows: [{ id: 3 }], error: null }) })
  await fixture.controllers[0].run()
  assert.equal(fixture.listeners('offline'), 1)
  fixture.offline()
  const state = fixture.snapshot()
  assert.deepEqual(state.rows, [{ id: 3 }]); assert.ok(state.error); assert.equal(state.loading, false)
  fixture.unmount()
  assert.equal(fixture.listeners('offline'), 0); assert.equal(fixture.subscribers(), 0)
  const writes = fixture.writes()
  fixture.offline(); await fixture.pullRefresh(); fixture.reload()
  assert.equal(fixture.writes(), writes); assert.equal(fixture.lateWrites(), 0)
})

test('unmount releases scheduler and native refresh subscription exactly once', () => {
  const fixture = hook()
  fixture.unmount(); fixture.unmount()
  assert.equal(fixture.controllers[0].stopCalls, 1)
  assert.equal(fixture.subscribers(), 0); assert.equal(fixture.listeners('offline'), 0)
})
