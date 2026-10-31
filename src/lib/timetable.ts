/**
 * 江苏海洋大学课表接口（云托管服务 jou-api）
 *
 * 接口契约：
 *   POST /api/timetable/captcha → {ok, sid, image: dataURL}
 *   POST /api/timetable/query   → {ok, rows:[{week, day, sections, name, teacher, room}]}
 *                              或 {ok:false, code, message}
 *
 * 地址由 Vite 环境变量 VITE_TIMETABLE_API 注入（即网关默认域，路径前缀 /api/timetable）：
 *   - dev / prod 均默认指向线上云托管（见 .env.development / .env.production）
 *   - 本地调 Flask 时用 `VITE_TIMETABLE_API=http://127.0.0.1:8090 npm run dev` 覆盖
 *
 * 错误码（后端契约，勿改语义）：
 *   1001=验证码错或会话过期（调用方应重新 fetchCaptcha）/ 1002=密码错
 *   1004=限流或服务繁忙（带 retryAfter，调用方应做冷却）/ 1006=上游超时或网络失败
 *   1007=课表解析失败 / 1010=服务端 OCR 未启用（应回退手输验证码）
 */

// A clean checkout (including GitHub iOS builds) must use the public gateway.
// Local Flask development remains an explicit VITE_TIMETABLE_API override.
const RAW = (import.meta.env.VITE_TIMETABLE_API ?? 'https://jou-d4gq7a3cqf51e6caa-1394316826.ap-shanghai.app.tcloudbase.com').toString().trim()
/** 去掉末尾的 `/`，避免拼接出 `//api/...` */
export const TIMETABLE_API_BASE = RAW.replace(/\/+$/, '')

/** 网络超时（毫秒）：取验证码较快；查询要等教务登录 + 课表页解析，给足时间 */
const TIMEOUT_CAPTCHA = 25_000
const TIMEOUT_QUERY = 60_000
/** 自动 OCR 可能多次换图重试，给更长超时 */
const TIMEOUT_AUTO = 90_000

export interface TtRow {
  /** 第几周（1..N） */
  week: number
  /** 周几：1=周一 … 7=周日 */
  day: number
  /** 第几节数组（已合并的连续节次） */
  sections: number[]
  /** 课程名 */
  name: string
  /** 教师 */
  teacher: string
  /** 教室 */
  room: string
}

export interface CaptchaResp {
  ok: boolean
  sid: string
  /** PNG/JPG 的 data URL，可直接放进 <img src> */
  image: string
}

export interface QueryOkResp {
  ok: true
  student_id?: string
  rows?: TtRow[]
  grades?: GradeRemote[]
  exams?: ExamRemote[]
  grades_error?: string
  exams_error?: string
}

export type GradeRemote = {
  year: string
  term: string
  code: string
  name: string
  nature: string
  credit: string
  score: string
  gpa: string
}

export type ExamRemote = {
  year: string
  term: string
  code: string
  name: string
  datetime: string
  room: string
  form: string
  seat: string
  campus: string
  teacher: string
}

export interface QueryErrResp {
  ok: false
  /** 1001=验证码错 / 1002=密码错 / 1004=限频 / 1006=上游超时 / 1007=解析失败 */
  code: string
  error?: string
  message?: string
}

export type QueryResp = QueryOkResp | QueryErrResp

/** 带错误码的异常，页面据此做自动换图 / 冷却等处理 */
export interface TimetableError extends Error {
  code?: string
  /** 后端 Retry-After（秒），仅限流时返回 */
  retryAfter?: number
  /** 路由缺失时供自动同步回退，不能依赖网关错误正文。 */
  httpStatus?: number
}

