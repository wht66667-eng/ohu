/**
 * 全局待办（作业 / 工作任务）
 * - 表级 CRUD 走 RLS（仅本人），复用 market.ts 的 queryRows / mutateRows
 * - 到期提醒：todo_remind_scan RPC（服务端按「每条待办每天至多一条」写通知）
 */
import { cbRdb } from './cb'
import { mutateRows, type QueryRes, type MutateRes } from './market'
import { DEFAULT_LOAD, normLoad, type LoadValue } from './todo-energy'
import { captureQbankSession, isQbankSessionCurrent } from './qbank'
import { notifyTodoDataChanged } from './todo-data-events'

type Any = any

export interface TodoRow {
  id: number
  title: string
  note: string
  due_at: string | null
  done: boolean
  done_at: string | null
  created_at: string
  /** 精力负荷 1-5（todos.load）；老数据没这列时由 normLoad 兜成默认档 */
  load: LoadValue
}

export interface TodoDraft {
  title: string
  note: string
  /** ISO 时间串；空串表示没有到期 */
  due_at: string
  /** 精力负荷 1-5，不传按默认档 */
  load?: unknown
}

export interface TodoScanRes {
  due: Array<{ id: number; title: string; due_at: string }>
  created: number
  today: number
  overdue: number
}

export interface TodoPageRes extends QueryRes<TodoRow> {
  has_more: boolean
  next_cursor: number | null
}

export interface HomeTodoRes extends QueryRes<TodoRow> {
  hasMore: boolean
}

export interface TodoReminderCandidatesRes extends QueryRes<Pick<TodoRow, 'id' | 'title' | 'due_at' | 'done'>> {
  hasMore: boolean
}

function errText(e: unknown): string {
  if (!e) return '操作失败，请稍后重试'
  const a = e as { message?: unknown; msg?: unknown }
  const m = typeof a.message === 'string' ? a.message : typeof a.msg === 'string' ? a.msg : ''
  return m || '操作失败，请稍后重试'
}

function readError(e: unknown): string | null {
  if (!e) return null
  if (typeof e === 'string') return e
  const msg = (e as { message?: string }).message
  return msg || null
}

export async function fetchTodos(): Promise<QueryRes<TodoRow>> {
  const page = await fetchTodosPage(null, 200)
  return { rows: page.rows, error: page.error }
}

/** 首页只需要待处理事项；服务端先筛掉已完成项，再按截止时间取稳定窗口。 */
export async function fetchOpenTodosForHome(limit = 200): Promise<HomeTodoRes> {
  const size = Math.max(1, Math.min(200, Math.floor(limit) || 200))
  const empty: HomeTodoRes = { rows: [], error: null, hasMore: false }
  try {
    const result = await (cbRdb().from('todos') as Any)
      .select('*')
      .eq('done', false)
      .order('due_at', { ascending: true })
      .order('id', { ascending: false })
      .limit(size + 1)
    const error = readError(result?.error)
    if (error) return { ...empty, error }
    const raw = Array.isArray(result?.data) ? result.data as Any[] : []
    return {
      rows: raw.slice(0, size).map((row) => ({
        ...row,
        load: normLoad(row?.load ?? DEFAULT_LOAD),
      })) as TodoRow[],
      error: null,
      hasMore: raw.length > size,
    }
  } catch (error) {
    return { ...empty, error: errText(error) }
  }
}

/**
 * 提醒缓存不能只从待办页首屏（按 ID 取最新 200 条）生成，否则较早创建但即将到期的事项会漏排。
 * 直接从服务端筛选未来 7 天及最近 1 天内的未完成事项，按到期时间取最紧急的 40 条并多取一条探测容量。
 */
