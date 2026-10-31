/**
 * 集市数据层：二手物品 / 任务 的 PG 读写 + pgstore 图片上传
 *
 * - 公开列表：读视图 v_secondhand_public / v_tasks_public（匿名可读，不含联系方式）
 * - 联系方式 / 我的管理：读主表 secondhand_items / tasks（登录用户，行级安全校验本人）
 * - 图片：上传至 pgstore 桶 images，返回公开 URL 数组入库存
 */
import { cbAuth, cbRdb, cbStorage } from './cb'
import { uploadErrorText, uploadGuardError } from './upload-error'
import { compressImage } from './image-compress'

/**
 * 与 images 桶的单文件上限一致（2MB）。
 * 手机相册原图 3–8MB 是常态，不压就传必然被拒，
 * 表现是「进度条一闪、图始终出不来」。
 */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024

/* ---------------- 类型 ---------------- */

export type ItemStatus = 'on' | 'sold' | 'off'
export type TaskStatus = 'open' | 'doing' | 'done' | 'cancelled'

export interface Item {
  id: number
  title: string
  description: string
  category: string
  condition: string
  price: number
  images: string[]
  building: string
  creator_name: string
  status: ItemStatus
  created_at: string
  contact?: string
  creator_uid?: string
  /** 图片审核状态：none 无图 / pending 待审 / ok 放行 / bad 违规（视图已按此门控公开列表） */
  img_state?: string
}


export type ItemImgState = 'none' | 'pending' | 'ok' | 'bad'

export interface Task {
  id: number
  title: string
  description: string
  kind: string
  reward: string
  location: string
  deadline: string
  creator_name: string
  status: TaskStatus
  created_at: string
  contact?: string
  creator_uid?: string
  /** Old text-only rows may omit this field until the task-images migration is applied. */
  images?: string[]
}

/** SDK 泛型链式查询较复杂，内部统一用 Any 收窄；公开 API 保持强类型 */
type Any = Record<string, any>

export interface QueryRes<T> {
  rows: T[]
  error: string | null
  hasMore?: boolean
}

export interface MutateRes {
  error: string | null
}

/* ---------------- 内部工具 ---------------- */

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

function sortTimeDesc<T extends { created_at?: string }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))
    || Number((b as T & { id?: number }).id || 0) - Number((a as T & { id?: number }).id || 0))
}

type QueryRowsOptions = { newestFirst?: boolean }

export async function queryRows<T extends { created_at?: string }>(
  name: string,
  filters?: Record<string, string | number>,
  limitN?: number,
  options: QueryRowsOptions = {},
): Promise<QueryRes<T>> {
  try {
    let q: Any = (cbRdb().from(name) as Any).select('*')
    if (filters) {
      for (const k of Object.keys(filters)) q = q.eq(k, filters[k])
    }
    // Public market feeds must apply ordering before limit, otherwise a newer
    // row outside the database's unspecified first window can be dropped.
    if (options.newestFirst) q = q.order('created_at', { ascending: false }).order('id', { ascending: false })
    if (limitN) q = q.limit(limitN)
    const res = await q
    const err = readError(res?.error)
    if (err) return { rows: [], error: err }
    const data = Array.isArray(res?.data) ? (res.data as T[]) : []
    return { rows: sortTimeDesc(data), error: null }
  } catch (e) {
    return { rows: [], error: errText(e) }
  }
}

export async function mutateRows(name: string, kind: 'insert' | 'update' | 'delete', body?: Record<string, unknown>, id?: number): Promise<MutateRes> {
  try {
    const q: Any = cbRdb().from(name) as Any
    let res: { data?: unknown; error?: { message?: string } | string }
    if (kind === 'insert' && body) {
      res = await q.insert(body)
      return { error: readError(res?.error) }
    }
    if (kind === 'update' && body && id != null) {
      res = await q.update(body).eq('id', id)
      return { error: readError(res?.error) }
    }
    if (kind === 'delete' && id != null) {
      res = await q.delete().eq('id', id)
      return { error: readError(res?.error) }
    }
    return { error: '参数错误' }
  } catch (e) {
    return { error: errText(e) }
  }
}

/* ---------------- 二手 ---------------- */

export const ITEM_LIMIT = 50
export const ITEM_PAGE_SIZE = 30

export async function fetchItems(category?: string): Promise<QueryRes<Item>> {
  const res = await queryRows<Item>(
    'v_secondhand_public',
    category && category !== 'all' ? { category } : undefined,
    ITEM_LIMIT,
    { newestFirst: true },
  )
  return res
}

