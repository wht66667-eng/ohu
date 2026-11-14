/**
 * TaskContract 1.1.0 · 教练任务契约解析与校验（M4 预览，纯函数，不落库）
 * 确定性规则优先：解析、字段校验、依赖成环、日期、单任务时长全部本地可解释。
 * AI 只用于生成草稿（见 ai.ts），契约本身不依赖任何模型即可校验。
 */

export const CONTRACT_SCHEMA = 'ohu.task-contract'
export const CONTRACT_VERSION = '1.1.0'
/** 单任务时长上限（分钟）：8 小时，超出视为异常排期。 */
export const MAX_TASK_MINUTES = 480
export const MIN_TASK_MINUTES = 1

export interface CoachTask {
  id: string
  title: string
  /** YYYY-MM-DD，落在 horizon 内 */
  date: string
  /** 单任务时长（分钟），1..480 */
  minutes: number
  /** 前置任务 id（不可成环、不可自引用、不可指向未知 id） */
  dependsOn: string[]
  category: string
  done: boolean
  note: string
}

export interface TaskContract {
  schema: string
  version: string
  title: string
  horizon: { start: string; end: string }
  tasks: CoachTask[]
}

/** 六类异常：断网 / 超时 / 异常 JSON / 缺字段 / 授权撤销 / 校验（成环·日期·时长）。 */
export type CoachErrorKind = 'network' | 'timeout' | 'parse' | 'schema' | 'auth' | 'validation'

export interface CoachIssue {
  code: string
  message: string
  taskId?: string
}

export type ParseResult =
  | { ok: true; contract: TaskContract }
  | { ok: false; kind: 'parse' | 'schema'; message: string; issues: CoachIssue[] }
  | { ok: false; kind: 'validation'; message: string; issues: CoachIssue[]; contract: TaskContract }

/** 每类异常的明确文案与恢复路径（出口要求：六类各有文案与恢复）。 */
export const COACH_ERRORS: Record<CoachErrorKind, { title: string; detail: string; recovery: string }> = {
  network: {
    title: '网络不可用',
    detail: '教练草稿需要联网生成，当前连接不上服务。',
    recovery: '检查网络后重试；也可以先用「示例契约」或「粘贴 JSON」离线预览。',
  },
  timeout: {
    title: '等待超时',
    detail: '生成草稿等待时间过长，已自动取消本次请求。',
    recovery: '重试一次；若持续超时，改用示例或粘贴 JSON 离线预览。',
  },
  parse: {
    title: '返回内容不是有效 JSON',
    detail: '拿到的文本无法解析为契约对象，可能被截断或夹带了说明文字。',
    recovery: '重试生成；或把完整 JSON 粘贴到输入框，系统会自动抠出对象。',
  },
  schema: {
    title: '契约缺少必需字段',
    detail: 'schema / version / horizon / tasks 等必需字段缺失或类型不符。',
    recovery: '按下方列出的字段补齐后重新校验；也可加载示例契约对照结构。',
  },
  auth: {
    title: '登录已失效',
    detail: '生成草稿需要登录哦狐账号，当前授权已撤销或过期。',
    recovery: '重新登录后再生成；离线预览（示例 / 粘贴 JSON）不需要登录。',
  },
  validation: {
    title: '排期校验未通过',
    detail: '契约结构正确，但存在依赖成环、日期越界或单任务时长异常。',
    recovery: '按下方逐条提示在预览里直接修改，改完即时重新校验；预览不会写入任何数据。',
  },
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** 真实日历校验：拒绝 2026-02-30 这类合法格式但非法日期。 */
export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 从模型回复或粘贴文本里抠出最外层 JSON 对象（容忍 ```json 围栏与前后废话）。 */
export function extractJsonObject(text: string): unknown {
  if (!text) return null
  const stripped = text.trim().replace(/```json/gi, '').replace(/```/g, '')
  const lo = stripped.indexOf('{')
  const hi = stripped.lastIndexOf('}')
  if (lo < 0 || hi <= lo) return null
  try {
    return JSON.parse(stripped.slice(lo, hi + 1))
  } catch {
    return null
  }
}

function normalizeTask(raw: unknown, index: number): { task: CoachTask | null; issues: CoachIssue[] } {
  const issues: CoachIssue[] = []
  if (!isRecord(raw)) {
    return { task: null, issues: [{ code: 'task_type', message: `第 ${index + 1} 个任务不是对象` }] }
  }
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  const date = typeof raw.date === 'string' ? raw.date.trim() : ''
  const minutes = typeof raw.minutes === 'number' ? raw.minutes : Number.NaN
  const dependsOn = Array.isArray(raw.dependsOn) ? raw.dependsOn.filter((d): d is string => typeof d === 'string').map(d => d.trim()) : []
  const category = typeof raw.category === 'string' && raw.category.trim() ? raw.category.trim() : '学习'
  const done = raw.done === true
  const note = typeof raw.note === 'string' ? raw.note.trim() : ''
  const ref = id || `#${index + 1}`
  if (!id) issues.push({ code: 'task_id', message: `任务 ${ref} 缺少 id`, taskId: id || undefined })
  if (!title) issues.push({ code: 'task_title', message: `任务 ${ref} 缺少标题`, taskId: id || undefined })
  if (!isValidDateKey(date)) issues.push({ code: 'task_date', message: `任务 ${ref} 日期「${date || '空'}」不是有效的 YYYY-MM-DD`, taskId: id || undefined })
  if (!Number.isFinite(minutes) || !Number.isInteger(minutes) || minutes < MIN_TASK_MINUTES || minutes > MAX_TASK_MINUTES) {
    issues.push({ code: 'task_minutes', message: `任务 ${ref} 时长「${Number.isFinite(minutes) ? minutes : '空'}」需为 ${MIN_TASK_MINUTES}–${MAX_TASK_MINUTES} 分钟的整数`, taskId: id || undefined })
  }
  if (!Array.isArray(raw.dependsOn)) issues.push({ code: 'task_depends', message: `任务 ${ref} 的 dependsOn 必须是数组`, taskId: id || undefined })
  const task: CoachTask = { id, title, date, minutes: Number.isFinite(minutes) ? minutes : 0, dependsOn, category, done, note }
  return { task, issues }
}

