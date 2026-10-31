import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const compile = path => ts.transpileModule(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText
const flush = () => new Promise(setImmediate)
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const rows = (first, last) => Array.from({ length: last - first + 1 }, (_, i) => ({
  id: first + i, thread_id: 7, sender_uid: 'peer', body: `synthetic-${first + i}`, kind: 'text', is_mine: false,
  created_at: '2026-10-09T00:00:00Z',
}))
const page = (items, more = false) => ({ error: null, data: { items, has_more: more, next_cursor: more && items.length ? { before_id: items[0].id } : null } })

function load(code, injected) {
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, require: name => injected[name] })
  return module.exports
}

/** Actual component/hook control flow with inert RPCs and a deterministic scroll surface. No user data or writes. */
function fixture(options = {}) {
  const asyncOwner = load(compile('src/lib/async-owner.ts'), {})
  const im = load(compile('src/lib/im-session.ts'), { './async-owner': asyncOwner })
  let auth = { isSigned: true, user: { uid: 'A', isAnonymous: false }, ensureSignedIn: async () => true }
  im.selectImSession('A')
  let route = '7', instance, tree, cursor = 0
  const calls = { fetch: [], send: [], upload: [], mark: [], staleWrites: 0 }
  const intervals = new Map(), scrollWrites = [], notices = []
  let sequence = 0, fetch = options.fetch || (async (_, before) => before == null ? page(rows(31, 60), true) : page(rows(1, 30)))
  let upload = options.upload || (async () => ({ error: null, url: 'https://fixture.invalid/image.png' }))
  let send = options.send || (async () => ({ error: null, data: { message: { ...rows(61, 61)[0], is_mine: true } } }))
  let messageIds = [], hasMore = false, optimistic = 0, scrollTop = 0
  const dom = {
    clientHeight: 200,
    get scrollHeight() { return messageIds.length * 40 + (hasMore ? 44 : 0) + optimistic * 40 },
    get scrollTop() { return scrollTop },
    set scrollTop(value) { scrollTop = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); scrollWrites.push(scrollTop) },
    getBoundingClientRect: () => ({ top: 100, bottom: 300 }),
    querySelectorAll() { return messageIds.map((id, index) => ({ dataset: { messageId: String(id) }, getBoundingClientRect: () => ({ top: 100 + (hasMore ? 44 : 0) + index * 40 - scrollTop, bottom: 140 + (hasMore ? 44 : 0) + index * 40 - scrollTop }) })) },
    querySelector(selector) { const id = selector.match(/"(\d+)"/)?.[1]; return this.querySelectorAll().find(node => node.dataset.messageId === id) || null },
  }
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  const hooks = {
    useState(initial) {
      const i = cursor++, owner = instance
      owner.slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [owner.slots[i].value, value => {
        if (!owner.active) calls.staleWrites++
        const next = typeof value === 'function' ? value(owner.slots[i].value) : value
        if (!Object.is(next, owner.slots[i].value)) { owner.slots[i].value = next; owner.dirty = true }
      }]
    },
    useRef(initial) { return instance.slots[cursor++] ??= { current: initial } },
    useCallback(fn, deps) {
      const i = cursor++
      if (!instance.slots[i] || !same(instance.slots[i].deps, deps)) instance.slots[i] = { deps, value: fn }
      return instance.slots[i].value
    },
    useEffect(fn, deps) { effect(fn, deps, false) },
    useLayoutEffect(fn, deps) { effect(fn, deps, true) },
  }
  function effect(fn, deps, layout) {
    const i = cursor++, old = instance.slots[i]
    if (!old || !same(old.deps, deps)) instance.effects.push({ i, fn, deps, layout })
  }
  const noop = () => null
  function jsx(type, props, key) {
    const node = { type, props: props || {}, key }
    if (type === 'div' && props?.className?.startsWith('list ')) {
      const children = walk(props.children)
      messageIds = children.filter(child => child.props?.['data-message-id'] != null).map(child => child.props['data-message-id'])
      hasMore = children.some(child => child.props?.className === 'moreRow')
      optimistic = children.filter(child => String(child.key || '').startsWith('out-')).length
      props.ref.current = dom
    } else if (props?.ref) props.ref.current = { focus: noop, setSelectionRange: noop, selectionStart: 0, selectionEnd: 0 }
    return node
  }
  const toast = Object.assign(message => notices.push(message), { err: message => notices.push(message) })
  const overrides = {
    '../lib/keyboard-viewport': load(compile('src/lib/keyboard-viewport.ts'), {}),
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-router-dom': { useParams: () => ({ id: route }), useNavigate: () => noop, Link: 'link' },
    '../lib/auth': { useAuth: () => auth }, '../lib/async-owner': asyncOwner, '../lib/im-session': im,
    '../context/ToastContext': { useToast: () => toast },
    '../lib/market': { queryRows: async () => ({ rows: [{ id: 7, user_uid: 'A', peer_uid: 'peer', user_name: 'A', peer_name: 'Peer', topic_title: '', topic_type: '', topic_id: null }] }) },
    '../lib/chat-image': { uploadChatImage: async (file, uid) => { calls.upload.push({ file, uid }); return upload(file, uid) } },
    '../lib/chat': {
      CHAT_MSG_PAGE_SIZE: 30,
      fetchChatMessages: async (id, _, before) => { calls.fetch.push({ id, before }); return fetch(id, before) },
      chatMarkRead: async id => { calls.mark.push(id); return { error: null } },
      chatSendMessage: async (id, body) => { calls.send.push({ id, body }); return send(id, body) },
      chatSendImage: async (id, url) => { calls.send.push({ id, url }); return send(id, url) },
      chatBubbleTime: () => '', chatTopicLabel: () => '', chatTopicPath: () => null,
    },
    /* 学院群：会话头显示群名与成员数、群内发送走这条通道（桩里只记录调用） */
    '../lib/college-group': {
      collegeName: () => '',
      fetchCollegeGroups: async () => [],
      sendCollegeGroupMessage: async (id, body) => { calls.send.push({ id, body }); return send(id, body) },
      sendCollegeGroupImage: async (id, url) => { calls.send.push({ id, url }); return send(id, url) },
    },
    '../components/Icons': { IconBack: noop, IconImage: noop, IconSend: noop, IconSmile: noop },
    '../components/ui/StateViews': { ErrorState: 'error-state' },
    '../components/ImageSourceSheet': { ImageSourceSheet: 'image-source' }, '../components/StickerPanel': { StickerPanel: 'sticker-panel' },
    '../components/ImageUploadField': { ImagePickButton: 'image-pick' },
    './ChatRoomPage.module.css': { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) },
  }
  const module = { exports: {} }
  vm.runInNewContext(compile('src/pages/ChatRoomPage.tsx') + '\nexports.__Content = ChatRoomContent;', {
    module, exports: module.exports, console, document: { visibilityState: 'visible' }, requestAnimationFrame: fn => fn(),
    window: { setInterval: fn => { const id = ++sequence; intervals.set(id, fn); return id }, clearInterval: id => intervals.delete(id) },
    require: name => { if (Object.hasOwn(overrides, name)) return overrides[name]; throw new Error(`Unexpected dependency: ${name}`) },
  })
  function render() {
    const entry = module.exports.ChatRoomPage()
    if (!instance || instance.key !== entry.key) {
      if (instance) { for (const slot of instance.slots) slot?.cleanup?.(); instance.active = false }
      instance = { key: entry.key, slots: [], effects: [], active: true, dirty: false }
      scrollTop = 0
    }
    cursor = 0; instance.dirty = false; instance.effects = []
    tree = module.exports.__Content(entry.props)
    for (const layout of [true, false]) for (const pending of instance.effects.filter(item => item.layout === layout)) {
      instance.slots[pending.i]?.cleanup?.()
      instance.slots[pending.i] = { deps: pending.deps, cleanup: pending.fn() }
    }
    return tree
  }
  return {
    calls, dom, scrollWrites, notices,
    async render() { render(); await flush(); for (let i = 0; instance.dirty && i < 10; i++) { render(); await flush() } return tree },
    setAuth(uid) { im.selectImSession(uid); auth = { ...auth, isSigned: !!uid, user: uid ? { uid, isAnonymous: false } : null } },
    route(value) { route = value }, fetch(fn) { fetch = fn }, upload(fn) { upload = fn }, send(fn) { send = fn },
    find(predicate) { return walk(tree).find(predicate) }, ids() { return [...messageIds] },
    poll() { for (const fn of intervals.values()) fn() },
    scroll(value) { dom.scrollTop = value; this.find(node => node.props?.className?.startsWith('list ')).props.onScroll() },
    dispose() { for (const slot of instance?.slots || []) slot?.cleanup?.(); if (instance) instance.active = false },
  }
}