export async function fetchTodoReminderCandidates(): Promise<TodoReminderCandidatesRes> {
  const empty: TodoReminderCandidatesRes = { rows: [], error: null, hasMore: false }
  const now = Date.now()
  const lowerBound = new Date(now - 86400_000).toISOString()
  const upperBound = new Date(now + 7 * 86400_000).toISOString()
  try {
    const result = await (cbRdb().from('todos') as Any)
      .select('id,title,due_at,done')
      .eq('done', false)
      .gte('due_at', lowerBound)
      .lte('due_at', upperBound)
      .order('due_at', { ascending: true })
      .order('id', { ascending: false })
      .limit(41)
    const error = readError(result?.error)
    if (error) return { ...empty, error }
    const raw = Array.isArray(result?.data) ? result.data as Any[] : []
    return {
      rows: raw.slice(0, 40).map((row) => ({
        id: Number(row?.id),
        title: String(row?.title || ''),
        due_at: typeof row?.due_at === 'string' ? row.due_at : null,
        done: row?.done === true,
      })) as Array<Pick<TodoRow, 'id' | 'title' | 'due_at' | 'done'>>,
      error: null,
      hasMore: raw.length > 40,
    }
  } catch (error) {
    return { ...empty, error: errText(error) }
  }
}

/** 按自增 id 倒序读取待办；游标分页避免 limit 截断后无法访问较早记录。 */
export async function fetchTodosPage(beforeId: number | null = null, pageSize = 100): Promise<TodoPageRes> {
  const empty: TodoPageRes = { rows: [], error: null, has_more: false, next_cursor: null }
  const size = Math.max(1, Math.min(200, Math.floor(pageSize) || 100))
  if (beforeId != null && (!Number.isSafeInteger(beforeId) || beforeId <= 0)) {
    return { ...empty, error: '待办位置无效，请刷新后重试' }
  }
  try {
    let query: Any = (cbRdb().from('todos') as Any).select('*')
    if (beforeId != null) query = query.lt('id', beforeId)
    query = query.order('id', { ascending: false }).limit(size + 1)
    const result = await query
    const error = readError(result?.error)
    if (error) return { ...empty, error }
    const raw = Array.isArray(result?.data) ? result.data as Any[] : []
    const hasMore = raw.length > size
    const rows = raw.slice(0, size).map((row) => ({
      ...row,
      // load 列可能还没上线（SQL 未执行 / 老包），兜成默认档而不是让 UI 出现 NaN
      load: normLoad(row?.load ?? DEFAULT_LOAD),
    })) as TodoRow[]
    return {
      rows,
      error: null,
      has_more: hasMore,
      next_cursor: hasMore && rows.length ? rows[rows.length - 1].id : null,
    }
  } catch (error) {
    return { ...empty, error: errText(error) }
  }
}

export function createTodo(d: TodoDraft, options: { notify?: boolean } = {}): Promise<MutateRes> {
  return mutateAndNotify('insert', {
    title: d.title,
    note: d.note,
    due_at: d.due_at ? new Date(d.due_at).toISOString() : null,
    load: normLoad(d.load ?? DEFAULT_LOAD),
  }, undefined, options.notify !== false)
}

/** 新建并返回真实待办 ID；用于需要把其他记录关联到新待办的跨表流程。 */
export async function createTodoWithId(
  d: TodoDraft,
  options: { notify?: boolean } = {},
  expectedSession = captureQbankSession(),
): Promise<MutateRes & { id: number | null; inserted: boolean }> {
  const session = expectedSession
  const empty = { id: null, inserted: false }
  if (!session.uid) return { error: '请先登录后再操作', ...empty }
  if (!isQbankSessionCurrent(session)) return { error: '账号已切换，请回到原账号重试', ...empty }
  const body = {
    title: d.title,
    note: d.note,
    due_at: d.due_at ? new Date(d.due_at).toISOString() : null,
    load: normLoad(d.load ?? DEFAULT_LOAD),
  }
  try {
    const result = await (cbRdb().from('todos') as Any).insert(body).select('id')
    const error = result?.error ? readError(result.error) : null
    if (error) return { error, ...empty }
    const raw = Array.isArray(result?.data) ? result.data[0]?.id : null
    const id = Number(raw)
    const validId = Number.isSafeInteger(id) && id > 0 ? id : null
    if (options.notify !== false && session.uid && isQbankSessionCurrent(session)) notifyTodoDataChanged()
    if (!isQbankSessionCurrent(session)) {
      return { error: '账号已切换；待办可能已保存，请回到原账号核对。', id: validId, inserted: true }
    }
    if (validId == null) {
      return { error: '待办可能已保存，但服务未返回编号；请刷新待办核对后再操作。', id: null, inserted: true }
    }
    return { error: null, id: validId, inserted: true }
  } catch (error) {
    return { error: `待办写入结果暂时无法确认：${errText(error)}`, ...empty, inserted: true }
  }
}

