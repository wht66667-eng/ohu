/**
 * 文档解析（HTTP：POST /api/docparse）· OP-C 二期
 *
 * 只做「PDF/Word/TXT → 纯文本 → 分块」，不做 AI 出题（Key 不扩散）。
 * 出题复用前端既有 /api/chat（askSunshine），按块逐个生成再入库。
 *
 * body: { base64, ext }   ext ∈ pdf | docx | txt
 * resp: { ok: true, chunks: [{ index, text }] } | { ok: false, message }
 *
 * 2026-10 收紧：此前本接口无鉴权且允许 27MB base64（约 20MB 原文件），
 * 任何拿到域名的人都能直接调，解析成本与流量全由本环境承担。
 * 现与 examGenerator 对齐：必须带登录态 Bearer token，文件上限 2MB。
 */
const mammoth = require('mammoth')
const { createVerifier } = require('./auth')
const { enforceRateLimit, actorOf } = require('./rate-limit')
let pdfParse = null
try {
  pdfParse = require('pdf-parse')
} catch (_) {
  /* pdf-parse 可选：未安装时仅支持 docx/txt */
}

const ENV_ID = 'jou-d4gq7a3cqf51e6caa'
const MAX_BYTES = 2 * 1024 * 1024
// base64 膨胀 4/3，再留一点表单开销；与 examGenerator 的 requestBody 同一算法
const MAX_BASE64 = Math.ceil(MAX_BYTES / 3) * 4 + 4096
const MAX_CHARS = 12000
const CHUNK_SIZE = 3800

const verifyToken = createVerifier({ envId: process.env.TCB_ENV || process.env.ENV_ID || ENV_ID })

/**
 * 配额：解析 PDF/Word 是 CPU / 内存密集型，
 * 单实例扛不住连打，所以除了「2MB / 200 万字」的单次体量校验，再加窗口次数闸门。
 * 默认值可用环境变量覆盖，例如 RATE_LIMIT_DOC_PARSE = "20:60,120:3600"。
 */
const RATE_LIMITS = {
  docParse: [
    { limit: 10, windowSeconds: 60 },
    { limit: 60, windowSeconds: 3600 },
  ],
}

/**
 * 限流计数用的服务端库连接。解析属于 CPU／内存密集型操作，
 *   无法确认共享限流状态时必须暂停解析，避免无上限消耗。
 */
let rdbClient
function db() {
  if (!rdbClient) {
    const tcb = require('@cloudbase/node-sdk')
    const key = String(process.env.CLOUDBASE_APIKEY || '').trim()
    rdbClient = tcb.init({ env: ENV_ID, ...(key ? { accessKey: key } : {}) }).rdb()
  }
  return rdbClient
}

function httpRes(status, body, extraHeaders) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      // 跨域头由 CloudBase 网关按「安全域名」白名单注入；不放 '*'，否则陌生站点也能直接调
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      ...(extraHeaders || {}),
    },
    body: JSON.stringify(body),
  }
}

function parseBody(event) {
  if (!event) return {}
  let body = event.body
  if (body == null || body === '') return event
  if (typeof body === 'object') return body
  let text = String(body)
  if (event.isBase64Encoded) {
    try {
      text = Buffer.from(text, 'base64').toString('utf8')
    } catch (_) {}
  }
  try {
    return JSON.parse(text.trim())
  } catch {
    throw new Error('bad json')
  }
}

function chunkText(text, size) {
  const clean = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const chunks = []
  let cur = ''
  for (const line of clean.split('\n')) {
    if ((cur + '\n' + line).length > size && cur) {
      chunks.push(cur.trim())
      cur = line
    } else {
      cur = cur ? cur + '\n' + line : line
    }
  }
  if (cur.trim()) chunks.push(cur.trim())
  return chunks.filter((c) => c.length > 0)
}

exports.main = async (event = {}) => {
  const method =
    event.httpMethod ||
    (event.requestContext && event.requestContext.http && event.requestContext.http.method) ||
    ''
  if (method === 'OPTIONS') return httpRes(204, { ok: true })
  if (method && method !== 'POST') return httpRes(405, { ok: false, message: '仅支持 POST' })

  // 身份只认 CloudBase 签发的 access token；游客（匿名）一律拒绝。
  const headers = event.headers || {}
  const authorization = headers.authorization || headers.Authorization || ''
  const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(authorization)
  let uid
  try {
    uid = match ? await verifyToken(match[1]) : null
  } catch {
    uid = null
  }
  if (typeof uid !== 'string' || !uid) return httpRes(401, { ok: false, message: '请先登录后使用文档解析' })

  /* 限流：按人计数，跨所有函数实例共享；鉴权之后、解析之前拦一道 */
  let budget
  try {
    budget = await enforceRateLimit(db(), {
      scope: 'doc-parse',
      actor: actorOf(event, uid),
      rules: RATE_LIMITS.docParse,
      failClosed: true,
    })
  } catch {
    return httpRes(503, { ok: false, code: 'RATE_LIMIT_UNAVAILABLE', message: '解析服务暂时繁忙，请稍后重试' })
  }
  if (budget.unavailable) {
    return httpRes(503, { ok: false, code: 'RATE_LIMIT_UNAVAILABLE', message: '解析服务暂时繁忙，请稍后重试' })
  }
  if (!budget.ok) {
    return httpRes(429,
      { ok: false, message: `解析太频繁，请 ${budget.retryAfter} 秒后再试`, retryAfter: budget.retryAfter },
      { 'Retry-After': String(budget.retryAfter) })
  }

  let rec
  try {
    rec = parseBody(event)
  } catch {
    return httpRes(400, { ok: false, message: '参数格式错误' })
  }

  const ext = String(rec.ext || '').toLowerCase()
  const base64 = String(rec.base64 || '')

  if (!base64) return httpRes(400, { ok: false, message: '缺少文件内容' })
  if (base64.length > MAX_BASE64) return httpRes(413, { ok: false, message: '文件超过 2MB' })
  if (!['pdf', 'docx', 'txt'].includes(ext)) return httpRes(400, { ok: false, message: '仅支持 pdf / docx / txt' })

  try {
    const buf = Buffer.from(base64, 'base64')
    let text = ''

    if (ext === 'txt') {
      text = buf.toString('utf8')
    } else if (ext === 'docx') {
      const result = await mammoth.extractRawText({ buffer: buf })
      text = result.value
    } else if (ext === 'pdf') {
      if (!pdfParse) return httpRes(501, { ok: false, message: 'PDF 解析组件未部署' })
      const result = await pdfParse(buf)
      text = result.text
    }

    if (text.length > MAX_CHARS) return httpRes(413, { ok: false, message: '文档文字超过 12000 字，请拆分后再试' })

    const chunks = chunkText(text, CHUNK_SIZE)
    if (!chunks.length) return httpRes(200, { ok: false, message: '没有解析出文字' })
    const limited = chunks.slice(0, 12).map((t, index) => ({ index, text: t }))
    return httpRes(200, { ok: true, chunks: limited, total: chunks.length })
  } catch (e) {
    const msg = (e && e.message) || String(e)
    console.error('docParse failed', msg)
    return httpRes(500, { ok: false, message: '解析失败：' + msg.slice(0, 120) })
  }
}
