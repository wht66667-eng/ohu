import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const fixtures = {
  cb: 'export const cbRdb = () => globalThis.todoFixture.db; export const cbAuth = () => ({ getAccessToken: () => "fixture" });',
  market: 'export const mutateRows = () => { throw Error("unexpected cloud mutation") };',
  qbank: 'export const captureQbankSession = () => ({ uid: globalThis.todoFixture.uid }); export const isQbankSessionCurrent = session => session.uid === globalThis.todoFixture.uid;',
  'todo-data-events': 'export const notifyTodoDataChanged = () => {};',
  'ai-local-context': 'export const buildLocalAiContext = () => "PRIVATE_CACHE";',
  gateway: 'export const API_BASE = "https://fixture.invalid";',
}
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const name = specifier.replace(/^\.\//, '')
    if (Object.hasOwn(fixtures, name) && /\/src\/lib\//.test(context.parentURL ?? '')) {
      return { url: 'data:text/javascript,' + encodeURIComponent(fixtures[name]), shortCircuit: true }
    }
    if (/^\.{1,2}\//.test(specifier) && !/\.[a-z]+$/.test(specifier) && context.parentURL?.endsWith('.ts')) {
      return next(specifier + '.ts', context)
    }
    return next(specifier, context)
  },
})
const { fetchTodosPage, fetchOpenTodosForHome, updateTodo } = await import('../src/lib/todo.ts')
const { generateContract } = await import('../src/services/coach/ai.ts')
const { requestAgnes } = await import('../src/lib/agnes-ai.ts')
hooks.deregister()

const row = (id, due_at = null) => ({ id, due_at, title: String(id), done: false })
function setup(read = (limit, cursor) => [row(5), row(4), row(3)].filter(r => r.id < cursor).slice(0, limit)) {
  const map = new Map([
    ['ohu.todo.local.v1:A', JSON.stringify([row(-10, '2026-11-13T00:00:00Z')])],
    ['ohu.todo.local.v1:B', JSON.stringify([row(-20)])],
  ])
  globalThis.localStorage = { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value) }
  globalThis.todoFixture = {
    uid: 'A',
    db: { from() {
      let cursor = Infinity
      return {
        select() { return this },
        eq() { return this },
        order() { return this },
        lt(_key, id) { cursor = id; return this },
        async limit(size) { return { data: await read(size, cursor) } },
      }
    } },
  }
}
test('本机待办随云端首屏返回，后续页只读取云端游标', async () => {
  setup()
  const page = await fetchTodosPage(null, 2)
  assert.deepEqual(page.rows.map(r => r.id), [-10, 5, 4])
  assert.equal(page.next_cursor, 4)
  assert.deepEqual((await fetchTodosPage(page.next_cursor, 2)).rows.map(r => r.id), [3])
  assert.deepEqual((await fetchOpenTodosForHome(2)).rows.map(r => r.id), [-10, 5])
  assert.equal((await updateTodo(-10, { done: true })).error, null)
  const completed = (await fetchTodosPage()).rows.find(r => r.id === -10)
  assert.equal(completed.title, '-10')
  assert.equal(completed.due_at, '2026-11-13T00:00:00Z')
  assert.deepEqual((await fetchOpenTodosForHome(2)).rows.map(r => r.id), [5, 4])
})

test('切换账号后丢弃旧请求结果，切回后恢复原本机待办', async () => {
  setup(async () => {
    globalThis.todoFixture.uid = 'B'
    return [row(5)]
  })
  const stale = await fetchTodosPage()
  assert.deepEqual(stale.rows, [])
  assert.match(stale.error, /账号已切换/)
  setup()
  globalThis.todoFixture.uid = 'B'
  assert.equal((await fetchTodosPage()).rows[0].id, -20)
  globalThis.todoFixture.uid = 'A'
  assert.equal((await fetchTodosPage()).rows[0].id, -10)
})

test('教练最终请求体不包含缓存，现有学习计划调用仍可附带上下文', async () => {
  const captured = []
  const original = globalThis.fetch
  globalThis.fetch = async (_url, request) => {
    captured.push(JSON.parse(request.body))
    return Response.json({ ok: true, answer: 'fixture' })
  }
  try {
    await generateContract('复习高数', '2026-11-13', '2026-11-20')
    await requestAgnes('study-plan', '常规学习计划')
    assert.equal(captured.length, 2)
    assert.match(captured[0].input, /复习高数/)
    assert.doesNotMatch(captured[0].input, /PRIVATE_CACHE/)
    assert.match(captured[1].input, /PRIVATE_CACHE/)
  } finally {
    globalThis.fetch = original
  }
})
