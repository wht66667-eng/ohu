/** Read-only public licensed corpus. Never queries the existing private qbank. */
const { enforceRateLimit, actorOf } = require('./rate-limit')
const EXAMS = new Set(['CET-4', 'CET-6', 'KAOYAN-1', 'KAOYAN-2', 'IELTS'])
const TYPES = new Set(['reading', 'listening', 'vocabulary', 'grammar', 'writing', 'translation'])

/**
 * 配额：本接口公开只读、不校验登录态，最容易被人当免费接口刷，
 * 所以按来源 IP 计数。默认值可用环境变量覆盖，例如
 *   RATE_LIMIT_EXAM_API = "300:60"（300 次 / 60 秒）
 */
const RATE_LIMITS = {
  examApi: [{ limit: 120, windowSeconds: 60 }],
}

let database
function db() {
  if (!database) {
    const tcb = require('@cloudbase/node-sdk')
    const app = tcb.init({ env: process.env.TCB_ENV || tcb.SYMBOL_DEFAULT_ENV,
      ...(process.env.CLOUDBASE_APIKEY ? { accessKey: process.env.CLOUDBASE_APIKEY } : {}) })
    database = app.rdb()
  }
  return database
}
function response(status, body, extraHeaders) {
  return { statusCode: status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    // 跨域头由 CloudBase 网关按「安全域名」白名单注入；不放 '*'，否则陌生站点也能直接调
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
    ...(extraHeaders || {}),
  }, body: status === 204 ? '' : JSON.stringify(body) }
}
function invalid(message) { const error = new Error(message); error.status = 400; throw error }
function integer(value, fallback, max, name) {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > max) invalid(`${name} 必须是 1–${max} 的整数`)
  return Number(value)
}
function parameters(event) {
  const raw = event.rawQueryString || event.queryString || ''
  if (raw && typeof raw === 'string') {
    const query = new URLSearchParams(raw)
    for (const key of query.keys()) if (query.getAll(key).length !== 1) invalid('参数不能重复')
    return Object.fromEntries(query)
  }
  return event.queryStringParameters || {}
}
function createHandler(getDatabase = db) {
  return async (event = {}) => {
    const method = event.httpMethod || event.requestContext?.http?.method || 'GET'
    if (method === 'OPTIONS') return response(204)
    if (method !== 'GET') return response(405, { error: '仅支持 GET' })
    try {
      const path = (event.path || event.rawPath || '/').replace(/^\/api\/exam(?=\/|$)/, '')
      const params = parameters(event)
      const isPassage = /^\/passages\/[a-f0-9]{64}$/.test(path)
      if (!isPassage && !['/questions', '/vocab'].includes(path)) return response(404, { error: '接口或材料不存在' })

      /* 限流：本接口无需登录（公开只读语料），所以按来源 IP 计数 */
      const budget = await enforceRateLimit(getDatabase(), {
        scope: 'exam-api', actor: actorOf(event, ''), rules: RATE_LIMITS.examApi,
      })
      if (!budget.ok) {
        return response(429,
          { ok: false, error: `请求太频繁，请 ${budget.retryAfter} 秒后再试`, retryAfter: budget.retryAfter },
          { 'Retry-After': String(budget.retryAfter) })
      }

      const allowed = path === '/questions' ? ['exam_type','year','type','format','page','limit'] : path === '/vocab' ? ['exam_type','page','limit'] : []
      if (Object.keys(params).some(key => !allowed.includes(key))) invalid('不支持的查询参数')
      if (params.exam_type !== undefined && !EXAMS.has(params.exam_type)) invalid('考试类型无效')
      if (params.type !== undefined && !TYPES.has(params.type)) invalid('题型无效')
      if (params.format !== undefined && !['single_choice','short_answer'].includes(params.format)) invalid('作答方式无效')
      if (params.year !== undefined && (!/^\d{4}$/.test(params.year) || Number(params.year)<1900 || Number(params.year)>2100)) invalid('年份无效')
      const page = integer(params.page, 1, 10000, 'page')
      const limit = integer(params.limit, 20, 100, 'limit')
      const table = isPassage ? 'exam_public_passages' : path === '/vocab' ? 'exam_public_vocab' : 'exam_public_questions'
      let query = getDatabase().from(table).select('*')
      if (isPassage) query = query.eq('id', path.split('/').pop()).limit(1)
      else {
        if (params.exam_type) query = query.eq('exam_type', params.exam_type)
        if (params.year) query = query.eq('year', Number(params.year))
        if (params.type) query = query.eq('question_type', params.type)
        if (params.format) query = query.eq('question_format', params.format)
        query = query.order('id', { ascending: true }).range((page-1)*limit, page*limit)
      }
      const result = await query
      if (result.error || !Array.isArray(result.data)) throw new Error('Corpus query failed')
      if (isPassage) return result.data.length ? response(200, { data: result.data[0] }) : response(404, { error: '材料不存在或暂未发布' })
      return response(200, { data: result.data.slice(0,limit), page, limit, has_more: result.data.length>limit })
    } catch (error) {
      if (error.status === 400) return response(400, { error: error.message })
      console.error('examApi read failed', { code: error.code || 'QUERY_FAILED' })
      return response(503, { error: '题库暂时无法读取，请稍后重试' })
    }
  }
}
exports.createHandler = createHandler
exports.main = createHandler()
