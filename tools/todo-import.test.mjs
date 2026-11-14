/**
 * 待办幂等导入回归（M5 第一段）：重复确认不重复、未知结果不重写可查询、失败可重试、跨账号中断。
 * 被测模块零副作用（localStorage/crypto 仅函数体内引用）；测试以内存 localStorage mock 注入。
 * 运行：`node --test tools/todo-import.test.mjs`。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  todoImportKey,
  readImportLedger,
  findImportRecord,
  markImportPending,
  markImportCreated,
  markImportFailed,
  resolveImportPending,
  listImportRecords,
  summarizeImport,
  importContractTasks,
  TODO_IMPORT_PREFIX,
} from '../src/lib/todo-import.ts'
import { buildSampleContract } from '../src/services/coach/sample.ts'

function installStorage() {
  const queues = new Map()
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request: (name, callback) => {
      const next = (queues.get(name) || Promise.resolve()).then(callback)
      queues.set(name, next.catch(() => {}))
      return next
    },
  } } })
  const map = new Map()
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    clear: () => { map.clear() },
  }
  return map
}

test('并发导入由锁串行化，只写入一次', async () => {
  installStorage()
  const w = okWriter()
  const results = await Promise.all([1, 2, 3].map(() => importContractTasks(contract, [t1], { uid: 'u', write: w.write })))
  assert.equal(w.calls.length, 1)
  assert.equal(results.reduce((sum, r) => sum + r.duplicate, 0), 2)
})

test('存储拒绝或损坏时拒绝新写入', async () => {
  installStorage()
  const w = okWriter()
  localStorage.setItem = () => { throw new Error('QuotaExceededError') }
  const r = await importContractTasks(contract, [t1], { uid: 'u', write: w.write })
  assert.equal(r.failed, 1)
  assert.equal(w.calls.length, 0)
  installStorage().set(`${TODO_IMPORT_PREFIX}u`, '{broken')
  const broken = await importContractTasks(contract, [t1], { uid: 'u', write: w.write })
  assert.equal(broken.failed, 1)
  assert.equal(w.calls.length, 0)
})

test('凭证满额时不淘汰旧记录、不写新任务', async () => {
  const map = installStorage()
  for (let i = 0; i < 500; i++) markImportPending(`k${i}`, { taskId: `t${i}`, title: '凭证', date: '2026-11-13' }, null, 'u')
  const before = map.get(`${TODO_IMPORT_PREFIX}u`)
  const w = okWriter()
  const r = await importContractTasks(contract, [t1], { uid: 'u', write: w.write })
  assert.equal(r.failed, 1)
  assert.equal(w.calls.length, 0)
  assert.equal(map.get(`${TODO_IMPORT_PREFIX}u`), before)
})

test('成功写入后凭证更新失败保留 pending，不重写', async () => {
  installStorage()
  const original = localStorage.setItem
  let stores = 0
  localStorage.setItem = (key, value) => { if (++stores > 1) throw new Error('满额'); original(key, value) }
  const w = okWriter()
  const r = await importContractTasks(contract, [t1], { uid: 'u', write: w.write })
  assert.equal(r.pending, 1)
  await importContractTasks(contract, [t1], { uid: 'u', write: w.write })
  assert.equal(w.calls.length, 1)
})

test('缺少跨标签锁时拒绝写入', async () => {
  installStorage()
  navigator.locks = undefined
  const w = okWriter()
  await assert.rejects(importContractTasks(contract, [t1], { uid: 'u', write: w.write }), /安全导入锁/)
  assert.equal(w.calls.length, 0)
})

const TODAY = '2026-11-13'
const contract = buildSampleContract(TODAY)
const [t1, t2] = contract.tasks

function okWriter(startId = 100) {
  let n = startId
  const calls = []
  return {
    calls,
    write: async (task) => { calls.push(task.id); return { id: n++, inserted: true, error: null } },
  }
}

test('todoImportKey 为 64 位 hex 且对同一契约任务稳定、随标题/日期/卷变化', async () => {
  const a = await todoImportKey(contract, t1)
  const b = await todoImportKey(contract, t1)
  assert.equal(a, b)
  assert.match(a, /^[0-9a-f]{64}$/)
  const other = await todoImportKey(contract, t2)
  assert.notEqual(a, other)
  const renamed = await todoImportKey(contract, { ...t1, title: t1.title + 'X' })
  assert.notEqual(a, renamed)
  const moved = await todoImportKey(contract, { ...t1, date: '2026-11-14' })
  assert.notEqual(a, moved)
  const retitled = await todoImportKey({ ...contract, title: contract.title + 'X' }, t1)
  assert.notEqual(a, retitled)
})

test('账本按账号隔离，pending→created→resolve 状态流转正确', () => {
  installStorage()
  const meta = { taskId: t1.id, title: t1.title, date: t1.date }
  markImportPending('k1', meta, null, 'u1')
  assert.equal(findImportRecord('k1', 'u1')?.status, 'pending')
  assert.equal(findImportRecord('k1', 'u2'), null)
  assert.equal(readImportLedger('u2').length, 0)
  markImportCreated('k1', 42, 'u1')
  assert.equal(findImportRecord('k1', 'u1')?.status, 'created')
  assert.equal(findImportRecord('k1', 'u1')?.todoId, 42)
  markImportPending('k2', meta, '未知', 'u1')
  assert.equal(resolveImportPending('k2', 7, 'u1'), true)
  assert.equal(findImportRecord('k2', 'u1')?.status, 'created')
  markImportPending('k3', meta, '未知', 'u1')
  assert.equal(resolveImportPending('k3', null, 'u1'), false)
  assert.equal(findImportRecord('k3', 'u1')?.status, 'pending')
  assert.equal(resolveImportPending('missing', 1, 'u1'), false)
  assert.ok(globalThis.localStorage.getItem(`${TODO_IMPORT_PREFIX}u1`))
})

test('summarizeImport 分组已写入/待处理/失败', () => {
  installStorage()
  const meta = { taskId: 'x', title: 't', date: TODAY }
  markImportPending('a', meta, null, 'u')
  markImportCreated('a', 1, 'u')
  markImportPending('b', meta, '未知', 'u')
  markImportPending('c', meta, null, 'u')
  markImportFailed('c', 'boom', 'u')
  const s = summarizeImport(listImportRecords('u'))
  assert.deepEqual(s.created.map((r) => r.key), ['a'])
  assert.deepEqual(s.pending.map((r) => r.key), ['b'])
  assert.deepEqual(s.failed.map((r) => r.key), ['c'])
})

test('重复确认不产生重复任务：第二次全 duplicate 且不再调用 writer', async () => {
  installStorage()
  const w = okWriter()
  const first = await importContractTasks(contract, [t1, t2], { uid: 'u', write: w.write })
  assert.equal(first.created, 2)
  assert.equal(first.duplicate, 0)
  assert.equal(w.calls.length, 2)
  const second = await importContractTasks(contract, [t1, t2], { uid: 'u', write: w.write })
  assert.equal(second.created, 0)
  assert.equal(second.duplicate, 2)
  assert.equal(w.calls.length, 2)
  assert.equal(second.results[0].todoId, first.results[0].todoId)
})

test('未知写入结果记 pending：不重写、可查询、人工落定后去重', async () => {
  installStorage()
  let calls = 0
  const unknown = async () => { calls++; return { id: null, inserted: true, error: '服务未返回编号' } }
  const r1 = await importContractTasks(contract, [t1], { uid: 'u', write: unknown })
  assert.equal(r1.pending, 1)
  assert.equal(calls, 1)
  const r2 = await importContractTasks(contract, [t1], { uid: 'u', write: unknown })
  assert.equal(r2.pending, 1)
  assert.equal(calls, 1, 'pending 不应触发重写')
  const key = r1.results[0].key
  assert.equal(findImportRecord(key, 'u')?.status, 'pending')
  assert.equal(summarizeImport(listImportRecords('u')).pending.length, 1)
  resolveImportPending(key, 99, 'u')
  const r3 = await importContractTasks(contract, [t1], { uid: 'u', write: unknown })
  assert.equal(r3.duplicate, 1)
  assert.equal(r3.results[0].todoId, 99)
  assert.equal(calls, 1)
})

test('明确失败可重试：failed 后再次导入会重新写入', async () => {
  installStorage()
  let calls = 0
  const failThenOk = async () => {
    calls++
    return calls === 1 ? { id: null, inserted: false, error: '网络异常' } : { id: 5, inserted: true, error: null }
  }
  const r1 = await importContractTasks(contract, [t1], { uid: 'u', write: failThenOk })
  assert.equal(r1.failed, 1)
  const r2 = await importContractTasks(contract, [t1], { uid: 'u', write: failThenOk })
  assert.equal(r2.created, 1)
  assert.equal(calls, 2)
})

test('writer 抛异常记 pending，重试不会再次写入', async () => {
  installStorage()
  let calls = 0
  const boom = async () => { calls++; throw new Error('响应丢失') }
  const r = await importContractTasks(contract, [t1], { uid: 'u', write: boom })
  assert.equal(r.pending, 1)
  await importContractTasks(contract, [t1], { uid: 'u', write: boom })
  assert.equal(calls, 1)
  assert.match(r.results[0].error, /响应丢失/)
})

test('跨账号：首条确认后停止，剩余 skipped 不续写', async () => {
  installStorage()
  const w = okWriter()
  let guardCalls = 0
  const r = await importContractTasks(contract, [t1, t2], {
    uid: 'u',
    write: w.write,
    // 编排对 t1 调用 3 次（循环顶/写前/写后）均放行，t2 循环顶第 4 次起判定切换
    sessionChanged: () => (++guardCalls >= 4),
  })
  assert.equal(r.stopped, true)
  assert.equal(r.created, 1)
  assert.equal(r.skipped, 1)
  assert.equal(w.calls.length, 1)
})

test('跨账号：写中切换记未知 pending 并保留返回 ID，剩余 skipped', async () => {
  installStorage()
  const w = okWriter()
  let guardCalls = 0
  const r = await importContractTasks(contract, [t1, t2], {
    uid: 'u',
    write: w.write,
    // 仅 t1 写后第 3 次检查判定切换 → 该笔结果未知
    sessionChanged: () => (++guardCalls === 3),
  })
  assert.equal(r.stopped, true)
  assert.equal(r.created, 0)
  assert.equal(r.pending, 1)
  assert.equal(r.skipped, 1)
  const rec = findImportRecord(r.results[0].key, 'u')
  assert.equal(rec?.status, 'pending')
  assert.equal(rec?.todoId, 100, '未知结果应保留已返回 ID 供人工落定')
})

test('部分成功：created/pending/failed 混合计数与清单齐全', async () => {
  installStorage()
  const mix = async (task) => {
    if (task.id === t1.id) return { id: 1, inserted: true, error: null }
    if (task.id === t2.id) return { id: null, inserted: true, error: '未确认' }
    return { id: null, inserted: false, error: '拒绝' }
  }
  const t3 = contract.tasks[2]
  const r = await importContractTasks(contract, [t1, t2, t3], { uid: 'u', write: mix })
  assert.equal(r.created, 1)
  assert.equal(r.pending, 1)
  assert.equal(r.failed, 1)
  const s = summarizeImport(listImportRecords('u'))
  assert.equal(s.created.length, 1)
  assert.equal(s.pending.length, 1)
  assert.equal(s.failed.length, 1)
})