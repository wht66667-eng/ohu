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
      const result = await db.rpc('rate_limit_hit', { p_scope: `${scope}:${rule.windowSeconds}`, p_actor: String(actor).slice(0, 120), p_limit: rule.limit, p_window_seconds: rule.windowSeconds })
      const data = unwrap(result?.data)
      if (result?.error || !data || typeof data.ok !== 'boolean') {
        const code = String(result?.error?.code || 'INVALID_RPC_RESPONSE').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)
        // Never log the RPC arguments, user identity, response body or credentials.
        console.warn('AGNES_RATE_LIMIT_UNAVAILABLE', code)
        throw new Error('RATE_LIMIT_UNAVAILABLE')
      }
      if (data.ok === false) return { ok: false, retryAfter: Number(data.retry_after) || rule.windowSeconds }
    } catch (error) {
      if (error?.message !== 'RATE_LIMIT_UNAVAILABLE') console.warn('AGNES_RATE_LIMIT_CONNECTION', String(error?.code || 'UNKNOWN').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64))
      throw new Error('RATE_LIMIT_UNAVAILABLE')
    }
  }
  return { ok: true, retryAfter: 0 }
}
module.exports = { enforceRateLimit, actorOf }
