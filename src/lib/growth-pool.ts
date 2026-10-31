/**
 * 成长池：把「突然想做的事」先停在这里，等负荷有富余再转成真待办。
 *
 * 量力的原话是——想法不丢、也不烂在收藏夹里。所以这里只做三件事：
 *   记下来（parked） → 有空了转待办（converted，记下 todo_id） → 想清楚了删掉（dropped）
 * 表 growth_ideas 走 RLS（仅本人），落库列与 docs/release/energy-plan.sql 一致。
 */
import { cbRdb } from './cb'
import { queryRows, type QueryRes, type MutateRes } from './market'
import { captureQbankSession, isQbankSessionCurrent } from './qbank'
import { normLoad, DEFAULT_LOAD, type LoadValue } from './todo-energy'
import { createTodoWithId, deleteTodoConfirmed } from './todo'

export type IdeaStatus = 'parked' | 'converted' | 'dropped'

export interface GrowthIdea {
  id: number
  uid: string
  title: string
  note: string
  kind: string
  status: IdeaStatus
  load: LoadValue
  todo_id: number | null
  created_at: string
  updated_at: string
}

export interface IdeaDraft {
  title: string
  note?: string
  load?: unknown
  kind?: string
}

const TABLE = 'growth_ideas'

function norm(row: any): GrowthIdea {
  return {
    id: Number(row?.id || 0),
    uid: String(row?.uid || ''),
    title: String(row?.title || ''),
    note: String(row?.note || ''),
    kind: String(row?.kind || 'idea'),
    status: (row?.status === 'converted' || row?.status === 'dropped' ? row.status : 'parked') as IdeaStatus,
    load: normLoad(row?.load),
    todo_id: row?.todo_id == null ? null : Number(row.todo_id) || null,
    created_at: String(row?.created_at || ''),
    updated_at: String(row?.updated_at || ''),
  }
}

export async function fetchGrowthIdeas(): Promise<QueryRes<GrowthIdea>> {
  const res = await queryRows<any>(TABLE, undefined, 100)
  return { rows: res.rows.map(norm), error: res.error }
}

type QbankSession = ReturnType<typeof captureQbankSession>

export async function createGrowthIdea(
  d: IdeaDraft,
  expectedSession: QbankSession = captureQbankSession(),
): Promise<MutateRes & { id?: number; inserted?: boolean }> {
  const title = String(d.title || '').trim()
  if (!title) return { error: '先写一下想做的事' }
  const session = expectedSession
  if (!session.uid) return { error: '请先登录后再保存成长池想法' }
  if (!isQbankSessionCurrent(session)) return { error: '账号已切换，请重新保存成长池想法' }
  const body = {
    uid: session.uid,
    title,
    note: String(d.note || '').trim(),
    kind: String(d.kind || 'idea'),
    status: 'parked',
    load: normLoad(d.load ?? DEFAULT_LOAD),
    todo_id: null,
  }
  try {
    const result = await (cbRdb().from(TABLE) as any).insert(body).select('id')
    const error = result?.error ? String((result.error as any)?.message || result.error) : null
    if (error) return { error, inserted: false }
    const rawId = Array.isArray(result?.data) ? result.data[0]?.id : null
    const id = Number(rawId)
    const validId = Number.isSafeInteger(id) && id > 0 ? id : undefined
    if (!isQbankSessionCurrent(session)) return { error: '账号已切换；想法可能已保存，请回到原账号核对。', id: validId, inserted: true }
    if (validId == null) return { error: '想法可能已保存，但服务未返回编号；请刷新成长池核对。', inserted: true }
    return { error: null, id: validId, inserted: true }
  } catch {
    return { error: '成长池写入结果暂时无法确认；请刷新后核对，避免重复保存。', inserted: true }
  }
}

