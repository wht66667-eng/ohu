import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const compile = path => ts.transpileModule(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
function load(path, imports = {}, suffix = '') {
  const module = { exports: {} }
  vm.runInNewContext(compile(path) + suffix, { module, exports: module.exports, require(name) { if (Object.hasOwn(imports, name)) return imports[name]; throw new Error(`Unexpected dependency: ${name}`) } })
  return module.exports
}
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }
const flush = () => new Promise(setImmediate)
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : typeof value === 'string' || typeof value === 'number' ? String(value) : ''
function walk(value) { return Array.isArray(value) ? value.flatMap(walk) : value && typeof value === 'object' ? [value, ...walk(value.props?.children), ...walk(value.props?.right), ...walk(value.props?.action)] : [] }
const note = (id, uid = 'A', read = false) => ({ id, uid, title: `Synthetic notification ${id}`, body: 'In-memory test only', kind: 'todo_due', link: `/todo?sample=${id}`, ref_id: null, read_at: read ? '2026-01-01T00:00:00Z' : null, created_at: '2026-01-01T00:00:00Z' })

/** Actual page/session code. Polling and mark-read RPCs are inert and never send notifications. */
function fixture(initialUid = 'A') {
  const asyncOwner = load('src/lib/async-owner.ts'), im = load('src/lib/im-session.ts', { './async-owner': asyncOwner })
  let auth = { isSigned: !!initialUid, user: initialUid ? { uid: initialUid } : null, ensureSignedIn: async () => true }
  im.selectImSession(initialUid)
  let instance, cursor = 0, effects = [], tree, overrideRows = null
  let markRead = async () => ({ error: null }), markAll = async () => ({ error: null })
  const calls = { read: [], all: 0, reload: 0, nav: [], ok: [], errors: [], staleWrites: 0, snapshots: [] }
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))
  const hooks = {
    useState(initial) {
      const index = cursor++, owner = instance
      owner.slots[index] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [owner.slots[index].value, value => { if (!owner.active) calls.staleWrites++; owner.slots[index].value = typeof value === 'function' ? value(owner.slots[index].value) : value }]
    },
    useRef(initial) { return instance.slots[cursor++] ??= { current: initial } },
    useEffect(callback, deps) { const index = cursor++; if (!same(instance.slots[index]?.deps, deps)) effects.push({ index, callback, deps }) },
    useSyncExternalStore(_subscribe, snapshot) {
      const first = snapshot(), second = snapshot()
      assert.equal(Object.is(first, second), true, 'unchanged IM snapshots must be stable')
      assert.equal(typeof first, 'number', 'the page subscribes to a stable revision primitive')
      calls.snapshots.push(first)
      return first
    },
  }
  const jsx = (type, props, key) => ({ type, props: props || {}, key })
  const toast = { ok: message => calls.ok.push(message), err: message => calls.errors.push(message) }
  const css = { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) }
  const page = load('src/pages/NotifyPage.tsx', {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
    'react-router-dom': { useNavigate: () => route => calls.nav.push(route) },
    '../lib/auth': { useAuth: () => auth }, '../lib/im-session': im,
    '../lib/hooks': { usePollingRows: () => ({ rows: overrideRows ?? (auth.user ? [note(1, auth.user.uid), note(2, auth.user.uid, true)] : []), error: null, loading: false, reload: () => { calls.reload++ } }) },
    '../lib/notify': { fetchNotifications: async () => ({ rows: [], error: null }), notifyMarkRead: async ids => { calls.read.push([...ids]); return markRead(ids) }, notifyMarkAllRead: async () => { calls.all++; return markAll() }, notifyMeta: () => ({ emoji: 'local' }), relTime: () => 'Synthetic time' },
    '../context/ToastContext': { useToast: () => toast },
    '../lib/ui-variant': { useUiVariant: () => 'pure', isFoxFreeVariant: () => true },
    '../components/PageHeader': { PageHeader: 'header' }, '../components/fox/FoxAvatar': { FoxAvatar: 'fox' },
    '../components/ui/StateViews': { DeniedState: 'denied', EmptyState: 'empty', ErrorState: 'error', LoadingState: 'loading' },
    './work.module.css': css, './me.module.css': css,
  }, '\nexports.__Content = NotifyContent;')
  function dispose() { if (!instance) return; for (const slot of instance.slots) slot?.cleanup?.(); instance.active = false }
  function render() {
    const entry = page.NotifyPage()
    if (!instance || instance.key !== entry.key) { dispose(); instance = { key: entry.key, slots: [], active: true } }
    cursor = 0; effects = []; tree = page.__Content()
    for (const { index, callback, deps } of effects) { instance.slots[index]?.cleanup?.(); instance.slots[index] = { deps, cleanup: callback() } }
    return tree
  }
  render()
  return { calls, render, dispose,
    rows(rows) { overrideRows = rows },
    setAuth(uid) { im.selectImSession(uid); auth = { ...auth, isSigned: !!uid, user: uid ? { uid } : null } },
    markRead(operation) { markRead = operation }, markAll(operation) { markAll = operation },
    item(id) { return walk(tree).find(node => node.type === 'button' && node.key === id) },
    allButton() { return walk(tree).find(node => node.type === 'button' && text(node).startsWith('全部已读')) },
    retry() { return walk(tree).find(node => node.type === 'button' && text(node) === '重试操作') },
    error() { return walk(tree).find(node => node.type === 'error' && node.props.title === '通知操作未完成') },
    state(type) { return walk(tree).find(node => node.type === type) },
    busy() { return !!tree.props['aria-busy'] }, key() { return instance.key },
  }
}

