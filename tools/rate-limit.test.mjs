import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))

// 限流模块按「每个函数各存一份」的约定复制，改动必须同步到三处
const FNS = ['docParse', 'examApi', 'examGenerator']
const EXPECTED_SCOPES = ['doc-parse', 'exam-api', 'exam-generator:generate', 'exam-generator:read']

function load(fn) {
  return require(join(root, 'cloudfunctions', fn, 'rate-limit.js'))
}

/** 依次回放预设的 RPC 结果，模拟固定窗口计数 */
function fakeDb(replies) {
  return { rpc: async () => replies.shift() }
}

test('未超限时放行', async () => {
  const { enforceRateLimit } = load('examGenerator')
  const r = await enforceRateLimit(
    fakeDb([{ data: { ok: true, remaining: 4, retry_after: 0, limit: 5 } }]),
    { scope: 'exam-generator:generate', actor: 'uid:a', rules: [{ limit: 5, windowSeconds: 60 }] },
  )
  assert.equal(r.ok, true)
})

test('超限时拒绝并带上建议等待秒数', async () => {
  const { enforceRateLimit } = load('examGenerator')
  const r = await enforceRateLimit(
    fakeDb([{ data: { ok: false, remaining: 0, retry_after: 16, limit: 5 } }]),
    { scope: 'exam-generator:generate', actor: 'uid:a', rules: [{ limit: 5, windowSeconds: 60 }] },
  )
  assert.equal(r.ok, false)
  assert.equal(r.retryAfter, 16)
  assert.equal(r.limit, 5)
})

test('多档配额逐条检查，任一档超限即拒绝', async () => {
  const { enforceRateLimit } = load('examGenerator')
  // 第一档 60s 通过，第二档 3600s 超限
  const r = await enforceRateLimit(
    fakeDb([
      { data: { ok: true, remaining: 1, retry_after: 0, limit: 5 } },
      { data: { ok: false, remaining: 0, retry_after: 900, limit: 20 } },
    ]),
    { scope: 'exam-generator:generate', actor: 'uid:a', rules: [{ limit: 5, windowSeconds: 60 }, { limit: 20, windowSeconds: 3600 }] },
  )
  assert.equal(r.ok, false)
  assert.equal(r.retryAfter, 900)
})

test('retry_after 缺失时回落到窗口长度', async () => {
  const { enforceRateLimit } = load('examApi')
  const r = await enforceRateLimit(fakeDb([{ data: { ok: false, remaining: 0, limit: 120 } }]), {
    scope: 'exam-api', actor: 'ip:1.2.3.4', rules: [{ limit: 120, windowSeconds: 60 }],
  })
  assert.equal(r.ok, false)
  assert.equal(r.retryAfter, 60)
})

test('拿不到库连接时限流放行，不挡正常业务', async () => {
  const { enforceRateLimit } = load('docParse')
  assert.equal((await enforceRateLimit(null, { scope: 'doc-parse', actor: 'uid:a', rules: [{ limit: 1, windowSeconds: 60 }] })).ok, true)
  assert.equal((await enforceRateLimit(undefined, { scope: 'doc-parse', actor: 'uid:a', rules: [{ limit: 1, windowSeconds: 60 }] })).ok, true)
})

test('识别不出调用者时限流放行', async () => {
  const { enforceRateLimit } = load('docParse')
  const r = await enforceRateLimit(fakeDb([]), { scope: 'doc-parse', actor: '', rules: [{ limit: 1, windowSeconds: 60 }] })
  assert.equal(r.ok, true)
})

test('RPC 返回 error 时放行', async () => {
  const { enforceRateLimit } = load('docParse')
  const r = await enforceRateLimit(fakeDb([{ error: { message: 'boom' } }]), {
    scope: 'doc-parse', actor: 'uid:a', rules: [{ limit: 1, windowSeconds: 60 }],
  })
  assert.equal(r.ok, true)
})

test('RPC 抛异常时放行', async () => {
  const { enforceRateLimit } = load('docParse')
  const db = { rpc: async () => { throw new Error('network down') } }
  const r = await enforceRateLimit(db, { scope: 'doc-parse', actor: 'uid:a', rules: [{ limit: 1, windowSeconds: 60 }] })
  assert.equal(r.ok, true)
})

test('计数参数按调用方意图原样下发', async () => {
  const { enforceRateLimit } = load('examGenerator')
  const seen = []
  const db = { rpc: async (name, params) => { seen.push([name, params]); return { data: { ok: true, remaining: 0, retry_after: 0, limit: 3 } } } }
  await enforceRateLimit(db, { scope: 's', actor: 'x'.repeat(300), rules: [{ limit: 3, windowSeconds: 60 }] })
  assert.equal(seen[0][0], 'rate_limit_hit')
  assert.equal(seen[0][1].p_scope, 's')
  assert.equal(seen[0][1].p_actor.length, 120) // actor 需截断，避免超长键撑爆索引
  assert.equal(seen[0][1].p_limit, 3)
  assert.equal(seen[0][1].p_window_seconds, 60)
})

test('actorOf：有 uid 按人限，无 uid 退回按 IP 限', () => {
  const { actorOf } = load('examApi')
  assert.equal(actorOf({}, 'u1'), 'uid:u1')
  assert.equal(actorOf({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } }, ''), 'ip:1.2.3.4')
  assert.equal(actorOf({ requestContext: { http: { sourceIp: '9.9.9.9' } } }, null), 'ip:9.9.9.9')
  assert.equal(actorOf({}, null), 'ip:unknown')
})

test('DEFAULT_RULES 的键与函数里实际传入的 scope 完全一致', () => {
  const { DEFAULT_RULES } = load('examGenerator')
  assert.deepEqual(Object.keys(DEFAULT_RULES).sort(), [...EXPECTED_SCOPES].sort())
  for (const fn of FNS) {
    const src = fs.readFileSync(join(root, 'cloudfunctions', fn, 'index.js'), 'utf8')
    // 字符串字面量，如 scope: 'doc-parse'
    for (const m of src.matchAll(/scope:\s*'([^']+)'/g)) {
      assert.ok(DEFAULT_RULES[m[1]], `${fn} 用了未登记的 scope: ${m[1]}`)
    }
    // 模板字符串，如 scope: `exam-generator:${...}`，其分支 scope 必须都已登记
    for (const m of src.matchAll(/scope:\s*`([a-z-]+):\$\{/g)) {
      const prefix = `${m[1]}:`
      assert.ok(
        Object.keys(DEFAULT_RULES).some((key) => key.startsWith(prefix)),
        `${fn} 用了未登记的 scope 前缀: ${prefix}`,
      )
    }
  }
})

test('三份限流模块内容逐字节一致', () => {
  const [first, ...rest] = FNS.map((fn) => fs.readFileSync(join(root, 'cloudfunctions', fn, 'rate-limit.js'), 'utf8'))
  for (const [i, content] of rest.entries()) assert.equal(content, first, `${FNS[i + 1]} 的副本与主本不一致`)
})
