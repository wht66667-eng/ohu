import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const compile = path => ts.transpileModule(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replaceAll('import.meta.env.BASE_URL', JSON.stringify('/')), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
function load(path, imports = {}, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(compile(path), { module, exports: module.exports, ...globals, require(name) { if (Object.hasOwn(imports, name)) return imports[name]; throw new Error(`Unexpected dependency: ${name}`) } })
  return module.exports
}
const jsx = (type, props, key) => ({ type, props: props || {}, key })
const jsxRuntime = { jsx, jsxs: jsx }
const css = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) }
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : typeof value === 'string' || typeof value === 'number' ? String(value) : ''
const walk = value => Array.isArray(value) ? value.flatMap(walk) : value && typeof value === 'object' ? [value, ...walk(value.props?.children)] : []
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }
const flush = () => new Promise(setImmediate)
const workAccess = load('src/lib/work-access.ts')

/** Actual WorkAccessGate, synthetic auth, no SDK/notification bridge or real account data. */
function gate({ phase = 'signed', profile = { isAdmin: false }, logout, reload } = {}) {
  const asyncOwner = load('src/lib/async-owner.ts'), im = load('src/lib/im-session.ts', { './async-owner': asyncOwner })
  let auth = { phase, isSigned: phase === 'signed', user: phase === 'signed' ? { uid: 'synthetic-A' } : null, profile }
  im.selectImSession(auth.user?.uid || '')
  let slots = [], cursor = 0, active = true, tree
  const cleanups = [], calls = { logout: 0, reload: 0, lateWrites: 0 }
  auth.logout = async () => { calls.logout++; await logout?.() }
  const hooks = {
    useState(initial) { const index = cursor++; slots[index] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[index].value, value => { if (!active) calls.lateWrites++; slots[index].value = typeof value === 'function' ? value(slots[index].value) : value }] },
    useRef(initial) { return slots[cursor++] ??= { current: initial } },
    useEffect(effect) { const index = cursor++; if (!slots[index]) { slots[index] = {}; cleanups.push(effect()) } },
  }
  const api = load('src/components/WorkPhoneGate.tsx', {
    react: hooks, 'react/jsx-runtime': jsxRuntime, 'motion/react': { motion: { div: 'motion-div' }, useReducedMotion: () => false },
    './PasswordInput': { PasswordInput: 'password' }, '../lib/auth': { useAuth: () => auth }, '../lib/im-session': im,
    '../lib/app-shell': { getAppShell: () => 'admin', SHELL_META: { admin: { label: 'Synthetic admin' } } }, '../lib/work-access': workAccess,
    '../lib/motion-pref': { enterMotion: () => ({}) }, '../lib/ui-variant': { isFoxFreeVariant: () => true, useUiVariant: () => 'pure' },
    './CampusGate.module.css': css,
  }, { window: { location: { reload() { calls.reload++; reload?.() } } } })
  function render() { cursor = 0; tree = api.WorkAccessGate(); return tree }
  render()
  return { api, hooks, calls, render,
    text: () => text(tree), busy: () => tree.props['aria-busy'],
    button(label) { return walk(tree).find(node => node.type === 'button' && text(node) === label) },
    changeIdentity(uid) { im.selectImSession(uid); auth = { ...auth, user: uid ? { uid } : null, isSigned: !!uid, phase: uid ? 'signed' : 'guest' } },
    dispose() { cleanups.forEach(cleanup => cleanup?.()); active = false },
  }
}