test('single-row marking holds one synchronous lock against repeat clicks and mark-all, and disables actions until completion', async () => {
  const f = fixture(), pending = deferred()
  try {
    f.markRead(() => pending.promise)
    const click = f.item(1).props.onClick
    click(); click(); f.allButton().props.onClick(); f.render()
    assert.deepEqual(f.calls.read, [[1]]); assert.equal(f.calls.all, 0)
    assert.equal(f.item(1).props.disabled, true); assert.equal(f.item(2).props.disabled, true); assert.equal(f.allButton().props.disabled, true)
    assert.deepEqual(f.calls.nav, []); assert.equal(f.calls.reload, 0)
    pending.resolve({ error: null }); await flush(); f.render()
    assert.deepEqual(f.calls.nav, ['/todo?sample=1']); assert.equal(f.calls.reload, 1); assert.equal(f.busy(), false)
  } finally { f.dispose() }
})

test('mark-all uses the same lock before React renders the busy state', async () => {
  const f = fixture(), pending = deferred()
  try {
    f.markAll(() => pending.promise)
    const click = f.allButton().props.onClick
    click(); click(); f.item(1).props.onClick(); f.render()
    assert.equal(f.calls.all, 1); assert.equal(f.calls.read.length, 0); assert.equal(f.busy(), true)
    pending.resolve({ error: null }); await flush(); f.render()
    assert.deepEqual(f.calls.ok, ['已全部标记为已读']); assert.equal(f.calls.reload, 1); assert.equal(f.busy(), false)
  } finally { f.dispose() }
})

test('a failed mark-read keeps the user on the notification page and offers a working retry', async () => {
  const f = fixture()
  try {
    f.markRead(async () => ({ error: 'Synthetic mark-read rejection' }))
    f.item(1).props.onClick(); await flush(); f.render()
    assert.deepEqual(f.calls.nav, []); assert.equal(f.calls.reload, 0); assert.equal(f.busy(), false)
    assert.match(f.error().props.hint, /Synthetic mark-read rejection/); assert.equal(f.retry().props.disabled, false)
    f.markRead(async () => ({ error: null })); f.retry().props.onClick(); await flush(); f.render()
    assert.equal(f.calls.read.length, 2); assert.deepEqual(f.calls.nav, ['/todo?sample=1']); assert.equal(f.calls.reload, 1); assert.equal(f.error(), undefined)
  } finally { f.dispose() }
})

