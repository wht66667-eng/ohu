/**
 * 校园留言反馈墙数据层
 *
 * - 公开列表：读脱敏视图 v_feedbacks_public（匿名可读，不暴露 creator_uid）
 * - 发帖：真实登录用户写主表 feedbacks（RLS 强制 creator_uid = auth.uid() 且禁止游客）
 * - 我的留言：登录后按 creator_uid 读主表（RLS 放行非游客登录用户）
 * - 管理员：回复/关闭/删除（RLS is_admin_user）
 */
import { cbRdb } from './cb'
import { fmtTime } from './market'

export type FeedbackCategory = 'complaint' | 'suggest' | 'praise' | 'other'
export type FeedbackStatus = 'open' | 'replied' | 'closed'

export interface Feedback {
  id: number
  category: FeedbackCategory
  title: string
  content: string
  creator_name: string
  status: FeedbackStatus
  reply: string
  handled_at?: string | null
  created_at: string
  updated_at?: string
  creator_uid?: string // 主表读回才有
}

export type Any = Record<string, any>

export interface QueryRes<T> {
  rows: T[]
  error: string | null
}

export interface MutateRes {
  error: string | null
}

function readError(e: unknown): string | null {
  if (!e) return null
  if (typeof e === 'string') return e
  const msg = (e as { message?: string }).message
  return msg || null
}

function errText(e: unknown): string {
  if (!e) return '操作失败，请稍后重试'
  const a = e as { message?: unknown; msg?: unknown }
  const m = typeof a.message === 'string' ? a.message : typeof a.msg === 'string' ? a.msg : ''
  return m || '操作失败，请稍后重试'
}

async function selectRows<T>(name: string, filters?: Record<string, string | number>): Promise<QueryRes<T>> {
  try {
    let q: Any = (cbRdb().from(name) as Any).select('*')
    if (filters) {
      for (const k of Object.keys(filters)) q = q.eq(k, filters[k])
    }
    const res = await q
    const err = readError(res?.error)
    if (err) return { rows: [], error: err }
    const data = Array.isArray(res?.data) ? (res.data as T[]) : []
    return { rows: data, error: null }
  } catch (e) {
    return { rows: [], error: errText(e) }
  }
}

async function mutate(name: string, kind: 'insert' | 'update' | 'delete', body?: Record<string, unknown>, where?: Record<string, unknown>): Promise<MutateRes> {
  try {
    const q: Any = cbRdb().from(name) as Any
    let res: { error?: { message?: string } | string }
    if (kind === 'insert' && body) {
      res = await q.insert(body)
      return { error: readError(res?.error) }
    }
    if (kind === 'update' && body && where) {
      let wq: Any = q.update(body)
      for (const k of Object.keys(where)) wq = wq.eq(k, where[k])
      res = await wq
      return { error: readError(res?.error) }
    }
    if (kind === 'delete' && where) {
      let wq: Any = q.delete()
      for (const k of Object.keys(where)) wq = wq.eq(k, where[k])
      res = await wq
      return { error: readError(res?.error) }
    }
    return { error: '参数错误' }
  } catch (e) {
    return { error: errText(e) }
  }
}

/* ---------------- 公开读 ---------------- */

/** 公开留言墙（脱敏视图；匿名游客可读） */
export async function fetchFeedbacks(): Promise<QueryRes<Feedback>> {
  try {
    const r = await selectRows<Feedback>('v_feedbacks_public')
    if (r.error) return r
    const rows = r.rows.slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    return { rows: rows.slice(0, 80), error: null }
  } catch (e) {
    return { rows: [], error: errText(e) }
  }
}

/** 我发过的留言（主表；含关闭，可继续删除） */
export async function fetchFeedbackMine(uid: string): Promise<QueryRes<Feedback>> {
  const r = await selectRows<Feedback>('feedbacks', { creator_uid: uid })
  if (r.error) return r
  const rows = r.rows.slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  return { rows, error: null }
}

export interface FeedbackDraft {
  category: FeedbackCategory
  title: string
  content: string
  creator_name: string
}

/** 发布留言（真实登录用户；RLS 兜底非游客） */
export async function createFeedback(d: FeedbackDraft): Promise<MutateRes> {
  const res = await mutate('feedbacks', 'insert', { ...d, status: 'open', reply: '' })
  if (!res.error) {
    const { pingBehavior } = await import('./activity-ping')
    pingBehavior.feedbackPost()
  }
  return res
}

/** 本人关闭自己尚未处理 / 已回复的留言（RLS 仅本人可更新） */
export async function closeFeedback(id: number): Promise<MutateRes> {
  return mutate('feedbacks', 'update', { status: 'closed' }, { id })
}

/** 删除留言（本人或管理员） */
export async function deleteFeedback(id: number): Promise<MutateRes> {
  return mutate('feedbacks', 'delete', undefined, { id })
}

/** 管理员回复（open -> replied）或直接关闭 */
export async function adminHandle(id: number, status: 'replied' | 'closed', reply?: string): Promise<MutateRes> {
  const now = new Date().toISOString()
  return mutate('feedbacks', 'update', { status, reply: status === 'closed' ? '' : reply || '', handled_at: now }, { id })
}

/* ---------------- 展示字典 ---------------- */

export const FEEDBACK_CATEGORIES: { value: FeedbackCategory; label: string; icon: string }[] = [
  { value: 'complaint', label: '投诉', icon: '🔥' },
  { value: 'suggest', label: '建议', icon: '💡' },
  { value: 'praise', label: '点赞', icon: '👍' },
  { value: 'other', label: '其他', icon: '💬' },
]

export function categoryText(c: string): string {
  return FEEDBACK_CATEGORIES.find((x) => x.value === c)?.label || c
}

export function categoryIcon(c: string): string {
  return FEEDBACK_CATEGORIES.find((x) => x.value === c)?.icon || '💬'
}

export const FEEDBACK_STATUS_TEXT: Record<FeedbackStatus, string> = {
  open: '待处理',
  replied: '已回复',
  closed: '已关闭',
}

export function fmtFeedbackTime(iso?: string): string {
  return fmtTime(iso)
}