export async function updateGrowthIdea(
  id: number,
  patch: Partial<Pick<GrowthIdea, 'title' | 'note' | 'load' | 'status' | 'todo_id' | 'kind'>>,
  expectedSession: QbankSession = captureQbankSession(),
): Promise<MutateRes> {
  const session = expectedSession
  if (!session.uid) return { error: '请先登录后再操作' }
  if (!isQbankSessionCurrent(session)) return { error: '账号已切换，请返回原账号重试' }
  if (!Number.isSafeInteger(id) || id <= 0) return { error: '成长池记录编号无效，请刷新后重试' }
  const body: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.title !== undefined) body.title = String(patch.title).trim()
  if (patch.note !== undefined) body.note = String(patch.note).trim()
  if (patch.load !== undefined) body.load = normLoad(patch.load)
  if (patch.status !== undefined) body.status = patch.status
  if (patch.todo_id !== undefined) body.todo_id = patch.todo_id
  if (patch.kind !== undefined) body.kind = patch.kind
  const matchesPatch = (row: any) =>
    (patch.title === undefined || String(row?.title ?? '') === body.title)
    && (patch.note === undefined || String(row?.note ?? '') === body.note)
    && (patch.load === undefined || normLoad(row?.load) === body.load)
    && (patch.status === undefined || row?.status === body.status)
    && (patch.todo_id === undefined || (row?.todo_id == null ? null : Number(row.todo_id)) === body.todo_id)
    && (patch.kind === undefined || String(row?.kind ?? '') === body.kind)

  async function confirmByReadback(fallbackError: string | null): Promise<MutateRes> {
    if (!isQbankSessionCurrent(session)) return { error: '账号已切换；成长池状态可能已更新，请回原账号核对。' }
    try {
      const check = await (cbRdb().from(TABLE) as any)
        .select('id,title,note,load,kind,status,todo_id')
        .eq('id', id)
      const checkError = check?.error ? String((check.error as any)?.message || check.error) : null
      if (!isQbankSessionCurrent(session)) return { error: '账号已切换；成长池状态可能已更新，请回原账号核对。' }
      if (checkError) return { error: `成长池更新结果无法确认：${fallbackError || checkError}` }
      const row = Array.isArray(check?.data) ? check.data.find((item: any) => Number(item?.id) === id) : null
      if (!row) return { error: fallbackError || '目标成长池记录不存在或当前账号无权修改' }
      if (matchesPatch(row)) return { error: null }
      return { error: fallbackError || '服务未确认成长池状态更新，请刷新两处核对后再操作' }
    } catch (reason) {
      if (!isQbankSessionCurrent(session)) return { error: '账号已切换；成长池状态可能已更新，请回原账号核对。' }
      const message = reason instanceof Error ? reason.message : '查询失败'
      return { error: `成长池更新结果无法确认：${fallbackError || message}` }
    }
  }

  try {
    const result = await (cbRdb().from(TABLE) as any).update(body).eq('id', id).select('id')
    const error = result?.error ? String((result.error as any)?.message || result.error) : null
    const updated = Array.isArray(result?.data) && result.data.some((row: any) => Number(row?.id) === id)
    if (!isQbankSessionCurrent(session)) return { error: '账号已切换；成长池状态可能已更新，请回原账号核对。' }
    if (updated) return { error: null }

    // Some SDK / gateway paths can omit RETURNING data even after a committed
    // update. Read back the requested fields before reporting success; a zero-row
    // RLS update must never be mistaken for a linked idea.
    return confirmByReadback(error)
  } catch (reason) {
    if (!isQbankSessionCurrent(session)) return { error: '账号已切换；成长池状态可能已更新，请回原账号核对。' }
    const message = reason instanceof Error ? reason.message : '操作失败'
    return confirmByReadback(message)
  }
}