test('a thrown mark-all error clears busy state and retry succeeds without navigation', async () => {
  const f = fixture()
  try {
    f.markAll(async () => { throw new Error('Synthetic bridge rejection') })
    f.allButton().props.onClick(); await flush(); f.render()
    assert.equal(f.busy(), false); assert.match(f.error().props.hint, /Synthetic bridge rejection/)
    assert.deepEqual(f.calls.nav, []); assert.equal(f.calls.reload, 0); assert.deepEqual(f.calls.ok, [])
    f.markAll(async () => ({ error: null })); f.retry().props.onClick(); await flush(); f.render()
    assert.equal(f.calls.all, 2); assert.equal(f.calls.reload, 1); assert.deepEqual(f.calls.ok, ['已全部标记为已读'])
  } finally { f.dispose() }
})

test('A to B to A during a row write cannot navigate, toast, refresh, or unlock the new A operation', async () => {
  const f = fixture(), old = deferred(), next = deferred()
  try {
    const oldKey = f.key(); f.markRead(() => old.promise); f.item(1).props.onClick()
    f.setAuth('B'); f.setAuth('A'); f.render()
    assert.notEqual(f.key(), oldKey)
    f.markAll(() => next.promise); f.allButton().props.onClick(); f.render()
    old.resolve({ error: null }); await flush(); f.render()
    assert.deepEqual(f.calls.nav, []); assert.deepEqual(f.calls.ok, []); assert.deepEqual(f.calls.errors, []); assert.equal(f.calls.reload, 0)
    assert.equal(f.busy(), true); assert.equal(f.calls.staleWrites, 0)
    next.resolve({ error: null }); await flush(); f.render()
    assert.equal(f.busy(), false); assert.equal(f.calls.reload, 1); assert.deepEqual(f.calls.ok, ['已全部标记为已读'])
  } finally { f.dispose() }
})

test('A to B to A before React rerenders still suppresses the obsolete mark-all error and old DOM actions', async () => {
  const f = fixture(), pending = deferred()
  try {
    f.markAll(() => pending.promise); const oldClick = f.item(1).props.onClick
    f.allButton().props.onClick(); f.setAuth('B'); f.setAuth('A')
    pending.resolve({ error: 'Synthetic old-owner error' }); await flush()
    oldClick(); await flush()
    assert.deepEqual(f.calls.errors, []); assert.deepEqual(f.calls.ok, []); assert.deepEqual(f.calls.nav, [])
    assert.equal(f.calls.reload, 0); assert.equal(f.calls.read.length, 0)
    f.render(); assert.equal(f.busy(), false)
  } finally { f.dispose() }
})

for (const action of ['row', 'all']) test(`unmount during ${action} marking suppresses late results and state writes`, async () => {
  const f = fixture(), pending = deferred()
  if (action === 'row') { f.markRead(() => pending.promise); f.item(1).props.onClick() }
  else { f.markAll(() => pending.promise); f.allButton().props.onClick() }
  f.dispose(); pending.resolve({ error: null }); await flush()
  assert.deepEqual(f.calls.nav, []); assert.deepEqual(f.calls.ok, []); assert.deepEqual(f.calls.errors, [])
  assert.equal(f.calls.reload, 0); assert.equal(f.calls.staleWrites, 0)
})

test('foreign-owner rows are hidden and guests keep the current notification description', () => {
  const signed = fixture()
  try { signed.rows([note(77, 'B')]); signed.render(); assert.equal(signed.item(77), undefined); assert.equal(signed.allButton().props.disabled, true) } finally { signed.dispose() }
  const guest = fixture('')
  try {
    const hint = guest.state('denied').props.hint
    assert.match(hint, /待办.*公益.*审核/); assert.doesNotMatch(hint, /订单|提现|结算/)
    guest.allButton().props.onClick(); assert.equal(guest.calls.all, 0)
  } finally { guest.dispose() }
})
