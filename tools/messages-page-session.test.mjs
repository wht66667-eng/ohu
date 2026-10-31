import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const compile = path => ts.transpileModule(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
function load(path, imports = {}, globals = {}, suffix = '') {
  const module = { exports: {} }
  vm.runInNewContext(compile(path) + suffix, { module, exports: module.exports, ...globals,
    require(name) { if (Object.hasOwn(imports, name)) return imports[name]; throw new Error(`Unexpected dependency ${name}`) },
  })
  return module.exports
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const flush = () => new Promise(setImmediate)
const text = value => Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.props?.children) : typeof value === 'string' || typeof value === 'number' ? String(value) : ''
function walk(value) { return Array.isArray(value) ? value.flatMap(walk) : value && typeof value === 'object' ? [value, ...walk(value.props?.children)] : [] }

/** Real header requests/session ownership; children and all network calls are inert. */
function fixture(initialUid = 'A') {
  const asyncOwner = load('src/lib/async-owner.ts')
  const im = load('src/lib/im-session.ts', { './async-owner': asyncOwner })
  const unread = load('src/lib/message-unread-summary.ts')
  let auth = { isSigned: !!initialUid, user: initialUid ? { uid: initialUid } : null }
  im.selectImSession(initialUid)
  const slots = [], intervals = new Map(), window = new EventTarget(), document = new EventTarget()
  document.visibilityState = 'visible'
  let cursor = 0, effects = [], dirty = false, active = true, tree, sequence = 0, staleWrites = 0
  let notify = async () => ({ count: 2, error: null }), requests = async () => ({ rows: [{ id: 1 }], error: null })
  const calls = { notify: 0, requests: 0 }
  window.setInterval = callback => { const id = ++sequence; intervals.set(id, callback); return id }
  window.clearInterval = id => intervals.delete(id)
  const same = (a, b) => a && b && a.length === b.length && a.every((item, i) => Object.is(item, b[i]))
  const hooks = {
    useRef(initial) { return slots[cursor++] ??= { current: initial } },
    useState(initial) {
      const index = cursor++
      slots[index] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [slots[index].value, next => {
        if (!active) staleWrites++
        const value = typeof next === 'function' ? next(slots[index].value) : next
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true }
      }]
    },
    useEffect(callback, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) effects.push({ index, callback, deps }) },
  }
  const jsx = (type, props, key) => ({ type, props, key })
  const page = load('src/pages/MessagesPage.tsx', {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-router-dom': { Link: 'link', useSearchParams: () => [new URLSearchParams()] },
    '../components/CampusIcon': { CampusIcon: 'icon' }, '../components/PageHeader': { PageHeader: 'header' },
    '../lib/auth': { useAuth: () => auth }, '../lib/async-owner': asyncOwner, '../lib/im-session': im,
    '../lib/notify': { fetchUnreadCount: async () => { calls.notify++; return notify() } },
    '../lib/friends': { fetchFriendRequests: async () => { calls.requests++; return requests() } },
    '../lib/message-unread-summary': unread,
    './ChatListPage': { ChatInbox: 'inbox' }, './MessageUpdatesPage': { MessageUpdatesPage: 'updates' },
    './MessagesPage.module.css': new Proxy({}, { get: (_, key) => key }),
  }, { window, document, URLSearchParams }, '\nexports.__Content = MessagesContent;')
  function render() {
    cursor = 0; effects = []; dirty = false; tree = page.__Content()
    for (const { index, callback, deps } of effects) { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: callback() } }
  }
  return {
    calls,
    async render() { render(); await flush(); for (let i = 0; dirty && i < 10; i++) { render(); await flush() } },
    text: () => text(tree),
    notify(operation) { notify = operation }, requests(operation) { requests = operation },
    poll() { for (const callback of intervals.values()) callback() },
    focus() { window.dispatchEvent(new Event('focus')) },
    visible(value) { document.visibilityState = value ? 'visible' : 'hidden'; document.dispatchEvent(new Event('visibilitychange')) },
    setAuth(uid) { im.selectImSession(uid); auth = { isSigned: !!uid, user: uid ? { uid } : null } },
    retry() { walk(tree).find(node => node.type === 'button' && text(node) === '重试').props.onClick() },
    stale: () => staleWrites,
    dispose() { for (const slot of slots) slot?.cleanup?.(); active = false },
  }
}

test('guests never query private notification or friend counts', async () => {
  const f = fixture('')
  try { await f.render(); f.poll(); f.focus(); assert.deepEqual(f.calls, { notify: 0, requests: 0 }); assert.match(f.text(), /登录后查看通知/) } finally { f.dispose() }
})

test('one failed source remains unknown while the successful count remains usable, and retry recovers', async () => {
  const f = fixture()
  try {
    f.notify(async () => { throw new Error('network') }); await f.render()
    assert.match(f.text(), /数量暂未更新/); assert.match(f.text(), /1 条新申请/); assert.doesNotMatch(f.text(), /暂无未读/)
    f.notify(async () => ({ count: 0, error: null })); f.retry(); await f.render()
    assert.match(f.text(), /暂无未读/); assert.doesNotMatch(f.text(), /暂时无法读取/)
  } finally { f.dispose() }
})

test('polling, focus and resume share a request lock, and hidden pages do not refresh', async () => {
  const f = fixture(), pending = deferred()
  try {
    f.notify(() => pending.promise); await f.render(); f.poll(); f.focus(); await f.render()
    assert.deepEqual(f.calls, { notify: 1, requests: 1 })
    pending.resolve({ count: 3, error: null }); await f.render(); f.visible(false); f.poll(); f.focus()
    assert.equal(f.calls.notify, 1)
    f.visible(true); await f.render(); assert.equal(f.calls.notify, 2)
  } finally { f.dispose() }
})

test('A to B to A starts a new request and cannot accept the original A result', async () => {
  const f = fixture(), old = deferred(), current = deferred()
  try {
    f.notify(() => old.promise); await f.render()
    f.notify(() => current.promise); f.setAuth('B'); f.setAuth('A'); await f.render()
    assert.equal(f.calls.notify, 2)
    old.resolve({ count: 99, error: null }); await f.render(); assert.doesNotMatch(f.text(), /99 条未读/)
    current.resolve({ count: 4, error: null }); await f.render(); assert.match(f.text(), /4 条未读/)
    assert.equal(f.stale(), 0)
  } finally { f.dispose() }
})

test('unmounted requests cannot write state or retain refresh listeners', async () => {
  const f = fixture(), pending = deferred()
  f.notify(() => pending.promise); await f.render(); f.dispose()
  pending.resolve({ count: 8, error: null }); await flush(); f.poll(); f.focus()
  assert.equal(f.stale(), 0); assert.equal(f.calls.notify, 1)
})