function shell({ shell = 'admin', phase = 'signed', profile = { isAdmin: false }, firstRun = true, pathname = '/admin/content' } = {}) {
  const state = { phase, isSigned: phase === 'signed', user: phase === 'signed' ? { uid: 'synthetic-A' } : null, profile }
  const WorkAccessGate = () => null, WorkPhoneGate = () => null
  const imports = {
    react: { useEffect() {}, useLayoutEffect() {}, useRef: value => ({ current: value }), useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}] },
    'react/jsx-runtime': jsxRuntime,
    'react-router-dom': { useLocation: () => ({ pathname, key: 'synthetic' }), useNavigate: () => () => {}, useNavigationType: () => 'POP' },
    '../lib/auth': { useAuth: () => state }, '../lib/app-shell': { getAppShell: () => shell, isWorkShell: value => value === 'admin', initAppShell: async () => shell },
    '../lib/work-access': workAccess, '../lib/first-run': { isFirstRunComplete: () => firstRun },
    '../lib/ui-variant': { useUiVariant() {}, restoreUiVariant: async () => {} }, '../lib/use-keyboard-inset': { useKeyboardInset() {} },
    './fox/useFoxCodexProgress': { useFoxCodexProgress() {} },
    '../services/focus': { isFocusImmersive: () => false }, '../lib/platform': { IS_NATIVE: false },
    './WorkPhoneGate': { WorkAccessGate, WorkPhoneGate },
    './usePullRefresh': { usePullRefresh: () => ({}) }, './PhoneShell.module.css': css,
    '../context/ToastContext': { ToastProvider: 'toast-provider' }, '../context/FocusTimerContext': { FocusTimerProvider: 'focus-provider', FocusTimerBar: 'focus-bar' },
    '../lib/auth-ui': { AuthSheets: 'auth-sheets' }, '../lib/toast': { Toaster: 'toaster' },
    '../ota-ready': { confirmOtaAppReady: async () => {} },
    '../lib/back': {}, '../lib/study-back-history': {}, '../lib/native': {}, '../lib/schedule-cache': {}, '../lib/auto-sync': {}, '../lib/campus-account': {}, '../lib/engagement': {},
  }
  for (const component of ['PublishSheet', 'TabBar', 'RemindHost', 'AwayLoginHost', 'FirstRunHost', 'OtaUpdateHost', 'ShellNotifyHost', 'ShellRouteGuard']) imports[`./${component}`] = { [component]: component }
  for (const component of ['FoxPresenceHost', 'FoxMoment']) imports[`./fox/${component}`] = { [component]: component }
  const api = load('src/components/PhoneShell.tsx', imports), content = jsx('business', { children: 'Synthetic protected business page' })
  const tree = api.PhoneShell({ children: content }), nodes = walk(tree)
  return { hasBusiness: nodes.includes(content), has: type => nodes.some(node => node.type === type), hasAccessGate: nodes.some(node => node.type === WorkAccessGate), hasLoginGate: nodes.some(node => node.type === WorkPhoneGate) }
}

test('ordinary signed accounts cannot enter admin pages and retain the access gate instead of an empty shell', () => {
  const actual = shell()
  assert.equal(actual.hasBusiness, false); assert.equal(actual.hasAccessGate, true); assert.equal(actual.hasLoginGate, false); assert.equal(actual.has('TabBar'), false)
})

test('guest, restoration and unknown-role states remain blocked with their appropriate visible gate', () => {
  const guest = shell({ phase: 'guest', profile: null }), booting = shell({ phase: 'booting', profile: null }), unknown = shell({ profile: null })
  assert.equal(guest.hasBusiness, false); assert.equal(guest.hasLoginGate, true)
  assert.equal(booting.hasBusiness, false); assert.equal(booting.hasAccessGate, true)
  assert.equal(unknown.hasBusiness, false); assert.equal(unknown.hasAccessGate, true)
  const loading = gate({ phase: 'booting', profile: null }), unconfirmed = gate({ profile: null })
  try { assert.match(loading.text(), /正在恢复登录状态/); assert.match(unconfirmed.text(), /权限尚未确认/); assert.equal(unconfirmed.button('重新检查权限').props.disabled, false) } finally { loading.dispose(); unconfirmed.dispose() }
})

test('admin and superadmin accounts retain protected pages, while first-run consent still precedes access', () => {
  for (const profile of [{ isAdmin: true }, { isAdmin: false, isSuperAdmin: true }]) {
    const allowed = shell({ profile }); assert.equal(allowed.hasBusiness, true); assert.equal(allowed.hasAccessGate, false); assert.equal(allowed.has('TabBar'), true)
    const consent = shell({ profile, firstRun: false }); assert.equal(consent.hasBusiness, false); assert.equal(consent.has('FirstRunHost'), true); assert.equal(consent.hasAccessGate, false)
  }
})

