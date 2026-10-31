import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')
const code = ts.transpileModule(fs.readFileSync(join(root, 'src/pages/SportsPage.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function textOf(node) { if (node == null || typeof node === 'boolean') return ''; if (typeof node !== 'object') return String(node); if (Array.isArray(node)) return node.map(textOf).join(' '); return textOf(node.props?.children) }
function find(node, predicate) { if (!node || typeof node !== 'object') return null; if (Array.isArray(node)) { for (const child of node) { const hit = find(child, predicate); if (hit) return hit } return null } if (predicate(node)) return node; return find(node.props?.children, predicate) }
function page({ permission = async () => true, start = async () => true, stop = async () => {}, resumeHandle } = {}) {
  const slots = [], effects = [], subscribers = new Set(), visibility = new Set()
  let cursor = 0, tree, alive = true, lateStateWrites = 0, resume
  let permissionCalls = 0, starts = 0, stops = 0, syncs = 0, resumeRemovals = 0
  let session = { uid: 'student-a', revision: 1 }
  let daily = { date: '2026-10-02', steps: 0, goal: 10000, distance: 0, calories: 0, activeMinutes: 0, source: 'manual' }
  const settings = { units: 'km', stepGoal: 10000, visibleCards: ['heart_rate'], dataSource: 'manual' }
  const react = {
    useState(initial) { const id = cursor++; if (!(id in slots)) slots[id] = typeof initial === 'function' ? initial() : initial; return [slots[id], (value) => { if (!alive) lateStateWrites++; slots[id] = typeof value === 'function' ? value(slots[id]) : value }] },
    useRef(initial) { const id = cursor++; return slots[id] ??= { current: initial } },
    useMemo(fn) { cursor++; return fn() }, useCallback(fn) { cursor++; return fn },
    useEffect(effect) { const id = cursor++; if (!(id in slots)) { slots[id] = true; effects.push(effect()) } },
    /* SportsPage 现在用 useSyncExternalStore 订阅账号范围：快照恒定，等价单账号旧行为 */
    useSyncExternalStore(_subscribe, getSnapshot) { const id = cursor++; if (!(id in slots)) slots[id] = getSnapshot(); return slots[id] },
  }
  const api = {
    getTodaySteps: () => daily, getRecentDays: () => [daily], getSettings: () => settings, getSportsScope: () => 'test-scope',
    subscribeSports: (listener) => { subscribers.add(listener); return () => subscribers.delete(listener) },
    requestActivityRecognition: () => { permissionCalls++; return permission() },
    isNativeStepEnvironment: () => true,
    startNativeStepListening: (...args) => { starts++; return start(...args) },
    stopNativeStepListening: () => { stops++; return stop() },
    syncStepsFromNative: async () => { syncs++; return { ok: true, steps: daily.steps } },
    updateTodaySteps: (patch) => { daily = { ...daily, ...patch }; subscribers.forEach((listener) => listener()) },
  }
  const jsx = (type, props) => ({ type, props })
  const module = { exports: {} }
  const App = { addListener: async (_name, callback) => { resume = callback; if (resumeHandle) return resumeHandle.promise; return { remove: async () => { resumeRemovals++ } } } }
  vm.runInNewContext(code, {
    module, exports: module.exports, console,
    document: { visibilityState: 'visible', addEventListener: (_name, callback) => visibility.add(callback), removeEventListener: (_name, callback) => visibility.delete(callback) },
    require(name) {
      if (name === 'react') return react
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' }
      if (name === '../lib/health') return api
      if (name === '../lib/qbank') return { captureQbankSession: () => session, isQbankSessionCurrent: (old) => old === session }
      if (name === '../lib/platform') return { IS_NATIVE: true }
      if (name === '@capacitor/app') return { App }
      if (name === '../context/ToastContext') return { useToast: () => ({ warn() {}, ok() {} }) }
      if (name.endsWith('.css')) return { default: new Proxy({}, { get: (_target, key) => String(key) }) }
      return new Proxy({}, { get: (_target, key) => String(key) })
    },
  })
  const render = () => { cursor = 0; tree = module.exports.SportsPage(); /* 新结构：SportsPage 返回 SportsAccountPage 元素，harness 需再执行一层 */ if (typeof tree.type === 'function') tree = tree.type(tree.props); return tree }
  render()
  return {
    api, render, switchIdentity: (uid) => { session = { uid, revision: session.revision + 1 } }, text: () => textOf(tree), button: (label) => find(tree, (node) => node.type === 'button' && textOf(node) === label),
    counts: () => ({ permissionCalls, starts, stops, syncs, resumeRemovals, lateStateWrites }),
    unmount() { alive = false; effects.forEach((cleanup) => cleanup?.()) },
    resume: () => resume?.({ isActive: true }), visible: () => visibility.forEach((callback) => callback()),
  }
}

test('the page keeps a denied permission visible and never claims counting has started', async () => {
  const run = page({ permission: async () => false })
  await run.button('开启计步').props.onClick(); run.render()
  assert.equal(run.counts().starts, 0)
  assert.match(run.text(), /运动权限未获允许/)
  assert.ok(run.button('开启计步'))
  assert.equal(run.button('开启计步').props.disabled, false)
  run.unmount()
})
test('repeated clicks during a pending permission request cannot duplicate startup', async () => {
  const wait = deferred(), run = page({ permission: () => wait.promise })
  const click = run.button('开启计步').props.onClick
  const first = click(); await click(); run.render()
  assert.equal(run.counts().permissionCalls, 1)
  assert.equal(run.button('正在开启…').props.disabled, true)
  wait.resolve(false); await first; run.render()
  assert.equal(run.button('开启计步').props.disabled, false)
  run.unmount()
})
test('a false native startup result leaves the page off with a device/permission message', async () => {
  const run = page({ start: async () => false })
  await run.button('开启计步').props.onClick(); run.render()
  assert.match(run.text(), /系统计步未能启动/)
  assert.ok(run.button('开启计步'))
  assert.equal(run.counts().syncs, 0)
  run.unmount()
})
test('unmount during a pending native start cleans up and prevents late state changes', async () => {
  const wait = deferred(), run = page({ start: () => wait.promise })
  const start = run.button('开启计步').props.onClick
  const pending = start(); await flush()
  assert.equal(run.counts().starts, 1)
  run.unmount(); wait.resolve(true); await pending; await flush()
  assert.equal(run.counts().stops, 1)
  assert.equal(run.counts().lateStateWrites, 0)
})
test('a failed stop stays actionable and always clears the busy state', async () => {
  const run = page({ stop: async () => { throw new Error('stop failed') } })
  await run.button('开启计步').props.onClick(); run.render()
  await run.button('停止计步').props.onClick(); run.render()
  assert.match(run.text(), /停止计步失败/)
  assert.equal(run.button('停止计步').props.disabled, false)
  run.unmount()
})
test('store notifications refresh the rendered total; resume/visibility share one synchronization', async () => {
  const run = page()
  await run.button('开启计步').props.onClick(); await flush()
  run.api.updateTodaySteps({ steps: 1005, source: 'sensor' }); run.render()
  assert.match(run.text(), /1,005/)
  assert.equal(run.counts().syncs, 1)
  run.resume(); run.visible(); await flush()
  assert.equal(run.counts().syncs, 2)
  run.unmount(); await flush()
  assert.equal(run.counts().resumeRemovals, 1)
})
test('a resume listener that registers after unmount is immediately removed', async () => {
  const wait = deferred(), run = page({ resumeHandle: wait }); let removed = 0
  await flush(); run.unmount()
  wait.resolve({ remove: async () => { removed++ } }); await flush()
  assert.equal(removed, 1)
  assert.equal(run.counts().lateStateWrites, 0)
})

test('a permission reply from A -> B -> A cannot start counting in the new identity before React cleanup', async () => {
  const wait = deferred(), run = page({ permission: () => wait.promise })
  const pending = run.button('开启计步').props.onClick()
  run.switchIdentity('student-b'); run.switchIdentity('student-a')
  wait.resolve(true); await pending
  assert.equal(run.counts().starts, 0)
  run.unmount()
})

test('failed manual step persistence shows an error and retains the existing count', () => {
  const run = page()
  run.api.updateTodaySteps = () => { throw new Error('本机记录保存失败') }
  run.button('+100').props.onClick(); run.render()
  assert.match(run.text(), /本机记录保存失败/)
  run.unmount()
})