/** 二手公开列表按发布时间与 ID 组成稳定游标。 */
export async function fetchItemsPage(
  category?: string,
  before: CreatedAtCursor | null = null,
  pageSize = ITEM_PAGE_SIZE,
): Promise<QueryRes<Item>> {
  const size = Math.max(1, Math.min(50, Math.floor(pageSize)))
  if (before && (!Number.isSafeInteger(before.id) || before.id <= 0
    || !/^[0-9TtZz:.+\- ]+$/.test(before.created_at)
    || !Number.isFinite(Date.parse(before.created_at)))) {
    return { rows: [], hasMore: false, error: '闲置分页位置无效，请刷新列表' }
  }
  try {
    let q: Any = (cbRdb().from('v_secondhand_public') as Any).select('*')
    if (category && category !== 'all') q = q.eq('category', category)
    if (before) {
      const stamp = before.created_at
      q = q.or(`created_at.lt.${stamp},and(created_at.eq.${stamp},id.lt.${before.id})`)
    }
    q = q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(size + 1)
    const res = await q
    const err = readError(res?.error)
    if (err) return { rows: [], hasMore: false, error: err }
    const data = Array.isArray(res?.data) ? sortTimeDesc(res.data as Item[]) : []
    return { rows: data.slice(0, size), hasMore: data.length > size, error: null }
  } catch (e) {
    return { rows: [], hasMore: false, error: errText(e) }
  }
}

/** 本人发布（主表含联系方式），uid 取 auth user 的 id */
export async function fetchMyItems(uid: string): Promise<QueryRes<Item>> {
  return queryRows<Item>('secondhand_items', { creator_uid: uid })
}

export interface ItemDraft {
  title: string
  description: string
  category: string
  condition: string
  price: number
  images: string[]
  building: string
  contact: string
  creator_name: string
}

export async function createItem(draft: ItemDraft): Promise<MutateRes> {
  const res = await mutateRows('secondhand_items', 'insert', { ...draft, status: 'on' } as unknown as Record<string, unknown>)
  if (!res.error) {
    const { pingBehavior } = await import('./activity-ping')
    pingBehavior.secondhandPublish()
  }
  return res
}

export async function setItemStatus(id: number, status: ItemStatus): Promise<MutateRes> {
  return mutateRows('secondhand_items', 'update', { status }, id)
}

/** 管理员审核二手图片状态（放行 ok / 标记 bad）；普通用户受触发器约束不能自我放行 */
export async function setItemImgState(id: number, state: ItemImgState): Promise<MutateRes> {
  return mutateRows('secondhand_items', 'update', { img_state: state }, id)
}

export async function deleteItem(id: number): Promise<MutateRes> {
  return mutateRows('secondhand_items', 'delete', undefined, id)
}

/* ---------------- 任务 ---------------- */

export const TASK_LIMIT = 50
export const TASK_PAGE_SIZE = 30

export interface CreatedAtCursor {
  created_at: string
  id: number
}

/** 任务类型：大厅筛选用「全部」+ 以下四项，发布表单只用以下四项 */
export const TASK_KINDS = ['代取快递', '结伴出行', '生活互助', '其他'] as const

export async function fetchTasks(kind?: string): Promise<QueryRes<Task>> {
  const res = await queryRows<Task>(
    'v_tasks_public',
    kind && kind !== 'all' ? { kind } : undefined,
    TASK_LIMIT,
    { newestFirst: true },
  )
  return res
}

/** 公开任务大厅使用发布时间 + ID 游标，避免相同发布时间时重复或漏项。 */
export async function fetchTasksPage(
  kind?: string,
  before: CreatedAtCursor | null = null,
  pageSize = TASK_PAGE_SIZE,
): Promise<QueryRes<Task>> {
  const size = Math.max(1, Math.min(50, Math.floor(pageSize)))
  if (before) {
    // Keep the interpolated PostgREST expression restricted to timestamp characters.
    if (!Number.isSafeInteger(before.id) || before.id <= 0
      || !/^[0-9TtZz:.+\- ]+$/.test(before.created_at)
      || !Number.isFinite(Date.parse(before.created_at))) {
      return { rows: [], hasMore: false, error: '任务分页位置无效，请刷新列表' }
    }
  }
  try {
    let q: Any = (cbRdb().from('v_tasks_public') as Any).select('*')
    if (kind && kind !== 'all') q = q.eq('kind', kind)
    if (before) {
      const stamp = before.created_at
      q = q.or(`created_at.lt.${stamp},and(created_at.eq.${stamp},id.lt.${before.id})`)
    }
    q = q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(size + 1)
    const res = await q
    const err = readError(res?.error)
    if (err) return { rows: [], hasMore: false, error: err }
    const data = Array.isArray(res?.data) ? sortTimeDesc(res.data as Task[]) : []
    return { rows: data.slice(0, size), hasMore: data.length > size, error: null }
  } catch (e) {
    return { rows: [], hasMore: false, error: errText(e) }
  }
}

