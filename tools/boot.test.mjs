import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
const motionModule = { exports: {} }
// animations.ts 也读界面版本（第 4 版走更短的缓动），这里给一个经典版桩即可。
vm.runInNewContext(compile(fs.readFileSync(join(root, 'src/lib/animations.ts'), 'utf8')), {
  module: motionModule,
  exports: motionModule.exports,
  require: (name) => (name === './ui-variant' ? { getUiVariant: () => 'classic' } : {}),
})

function presentation(preview, mounted = false) {
  let removed = 0, exits = 0
  const timers = []
  const splash = { dataset: mounted ? { runtime: '1' } : {}, querySelector: () => null, contains: () => false, remove: () => { removed++ }, style: {}, animate: () => { exits++; return { finished: Promise.resolve() } } }
  const status = { textContent: '' }
  const retry = { hidden: true }
  const document = { documentElement: { classList: { remove() {} } }, activeElement: null, getElementById: (id) => id === 'boot-splash' ? splash : id === 'boot-status' ? status : id === 'boot-retry' ? retry : null, querySelector: () => null }
  const window = { matchMedia: () => ({ matches: true }), setTimeout: (cb) => { timers.push(cb); return 0 }, location: { search: preview ? '?preview=boot' : '' } }
  const source = fs.readFileSync(join(root, 'src/lib/boot.ts'), 'utf8').replaceAll('import.meta.env.DEV', 'true')
  const module = { exports: {} }
  vm.runInNewContext(compile(source), { module, exports: module.exports, require: (name) => {
    if (name === './app-shell') return { getAppShell: () => 'user', SHELL_META: { user: { label: '哦狐' } } }
    assert.equal(name, './animations'); return motionModule.exports
  }, document, window, URLSearchParams })
  return { api: module.exports, counts: () => ({ removed, exits }), timers, retry, status }
}

test('real readiness dismisses immediately with reduced motion and no animation wait', async () => {
  const { api, counts } = presentation(false)
  api.markBootReady('auth'); api.markBootReady('home')
  api.dismissBootSplash('ready')
  await api.whenBootSettled()
  assert.equal(api.bootSettled(), true)
  assert.deepEqual(counts(), { removed: 1, exits: 0 })
})
test('preview dismissal preserves readiness; only explicit close removes it', () => {
  const { api, counts } = presentation(true)
  api.markBootReady('auth'); api.markBootReady('home')
  api.dismissBootSplash('ready'); api.dismissBootSplash('timeout')
  assert.equal(api.isBootReady('home'), true)
  assert.equal(api.bootSettled(), false)
  api.dismissBootSplash('skip'); api.dismissBootSplash('skip')
  assert.deepEqual(counts(), { removed: 1, exits: 0 })
})
test('a mounted app leaves its decorative cover by three seconds without faking readiness', () => {
  const { api, timers, counts } = presentation(false, true)
  assert.equal(api.MAX_BOOT_MS, 3000)
  timers.forEach((timer) => timer())
  assert.equal(api.bootSettled(), true)
  assert.equal(api.isBootReady('auth'), false)
  assert.equal(api.isBootReady('home'), false)
  assert.deepEqual(counts(), { removed: 1, exits: 0 })
})
test('slow initialization preserves the static opening and offers retry', () => {
  const { api, timers, retry, status, counts } = presentation(false)
  api.markBootReady('auth')
  timers.forEach((timer) => timer())
  assert.equal(api.bootSettled(), false)
  assert.equal(retry.hidden, false)
  assert.match(status.textContent, /加载较慢/)
  assert.deepEqual(counts(), { removed: 0, exits: 0 })
})