/** 删除指定待办并要求服务确认返回目标 ID；用于跨表补偿，避免把零行删除当成成功。 */
export async function deleteTodoConfirmed(
  id: number,
  expectedSession = captureQbankSession(),
): Promise<MutateRes> {
  const session = expectedSession
  if (!session.uid) return { error: '请先登录后再操作' }
  if (!Number.isSafeInteger(id) || id <= 0) return { error: '待办编号无效，请刷新后重试' }
  if (!isQbankSessionCurrent(session)) return { error: '账号已切换，请回到原账号重试' }
  let before: Any
  try {
    before = await (cbRdb().from('todos') as Any).select('id').eq('id', id)
  } catch (reason) {
    return { error: `无法确认待办记录归属：${errText(reason)}` }
  }
  if (!isQbankSessionCurrent(session)) return { error: '账号已切换；尚未开始删除，请回原账号核对。' }
  const beforeError = before?.error ? readError(before.error) : null
  if (beforeError) return { error: `无法确认待办记录归属：${beforeError}` }
  const existedBefore = Array.isArray(before?.data)
    && before.data.some((row: Any) => Number(row?.id) === id)
  if (!existedBefore) return { error: '目标待办记录不存在或当前账号无权删除' }

  let result: Any = null
  let error: string | null = null
  try {
    result = await (cbRdb().from('todos') as Any).delete().eq('id', id).select('id')
    error = result?.error ? readError(result.error) : null
  } catch (reason) {
    error = errText(reason)
  }
  if (!isQbankSessionCurrent(session)) return { error: '账号已切换；待办删除可能已完成，请回原账号核对。' }
  const rows = Array.isArray(result?.data) ? result.data : []
  let deleted = rows.some((row: Any) => Number(row?.id) === id)
  if (!deleted) {
    // The DELETE may have committed even if the response or projection failed.
    // Verify existence before deciding whether compensation should restore a row.
    try {
      if (!isQbankSessionCurrent(session)) return { error: '账号已切换；待办删除结果无法确认，请回原账号核对。' }
      const check = await (cbRdb().from('todos') as Any).select('id').eq('id', id)
      if (!isQbankSessionCurrent(session)) return { error: '账号已切换；待办删除结果无法确认，请回原账号核对。' }
      const checkError = check?.error ? readError(check.error) : null
      if (checkError) return { error: `待办删除结果无法确认：${error || checkError}` }
      const remaining = Array.isArray(check?.data) ? check.data : []
      deleted = !remaining.some((row: Any) => Number(row?.id) === id)
    } catch (reason) {
      return { error: `待办删除结果无法确认：${error || errText(reason)}` }
    }
  }
  if (!deleted) return { error: error || '服务未确认删除目标待办' }
  if (!isQbankSessionCurrent(session)) return { error: '账号已切换；待办删除可能已完成，请回原账号核对。' }
  notifyTodoDataChanged()
  return { error: null }
}

export function updateTodo(
  id: number,
  patch: Partial<Pick<TodoRow, 'title' | 'note' | 'due_at' | 'done' | 'load'>> & { due_at?: string | null },
  expectedSession = captureQbankSession(),
): Promise<MutateRes> {
  const body: Record<string, unknown> = {}
  if (patch.title !== undefined) body.title = patch.title
  if (patch.note !== undefined) body.note = patch.note
  if (patch.load !== undefined) body.load = normLoad(patch.load)
  if (patch.due_at !== undefined) body.due_at = patch.due_at ? new Date(patch.due_at).toISOString() : null
  if (patch.done !== undefined) {
    body.done = patch.done
    body.done_at = patch.done ? new Date().toISOString() : null
    body.updated_at = new Date().toISOString()
  }
  return updateTodoConfirmed(id, body, expectedSession)
}

