import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const compile = path => ts.transpileModule(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const thread = (id, at = id, unread = 0) => ({ id, last_at: `2030-01-01T${String(at).padStart(2, '0')}:00:00Z`, created_at: '', other_name: `同学${id}`, other_uid: `peer-${id}`, my_unread: unread, last_message: `消息${id}`, topic_type: 'friend', topic_title: '好友私信' })
const page = (items = [], { more = false, cursor = null, error = null } = {}) => ({ error, data: { items, unread_total: items.reduce((sum, item) => sum + item.my_unread, 0), has_more: more, next_cursor: cursor } })
const cursor = { before_at: '2030-01-01T02:00:00Z', before_id: 2 }
const walk = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(walk)]
const text = tree => !tree ? '' : typeof tree !== 'object' ? String(tree) : [tree.props?.children].flat(Infinity).map(text).join('')

/** Run the real inbox with controlled hooks, a real owner/session fence, and no network bridge. */
function fixture({ signed = true, embedded = true } = {}) {
  let auth = { isSigned: signed, user: signed ? { uid: 'A' } : null, ensureSignedIn: () => {} }
  const owner = { exports: {} }
  vm.runInNewContext(compile('src/lib/async-owner.ts'), { module: owner, exports: owner.exports })
  const im = { exports: {} }
  vm.runInNewContext(compile('src/lib/im-session.ts'), { module: im, exports: im.exports, require: name => {
    assert.equal(name, './async-owner'); return owner.exports
  } })
  im.exports.selectImSession(signed ? 'A' : null)
  const slots = [], calls = [], hides = [], notices = [], navs = [], timers = new Set()
  const window = new EventTarget(), document = new EventTarget()
  document.visibilityState = 'visible'
  window.setInterval = callback => { timers.add(callback); return callback }
  window.clearInterval = callback => timers.delete(callback)
  let index = 0, effects = [], tree
  const memo = (factory, deps) => {
    const i = index++, previous = slots[i]
    if (!previous || deps.some((value, n) => !Object.is(value, previous.deps[n]))) slots[i] = { value: factory(), deps }
    return slots[i].value
  }
  const hooks = {
    useState(initial) {
      const i = index++
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next }]
    },
    useRef(initial) { const i = index++; return slots[i] ??= { current: initial } },
    useMemo: memo,
    useCallback: (callback, deps) => memo(() => callback, deps),
    useEffect(callback, deps) {
      const i = index++, previous = slots[i]
      if (!previous || deps.some((value, n) => !Object.is(value, previous.deps[n]))) effects.push({ i, callback, deps })
    },
  }
  const ConfirmSheet = () => null, PageHeader = () => null
  const bridge = {
    CHAT_PAGE_SIZE: 20,
    fetchChatThreads: (_limit, before) => { const item = { ...deferred(), before }; calls.push(item); return item.promise },
    chatHideThread: id => { const item = { ...deferred(), id }; hides.push(item); return item.promise },
    chatPreviewText: item => item.last_message,
    chatRelTime: at => at,
    chatTopicLabel: () => '好友',
  }
  const imports = {
    react: hooks,
    'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'react-router-dom': { useNavigate: () => route => navs.push(route) },
    '../components/CampusIcon': {}, '../components/ConfirmSheet': { ConfirmSheet }, '../components/PageHeader': { PageHeader }, '../components/Thumbs': {},
    '../context/ToastContext': { useToast: () => ({ ok: value => notices.push(value), err: value => notices.push(value) }) },
    '../lib/auth': { useAuth: () => auth }, '../lib/async-owner': owner.exports, '../lib/im-session': im.exports,
    '../lib/chat': bridge, './ChatListPage.module.css': { default: {} },
  }
  const module = { exports: {} }
  vm.runInNewContext(compile('src/pages/ChatListPage.tsx') + '\nexports.__Content = ChatInboxContent; exports.__merge = mergeThreads;', {
    module, exports: module.exports, window, document, console,
    require: name => { if (!Object.hasOwn(imports, name)) throw new Error(`Unexpected import ${name}`); return imports[name] },
  })
  function render() {
    index = 0; effects = []
    tree = module.exports.__Content({ embedded })
    for (const effect of effects) {
      slots[effect.i]?.cleanup?.()
      slots[effect.i] = { deps: effect.deps, cleanup: effect.callback() }
    }
    return tree
  }
  render()
  return {
    calls, hides, notices, navs, merge: module.exports.__merge, render,
    nodes: () => walk(tree), text: () => text(tree),
    rows: () => walk(tree).filter(node => node.type === 'li').map(node => Number(node.key)),
    button: label => walk(tree).find(node => node.type === 'button' && (node.props['aria-label'] === label || text(node) === label)),
    confirm: () => walk(tree).find(node => node.type === ConfirmSheet),
    header: () => walk(tree).find(node => node.type === PageHeader),
    poll: () => timers.forEach(callback => callback()),
    focus: () => window.dispatchEvent(new Event('focus')),
    visible: value => { document.visibilityState = value; document.dispatchEvent(new Event('visibilitychange')) },
    session: uid => im.exports.selectImSession(uid),
    auth: uid => { auth = { ...auth, isSigned: !!uid, user: uid ? { uid } : null }; im.exports.selectImSession(uid) },
    async answer(items = [], options = {}, request = calls.at(-1)) { request.resolve(page(items, options)); await flush(); render() },
    remove(id) { walk(tree).find(node => node.type === 'button' && node.props['aria-label']?.endsWith(`（${id}）`)).props.onClick(); render(); return this.confirm().props.onConfirm() },
    unmount: () => { for (const slot of slots) slot?.cleanup?.() },
  }
}

