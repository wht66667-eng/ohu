const crypto = require('node:crypto')

function createVerifier({ envId, issuer = `https://${envId}.api.tcloudbasegateway.com`, fetchKeys, now = Date.now } = {}) {
  let cached = { until: 0, keys: [] }
  let pending
  const denied = () => { throw new Error('UNAUTHENTICATED') }
  async function getKeys(refresh = false) {
    if (!refresh && cached.until > now()) return cached.keys
    if (pending) return pending
    pending = (async () => {
      const values = fetchKeys ? await fetchKeys() : await fetch(`${issuer}/auth/v1/certs`, { signal: AbortSignal.timeout(3000) }).then(async response => {
        if (!response.ok) return denied()
        const text = await response.text()
        if (text.length > 65536) return denied()
        return JSON.parse(text).keys
      })
      if (!Array.isArray(values) || !values.length || values.length > 30) return denied()
      cached = { until: now() + 600000, keys: values }
      return values
    })()
    try { return await pending } finally { pending = null }
  }
  return async function verify(token) {
    if (!envId || typeof token !== 'string' || token.length > 8192) return denied()
    const parts = token.split('.')
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return denied()
    let header, claims
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    } catch { return denied() }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid || header.kid.length > 128) return denied()
    let key = (await getKeys()).find(value => value.kid === header.kid && value.kty === 'RSA' && (!value.alg || value.alg === 'RS256') && (!value.use || value.use === 'sig'))
    if (!key) key = (await getKeys(true)).find(value => value.kid === header.kid && value.kty === 'RSA' && (!value.alg || value.alg === 'RS256') && (!value.use || value.use === 'sig'))
    if (!key) return denied()
    let valid = false
    try { valid = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), crypto.createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url')) } catch { return denied() }
    const second = Math.floor(now() / 1000)
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    const anonymous = claims.is_anonymous === true || claims.isAnonymous === true || claims.anonymous === true || ['anon', 'anonymous', 'guest'].includes(claims.role)
    if (!valid || claims.iss !== issuer || !audience.includes(envId) || !Number.isSafeInteger(claims.exp) || claims.exp <= second ||
      (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > second)) || typeof claims.sub !== 'string' ||
      !claims.sub.trim() || claims.sub.length > 128 || /^local:/.test(claims.sub) || anonymous) return denied()
    return claims.sub
  }
}

module.exports = { createVerifier }