/** 依赖成环检测（DFS 三色），返回环路径或 null。 */
export function findDependencyCycle(tasks: CoachTask[]): string[] | null {
  const map = new Map(tasks.map(t => [t.id, t.dependsOn]))
  const state = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  let cycle: string[] | null = null
  const visit = (id: string): void => {
    if (cycle) return
    const mark = state.get(id) ?? 0
    if (mark === 1) {
      const at = stack.indexOf(id)
      cycle = [...stack.slice(at >= 0 ? at : 0), id]
      return
    }
    if (mark === 2) return
    state.set(id, 1)
    stack.push(id)
    for (const dep of map.get(id) ?? []) {
      if (map.has(dep)) visit(dep)
      if (cycle) break
    }
    stack.pop()
    state.set(id, 2)
  }
  for (const t of tasks) {
    visit(t.id)
    if (cycle) break
  }
  return cycle
}

/** 结构 + 字段 + 排期校验。结构错→schema；排期错→validation；均附逐条 issues。 */
export function validateContract(raw: unknown): ParseResult {
  if (!isRecord(raw)) {
    return { ok: false, kind: 'schema', message: COACH_ERRORS.schema.detail, issues: [{ code: 'root', message: '契约根节点必须是对象' }] }
  }
  const schemaIssues: CoachIssue[] = []
  if (raw.schema !== CONTRACT_SCHEMA) schemaIssues.push({ code: 'schema', message: `schema 应为「${CONTRACT_SCHEMA}」` })
  if (raw.version !== CONTRACT_VERSION) schemaIssues.push({ code: 'version', message: `version 应为「${CONTRACT_VERSION}」` })
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (!title) schemaIssues.push({ code: 'title', message: '缺少计划标题 title' })
  const horizon = isRecord(raw.horizon) ? raw.horizon : null
  const start = horizon && typeof horizon.start === 'string' ? horizon.start : ''
  const end = horizon && typeof horizon.end === 'string' ? horizon.end : ''
  if (!isValidDateKey(start)) schemaIssues.push({ code: 'horizon_start', message: 'horizon.start 不是有效日期' })
  if (!isValidDateKey(end)) schemaIssues.push({ code: 'horizon_end', message: 'horizon.end 不是有效日期' })
  if (!Array.isArray(raw.tasks)) schemaIssues.push({ code: 'tasks', message: 'tasks 必须是数组' })
  if (schemaIssues.length) {
    return { ok: false, kind: 'schema', message: COACH_ERRORS.schema.detail, issues: schemaIssues }
  }

  const tasks: CoachTask[] = []
  const issues: CoachIssue[] = []
  const seen = new Set<string>()
  ;(raw.tasks as unknown[]).forEach((item, index) => {
    const { task, issues: taskIssues } = normalizeTask(item, index)
    issues.push(...taskIssues)
    if (task) {
      if (task.id && seen.has(task.id)) issues.push({ code: 'duplicate_id', message: `任务 id「${task.id}」重复`, taskId: task.id })
      if (task.id) seen.add(task.id)
      tasks.push(task)
    }
  })

  if (isValidDateKey(start) && isValidDateKey(end) && start > end) {
    issues.push({ code: 'horizon_order', message: `起始日期 ${start} 晚于结束日期 ${end}` })
  }
  const ids = new Set(tasks.map(t => t.id).filter(Boolean))
  for (const t of tasks) {
    if (isValidDateKey(t.date) && isValidDateKey(start) && isValidDateKey(end) && (t.date < start || t.date > end)) {
      issues.push({ code: 'date_out_of_horizon', message: `任务「${t.title || t.id}」日期 ${t.date} 不在 ${start} ~ ${end} 内`, taskId: t.id })
    }
    for (const dep of t.dependsOn) {
      if (dep === t.id) issues.push({ code: 'self_dependency', message: `任务「${t.title || t.id}」依赖了自己`, taskId: t.id })
      else if (!ids.has(dep)) issues.push({ code: 'unknown_dependency', message: `任务「${t.title || t.id}」依赖了未知 id「${dep}」`, taskId: t.id })
    }
  }
  const cycle = findDependencyCycle(tasks.filter(t => t.id && ids.has(t.id)))
  if (cycle) {
    issues.push({ code: 'dependency_cycle', message: `依赖成环：${cycle.join(' → ')}` })
  }

  const contract: TaskContract = {
    schema: CONTRACT_SCHEMA,
    version: CONTRACT_VERSION,
    title,
    horizon: { start, end },
    tasks,
  }
  if (issues.length) {
    return { ok: false, kind: 'validation', message: COACH_ERRORS.validation.detail, issues, contract }
  }
  return { ok: true, contract }
}

/** 解析文本（粘贴或 AI 回复）→ 抠 JSON → 校验。无法抠出对象时归为 parse 异常。 */
export function parseContractText(text: string): ParseResult {
  const raw = extractJsonObject(text)
  if (raw === null) {
    return { ok: false, kind: 'parse', message: COACH_ERRORS.parse.detail, issues: [{ code: 'json', message: '未能从文本中解析出 JSON 对象' }] }
  }
  return validateContract(raw)
}