function gate({ shell = 'user', path = '/', firstRun = true, campus = true, home = false, native = true, width = 390 } = {}) {
  let dismissed = 0, listener
  const readiness = { auth: true, home }
  const mocks = {
    react: { useEffect: (effect) => effect() },
    '../lib/boot': { startBootPresentation: () => () => {}, isBootReady: (key) => readiness[key], dismissBootSplash: () => { dismissed++ }, subscribeBoot: (cb) => { listener = cb; return () => {} } },
    '../lib/app-shell': { getAppShell: () => shell },
    '../lib/campus-gate': { hasCampusGatePass: () => campus },
    '../lib/first-run': { isFirstRunComplete: () => firstRun },
    '../lib/platform': { IS_NATIVE: native },
    '../lib/startup-cover': { mountStartupCover: () => () => {}, updateStartupCover: () => {} },
  }
  const module = { exports: {} }
  vm.runInNewContext(compile(fs.readFileSync(join(root, 'src/components/BootGate.tsx'), 'utf8')), { module, exports: module.exports, require: (name) => mocks[name], window: { innerWidth: width, location: { pathname: path, hash: '' } } })
  module.exports.BootGate()
  return { dismissed: () => dismissed, homeReady() { readiness.home = true; listener() } }
}
test('fresh-install guide and campus login appear as soon as auth is ready', () => {
  assert.equal(gate({ firstRun: false }).dismissed(), 1)
  assert.equal(gate({ campus: false }).dismissed(), 1)
})
test('work shell and deep links do not wait for an unused home query', () => {
  assert.equal(gate({ shell: 'admin' }).dismissed(), 1)
  assert.equal(gate({ path: '/study/focus' }).dismissed(), 1)
})
test('an unlocked homepage waits for its real mounted frame and then exits immediately', () => {
  const run = gate()
  assert.equal(run.dismissed(), 0)
  run.homeReady()
  assert.equal(run.dismissed(), 1)
})

test('startup layout selection uses actual history and never gives anonymous users an achievement', () => {
  const source = fs.readFileSync(join(root, 'src/lib/startup-cover.ts'), 'utf8').replaceAll('import.meta.env.DEV', 'false')
  const module = { exports: {} }
  vm.runInNewContext(compile(source), { module, exports: module.exports, require: () => ({}) })
  const choose = module.exports.chooseStartupLayout
  const unknown = { userId: '', hasHistory: false, pendingSync: true, totalLoginDays: 0, currentStreakDays: 0, missedDays: 0 }
  for (const draw of [0, .2, .5, .7, .999]) assert.notEqual(choose(unknown, () => draw), 'achievement')
  const known = { ...unknown, userId: 'real-user', hasHistory: true, pendingSync: false, totalLoginDays: 7, currentStreakDays: 7 }
  assert.equal(choose(known, () => .5), 'achievement')
  assert.equal(choose({ ...known, missedDays: 3 }, () => .7), 'comic')
  assert.notEqual(choose({ ...known, pendingSync: true }, () => .5), 'achievement')
})

function routeFeedback(reduce = false) {
  let slow = false, scheduled, cleanup, effectMounted = false, cleared = false, animated = 0
  const module = { exports: {} }
  vm.runInNewContext(compile(fs.readFileSync(join(root, 'src/components/RouteLoading.tsx'), 'utf8')), {
    module, exports: module.exports,
    require: (name) => name === 'react' ? {
      useState: () => [slow, (value) => { slow = value }],
      useEffect: (effect) => { if (!effectMounted) { effectMounted = true; cleanup = effect() } },
      useLayoutEffect: (effect) => effect(),
    } : name === 'react/jsx-runtime' ? { jsx: (type, props) => ({ type, props }) }
      : name === 'react-router-dom' ? { useLocation: () => ({ pathname: '/home', search: '' }), useNavigationType: () => 'PUSH' } : {},
    window: { setTimeout: (callback, delay) => { scheduled = { callback, delay }; return 7 }, clearTimeout: (id) => { assert.equal(id, 7); cleared = true }, matchMedia: () => ({ matches: reduce }) },
    document: { activeElement: null, getElementById: () => ({ animate: (frames, timing) => { animated++; assert.equal(timing.duration, 260); assert.equal(frames[0].opacity, .75); return { cancel() {} } } }) },
    getComputedStyle: () => ({ getPropertyValue: (name) => name === '--turn-ms' ? '260ms' : '' }),
  })
  return { api: module.exports, timer: () => scheduled, unmount: () => cleanup(), cleared: () => cleared, animated: () => animated }
}

test('a fast route renders no fox; a still-pending route reveals feedback at 300ms', () => {
  const run = routeFeedback()
  assert.equal(run.api.RouteLoading().props.children, null)
  assert.equal(run.timer().delay, 300)
  run.timer().callback()
  assert.equal(run.api.RouteLoading().props.children.props['data-route-loading'], '')
})

test('leaving a fast route cancels delayed feedback and reduced motion skips the page fade', () => {
  const fast = routeFeedback()
  fast.api.RouteLoading(); fast.unmount()
  assert.equal(fast.cleared(), true)
  fast.api.RouteEntryMotion(); assert.equal(fast.animated(), 1)
  const reduced = routeFeedback(true)
  reduced.api.RouteEntryMotion(); assert.equal(reduced.animated(), 0)
})