export async function deleteGrowthIdea(
  id: number,
  expectedSession: QbankSession = captureQbankSession(),
): Promise<MutateRes> {
  const session = expectedSession
  if (!session.uid) return { error: '请先登录后再操作' }
  if (!Number.isSafeInteger(id) || id <= 0) return { error: '成长池记录编号无效，请刷新后重试' }
  if (!isQbankSessionCurrent(session)) return { error: '账号已切换，请返回原账号重试' }
  let before: any
  try {
    before = await (cbRdb().from(TABLE) as any).select('id').eq('id', id)
  } catch (reason) {
    return { error: `无法确认成长池记录归属：${reason instanceof Error ? reason.message : '读取失败'}` }
  }
  if (!isQbankSessionCurrent(session)) return { error: '账号已切换；尚未开始删除，请回原账号核对。' }
  const beforeError = before?.error ? String((before.error as any)?.message || before.error) : null
  if (beforeError) return { error: `无法确认成长池记录归属：${beforeError}` }
  const existedBefore = Array.isArray(before?.data)
    && before.data.some((row: any) => Number(row?.id) === id)
  if (!existedBefore) return { error: '目标成长池记录不存在或当前账号无权删除' }

  let result: any = null
  let error: string | null = null
  try {
    result = await (cbRdb().from(TABLE) as any).delete().eq('id', id).select('id')
    error = result?.error ? String((result.error as any)?.message || result.error) : null
  } catch (reason) {
    error = reason instanceof Error ? reason.message : '操作失败，请稍后重试'
  }
  if (!isQbankSessionCurrent(session)) return { error: '账号已切换；成长池删除可能已完成，请回原账号核对。' }
  const rows = Array.isArray(result?.data) ? result.data : []
  let deleted = rows.some((row: any) => Number(row?.id) === id)
  if (!deleted) {
    try {
      if (!isQbankSessionCurrent(session)) return { error: '账号已切换；成长池删除结果无法确认，请回原账号核对。' }
      const check = await (cbRdb().from(TABLE) as any).select('id').eq('id', id)
      if (!isQbankSessionCurrent(session)) return { error: '账号已切换；成长池删除结果无法确认，请回原账号核对。' }
      const checkError = check?.error ? String((check.error as any)?.message || check.error) : null
      if (checkError) return { error: `成长池删除结果无法确认：${error || checkError}` }
      const remaining = Array.isArray(check?.data) ? check.data : []
      deleted = !remaining.some((row: any) => Number(row?.id) === id)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '查询失败'
      return { error: `成长池删除结果无法确认：${error || message}` }
    }
  }
  if (!deleted) return { error: error || '服务未确认删除目标成长池记录' }
  return { error: null }
}

/**
 * 一键转待办：用 INSERT 返回的真实 todo_id 关联成长池记录。
 * 若关联失败，尝试删除刚创建的那一条待办；跨表操作仍非数据库事务。
 */
export async function convertIdeaToTodo(
  idea: GrowthIdea,
  due = '',
): Promise<{ error: string | null; todoId: number | null; partial?: boolean }> {
  const session = captureQbankSession()
  if (!session.uid) return { error: '请先登录后再转换待办', todoId: null }
  // 想法上估过的负荷跟着一起落到待办，进负荷条才算数
  const res = await createTodoWithId({
    title: idea.title,
    note: idea.note || '',
    due_at: due,
    load: idea.load,
  }, {}, session)
  if (res.error) return { error: res.error, todoId: res.id, partial: res.inserted }
  if (!isQbankSessionCurrent(session)) return { error: '账号已切换；待办可能已保存到原账号，请回到原账号核对后再操作。', todoId: null }
  const todoId = res.id
  if (todoId == null) return { error: '待办编号缺失，未能关联成长池；请刷新两处核对后再操作。', todoId: null, partial: true }
  const linked = await updateGrowthIdea(idea.id, { status: 'converted', todo_id: todoId, load: idea.load }, session)
  if (!isQbankSessionCurrent(session)) return { error: '账号已切换；待办与成长池关联状态请回原账号核对。', todoId, partial: true }
  if (!linked.error) return { error: null, todoId }

  // The insert succeeded but the idea link did not. Compensate by deleting only
  // the exact row returned by INSERT ... RETURNING; never guess by title.
  const rollback = await deleteTodoConfirmed(todoId, session)
  if (!isQbankSessionCurrent(session)) return { error: '账号已切换；请回原账号核对待办与成长池。', todoId, partial: true }
  if (!rollback.error) {
    return { error: '成长池状态未能更新，已撤销刚创建的待办；想法仍保留，可稍后重试。', todoId: null }
  }
  return { error: '待办已创建，但成长池状态未同步且自动撤销未成功；请刷新两处核对，暂勿重复转换。', todoId, partial: true }
}
