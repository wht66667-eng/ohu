/**
 * exam-generator 端到端限流：走真实 handler，只把「鉴权」和「库」换成 mock，
 * 验证配额在干活之前拦住请求，且不同用户互不干扰。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))

const ENV = {
  TCB_ENV: 'test-env',
  CLOUDBASE_APIKEY: 'fake-api-key',
  LLM_API_KEY: 'fake-llm-key',
  LLM_MODEL: 'fake-model',
  LLM_BASE_URL: 'https://llm.example.test',
  FILE_EXAM_ENABLED: 'true',
  FILE_EXAM_PRICE_CENT: '100',
}

const UUID = '11111111-1111-4111-8111-111111111111'

/** 按 scope+actor+窗口 分桶计数，对齐库里的唯一键 (scope, actor, window_start) */
function countingDb() {
  const buckets = new Map()
  return {
    buckets,
    rpc: async (_name, params) => {
      const key = `${params.p_scope}|${params.p_actor}|${params.p_window_seconds}`
      const hits = (buckets.get(key) || 0) + 1
      buckets.set(key, hits)
      const ok = hits <= params.p_limit
      return {
        data: {
          ok,
          remaining: Math.max(0, params.p_limit - hits),
          retry_after: ok ? 0 : params.p_window_seconds,
          limit: params.p_limit,
        },
      }
    },
  }
}

function generateEvent(token) {
  return {
    httpMethod: 'POST',
    path: '/api/exam-generator/generate',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      requestId: UUID, fileName: 'note.pdf', ext: 'pdf',
      base64: 'AAAA', subject: '', type: 'mix', dir: 'both',
    }),
  }
}

function makeHandler(db, uid) {
  const api = require(join(root, 'cloudfunctions', 'examGenerator', 'index.js'))
  return api.createHandler({ db, verify: async (token) => (token === 'good' ? uid : '') })
}

test('前 5 次出题放行，第 6 次被限流拦截', async () => {
  const db = countingDb()
  const handler = makeHandler(db, 'uid:alice')
  const event = generateEvent('good')

  for (let i = 1; i <= 5; i += 1) {
    const res = await handler(event)
    assert.notEqual(res.statusCode, 429, `第 ${i} 次不该被限流（配额 5/60s）`)
  }
  const blocked = await handler(event)
  assert.equal(blocked.statusCode, 429)
  const body = JSON.parse(blocked.body)
  assert.equal(body.retryAfter, 60)
  assert.match(body.error, /请求太频繁/)
})

test('429 响应带上 Retry-After 头', async () => {
  const db = countingDb()
  const handler = makeHandler(db, 'uid:bob')
  const event = generateEvent('good')
  for (let i = 0; i < 5; i += 1) await handler(event)
  const blocked = await handler(event)
  assert.equal(blocked.statusCode, 429)
  assert.equal(blocked.headers['Retry-After'], '60')
})

test('限流按人隔离：A 被限不影响 B', async () => {
  const db = countingDb()
  const alice = makeHandler(db, 'uid:alice')
  const bob = makeHandler(db, 'uid:bob')
  const event = generateEvent('good')

  for (let i = 0; i < 6; i += 1) await alice(event)
  assert.equal((await alice(event)).statusCode, 429)

  // B 的计数桶独立，仍能正常发起（未配置 apiKey 时落到 503，说明没有被限流拦下）
  const bobs = await bob(event)
  assert.notEqual(bobs.statusCode, 429)
})

test('限流早于「服务未开放」检查，超限时不会误报 503', async () => {
  // 不配 CLOUBASE_APIKEY：正常应返回 503 NOT_CONFIGURED；
  // 但限流先执行，超限场景必须返回 429 而不是 503。
  const db = countingDb()
  const handler = makeHandler(db, 'uid:carol')
  const event = generateEvent('good')
  for (let i = 0; i < 5; i += 1) await handler(event)
  const blocked = await handler(event)
  assert.equal(blocked.statusCode, 429)
  const unblocked = await makeHandler(countingDb(), 'uid:dave')(event)
  assert.equal(unblocked.statusCode, 503)
})

test('未登录请求走不到限流', async () => {
  const db = countingDb()
  const handler = makeHandler(db, 'uid:alice')
  const res = await handler(generateEvent('bad'))
  assert.equal(res.statusCode, 401)
  assert.equal(db.buckets.size, 0)
})

test('/config 公开配置不消耗配额', async () => {
  const db = countingDb()
  const handler = makeHandler(db, 'uid:alice')
  const res = await handler({ httpMethod: 'GET', path: '/api/exam-generator/config', headers: {} })
  assert.equal(res.statusCode, 200)
  assert.equal(db.buckets.size, 0)
})
