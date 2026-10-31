function unwrap(value) {
  let data = value
  for (let i = 0; i < 3 && typeof data === 'string'; i += 1) { try { data = JSON.parse(data) } catch { return null } }
  if (Array.isArray(data)) data = data.length === 1 ? data[0] : null
  return data && typeof data === 'object' ? data : null
}
function actorOf(event, uid) {
  if (uid) return `uid:${uid}`
  const headers = event?.headers || {}
  const forwarded = headers['x-forwarded-for'] || headers['X-Forwarded-For'] || ''
  const direct = event?.requestContext?.http?.sourceIp
  return `ip:${String(forwarded).split(',')[0].trim() || String(direct || '').trim() || 'unknown'}`
}
async function enforceRateLimit(db, { scope, actor, rules }) {
  for (const rule of rules || []) {
    try {
      const result = await db.rpc('rate_limit_hit', { p_scope: scope, p_actor: String(actor).slice(0, 120), p_limit: rule.limit, p_window_seconds: rule.windowSeconds })
      const data = unwrap(result?.data)
      if (result?.error || !data) throw new Error('RATE_LIMIT_UNAVAILABLE')
      if (data.ok === false) return { ok: false, retryAfter: Number(data.retry_after) || rule.windowSeconds }
    } catch { throw new Error('RATE_LIMIT_UNAVAILABLE') }
  }
  return { ok: true, retryAfter: 0 }
}
module.exports = { enforceRateLimit, actorOf }