function walk(value) {
  if (Array.isArray(value)) return value.flatMap(walk)
  if (!value || typeof value !== 'object') return []
  return [value, ...walk(value.props?.children)]
}
const text = node => walk(node).flatMap(value => [value.props?.children]).flat(Infinity).filter(value => typeof value === 'string' || typeof value === 'number').join('')
const moreButton = f => f.find(node => node.type === 'button' && text(node).includes('查看更早'))

test('logout hides private content and late old polling cannot write into the new account', async () => {
  const f = fixture()
  try {
    await f.render(); assert.equal(f.ids().length, 30)
    const pending = deferred(); f.fetch(() => pending.promise); f.poll()
    f.setAuth(null); await f.render(); assert.deepEqual(f.ids(), [])
    f.setAuth('B'); f.fetch(async () => page([])); await f.render()
    pending.resolve(page(rows(91, 91))); await f.render()
    assert.deepEqual(f.ids(), []); assert.equal(f.calls.staleWrites, 0)
  } finally { f.dispose() }
})

test('A to B to A invalidates in-flight work even before React renders either change', async () => {
  const f = fixture()
  try {
    await f.render(); const pending = deferred(); f.fetch(() => pending.promise); f.poll()
    f.setAuth('B'); f.setAuth('A'); f.fetch(async () => page(rows(31, 60), true)); pending.resolve(page(rows(91, 91))); await f.render()
    assert(!f.ids().includes(91)); assert.equal(f.calls.staleWrites, 0)
  } finally { f.dispose() }
})

