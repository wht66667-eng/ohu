const jwt = require('jsonwebtoken')

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  }
}

function key() {
  try {
    const parsed = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, 'key.json'), 'utf8'))
    if (parsed.private_key && parsed.private_key_id && parsed.env_id) return parsed
  } catch { /* invalid env */ }
  return null
}

exports.main = async (event = {}) => {
  let body = event
  if (typeof event.body === 'string') {
    try { body = JSON.parse(event.body) } catch { return json(400, { ok: false, message: '请求格式错误' }) }
  }
  const studentId = String(body?.studentId || '').trim()
  if (!/^\d{8,12}$/.test(studentId)) return json(400, { ok: false, message: '请填写正确的学号' })
  const credentials = key()
  if (!credentials) return json(500, { ok: false, message: '云身份尚未配置' })
  try {
  const now = Date.now()
  const uid = `student_${studentId}`
  const token = jwt.sign({
    alg: 'RS256',
    env: credentials.env_id,
    iat: now,
    exp: now + 10 * 60 * 1000,
    uid,
    refresh: 60 * 60 * 24 * 30,
    expire: now + 7 * 24 * 60 * 60 * 1000,
  }, credentials.private_key, { algorithm: 'RS256', allowInsecureKeySizes: true })
  return json(200, { ok: true, uid, ticket: `${credentials.private_key_id}/@@/${token}` })
  } catch (error) {
    return json(500, { ok: false, message: String(error && error.message || error).slice(0, 160) })
  }
}
