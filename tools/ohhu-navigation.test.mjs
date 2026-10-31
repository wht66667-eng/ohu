import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')
function load(relative, injected = {}) {
  const source = fs.readFileSync(join(root, relative), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(compiled, { module, exports: module.exports, URLSearchParams, require: (name) => {
    if (name in injected) return injected[name]
    throw Error(`Unexpected dependency: ${name}`)
  } })
  return module.exports
}
const unread = load('src/lib/message-unread-summary.ts')
function infoModule(response = { data: [], error: null }) {
  const calls = []
  const query = { select(value) { calls.push(['select', value]); return this }, eq(column, value) { calls.push(['eq', column, value]); return this }, async limit(value) { calls.push(['limit', value]); if (response instanceof Error) throw response; return response } }
  const api = load('src/lib/info-target.ts', { './cb': { cbRdb: () => ({ from(view) { calls.push(['view', view]); return query } }) } })
  return { api, calls }
}
const plain = (value) => JSON.parse(JSON.stringify(value))

test('legacy announcement links remain correct while new kinds get distinct keys', () => {
  const { api } = infoModule()
  assert.deepEqual(plain(api.parseInfoTarget(new URLSearchParams('id=8')).target), { kind: 'news', id: 8 })
  assert.equal(api.infoTargetKey({ kind: 'news', id: 8 }), 'n-8')
  assert.equal(api.infoTargetKey({ kind: 'activity', id: 8 }), 'a-8')
  assert.equal(api.infoTargetKey({ kind: 'lost', id: 8 }), 'l-8')
})
test('unsupported kinds, repeated parameters and invalid IDs are rejected', () => {
  const { api } = infoModule()
  for (const query of ['kind=admin&id=1', 'kind=__proto__&id=1', 'kind=&id=1', 'kind=news', 'id=-1', 'id=0', 'id=1.2', 'id=1e2', 'id=9007199254740992', 'id=1&id=2', 'kind=lost&kind=news&id=1']) assert.ok(api.parseInfoTarget(new URLSearchParams(query)).error, query)
  assert.equal(api.parseInfoTarget(new URLSearchParams('filter=公告')).error, null)
  assert.equal(api.parseInfoTarget(new URLSearchParams()).target, null)
})
for (const [kind, view] of [['news', 'v_news_public'], ['activity', 'v_activities_public'], ['lost', 'v_lost_public']]) {
  test(`${kind} target queries its own public view by exact ID`, async () => {
    const { api, calls } = infoModule({ data: [{ id: 88, title: '真实记录' }], error: null })
    const result = await api.fetchInfoTarget({ kind, id: 88 })
    assert.equal(result.error, null)
    assert.equal(result.rows[0].kind, kind)
    assert.equal(result.rows[0].row.id, 88)
    assert.deepEqual(calls, [['view', view], ['select', '*'], ['eq', 'id', 88], ['limit', 1]])
    assert.equal(api.infoTargetPath(kind, 88), `/info?kind=${kind}&id=88`)
  })
}
test('unavailable public records return empty without inventing content', async () => {
  const { api } = infoModule()
  const result = await api.fetchInfoTarget({ kind: 'lost', id: 8 })
  assert.equal(result.error, null)
  assert.equal(result.rows.length, 0)
})
test('failed public reads retain an error distinct from empty results', async () => {
  for (const response of [{ data: [], error: { message: 'permission denied' } }, new Error('network')]) {
    const { api } = infoModule(response)
    const result = await api.fetchInfoTarget({ kind: 'news', id: 8 })
    assert.equal(result.rows.length, 0)
    assert.ok(result.error)
  }
})
test('invalid target IDs never reach the database', async () => {
  const { api, calls } = infoModule()
  const result = await api.fetchInfoTarget({ kind: 'news', id: -1 })
  assert.ok(result.error)
  assert.equal(calls.length, 0)
})
test('wrong-ID responses are not shown as the requested record', async () => {
  const { api } = infoModule({ data: [{ id: 9, title: '另一条' }], error: null })
  assert.equal((await api.fetchInfoTarget({ kind: 'activity', id: 8 })).rows.length, 0)
})
test('homepage highlights preserve each source kind and ID even when three IDs coincide', async () => {
  const { api } = infoModule()
  const home = load('src/pages/home/home-data.ts', {
    '../../lib/info-target': api,
    '../../lib/bulletin': {
      fetchNews: async () => ({ rows: [{ id: 5, title: '公告原文', created_at: '2026-01-01', published_at: '2026-01-01' }], error: null }),
      fetchActivities: async () => ({ rows: [{ id: 5, title: '活动原文', status: 'open', created_at: '2026-01-01' }], error: null }),
      fetchLostList: async () => ({ rows: [{ id: 5, title: '失物原文', status: 'open', created_at: '2026-01-01', kind: 'lost' }], error: null }),
    },
  })
  const result = await home.loadCampusHighlights()
  assert.equal(result.rows.length, 3)
  assert.equal(new Set(result.rows.map((entry) => entry.id)).size, 3)
  for (const entry of result.rows) {
    const query = new URLSearchParams(entry.to.split('?')[1])
    assert.equal(query.get('kind'), entry.sourceKind)
    assert.equal(Number(query.get('id')), entry.recordId)
  }
})
test('homepage partial failure retains successful real sections', async () => {
  const { api } = infoModule()
  const home = load('src/pages/home/home-data.ts', {
    '../../lib/info-target': api,
    '../../lib/bulletin': {
      fetchNews: async () => ({ rows: [], error: 'network' }),
      fetchActivities: async () => ({ rows: [{ id: 7, title: '可读取活动', status: 'open', created_at: '2026-01-01' }], error: null }),
      fetchLostList: async () => ({ rows: [], error: null }),
    },
  })
  const result = await home.loadCampusHighlights()
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].recordId, 7)
  assert.ok(result.error.includes('公告'))
})
test('complete unread reads produce a known true total including zero', () => {
  const snapshot = { uid: 'a', notifications: unread.unreadSource(2, null), chats: unread.unreadSource(3, null) }
  assert.deepEqual(plain(unread.summarizeUnread('a', snapshot)), { count: 5, incomplete: false, error: false, hint: '' })
  snapshot.notifications = unread.unreadSource(0, null); snapshot.chats = unread.unreadSource(0, null)
  assert.equal(unread.summarizeUnread('a', snapshot).count, 0)
  assert.equal(unread.summarizeUnread('a', snapshot).incomplete, false)
})
test('a failed notification read preserves the successful private-message count', () => {
  const result = unread.summarizeUnread('a', { uid: 'a', notifications: unread.unreadSource(0, 'network'), chats: unread.unreadSource(7, null) })
  assert.equal(result.count, 7)
  assert.equal(result.incomplete, true)
  assert.equal(result.error, true)
  assert.equal(result.hint, '部分消息暂时无法读取')
  assert.deepEqual(plain(unread.unreadFailures('a', { uid: 'a', notifications: unread.unreadSource(0, 'network'), chats: unread.unreadSource(7, null) })), [{ label: '通知', to: '/notify', message: '网络连接失败，请稍后重试' }])
})
test('both failed reads show unknown, not zero unread', () => {
  const result = unread.summarizeUnread('a', { uid: 'a', notifications: unread.unreadSource(null, true), chats: unread.unreadSource(null, true) })
  assert.equal(result.count, null)
  assert.equal(result.hint, '消息暂时无法读取')
})
test('unread data from a previous UID is immediately hidden', () => {
  const old = { uid: 'a', notifications: unread.unreadSource(2, null), chats: unread.unreadSource(3, null) }
  assert.equal(unread.summarizeUnread('b', old).count, null)
  assert.equal(unread.summarizeUnread('', old).count, null)
})
test('invalid unread values cannot be promoted to real counts', () => {
  for (const value of [-1, NaN, Infinity, '4', null]) assert.equal(unread.unreadSource(value, null).count, null)
})