export async function fetchMyTasks(uid: string): Promise<QueryRes<Task>> {
  return queryRows<Task>('tasks', { creator_uid: uid })
}

export interface TaskDraft {
  title: string
  description: string
  kind: string
  reward: string
  location: string
  deadline: string
  contact: string
  creator_name: string
  images?: string[]
  /** Explicit owner prevents a late submit being attached to a different signed-in account. */
  creator_uid?: string
}

export async function createTask(draft: TaskDraft): Promise<MutateRes> {
  const res = await mutateRows('tasks', 'insert', { ...draft, images: draft.images || [], status: 'open' } as unknown as Record<string, unknown>)
  if (!res.error) {
    const { pingBehavior } = await import('./activity-ping')
    pingBehavior.taskPublish()
  }
  return res
}

export async function setTaskStatus(id: number, status: TaskStatus): Promise<MutateRes> {
  return mutateRows('tasks', 'update', { status }, id)
}

export async function deleteTask(id: number): Promise<MutateRes> {
  return mutateRows('tasks', 'delete', undefined, id)
}

/** 管理端：主表全量（含已下架；普通登录用户也可读，但无内容管理入口） */
export async function fetchAllItems(): Promise<QueryRes<Item>> {
  return queryRows<Item>('secondhand_items', undefined, 300)
}

export async function fetchAllTasks(): Promise<QueryRes<Task>> {
  return queryRows<Task>('tasks', undefined, 300)
}

/** 按 id 集合查询（管理端关联举报目标） */
export async function fetchRowsByIds<T extends { id: number }>(name: string, ids: number[]): Promise<QueryRes<T>> {
  if (!ids.length) return { rows: [], error: null }
  try {
    const q: Any = (cbRdb().from(name) as Any).select('*').in('id', ids)
    const res = await q
    const err = readError(res?.error)
    if (err) return { rows: [], error: err }
    const data = Array.isArray(res?.data) ? (res.data as T[]) : []
    return { rows: data, error: null }
  } catch (e) {
    return { rows: [], error: errText(e) }
  }
}

/* ---------------- 图片上传 ---------------- */

const ALLOWED_IMG = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp'])

export async function uploadImages(files: File[], dir: string): Promise<{ urls: string[]; error: string | null }> {
  const urls: string[] = []
  // 游客 / 未登录在服务端必被拒（Storage RLS 要求 authenticated），先本地拦一道
  const guard = uploadGuardError(() => (cbAuth() as { currentUser?: unknown })?.currentUser)
  if (guard) {
    console.warn('[上传被守卫拦截]', dir, guard)
    return { urls, error: guard }
  }
  try {
    const bucket = cbStorage().from('images')
    for (const file of files) {
      const raw = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const ext = ALLOWED_IMG.has(raw) ? raw : 'jpg'
      const path = `${dir}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`
      /* 先本地降采样重编码再传，压完仍超标才报错（GIF 不压以保住动画） */
      let out = file
      if (out.size > MAX_UPLOAD_BYTES) {
        out = (await compressImage(out, MAX_UPLOAD_BYTES)).file
        if (out.size > MAX_UPLOAD_BYTES) return { urls, error: '图片太大了，换一张小一点的试试' }
      }
      const res = await bucket.upload(path, out)
      if (res.error) {
        console.warn('[上传失败]', path, res.error)
        return { urls, error: uploadErrorText(res.error, '图片上传失败') }
      }
      const pub = bucket.getPublicUrl(path)
      urls.push(pub?.data?.publicUrl || path)
    }
    return { urls, error: null }
  } catch (e) {
    console.warn('[上传异常]', e)
    return { urls, error: uploadErrorText(e, '图片上传失败') }
  }
}

/* ---------------- 展示工具 ---------------- */

export const ITEM_STATUS_TEXT: Record<ItemStatus, string> = { on: '在售', sold: '已出', off: '已下架' }
export const TASK_STATUS_TEXT: Record<TaskStatus, string> = {
  open: '待接单',
  doing: '进行中',
  done: '已完成',
  cancelled: '已关闭',
}

export function fmtTime(iso?: string): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return String(iso).slice(0, 16).replace('T', ' ')
  const diff = Date.now() - t
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d} 天前`
  const date = new Date(t)
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}
