/**
 * 成长池测试（纯逻辑层，用假 market 替掉 CloudBase）：
 * 1) 记想法：空标题拦下，落库带 uid / 默认负荷 / parked
 * 2) 读列表：脏 status 与越界 load 都要被收敛，不能把 undefined 渲染出来
 * 3) 一键转待办：先写 todos 再回写想法（converted + todo_id），todo 失败则不改想法
 * 4) 删除与局部更新
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')

function load(relative, injected = {}, globals = {}) {
  const source = fs.readFileSync(join(root, relative), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    URLSearchParams,
    ...globals,
    require(name) {
      if (name in injected) return injected[name]
      throw Error(`Unexpected dependency: ${name}`)
    },
  })
  return module.exports
}

function storage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value))
    },
    removeItem: (key) => {
      map.delete(key)
    },
  }
}

const SESSION = { uid: 'A', revision: 1 }

/** 内存版 market：按表名建 id，模拟 RLS「只返回自己的行」 */
function fakeMarket(options = {}) {
  const tables = { todos: [], growth_ideas: [] }
  let seq = 0
  return {
    tables,
    market: {
      async queryRows(name) {
        const rows = tables[name] || []
        return { rows: rows.map((r) => ({ ...r })), error: null }
      },
      async mutateRows(name, kind, body, id) {
        if (options.failOn === name && kind === 'insert') return { error: '写入失败' }
        const list = (tables[name] = tables[name] || [])
        if (kind === 'insert') {
          seq += 1
          list.push({ id: seq, created_at: `2026-03-10T00:00:${seq}.000Z`, ...body })
          return { error: null }
        }
        if (kind === 'update') {
          const hit = list.find((r) => r.id === id)
          if (hit) Object.assign(hit, body)
          return { error: null }
        }
        if (kind === 'delete') {
          tables[name] = list.filter((r) => r.id !== id)
          return { error: null }
        }
        return { error: '参数错误' }
      },
    },
  }
}

function pool(options = {}) {
  const { market, tables } = fakeMarket(options)
  const globals = { localStorage: storage(), Date, Math, Number }
  const deps = {
    './market': market,
    './qbank': { captureQbankSession: () => ({ ...SESSION }), isQbankSessionCurrent: () => true },
    // todo.ts / growth-pool 都靠它收口负荷档位，这里给一份等价实现（真身另有测试覆盖）
    './todo-energy': {
      DEFAULT_LOAD: 2,
      normLoad: (v) => {
        const n = Math.round(Number(v))
        if (!Number.isFinite(n)) return 2
        return Math.min(5, Math.max(1, n))
      },
    },
    './cb': { cbRdb: () => ({ from: () => ({}) }) },
  }
  // 真身 todo.ts（同样吃假 market），这样「转待办」测的是真实的写入链路
  const todo = load('src/lib/todo.ts', deps, globals)
  const mod = load('src/lib/growth-pool.ts', { ...deps, './todo': todo }, globals)
  return { ...mod, tables }
}

test('creating an idea rejects blank titles and stores owner, load and status', async () => {
  const { createGrowthIdea, tables } = pool()
  const blank = await createGrowthIdea({ title: '   ' })
  assert.equal(blank.error, '先写一下想做的事')
  assert.equal(tables.growth_ideas.length, 0)

  const res = await createGrowthIdea({ title: '学点心理学', note: '先看两章' })
  assert.equal(res.error, null)
  assert.equal(tables.growth_ideas.length, 1)
  const row = tables.growth_ideas[0]
  assert.equal(row.uid, 'A')
  assert.equal(row.title, '学点心理学')
  assert.equal(row.note, '先看两章')
  assert.equal(row.status, 'parked')
  assert.equal(row.load, 2)
})

test('reading the pool normalises dirty rows', async () => {
  const { fetchGrowthIdeas, tables } = pool()
  tables.growth_ideas = [
    { id: 1, uid: 'A', title: 'a', note: '', kind: 'idea', status: 'parked', load: 2, todo_id: null, created_at: '2026-03-10T00:00:01Z' },
    { id: 2, uid: 'A', title: 'b', note: '', kind: 'idea', status: 'converted', load: 99, todo_id: 7, created_at: '2026-03-10T00:00:02Z' },
    { id: 3, uid: 'A', title: 'c', note: '', kind: 'idea', status: 'who-knows', load: -4, todo_id: null, created_at: '2026-03-10T00:00:03Z' },
  ]
  const res = await fetchGrowthIdeas()
  assert.equal(res.error, null)
  const byId = new Map(res.rows.map((r) => [r.id, r]))
  assert.equal(byId.get(2).status, 'converted')
  assert.equal(byId.get(2).load, 5)
  assert.equal(byId.get(2).todo_id, 7)
  assert.equal(byId.get(3).status, 'parked')
  assert.equal(byId.get(3).load, 1)
  assert.equal(byId.get(3).todo_id, null)
})

test('converting an idea writes the todo first, then marks the idea', async () => {
  const { createGrowthIdea, convertIdeaToTodo, fetchGrowthIdeas, tables } = pool()
  await createGrowthIdea({ title: '把英语口语练起来', load: 3 })
  const [idea] = (await fetchGrowthIdeas()).rows
  const res = await convertIdeaToTodo(idea)
  assert.equal(res.error, null)
  assert.ok(res.todoId > 0)
  assert.equal(tables.todos.length, 1)
  assert.equal(tables.todos[0].title, '把英语口语练起来')
  assert.equal(tables.todos[0].load, 3)
  const after = (await fetchGrowthIdeas()).rows.find((r) => r.id === idea.id)
  assert.equal(after.status, 'converted')
  assert.equal(after.todo_id, res.todoId)
})

test('a failed todo insert leaves the idea parked', async () => {
  const { createGrowthIdea, convertIdeaToTodo, fetchGrowthIdeas, tables } = pool({ failOn: 'todos' })
  await createGrowthIdea({ title: '学吉他' })
  const [idea] = (await fetchGrowthIdeas()).rows
  const res = await convertIdeaToTodo(idea)
  assert.equal(res.error, '写入失败')
  assert.equal(res.todoId, null)
  assert.equal(tables.todos.length, 0)
  const after = (await fetchGrowthIdeas()).rows.find((r) => r.id === idea.id)
  assert.equal(after.status, 'parked')
  assert.equal(after.todo_id, null)
})

test('partial updates only touch the given columns and delete removes the row', async () => {
  const { createGrowthIdea, updateGrowthIdea, deleteGrowthIdea, fetchGrowthIdeas } = pool()
  await createGrowthIdea({ title: '跑个半马' })
  let [idea] = (await fetchGrowthIdeas()).rows
  const before = { ...idea }
  await updateGrowthIdea(idea.id, { load: 5 })
  const after = (await fetchGrowthIdeas()).rows.find((r) => r.id === idea.id)
  assert.equal(after.load, 5)
  assert.equal(after.title, before.title)
  assert.equal(after.note, before.note)
  await deleteGrowthIdea(idea.id)
  assert.equal((await fetchGrowthIdeas()).rows.length, 0)
})