test('pending IM is unknown without becoming a connection failure', () => {
  const snapshot = { uid: 'a', notifications: unread.unreadSource(0, null), chats: unread.unreadSource(0, null), im: { count: null, error: false } }
  assert.equal(unread.summarizeUnread('a', snapshot).incomplete, true)
  assert.equal(unread.summarizeUnread('a', snapshot).error, false)
  assert.deepEqual(plain(unread.unreadFailures('a', snapshot)), [])
})

test('all failing sources are named while internal database errors stay out of user copy', () => {
  const snapshot = { uid: 'a', notifications: unread.unreadSource(null, 'internal policy relation'), chats: unread.unreadSource(null, 'network'), im: { count: null, error: true, detail: '登录态验证失败' } }
  const failures = plain(unread.unreadFailures('a', snapshot))
  assert.deepEqual(failures.map(f => f.label), ['通知', '历史私信', '即时私信'])
  assert.match(failures[2].message, /重新登录/)
  assert.ok(failures.every(f => !f.message.includes('internal policy')))
  assert.equal(unread.summarizeUnread('a', snapshot).count, null)
})

test('signing out or switching accounts hides previous connection errors as well as counts', () => {
  const snapshot = { uid: 'a', notifications: unread.unreadSource(0, 'network'), chats: unread.unreadSource(7, null) }
  assert.deepEqual(plain(unread.unreadFailures('b', snapshot)), [])
  assert.deepEqual(plain(unread.unreadFailures('', snapshot)), [])
  assert.equal(unread.summarizeUnread('b', snapshot).error, false)
})