test('student pages retain guest access, login sheets and reminders without global mascot overlays', () => {
  for (const pathname of ['/', '/profile', '/services', '/campus-map', '/schedule', '/todo', '/library', '/campus-card', '/chat']) {
    const actual = shell({ shell: 'user', phase: 'guest', profile: null, pathname })
    assert.equal(actual.hasBusiness, true, pathname)
    assert.equal(actual.has('auth-sheets'), true, pathname)
    assert.equal(actual.has('RemindHost'), true, pathname)
    assert.equal(actual.hasAccessGate, false, pathname)
    for (const overlay of ['FoxPresenceHost', 'FoxMoment', 'AwayLoginHost']) assert.equal(actual.has(overlay), false, `${pathname}: ${overlay}`)
  }
})

test('codex history continues recording earned expressions without rendering an overlay', () => {
  const store = new Map(), writes = []
  const localStorage = { getItem: key => store.get(key) ?? null, setItem(key, value) { store.set(key, value); writes.push(value) } }
  const codex = load('src/components/fox/FoxCodex.tsx', {
    react: {}, 'react/jsx-runtime': jsxRuntime,
    '../../lib/fox-labels': {}, '../../lib/fox-sheet': {}, './FoxSheetPose': {}, '../ui/DialogLayer': {}, './useFoxState': {}, '../../lib/ui-variant': {}, './FoxCodex.module.css': css,
  }, { localStorage })
  let snapshot = { iconState: 'streak_3' }
  const hook = load('src/components/fox/useFoxCodexProgress.ts', {
    react: { useEffect(effect) { effect() } }, './FoxCodex': codex, './useFoxState': { useFoxState: () => snapshot },
  }).useFoxCodexProgress
  hook(false)
  assert.equal(writes.length, 0, 'work or incomplete first-run states must not record progress')
  assert.equal(hook(true), undefined, 'progress tracking has no visible render output')
  hook(true)
  assert.deepEqual(JSON.parse(store.get('sc.fox.codex.v1')), ['streak_3'])
  assert.equal(writes.length, 1, 'repeated state does not duplicate history')
  snapshot = { iconState: 'away_5' }; hook(true)
  snapshot = { iconState: 'default' }; hook(true)
  assert.deepEqual(JSON.parse(store.get('sc.fox.codex.v1')), ['streak_3', 'away_5'])
  snapshot = null; hook(true)
  assert.equal(writes.length, 2, 'missing and default states do not unlock expressions')
})

test('permission retry reloads the current auth flow once and can recover from reload failure', () => {
  let fail = true
  const f = gate({ profile: null, reload: () => { if (fail) throw new Error('Synthetic reload failure') } })
  try {
    f.button('重新检查权限').props.onClick(); f.render(); assert.match(f.text(), /暂时无法重新检查权限/)
    fail = false
    const click = f.button('重新检查权限').props.onClick; click(); click(); f.render()
    assert.equal(f.calls.reload, 2); assert.equal(f.button('正在重新检查…').props.disabled, true); assert.equal(f.button('退出并更换账号').props.disabled, true)
  } finally { f.dispose() }
})

test('changing accounts waits for the real logout API, locks repeats and exposes a retryable failure without fake navigation', async () => {
  const wait = deferred(), f = gate({ logout: () => wait.promise })
  try {
    const click = f.button('退出并更换账号').props.onClick; click(); click(); f.render()
    assert.equal(f.calls.logout, 1); assert.equal(f.button('正在退出…').props.disabled, true); assert.equal(f.calls.reload, 0)
    wait.reject(new Error('Synthetic logout failure')); await flush(); f.render()
    assert.match(f.text(), /Synthetic logout failure/); assert.equal(f.button('退出并更换账号').props.disabled, false)
    assert.equal(f.calls.reload, 0)
  } finally { f.dispose() }
})

test('late logout failure after unmount or A to B to A cannot write an obsolete access message', async () => {
  for (const unmount of [false, true]) {
    const wait = deferred(), f = gate({ logout: () => wait.promise })
    f.button('退出并更换账号').props.onClick()
    if (unmount) f.dispose(); else { f.changeIdentity('synthetic-B'); f.changeIdentity('synthetic-A') }
    wait.reject(new Error('Synthetic old-account logout failure')); await flush()
    assert.equal(f.calls.lateWrites, 0)
    if (!unmount) { f.render(); assert.doesNotMatch(f.text(), /old-account logout failure/); f.dispose() }
  }
})