test('latest message sorting is global, deterministic, and first-page duplicates win', () => {
  const f = fixture({ signed: false })
  const latest = { ...thread(1, 8), last_message: '更新消息' }
  const result = f.merge([thread(4, 9, 0), latest, thread(3, 9)], [thread(1, 2, 100), thread(2, 10, 0)])
  assert.deepEqual(Array.from(result, item => item.id), [2, 4, 3, 1])
  assert.equal(result.at(-1).last_message, '更新消息')
})

test('embedded inbox omits duplicate page header and announces the precise unread number', async () => {
  const f = fixture()
  await f.answer([thread(2, 2, 121), thread(1, 4)])
  assert.equal(f.header(), undefined)
  assert.deepEqual(f.rows(), [1, 2])
  assert.ok(f.button('与同学2的会话，121 条未读'))
  assert.match(f.text(), /私信未读 121 条/)
  assert.match(f.text(), /99\+/)
  f.button('与同学2的会话，121 条未读').props.onClick()
  assert.deepEqual(f.navs, ['/chats/2'])
})

test('complete chats page retains its header; guest and empty inbox guide the next action', async () => {
  const guest = fixture({ signed: false, embedded: false })
  assert.ok(guest.header())
  assert.ok(guest.button('去登录'))
  assert.equal(guest.calls.length, 0)
  const f = fixture()
  await f.answer()
  f.button('打开好友通讯录').props.onClick()
  assert.deepEqual(f.navs, ['/contacts'])
})

test('ordinary direct chats omit redundant source copy while topic conversations retain their context', async () => {
  const f = fixture()
  await f.answer([{ ...thread(1), topic_type: 'plaza_user', topic_title: '普通私聊' }, { ...thread(2), topic_type: 'secondhand', topic_title: '二手教材' }])
  assert.doesNotMatch(f.text(), /普通私聊/)
  assert.match(f.text(), /二手教材/)
})

test('poll/focus requests coalesce, pause while hidden, and resume immediately', async () => {
  const f = fixture()
  f.poll(); f.focus()
  assert.equal(f.calls.length, 1)
  await f.answer([thread(1)])
  f.visible('hidden'); f.poll(); f.focus()
  assert.equal(f.calls.length, 1)
  f.visible('visible'); f.focus(); f.poll()
  assert.equal(f.calls.length, 2)
  await f.answer([thread(2)])
  assert.equal(f.calls.length, 2)
  assert.deepEqual(f.rows(), [2])
})

test('unexpected read rejection releases loading; refresh failure preserves loaded conversations', async () => {
  const f = fixture()
  f.calls[0].reject(new Error('连接断开'))
  await flush(); f.render()
  assert.match(f.text(), /会话同步失败/)
  assert.doesNotMatch(f.text(), /正在同步会话/)
  f.button('重试').props.onClick()
  await f.answer([thread(1)])
  f.focus()
  await f.answer([], { error: '暂时离线' })
  assert.deepEqual(f.rows(), [1])
  assert.match(f.text(), /已加载的会话仍可查看/)
  f.button('与同学1的会话').props.onClick()
  assert.deepEqual(f.navs, ['/chats/1'])
})

