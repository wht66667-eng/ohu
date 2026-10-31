/** Run real friend APIs and pages against an in-memory database and identity revision. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const compile = path => ts.transpileModule(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const sources = new Map()
const source = path => { if (!sources.has(path)) sources.set(path, compile(path)); return sources.get(path) }
const plain = value => JSON.parse(JSON.stringify(value))
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const flush = () => new Promise(setImmediate)
const friend = (id = 1, user = 'A', peer = 'B', name = '合成同学') => ({ id, user_uid: user, friend_uid: peer, friend_name: name, friend_avatar: '', created_at: '2030-01-02T08:00:00Z' })
const request = (id = 1, from = 'B', to = 'A', status = 'pending') => ({ id, from_uid: from, from_name: '申请同学', from_avatar: '', to_uid: to, status, created_at: '2030-01-02T08:00:00Z', message: '合成验证消息' })

function load(path, dependencies = {}, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(source(path), { module, exports: module.exports, Date, Event, console, ...globals,
    require: name => { if (Object.hasOwn(dependencies, name)) return dependencies[name]; throw new Error(`Unexpected dependency ${name} in ${path}`) },
  }, { filename: path })
  return module.exports
}

function service({ uid = 'A', friends = [], requests = [] } = {}) {
  let actorUid = uid
  const owner = load('src/lib/async-owner.ts')
  const session = load('src/lib/im-session.ts', { './async-owner': owner })
  session.selectImSession(uid)
  const calls = [], flags = { before: null, failure: null, edgeFailure: false, ignoreReadFilters: false }
  const tables = { friends: plain(friends), friend_requests: plain(requests) }
  const rdb = {
    from(table) {
      const query = { table, action: 'select', filters: [], value: null, single: false }
      const builder = {
        select() { return builder }, eq(column, value) { query.filters.push([column, value]); return builder },
        order() { return builder }, maybeSingle() { query.single = true; return builder },
        update(value) { query.action = 'update'; query.value = value; return builder },
        insert(value) { query.action = 'insert'; query.value = value; return builder },
        delete() { query.action = 'delete'; return builder },
        then(resolve, reject) {
          return (async () => {
            const call = { ...query, filters: [...query.filters], uid: actorUid }
            calls.push(call)
            const matches = row => call.filters.every(([column, value]) => row[column] === value)
            const readRows = tables[table].filter(row => flags.ignoreReadFilters || matches(row)).map(row => ({ ...row }))
            if (flags.before) await flags.before(call)
            const failure = flags.failure?.(call)
            if (failure) return { data: null, error: failure }
            if (call.action === 'select') return { data: call.single ? readRows[0] ?? null : readRows, error: null }
            if (call.action === 'insert') {
              if (table === 'friends' && tables.friends.some(row => row.user_uid === call.value.user_uid && row.friend_uid === call.value.friend_uid)) return { data: null, error: { code: '23505', message: 'duplicate unique pair' } }
              if (table === 'friend_requests' && tables.friend_requests.some(row => row.from_uid === call.value.from_uid && row.to_uid === call.value.to_uid && row.status === 'pending')) return { data: null, error: { code: '23505', message: 'duplicate pending pair' } }
              const row = { id: Math.max(0, ...tables[table].map(item => item.id)) + 1, ...call.value }
              tables[table].push(row)
              return { data: row, error: null }
            }
            const affected = tables[table].filter(matches)
            if (call.action === 'update') {
              if (table === 'friend_requests' && call.value.status === 'accepted') {
                if (flags.edgeFailure) return { data: null, error: { message: 'synthetic atomic edge failure' } }
                for (const row of affected) {
                  if (!tables.friends.some(edge => (edge.user_uid === row.to_uid && edge.friend_uid === row.from_uid) || (edge.user_uid === row.from_uid && edge.friend_uid === row.to_uid))) {
                    tables.friends.push(friend(Math.max(0, ...tables.friends.map(item => item.id)) + 1, row.to_uid, row.from_uid, row.from_name))
                  }
                }
              }
              affected.forEach(row => Object.assign(row, call.value))
            }
            if (call.action === 'delete') tables[table] = tables[table].filter(row => !matches(row))
            return { data: call.single ? affected[0] ?? null : affected, error: null }
          })().then(resolve, reject)
        },
      }
      return builder
    },
  }
  const api = load('src/lib/friends.ts', {
    './cb': { cbRdb: () => rdb }, './social-actor': { currentActor: () => actorUid ? { uid: actorUid, name: '本人昵称', avatar: '本人头像' } : null },
    './im-session': session, './async-owner': owner,
  })
  return { api, session, owner, calls, tables, flags,
    uid: () => actorUid,
    select(next) { actorUid = next; session.selectImSession(next) },
  }
}

test('friend reads normalize both edge directions, discard unrelated/self rows and never reuse our reverse metadata', async () => {
  const f = service({ friends: [friend(1), { ...friend(2, 'C', 'A', '本人昵称'), friend_avatar: '本人头像', remark: '别人的备注' }, friend(3, 'X', 'Y'), friend(4, 'A', 'A')] })
  f.flags.ignoreReadFilters = true
  const result = await f.api.fetchFriends()
  assert.equal(result.error, null)
  assert.deepEqual(plain(result.rows.map(row => [row.user_uid, row.friend_uid, row.friend_name, row.friend_avatar, row.remark])), [['A', 'B', '合成同学', '', ''], ['A', 'C', '', '', '']])
  assert.deepEqual(f.calls.map(call => call.filters), [[['user_uid', 'A']], [['friend_uid', 'A']]])
})

test('guest friend reads and mutations never access the database; inbox excludes sent and processed requests', async () => {
  const guest = service({ uid: '' })
  for (const result of await Promise.all([guest.api.fetchFriends(), guest.api.fetchFriendRequests(), guest.api.acceptFriendRequest(1), guest.api.rejectFriendRequest(1), guest.api.sendFriendRequest('B'), guest.api.deleteFriend(1)])) assert.match(result.error, /登录/)
  assert.equal(guest.calls.length, 0)
  const f = service({ requests: [request(), request(2, 'A', 'B'), request(3, 'C', 'A', 'accepted')] })
  f.flags.ignoreReadFilters = true
  assert.deepEqual(plain((await f.api.fetchFriendRequests()).rows.map(row => row.id)), [1])
  assert.deepEqual(f.calls[0].filters, [['to_uid', 'A'], ['status', 'pending']])
})

test('an atomic acceptance failure leaves no friend edge, and retry confirms the request and edge together', async () => {
  const f = service({ requests: [request()] })
  f.flags.edgeFailure = true
  assert.match((await f.api.acceptFriendRequest(1)).error, /atomic edge failure/)
  assert.equal(f.tables.friend_requests[0].status, 'pending'); assert.equal(f.tables.friends.length, 0)
  assert.equal(f.calls.some(call => call.action === 'insert'), false)
  f.flags.edgeFailure = false
  f.flags.failure = call => call.action === 'update' ? { message: 'synthetic status failure' } : null
  assert.match((await f.api.acceptFriendRequest(1)).error, /status failure/)
  assert.equal(f.tables.friend_requests[0].status, 'pending'); assert.equal(f.tables.friends.length, 0)
  f.flags.failure = null
  assert.equal((await f.api.acceptFriendRequest(1)).error, null)
  assert.equal(f.tables.friend_requests[0].status, 'accepted'); assert.equal(f.tables.friends.length, 1)
})

test('an existing reverse friend edge is reused and rejection is persisted only after a confirmed recipient-owned write', async () => {
  const f = service({ requests: [request()], friends: [friend(3, 'B', 'A', '本人昵称')] })
  assert.equal((await f.api.acceptFriendRequest(1)).error, null)
  assert.equal(f.calls.some(call => call.action === 'insert'), false)
  const rejected = service({ requests: [request()] })
  rejected.flags.failure = call => call.action === 'update' ? { message: 'synthetic update denied' } : null
  assert.match((await rejected.api.rejectFriendRequest(1)).error, /update denied/)
  assert.equal(rejected.tables.friend_requests[0].status, 'pending')
  rejected.flags.failure = null
  assert.equal((await rejected.api.rejectFriendRequest(1)).error, null)
  assert.equal(rejected.tables.friend_requests[0].status, 'rejected')
  assert.equal((await rejected.api.fetchFriendRequests()).rows.length, 0)
})

test('foreign or already processed requests never create an edge or mutate a status', async () => {
  const f = service({ requests: [request(1, 'A', 'B'), request(2, 'C', 'A', 'rejected')] })
  for (const id of [1, 2]) {
    assert.match((await f.api.acceptFriendRequest(id)).error, /已处理|不存在/)
    assert.match((await f.api.rejectFriendRequest(id)).error, /已处理|不存在/)
  }
  assert.equal(f.calls.some(call => call.action !== 'select'), false)
})

test('A to B to A during a pending read stops all remaining acceptance writes despite the same final UID', async () => {
  const f = service({ requests: [request()] }), wait = deferred()
  f.flags.before = call => call.table === 'friend_requests' && call.action === 'select' ? wait.promise : undefined
  const work = f.api.acceptFriendRequest(1); await flush()
  f.select('B'); f.select('A'); wait.resolve()
  assert.match((await work).error, /账号已变化/)
  assert.equal(f.calls.some(call => call.action !== 'select'), false)
})

test('an identity change during the atomic decision cannot report old success to the new account', async () => {
  const f = service({ requests: [request()] }), wait = deferred()
  f.flags.before = call => call.table === 'friend_requests' && call.action === 'update' ? wait.promise : undefined
  const work = f.api.acceptFriendRequest(1); await flush()
  assert.equal(f.calls.some(call => call.action === 'update'), true)
  f.select('B'); wait.resolve()
  assert.match((await work).error, /账号已变化/)
  assert.equal(f.calls.some(call => call.action === 'insert'), false)
  assert.equal(f.tables.friend_requests[0].status, 'accepted')
  assert.equal(f.tables.friends.length, 1)
})

test('rejecting after a failed atomic acceptance leaves no contact or accepted request', async () => {
  const f = service({ requests: [request()] })
  f.flags.edgeFailure = true
  assert.match((await f.api.acceptFriendRequest(1)).error, /atomic edge failure/)
  f.flags.edgeFailure = false
  assert.equal((await f.api.rejectFriendRequest(1)).error, null)
  assert.equal(f.tables.friend_requests[0].status, 'rejected')
  assert.equal((await f.api.fetchFriends()).rows.length, 0)
  assert.equal(f.calls.some(call => call.action === 'insert'), false)
})

const walk = value => Array.isArray(value) ? value.flatMap(walk) : value && typeof value === 'object' ? [value, ...walk(value.props?.children), ...walk(value.props?.action), ...walk(value.props?.right)] : []
const text = value => Array.isArray(value) ? value.map(text).join('') : typeof value === 'string' || typeof value === 'number' ? String(value) : value?.props ? text(value.props.children) : ''
const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))

function pageFixture(page, f = service()) {
  let instance, cursor = 0, tree
  const calls = { nav: [], toast: [], dm: [], copy: [], staleWrites: 0 }, flags = { dmGate: null, dmError: null, copyOk: true }
  const hooks = {
    useState(initial) {
      const index = cursor++, owner = instance
      owner.slots[index] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [owner.slots[index].value, value => {
        if (!owner.active) calls.staleWrites++
        const next = typeof value === 'function' ? value(owner.slots[index].value) : value
        if (!Object.is(next, owner.slots[index].value)) { owner.slots[index].value = next; owner.dirty = true }
      }]
    },
    useRef(initial) { return instance.slots[cursor++] ??= { current: initial } },
    useCallback(callback, deps) { const index = cursor++; if (!instance.slots[index] || !same(instance.slots[index].deps, deps)) instance.slots[index] = { value: callback, deps }; return instance.slots[index].value },
    useEffect(callback, deps) { const index = cursor++; if (!instance.slots[index] || !same(instance.slots[index].deps, deps)) instance.effects.push({ index, callback, deps }) },
  }
  const toast = Object.assign(message => calls.toast.push(message), { ok: message => calls.toast.push(message), err: message => calls.toast.push(message) })
  const entry = load('src/lib/dm-entry.ts', { './chat': { chatOpenThread: async input => {
    calls.dm.push(input); if (flags.dmGate) await flags.dmGate.promise
    return flags.dmError ? { data: null, error: flags.dmError } : { data: { thread: { id: 7 } }, error: null }
  } } })
  const jsx = (type, props, key) => ({ type, props: props || {}, key })
  const dependencies = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-router-dom': { useNavigate: () => route => calls.nav.push(route) },
    '../lib/auth': { useAuth: () => ({ isSigned: !!f.uid(), user: f.uid() ? { uid: f.uid() } : null, ensureSignedIn: async () => false }) },
    '../lib/friends': f.api, '../lib/async-owner': f.owner, '../lib/im-session': f.session, '../lib/dm-entry': entry,
    '../context/ToastContext': { useToast: () => toast }, '../lib/campus-account': { copyText: async value => { calls.copy.push(value); return flags.copyOk } },
    '../components/PageHeader': { PageHeader: 'page-header' }, '../components/CampusIcon': { CampusIcon: 'campus-icon' }, '../components/Thumbs': { Avatar: 'avatar' },
    '../components/ui/StateViews': { EmptyState: 'empty-state', ErrorState: 'error-state', LoadingState: 'loading-state' },
    [`./${page}.module.css`]: { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) },
  }
  const module = { exports: {} }, content = page.replace('Page', 'Content')
  vm.runInNewContext(source(`src/pages/${page}.tsx`) + `\nexports.__Content = ${content};`, {
    module, exports: module.exports, console,
    require: name => { if (Object.hasOwn(dependencies, name)) return dependencies[name]; throw new Error(`Unexpected page dependency ${name}`) },
  })
  function render() {
    const root = module.exports[page]()
    if (!instance || instance.key !== root.key) {
      if (instance) { for (const slot of instance.slots) slot?.cleanup?.(); instance.active = false }
      instance = { key: root.key, slots: [], effects: [], dirty: false, active: true }
    }
    cursor = 0; instance.effects = []; instance.dirty = false
    tree = module.exports.__Content()
    for (const effect of instance.effects) { instance.slots[effect.index]?.cleanup?.(); instance.slots[effect.index] = { deps: effect.deps, cleanup: effect.callback() } }
  }
  return { f, calls, flags,
    async render() { render(); await flush(); for (let i = 0; instance.dirty && i < 10; i++) { render(); await flush() } },
    find(predicate) { return walk(tree).find(predicate) }, all(predicate) { return walk(tree).filter(predicate) },
    text: () => text(tree),
    button(label) { return this.find(node => node.type === 'button' && text(node) === label) },
    submit() { this.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }) },
    change(id, value) { this.find(node => node.props.id === id).props.onChange({ target: { value } }) },
    dispose() { for (const slot of instance?.slots || []) slot?.cleanup?.(); if (instance) instance.active = false },
  }
}

test('contacts always expose incoming requests, omit the false group entry, and open the normalized peer as a numeric thread', async () => {
  const f = service({ friends: [friend(1, 'B', 'A', '本人昵称')] }), p = pageFixture('ContactsPage', f)
  try {
    await p.render()
    assert.match(p.text(), /新的朋友/); assert.doesNotMatch(p.text(), /群聊|本人昵称/)
    const open = p.all(node => node.type === 'button' && node.props.className === 'friend')[0]
    assert.match(text(open), /好友码 B/)
    open.props.onClick(); open.props.onClick(); await p.render()
    assert.equal(p.calls.dm.length, 1); assert.equal(p.calls.dm[0].peerUid, 'B')
    assert.deepEqual(p.calls.nav, ['/chats/7'])
  } finally { p.dispose() }
})

test('friend and application read failures render explicit retry states rather than empty lists', async () => {
  for (const page of ['ContactsPage', 'FriendRequestsPage']) {
    const f = service(), p = pageFixture(page, f)
    try {
      f.flags.failure = () => ({ message: 'synthetic offline' })
      await p.render()
      assert(p.find(node => node.type === 'error-state'))
      assert.equal(p.find(node => node.type === 'empty-state'), undefined)
      f.flags.failure = null; p.button('重试').props.onClick(); await p.render()
      assert(p.find(node => node.type === 'empty-state'))
    } finally { p.dispose() }
  }
})

test('a delayed friend read and a delayed private-message open cannot populate or navigate a newer account', async () => {
  const f = service({ friends: [friend()] }), p = pageFixture('ContactsPage', f), read = deferred()
  try {
    f.flags.before = call => call.table === 'friends' ? read.promise : undefined
    await p.render(); f.select('B'); f.flags.before = null; await p.render()
    read.resolve(); await p.render()
    assert.equal(p.calls.staleWrites, 0)
    f.select('A'); await p.render()
    const wait = deferred(); p.flags.dmGate = wait
    p.all(node => node.type === 'button' && node.props.className === 'friend')[0].props.onClick()
    f.select('B'); f.select('A'); await p.render(); wait.resolve(); await p.render()
    assert.deepEqual(p.calls.nav, []); assert.equal(p.calls.staleWrites, 0)
  } finally { p.dispose() }
})

test('failed rejection remains visible and duplicate action clicks are locked until a confirmed retry succeeds', async () => {
  const f = service({ requests: [request()] }), p = pageFixture('FriendRequestsPage', f)
  try {
    await p.render()
    const wait = deferred(); f.flags.before = call => call.action === 'update' ? wait.promise : undefined
    f.flags.failure = call => call.action === 'update' ? { message: 'synthetic update denied' } : null
    const reject = p.button('拒绝'); reject.props.onClick(); reject.props.onClick(); await p.render()
    assert.equal(f.calls.filter(call => call.action === 'update').length, 1)
    assert(p.all(node => node.type === 'button').filter(node => ['拒绝', '处理中…'].includes(text(node))).every(node => node.props.disabled))
    wait.resolve(); await p.render()
    assert.equal(p.all(node => node.props.className === 'request').length, 1); assert.match(p.text(), /synthetic update denied/)
    f.flags.before = null; f.flags.failure = null; p.button('拒绝').props.onClick(); await p.render()
    assert.equal(f.tables.friend_requests[0].status, 'rejected'); assert(p.find(node => node.type === 'empty-state'))
  } finally { p.dispose() }
})

test('friend-code form rejects empty/self codes, preserves failed drafts, locks duplicate submits and copies without false success', async () => {
  const f = service(), p = pageFixture('AddFriendPage', f)
  try {
    await p.render()
    assert.equal(p.find(node => node.props['aria-label'] === '我的好友码').props.value, 'A')
    assert.doesNotMatch(p.text(), /手机号|学号/)
    p.flags.copyOk = false; p.button('复制').props.onClick(); await p.render()
    assert.match(p.text(), /无法自动复制.*手动复制/); assert.doesNotMatch(p.text(), /好友码已复制/)
    p.submit(); await p.render(); assert.match(p.text(), /请粘贴/)
    p.change('friend-code', ' A '); await p.render(); p.submit(); await p.render(); assert.match(p.text(), /不能添加自己/)
    assert.equal(f.calls.length, 0)
    p.change('friend-code', ' B '); p.change('friend-message', '验证草稿'); await p.render()
    const wait = deferred(); f.flags.before = () => wait.promise; f.flags.failure = () => ({ message: 'synthetic submit rejected' })
    p.submit(); p.submit(); await p.render(); assert.equal(f.calls.length, 1)
    wait.resolve(); await p.render()
    assert.equal(p.find(node => node.props.id === 'friend-code').props.value, ' B ')
    assert.equal(p.find(node => node.props.id === 'friend-message').props.value, '验证草稿')
    assert.match(p.text(), /synthetic submit rejected/); assert.deepEqual(p.calls.nav, [])
  } finally { p.dispose() }
})

test('a successful friend-code submit from an obsolete session cannot show success or navigate', async () => {
  const f = service(), p = pageFixture('AddFriendPage', f), wait = deferred()
  try {
    await p.render(); p.change('friend-code', 'B'); await p.render()
    f.flags.before = () => wait.promise
    p.submit(); await p.render(); f.select('B'); f.select('A'); await p.render()
    wait.resolve(); await p.render()
    assert.deepEqual(p.calls.nav, []); assert.deepEqual(p.calls.toast, []); assert.equal(p.calls.staleWrites, 0)
  } finally { p.dispose() }
})

test('guest pages show a login state without issuing any friend database reads', async () => {
  for (const page of ['ContactsPage', 'FriendRequestsPage', 'AddFriendPage']) {
    const f = service({ uid: '' }), p = pageFixture(page, f)
    try {
      await p.render()
      assert(p.find(node => node.type === 'empty-state' && node.props.title.includes('登录')))
      assert.equal(f.calls.length, 0)
    } finally { p.dispose() }
  }
})

test('a late acceptance cannot remove the new account request or announce old success', async () => {
  const f = service({ requests: [request(1, 'C', 'A'), request(2, 'D', 'B')] }), p = pageFixture('FriendRequestsPage', f), wait = deferred()
  try {
    await p.render()
    f.flags.before = call => call.action === 'update' ? wait.promise : undefined
    p.button('接受').props.onClick(); await p.render()
    assert.equal(f.calls.filter(call => call.action === 'update').length, 1)
    f.select('B'); f.flags.before = null; await p.render()
    wait.resolve(); await p.render()
    assert.match(p.text(), /好友码 D/); assert.doesNotMatch(p.text(), /已添加为好友/)
    assert.equal(p.all(node => node.props.className === 'request').length, 1)
    assert.equal(p.calls.staleWrites, 0)
  } finally { p.dispose() }
})

test('confirmed friend-code copy and current submit show success only after their actual operations succeed', async () => {
  const f = service(), p = pageFixture('AddFriendPage', f)
  try {
    await p.render(); p.button('复制').props.onClick(); await p.render()
    assert.match(p.text(), /好友码已复制/); assert.deepEqual(p.calls.copy, ['A'])
    p.change('friend-code', ' B '); p.change('friend-message', ' 合成验证 '); await p.render()
    p.submit(); await p.render()
    assert.equal(f.tables.friend_requests[0].from_uid, 'A'); assert.equal(f.tables.friend_requests[0].to_uid, 'B')
    assert.equal(f.tables.friend_requests[0].message, '合成验证')
    assert.deepEqual(p.calls.nav, ['/contacts']); assert.deepEqual(p.calls.toast, ['好友申请已发送'])
  } finally { p.dispose() }
})