test('loading older messages preserves the visible message anchor; rolling latest keeps the old edge', async () => {
  const f = fixture()
  try {
    await f.render(); f.scroll(84); const oldNode = f.dom.querySelector('[data-message-id="32"]'); const before = oldNode.getBoundingClientRect().top
    moreButton(f).props.onClick(); await f.render()
    assert.equal(f.ids().length, 60)
    assert.equal(f.dom.querySelector('[data-message-id="32"]').getBoundingClientRect().top, before)
    const position = f.dom.scrollTop
    f.fetch(async () => page(rows(32, 61), true)); f.poll(); await f.render()
    assert.equal(f.ids().length, 61); assert(f.ids().includes(31)); assert.equal(f.dom.scrollTop, position)
    assert(f.find(node => node.type === 'button' && text(node).includes('1 条新消息')))
    f.find(node => node.type === 'button' && text(node).includes('回到最新')).props.onClick(); await f.render()
    assert.equal(f.dom.scrollTop, f.dom.scrollHeight - f.dom.clientHeight)
  } finally { f.dispose() }
})

test('more than 30 newly arrived messages are bridged with the server cursor without dropping a loaded range', async () => {
  const f = fixture()
  try {
    await f.render()
    f.fetch(async (_, before) => before == null ? page(rows(71, 100), true) : page(rows(41, 70), true))
    f.poll(); await f.render()
    assert.deepEqual(f.ids(), Array.from({ length: 70 }, (_, i) => i + 31))
    assert.equal(f.calls.fetch.at(-1).before, 71)
    assert.equal(f.dom.scrollTop, f.dom.scrollHeight - f.dom.clientHeight)
  } finally { f.dispose() }
})

test('large new-message gaps are fetched in bounded batches with a visible continuation', async () => {
  const f = fixture()
  try {
    await f.render(); f.scroll(0)
    f.fetch(async (_, before) => before == null ? page(rows(231, 260), true) : page(rows(before - 30, before - 1), true))
    f.poll(); await f.render()
    assert.equal(f.calls.fetch.filter(call => call.before != null).length, 4)
    assert(f.find(node => node.type === 'button' && text(node).includes('部分新消息待同步')))
    f.poll(); await f.render()
    assert.deepEqual(f.ids(), Array.from({ length: 230 }, (_, i) => i + 31))
    assert(!f.find(node => node.type === 'button' && text(node).includes('部分新消息待同步')))
  } finally { f.dispose() }
})

