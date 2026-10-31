/**
 * 云函数限流：固定窗口计数，计数落在 public.function_rate_limits。
 *
 * 为什么不放内存：云函数按并发拉起多个实例，内存里的计数各算各的，
 *   攻击者只要把请求打散到不同实例就能绕过。计数必须落库，所有实例共享同一份。
 *
 * 为什么走 RPC 而不是函数直写表：INSERT ... ON CONFLICT DO UPDATE 能把
 *   「读计数 → 加一 → 写回」压成一条语句，**没有竞态窗口**；
 *   且限流表不对外开放任何 RLS 策略，客户端碰不到。
 *
 * 默认沿用低成本读取的故障放行策略。高成本操作可传 failClosed: true，
 *   此时数据库、RPC 或结果格式异常均返回 unavailable，调用方应暂缓执行。
 */

/**
 * 各云函数的默认配额，键必须与调用处传入的 scope **完全一致**，
 * 否则 readRule() 取不到默认值、环境变量覆盖也会静默失效。
 *
 * 覆盖方式：RATE_LIMIT_<SCOPE 大写、非字母数字转下划线>，
 * 形如 "5:60,20:3600"。例如
 *   exam-generator:generate → RATE_LIMIT_EXAM_GENERATOR_GENERATE
 *   exam-generator:read     → RATE_LIMIT_EXAM_GENERATOR_READ
 *   doc-parse               → RATE_LIMIT_DOC_PARSE
 *   exam-api                → RATE_LIMIT_EXAM_API
 */
const DEFAULT_RULES = {
  // 出题最贵：每次调用会真实消耗 LLM 额度
  'exam-generator:generate': [
    { limit: 5, windowSeconds: 60 },
    { limit: 20, windowSeconds: 3600 },
  ],
  // 轮询 / 读结果：便宜但量大
  'exam-generator:read': [{ limit: 60, windowSeconds: 60 }],
  // 文档解析：CPU / 内存密集
  'doc-parse': [
    { limit: 10, windowSeconds: 60 },
    { limit: 60, windowSeconds: 3600 },
  ],
  // 公开只读语料：不设限会被当免费接口刷流量
  'exam-api': [{ limit: 120, windowSeconds: 60 }],
}

function readRule(scope) {
  const envKey = `RATE_LIMIT_${scope.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`
  const raw = process.env[envKey]
  if (!raw) return DEFAULT_RULES[scope] || []
  // 形如 "5:60,20:3600"，解析失败就回落到默认
  const parsed = String(raw)
    .split(',')
    .map((part) => part.split(':'))
    .filter((pair) => pair.length === 2)
    .map(([limit, windowSeconds]) => ({ limit: Number(limit), windowSeconds: Number(windowSeconds) }))
    .filter((rule) => Number.isFinite(rule.limit) && Number.isFinite(rule.windowSeconds) && rule.limit > 0 && rule.windowSeconds > 0)
  return parsed.length ? parsed : DEFAULT_RULES[scope] || []
}

function unwrap(value) {
  let data = value
  for (let i = 0; i < 3 && typeof data === 'string'; i += 1) {
    try { data = JSON.parse(data) } catch { return null }
  }
  if (Array.isArray(data)) data = data.length === 1 ? data[0] : null
  return data && typeof data === 'object' ? data : null
}

/** 尽量拿到客户端 IP；拿不到就用 unknown，避免同一桶误伤 / 漏限 */
function clientIp(event) {
  const headers = (event && event.headers) || {}
  const forwarded = headers['x-forwarded-for'] || headers['X-Forwarded-For'] || ''
  const first = String(forwarded).split(',')[0].trim()
  const direct = event && event.requestContext && event.requestContext.http && event.requestContext.http.sourceIp
  return first || String(direct || '').trim() || 'unknown'
}

/** uid 已知就按人限；否则退回按 IP 限 */
function actorOf(event, uid) {
  return uid ? `uid:${uid}` : `ip:${clientIp(event)}`
}

/**
 * 命中一次计数。超限时返回 ok=false 与建议等待秒数。
 *
 * 只在**鉴权之后**调用：先有 uid 才谈得上按人限流，
 * 否则未登录的匿名请求会把 IP 桶刷爆，反而误伤同网段同学。
 */
async function enforceRateLimit(db, { scope, actor, rules, failClosed = false }) {
  const unavailable = () => failClosed
    ? { ok: false, unavailable: true, retryAfter: 0, limit: 0, windowSeconds: 0 }
    : { ok: true, retryAfter: 0, limit: 0, windowSeconds: 0 }
  if (!db || !actor) return unavailable()
  const list = Array.isArray(rules) && rules.length ? rules : readRule(scope)
  if (!list.length) return unavailable()
  let applied = 0
  for (const rule of list) {
    const limit = Number(rule && rule.limit)
    const windowSeconds = Number(rule && rule.windowSeconds)
    if (!(limit > 0) || !(windowSeconds > 0)) continue
    applied += 1
    try {
      const res = await db.rpc('rate_limit_hit', {
        p_scope: scope,
        p_actor: String(actor).slice(0, 120),
        p_limit: limit,
        p_window_seconds: windowSeconds,
      })
      const data = unwrap(res && res.data)
      if (res && res.error) return failClosed
        ? { ok: false, unavailable: true, retryAfter: 0, limit, windowSeconds }
        : { ok: true, retryAfter: 0, limit, windowSeconds }
      if (!data) return failClosed
        ? { ok: false, unavailable: true, retryAfter: 0, limit, windowSeconds }
        : { ok: true, retryAfter: 0, limit, windowSeconds }
      if (data.ok !== true && data.ok !== false) return unavailable()
      if (data && data.ok === false) {
        return {
          ok: false,
          retryAfter: Number(data.retry_after) || windowSeconds,
          limit,
          windowSeconds,
        }
      }
    } catch {
      return unavailable()
    }
  }
  if (!applied) return unavailable()
  return { ok: true, retryAfter: 0, limit: 0, windowSeconds: 0 }
}

module.exports = { enforceRateLimit, actorOf, clientIp, DEFAULT_RULES }