function fail(msg: string, code?: string, retryAfter?: number): TimetableError {
  const err = new Error(msg) as TimetableError
  err.code = code
  err.retryAfter = retryAfter
  return err
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function apiFailure(data: Record<string, unknown>, retryAfter: number, automatic = false, fallback = '查询失败'): TimetableError {
  const code = typeof data.code === 'string' && data.code ? data.code : automatic ? '1010' : '1006'
  const message = typeof data.message === 'string' && data.message ? data.message
    : typeof data.error === 'string' && data.error ? data.error : fallback
  return fail(code === '1001' ? automatic ? '自动识别验证码失败，请手输验证码' : '验证码错误或已过期，请重新输入'
    : automatic && code === '1010' ? '自动识别未启用，请手输验证码' : message, code, retryAfter)
}

function validCourse(value: unknown): boolean {
  return isRecord(value) && Number.isInteger(value.week) && Number(value.week) >= 1
    && Number.isInteger(value.day) && Number(value.day) >= 1 && Number(value.day) <= 7
    && Array.isArray(value.sections) && value.sections.length > 0
    && value.sections.every((section) => Number.isInteger(section) && section >= 1)
    && typeof value.name === 'string' && !!value.name.trim()
    && typeof value.teacher === 'string' && typeof value.room === 'string'
}

function validStrings(value: unknown, fields: readonly string[]): boolean {
  return isRecord(value) && fields.every((field) => typeof value[field] === 'string')
    && typeof value.name === 'string' && !!value.name.trim()
}

/** Missing requested data is a protocol failure, rather than a successfully empty sync. */
function academicResponse(data: unknown, requested: Array<'schedule' | 'grades' | 'exams'>, retryAfter: number, automatic = false): QueryOkResp {
  if (!isRecord(data) || typeof data.ok !== 'boolean') throw fail('课表服务返回格式异常，请重试', '1006')
  if (!data.ok) throw apiFailure(data, retryAfter, automatic, automatic ? '自动同步失败' : '查询失败')
  if ((data.student_id !== undefined && typeof data.student_id !== 'string')
    || (data.auto !== undefined && typeof data.auto !== 'boolean')
    || (data.grades_error !== undefined && typeof data.grades_error !== 'string')
    || (data.exams_error !== undefined && typeof data.exams_error !== 'string')) {
    throw fail('课表服务返回格式异常，请重试', '1006')
  }
  const want = requested.length ? requested : automatic ? ['schedule', 'grades', 'exams'] : ['schedule']
  const check = (field: 'rows' | 'grades' | 'exams', required: boolean, valid: (item: unknown) => boolean, partialError?: unknown) => {
    const value = data[field]
    if (value === undefined && (!required || typeof partialError === 'string' && !!partialError.trim())) return
    if (!Array.isArray(value) || !value.every(valid)) throw fail('课表服务返回格式异常，请重试', '1006')
  }
  check('rows', want.includes('schedule'), validCourse)
  check('grades', want.includes('grades'), (item) => validStrings(item, ['year', 'term', 'code', 'name', 'nature', 'credit', 'score', 'gpa']), data.grades_error)
  check('exams', want.includes('exams'), (item) => validStrings(item, ['year', 'term', 'code', 'name', 'datetime', 'room', 'form', 'seat', 'campus', 'teacher']), data.exams_error)
  return data as unknown as QueryOkResp
}

/**
 * 统一的 POST JSON 封装：
 *  - 加超时（避免移动端网络差时按钮长时间无响应）
 *  - 非 JSON 响应兜底（网关/容器异常时可能是 HTML 错误页）
 *  - 带出 Retry-After，供页面做冷却倒计时
 */
async function postJson(
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<{ data: unknown; retryAfter: number }> {
  const ctrl = new AbortController()
  let timer: ReturnType<typeof setTimeout>
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      ctrl.abort()
      reject(fail('服务响应超时，请重试', '1006'))
    }, timeoutMs)
  })
  try {
    const { r, text } = await Promise.race([
      (async () => {
        try {
          const r = await fetch(`${TIMETABLE_API_BASE}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: ctrl.signal,
          })
          return { r, text: await r.text() }
        } catch (error) {
          const aborted = ctrl.signal.aborted || isRecord(error) && error.name === 'AbortError'
          throw fail(aborted ? '服务响应超时，请重试' : '无法连接课表服务，请检查网络后重试', '1006')
        }
      })(),
      deadline,
    ])
    const seconds = Number(r.headers.get('Retry-After') || 0)
    const retryAfter = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
    const httpFailure = () => {
      const error = fail(`课表服务暂时不可用（HTTP ${r.status}），请稍后重试`, r.status === 429 ? '1004' : '1006', retryAfter)
      error.httpStatus = r.status
      return error
    }
    let data: unknown
    try { data = JSON.parse(text) }
    catch { throw httpFailure() }
    if (!r.ok) {
      // Older deployments can return a JSON 1008 from their catch-all route.
      if (r.status === 404 || r.status === 405) throw httpFailure()
      const error = isRecord(data) && data.ok === false ? apiFailure(data, retryAfter, path.endsWith('/auto')) : httpFailure()
      if (r.status === 429) error.code = '1004'
      error.httpStatus = r.status
      throw error
    }
    return { data, retryAfter }
  } finally {
    clearTimeout(timer!)
  }
}

/** 拉取一次性登录会话 + 验证码图片 */
export async function fetchCaptcha(): Promise<CaptchaResp> {
  const { data, retryAfter } = await postJson('/api/timetable/captcha', undefined, TIMEOUT_CAPTCHA)
  if (isRecord(data) && data.ok === false) throw apiFailure(data, retryAfter, false, '验证码加载失败，请重试')
  if (!isRecord(data) || data.ok !== true || typeof data.sid !== 'string' || !data.sid
    || typeof data.image !== 'string' || !data.image) throw fail('验证码加载失败，请重试', '1006')
  return { ok: true, sid: data.sid, image: data.image }
}

/**
 * 用 sid + 学号 + 密码 + 验证码 登录教务系统并拉课表。
 * 验证码错时（code=1001），调用方应当重新调 fetchCaptcha()。
 */
export async function queryTimetable(
  sid: string,
  payload: { username: string; password: string; captcha: string },
): Promise<TtRow[]> {
  const data = await queryAcademic(sid, payload, ['schedule'])
  return data.rows ?? []
}

/**
 * 一次验证码同步课表 / 成绩 / 考试（fetch 控制抓取项）。
 */
export async function queryAcademic(
  sid: string,
  payload: { username: string; password: string; captcha: string },
  fetch: Array<'schedule' | 'grades' | 'exams'> = ['schedule'],
): Promise<{
  rows: TtRow[]
  grades: GradeRemote[]
  exams: ExamRemote[]
  grades_error?: string
  exams_error?: string
  student_id?: string
}> {
  const { data, retryAfter } = await postJson(
    '/api/timetable/query',
    { sid, ...payload, fetch },
    TIMEOUT_QUERY,
  )
  const d = academicResponse(data, fetch, retryAfter)
  return {
    rows: d.rows ?? [],
    grades: d.grades ?? [],
    exams: d.exams ?? [],
    grades_error: d.grades_error,
    exams_error: d.exams_error,
    student_id: d.student_id,
  }
}

/**
 * 仅学号 + 密码：服务端 OCR 验证码后拉课表/成绩/考试。
 * code=1010 / 1001 时调用方应回退到手输验证码流程。
 * 线上旧版 jou-api 无 /auto（常返回 404/405）时同样视为 1010。
 */
export async function autoQueryAcademic(
  payload: { username: string; password: string },
  fetch: Array<'schedule' | 'grades' | 'exams'> = ['schedule', 'grades', 'exams'],
): Promise<{
  rows: TtRow[]
  grades: GradeRemote[]
  exams: ExamRemote[]
  grades_error?: string
  exams_error?: string
  student_id?: string
  auto?: boolean
}> {
  let data: unknown
  let retryAfter = 0
  try {
    const res = await postJson(
      '/api/timetable/auto',
      { ...payload, fetch, max_tries: 5 },
      TIMEOUT_AUTO,
    )
    data = res.data
    retryAfter = res.retryAfter
  } catch (e) {
    const err = e as TimetableError
    /* 旧网关/旧容器没有 auto 路由 */
    if (err.httpStatus === 404 || err.httpStatus === 405) {
      throw fail('自动识别未部署，请手输验证码', '1010')
    }
    throw err
  }
  const d = academicResponse(data, fetch, retryAfter, true)
  return {
    rows: d.rows ?? [],
    grades: d.grades ?? [],
    exams: d.exams ?? [],
    grades_error: d.grades_error,
    exams_error: d.exams_error,
    student_id: d.student_id,
    auto: true,
  }
}