test('a send completed during a polling backfill is retained when the backfill finishes', async () => {
  const f = fixture()
  try {
    await f.render(); const pending = deferred()
    f.fetch(async (_, before) => before == null ? page(rows(71, 100), true) : pending.promise)
    f.poll(); await f.render(); assert.equal(f.calls.fetch.at(-1).before, 71)
    f.send(async () => ({ error: null, data: { message: { ...rows(101, 101)[0], is_mine: true } } }))
    f.find(node => node.type === 'textarea' && node.props.placeholder === '输入消息…').props.onChange({ target: { value: 'synthetic concurrent' } }); await f.render()
    f.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await f.render()
    assert(f.ids().includes(101))
    pending.resolve(page(rows(41, 70), true)); await f.render()
    assert(f.ids().includes(101)); assert.equal(f.ids().length, 71)
  } finally { f.dispose() }
})

test('an isolated successful send cannot advance the continuous receive edge past unseen peer messages', async () => {
  const f = fixture()
  try {
    await f.render()
    f.send(async () => ({ error: null, data: { message: { ...rows(101, 101)[0], is_mine: true } } }))
    f.find(node => node.type === 'textarea' && node.props.placeholder === '输入消息…').props.onChange({ target: { value: 'send before polling' } }); await f.render()
    f.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await f.render()
    assert(f.ids().includes(101)); assert(!f.ids().includes(61))
    f.fetch(async (_, before) => before == null ? page(rows(72, 101), true) : page(rows(42, 71), true))
    f.poll(); await f.render()
    assert.equal(f.calls.fetch.at(-1).before, 72)
    assert.deepEqual(f.ids(), Array.from({ length: 71 }, (_, i) => i + 31))
  } finally { f.dispose() }
})

test('old image uploads do not post after switching conversations or accounts', async () => {
  const f = fixture()
  try {
    await f.render(); const pending = deferred(); f.upload(() => pending.promise)
    const picker = f.find(node => node.type === 'image-pick'); picker.props.onPick([{ name: 'synthetic.png' }]); await f.render()
    assert.equal(f.calls.upload[0].uid, 'A')
    f.route('8'); await f.render(); f.setAuth('B'); await f.render()
    pending.resolve({ error: null, url: 'https://fixture.invalid/old-A.png' }); await f.render()
    assert.equal(f.calls.send.length, 0); assert.equal(f.calls.staleWrites, 0)
  } finally { f.dispose() }
})

test('a sent text follows immediately, while its late reply does not pull a history reader back', async () => {
  const f = fixture()
  try {
    await f.render(); f.scroll(0)
    const pending = deferred(); f.send(() => pending.promise)
    f.find(node => node.type === 'textarea' && node.props.placeholder === '输入消息…').props.onChange({ target: { value: 'synthetic outgoing' } }); await f.render()
    f.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await f.render()
    assert.equal(f.calls.send.length, 1); assert.equal(f.dom.scrollTop, f.dom.scrollHeight - f.dom.clientHeight)
    f.scroll(0); pending.resolve({ error: null, data: { message: { ...rows(61, 61)[0], is_mine: true } } }); await f.render()
    assert.equal(f.dom.scrollTop, 0); assert(f.ids().includes(61))
  } finally { f.dispose() }
})

test('an obsolete send cannot clear the restored account busy state after A to B to A', async () => {
  const f = fixture()
  try {
    await f.render(); const old = deferred(); f.send(() => old.promise)
    f.find(node => node.type === 'textarea' && node.props.placeholder === '输入消息…').props.onChange({ target: { value: 'old draft' } }); await f.render()
    f.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await f.render()
    f.setAuth('B'); f.setAuth('A'); await f.render()
    assert(!f.find(node => String(node.key || '').startsWith('out-')))
    const current = deferred(); f.send(() => current.promise)
    f.find(node => node.type === 'textarea' && node.props.placeholder === '输入消息…').props.onChange({ target: { value: 'new draft' } }); await f.render()
    f.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await f.render()
    old.resolve({ error: null, data: { message: { ...rows(91, 91)[0], is_mine: true } } }); await f.render()
    assert(!f.ids().includes(91))
    assert.equal(f.find(node => node.type === 'button' && node.props['aria-label'] === '发送').props.disabled, true)
    current.resolve({ error: null, data: { message: { ...rows(92, 92)[0], is_mine: true } } }); await f.render()
    assert(f.ids().includes(92)); assert.equal(f.calls.staleWrites, 0)
  } finally { f.dispose() }
})

test('invalid conversation IDs never enter a message RPC', async () => {
  for (const id of ['-1', '1.5', '1e2', '9007199254740993']) {
    const f = fixture(); f.route(id)
    try { await f.render(); assert.equal(f.calls.fetch.length, 0) } finally { f.dispose() }
  }
})