async function updateTodoConfirmed(
  id: number,
  body: Record<string, unknown>,
  session: ReturnType<typeof captureQbankSession>,
): Promise<MutateRes> {
  if (!session.uid) return { error: '请先登录后再操作' }
  if (!Number.isSafeInteger(id) || id <= 0) return { error: '待办编号无效，请刷新后重试' }
  if (!Object.keys(body).length) return { error: '没有可保存的修改' }
  if (!isQbankSessionCurrent(session)) return { error: '账号已切换，请回到原账号重试' }

  let result: Any = null
  let writeError: string | null = null
  try {
    result = await (cbRdb().from('todos') as Any).update(body).eq('id', id).select('id')
    writeError = result?.error ? readError(result.error) : null
  } catch (reason) {
    writeError = errText(reason)
  }
  if (!isQbankSessionCurrent(session)) return { error: '账号已切换；待办更新可能已完成，请回原账号核对。' }

  const returned = Array.isArray(result?.data) ? result.data : []
  const confirmed = returned.some((row: Any) => Number(row?.id) === id)
  if (!confirmed) {
    try {
      if (!isQbankSessionCurrent(session)) return { error: '账号已切换；待办更新结果无法确认，请回原账号核对。' }
      const check = await (cbRdb().from('todos') as Any)
        .select('id,title,note,due_at,done,done_at,load,updated_at')
        .eq('id', id)
      if (!isQbankSessionCurrent(session)) return { error: '账号已切换；待办更新结果无法确认，请回原账号核对。' }
      const checkError = check?.error ? readError(check.error) : null
      if (checkError) return { error: `待办更新结果无法确认：${writeError || checkError}` }
      const row = Array.isArray(check?.data)
        ? check.data.find((item: Any) => Number(item?.id) === id)
        : null
      if (!row) return { error: writeError || '目标待办不存在或当前账号无权修改' }
      const matches = Object.entries(body).every(([key, value]) => {
        if (key === 'due_at' || key === 'done_at' || key === 'updated_at') {
          const actual = row[key] == null ? null : Date.parse(String(row[key]))
          const expected = value == null ? null : Date.parse(String(value))
          return actual === expected
        }
        if (key === 'load') return normLoad(row[key] ?? DEFAULT_LOAD) === value
        return row[key] === value
      })
      if (!matches) return { error: writeError || '服务未确认待办已更新，请刷新后重试' }
    } catch (reason) {
      return { error: `待办更新结果无法确认：${writeError || errText(reason)}` }
    }
  }

  if (!isQbankSessionCurrent(session)) return { error: '账号已切换；待办更新可能已完成，请回原账号核对。' }
  notifyTodoDataChanged()
  return { error: null }
}

export function deleteTodo(id: number): Promise<MutateRes> {
  return mutateAndNotify('delete', undefined, id)
}

async function mutateAndNotify(kind: 'insert' | 'update' | 'delete', body?: Record<string, unknown>, id?: number, notify = true): Promise<MutateRes> {
  const session = captureQbankSession()
  const result = await mutateRows('todos', kind, body, id)
  if (notify && !result.error && session.uid && isQbankSessionCurrent(session)) notifyTodoDataChanged()
  return result
}

/**
 * 到期提醒扫描：
 * 服务端把临期（2 小时内）/ 逾期 7 天内的待办写入通知中心（每日去重），
 * 并返回今日 / 逾期统计与临期清单，供首页卡片与弹窗一次渲染。
 * 未登录 / 匿名直接返回 null，不弹错。
 */
export async function todoRemindScan(): Promise<{ data: TodoScanRes | null; error: string | null }> {
  try {
    const res: Any = await (cbRdb() as Any).rpc('todo_remind_scan', { p_ahead_minutes: 120 })
    const err = readError(res?.error)
    if (err) return { data: null, error: err }
    let raw: unknown = res?.data
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw)
      } catch {
        return { data: null, error: '服务端返回格式异常' }
      }
    }
    if (!raw || typeof raw !== 'object') return { data: null, error: null }
    const d = raw as Any
    return {
      data: {
        due: Array.isArray(d.due)
          ? d.due.map((x: Any) => ({
              id: Number(x?.id) || 0,
              title: String(x?.title || ''),
              due_at: String(x?.due_at || ''),
            }))
          : [],
        created: Number(d.created) || 0,
        today: Number(d.today) || 0,
        overdue: Number(d.overdue) || 0,
      },
      error: null,
    }
  } catch (e) {
    return { data: null, error: errText(e) }
  }
}
