import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function load(relative, injected = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(join(root, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(compiled, { module, exports: module.exports, window: { setTimeout, clearTimeout }, require(name) {
    if (name in injected) return injected[name]
    if (name.endsWith('.css')) return {}
    throw Error(`Unexpected import ${name}`)
  } })
  return module.exports
}
const owner = load('src/lib/async-owner.ts')
const dummy = name => ({ [name]: function component() {} })
const jsx = (type, props, key) => ({ type, props, key })
const same = (a, b) => a?.length === b?.length && a.every((value, index) => Object.is(value, b[index]))
function harness(page, options = {}) {
  let id = '1'
  let uid = 'A'
  let auth = makeAuth()
  let current = null
  let rendering = null
  let tree
  const frames = []
  const identityListeners = new Set()
  const calls = { nav: [], queries: [], comments: [] }
  function makeAuth() { return { isSigned: !!uid, user: uid ? { uid, nickname: uid } : null, profile: { username: uid, isAdmin: false }, ensureSignedIn: async () => !!uid } }
  const hooks = {
    useState(initial) { const frame = rendering; const index = frame.index++; if (!(index in frame.slots)) frame.slots[index] = typeof initial === 'function' ? initial() : initial; return [frame.slots[index], value => { if (!frame.mounted) frame.lateWrites++; frame.slots[index] = typeof value === 'function' ? value(frame.slots[index]) : value }] },
    useRef(initial) { const frame = rendering; const index = frame.index++; return frame.slots[index] ||= { current: initial } },
    useCallback(value, deps) { const frame = rendering; const index = frame.index++; if (!frame.slots[index] || !same(frame.slots[index].deps, deps)) frame.slots[index] = { deps, value }; return frame.slots[index].value },
    useMemo(factory, deps) { return hooks.useCallback(factory, deps)() },
    useEffect(effect, deps) { const frame = rendering; const index = frame.index++; const old = frame.effects[index]; if (old && same(old.deps, deps)) return; old?.cleanup?.(); frame.effects[index] = { deps, effect }; frame.pending.push(index) },
  }
  const toast = () => {}; toast.err = toast.ok = toast
  const names = ['PageHeader', 'Avatar', 'ProductArt', 'ConfirmSheet', 'ExpressTrackSheet', 'DeniedState', 'EmptyState', 'ErrorState', 'LoadingState', 'IconClock', 'IconPin', 'TaskImageGallery']
  const components = Object.assign({}, ...names.map(dummy))
  const market = {
    queryRows: async (name, where) => { calls.queries.push([name, where.id]); return options.query?.(name, where.id) || { rows: [], error: null } },
    setTaskStatus: async () => ({ error: null }), setItemStatus: async () => ({ error: null }), fmtTime: () => '', TASK_STATUS_TEXT: {}, ITEM_STATUS_TEXT: {},
  }
  const deal = { fetchItemComments: async id => { calls.comments.push(id); return options.comments?.(id) || { rows: [], error: null } }, addItemComment: async () => ({ error: null }), deleteItemComment: async () => ({ error: null }) }
  const injected = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-router-dom': { useParams: () => ({ id }), useNavigate: () => value => calls.nav.push(value) },
    '../lib/auth': { useAuth: () => auth }, '../lib/async-owner': owner, '../context/ToastContext': { useToast: () => toast },
    '../lib/im-session': { subscribeImSession: callback => { identityListeners.add(callback); return () => identityListeners.delete(callback) } },
    // 私信入口已从腾讯 IM（imDmPath）换成自建会话线：先开会话再跳 /chats/{id}
    '../lib/dm-entry': { openDmThread: async input => ({ path: `/chats/${input.peerUid}`, error: null }) }, '../lib/market': market, '../lib/deal': deal,
    '../lib/moderation': { deletePost: async () => ({ error: null }), deleteGoods: async () => ({ error: null }), setGoodsStatus: async () => ({ error: null }) },
  }
  for (const path of ['PageHeader', 'Thumbs', 'ConfirmSheet', 'ExpressTrackSheet', 'Icons', 'ui/StateViews', 'TaskImageGallery']) injected[`../components/${path}`] = components
  const module = load(`src/pages/${page}.tsx`, injected)
  const outer = module[page]
  function render() {
    const element = outer()
    if (!current || current.key !== element.key) {
      if (current) { for (const effect of current.effects) effect?.cleanup?.(); current.mounted = false }
      current = { key: element.key, component: element.type, index: 0, slots: [], effects: [], pending: [], mounted: true, lateWrites: 0 }; frames.push(current)
    }
    current.index = 0; rendering = current; tree = current.component(); rendering = null
    for (const index of current.pending.splice(0)) current.effects[index].cleanup = current.effects[index].effect()
    return tree
  }
  const children = value => value == null ? [] : Array.isArray(value) ? value.flatMap(children) : typeof value === 'object' ? [value, ...children(value.props?.children)] : []
  const text = value => value == null ? '' : Array.isArray(value) ? value.map(text).join(' ') : typeof value === 'object' ? text(value.props?.children) : String(value)
  return { calls, frames, render, setRoute(next) { id = next }, setUid(next) { uid = next; auth = makeAuth(); identityListeners.forEach(callback => callback()) }, text: () => text(tree), elements: () => children(tree), button(label) { return children(tree).find(node => node.type === 'button' && text(node).trim() === label) }, component(name) { return children(tree).find(node => node.type === components[name]) } }
}
const task = id => ({ id, title: `任务 ${id}`, creator_uid: 'seller', creator_name: '卖家', status: 'open' })
const item = id => ({ id, title: `闲置 ${id}`, creator_uid: 'seller', creator_name: '卖家', status: 'on', price: 1 })

for (const [page, row] of [['TaskDetailPage', task], ['ItemDetailPage', item]]) {
  test(`${page}: late ID 1 response cannot restore old content after navigating to ID 2`, async () => {
    const old = deferred()
    const app = harness(page, { query: (_name, id) => id === 1 ? old.promise : { rows: [row(2)], error: null } })
    app.render(); app.setRoute('2'); app.render(); await flush(); app.render()
    old.resolve({ rows: [row(1)], error: null }); await flush(); app.render()
    assert.ok(app.text().includes(row(2).title)); assert.ok(!app.text().includes(row(1).title)); assert.equal(app.frames[0].lateWrites, 0)
  })
  test(`${page}: malformed IDs never query the database`, async () => {
    const app = harness(page)
    for (const id of ['0', '-1', '1e2', '1.5', '9007199254740992']) { app.setRoute(id); app.render(); await flush() }
    assert.equal(app.calls.queries.length, 0)
  })
  test(`${page}: opening chat is bound to the clicked record despite route changes`, async () => {
    const privateRead = deferred()
    const app = harness(page, { query: (name, id) => name.startsWith('v_') ? { rows: [row(id)], error: null } : privateRead.promise })
    app.render(); await flush(); app.render(); app.button('发私信').props.onClick(); await flush()
    app.setRoute('2'); app.render(); privateRead.resolve({ rows: [row(1)], error: null }); await flush(); app.render()
    assert.equal(app.calls.nav.length, 0); assert.equal(app.frames[0].lateWrites, 0)
  })
}
test('ItemDetailPage: old signed-account contact and draft disappear at account change', async () => {
  const app = harness('ItemDetailPage', { query: (_name, id) => ({ rows: [{ ...item(id), contact: 'A-private-contact' }], error: null }) })
  app.render(); await flush(); app.render(); app.button('查看联系方式').props.onClick(); await flush(); app.render()
  assert.ok(app.text().includes('A-private-contact'))
  app.setUid('B'); app.render(); assert.ok(!app.text().includes('A-private-contact'))
})
test('ItemDetailPage: failed comment read exposes retry instead of inventing no comments', async () => {
  const app = harness('ItemDetailPage', { query: (_name, id) => ({ rows: [item(id)], error: null }), comments: () => ({ rows: [], error: 'network' }) })
  app.render(); await flush(); app.render()
  assert.equal(app.component('ErrorState').props.title, '留言读取失败'); assert.ok(!app.text().includes('还没有人留言'))
})