test('pagination errors retry the same cursor, deduplicate rows, and keep their cursor across polling', async () => {
  const f = fixture()
  await f.answer([thread(4), thread(3)], { more: true, cursor })
  f.button('加载更早的会话').props.onClick(); f.button('加载更早的会话').props.onClick()
  assert.equal(f.calls.length, 2)
  f.calls[1].reject(new Error('分页失败'))
  await flush(); f.render()
  assert.deepEqual(f.rows(), [4, 3])
  f.button('重试加载更早的会话').props.onClick()
  const nextCursor = { before_at: '2030-01-01T01:00:00Z', before_id: 1 }
  await f.answer([thread(3, 1), thread(2), thread(1), thread(1)], { more: true, cursor: nextCursor })
  assert.deepEqual(f.rows(), [4, 3, 2, 1])
  assert.deepEqual(f.calls[1].before, f.calls[2].before)
  f.focus(); await f.answer([thread(4, 8), thread(3)], { more: true, cursor })
  f.button('加载更早的会话').props.onClick()
  assert.equal(f.calls.at(-1).before.before_id, 1)
})

test('focus during pagination queues one fresh first page without a concurrent duplicate read', async () => {
  const f = fixture()
  await f.answer([thread(3)], { more: true, cursor })
  f.button('加载更早的会话').props.onClick()
  f.focus(); f.focus(); f.poll()
  assert.equal(f.calls.length, 2)
  await f.answer([thread(2)], { more: false })
  assert.equal(f.calls.length, 3)
  await f.answer([thread(3, 8)])
  assert.equal(f.calls.length, 3)
  assert.deepEqual(f.rows(), [3, 2])
})

test('successful hide rejects a pre-write poll result, then allows a genuinely new message to restore the row', async () => {
  const f = fixture()
  await f.answer([thread(2), thread(1)])
  f.focus()
  const oldPoll = f.calls.at(-1)
  const hiding = f.remove(2)
  assert.deepEqual(f.rows(), [2, 1])
  f.hides[0].resolve({ error: null }); await hiding; f.render()
  assert.deepEqual(f.rows(), [1])
  assert.equal(f.calls.length, 2)
  await f.answer([thread(2), thread(1)], {}, oldPoll)
  assert.deepEqual(f.rows(), [1])
  assert.equal(f.calls.length, 3)
  await f.answer([thread(1)])
  f.focus(); await f.answer([thread(2, 10), thread(1)])
  assert.deepEqual(f.rows(), [2, 1])
})

test('successful hide also rejects an older-page response containing the hidden thread', async () => {
  const f = fixture()
  await f.answer([thread(3)], { more: true, cursor })
  f.button('加载更早的会话').props.onClick()
  const oldPage = f.calls.at(-1), hiding = f.remove(3)
  f.hides[0].resolve({ error: null }); await hiding; f.render()
  await f.answer([thread(3), thread(2)], { more: false }, oldPage)
  assert.deepEqual(f.rows(), [])
  assert.equal(f.calls.length, 3)
  await f.answer([thread(2)])
  assert.deepEqual(f.rows(), [2])
})

test('failed or thrown hide keeps the row and releases its write lock for retry', async () => {
  const f = fixture()
  await f.answer([thread(1)])
  let hiding = f.remove(1)
  f.confirm().props.onConfirm()
  assert.equal(f.hides.length, 1)
  f.hides[0].reject(new Error('移除失败')); await hiding; f.render()
  assert.deepEqual(f.rows(), [1])
  assert.equal(f.confirm().props.busy, false)
  hiding = f.confirm().props.onConfirm()
  f.hides[1].resolve({ error: '未移除' }); await hiding; f.render()
  assert.deepEqual(f.rows(), [1])
  assert.equal(f.confirm().props.busy, false)
})

test('A → B → A before a render invalidates both old reads and writes without blocking the new session', async () => {
  const f = fixture()
  await f.answer([thread(1)])
  f.focus(); const oldRead = f.calls.at(-1)
  const hiding = f.remove(1)
  f.session('B'); f.session('A'); f.render()
  assert.deepEqual(f.rows(), [])
  assert.equal(f.calls.length, 3)
  await f.answer([thread(2)])
  oldRead.resolve(page([thread(1)]))
  f.hides[0].resolve({ error: null }); await hiding; await flush(); f.render()
  assert.deepEqual(f.rows(), [2])
  assert.equal(f.confirm(), undefined)
  assert.deepEqual(f.notices, [])
})

test('unmount discards pending results and removes polling/focus listeners', async () => {
  const f = fixture()
  f.unmount()
  f.calls[0].resolve(page([thread(1)])); await flush(); f.render()
  assert.deepEqual(f.rows(), [])
  f.focus(); f.poll()
  assert.equal(f.calls.length, 1)
})
