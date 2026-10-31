/**
 * 站内通知数据层：列表 / 未读数 / 标记已读
 *
 * 服务端事实源（迁移 20260933010000 / 20260933030000）：
 * - notifications 表由服务端触发器与 RPC 写入，前端**只读**
 *   · todo_due        待办到期提醒
 *   · cat_point / cat_exchange  喵粮公益积分到账与兑换券
 *   · report_new      新举报（管理端）
 *   · role_apply_admin / role_review  角色申请与审批结果
 *   · 公告类走 news_broadcasts（见 lib/bulletin），不进本表
 * - 2026-10 交易链下线后，order_* / shop_* / withdraw_result / partner_review / rider_*
 *   这些 kind 服务端已不再产生；类型里保留是为了兼容库里的历史行，前端不展示。
 * - 已读状态只能经 RPC notify_mark_read / notify_mark_all_read 修改
 * - RLS：notifications 只对 uid = auth.uid() 可见
 *
 * 未读数说明：postgREST 侧不支持 `read_at IS NULL` 过滤，
 * 且单用户通知量级很小，故统一「拉取最近 N 条 → 前端统计未读」。
 */
import { cbRdb } from './cb'
import type { QueryRes, MutateRes } from './market'

/* ---------------- 内部工具 ---------------- */

type Any = Record<string, any>

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

async function rpc(name: string, params: Record<string, unknown>): Promise<MutateRes> {
  try {
    const res: Any = await (cbRdb() as Any).rpc(name, params)
    return { error: readError(res?.error) }
  } catch (e) {
    return { error: errText(e) }
  }
}

/* ---------------- 类型 ---------------- */

export type NotifyKind =
  | 'order_new'
  | 'order_status'
  | 'order_settled'
  | 'withdraw_result'
  | 'force_close'
  | 'role_review'
  /* 合伙人小店（迁移 20260934000000 扩容 notifications.kind 白名单） */
  | 'shop_order_new'
  | 'shop_order_status'
  | 'shop_group'
  | 'partner_review'
  /* 待办到期提醒（迁移 20260941000000） */
  | 'todo_due'
  /* 喵粮公益：积分到账 / 兑换券（迁移 20260942000000） */
  | 'cat_point'
  | 'cat_exchange'
  /* 五端分流扩展（前端识别；库 kind 白名单需同步 SQL） */
  | 'rider_grab'
  | 'rider_dispatch'
  | 'role_apply_admin'
  | 'report_new'

export interface NotifyRow {
  id: number
  uid: string
  kind: NotifyKind
  title: string
  body: string
  link: string
  ref_id: number | null
  read_at: string | null
  created_at: string
}

export interface NotifyMeta {
  emoji: string
  foxPose?: 'cheer' | 'food'
  tone: 'orange' | 'green' | 'blue' | 'purple' | 'red'
}

export const NOTIFY_META: Record<NotifyKind, NotifyMeta> = {
  order_new: { emoji: '🍱', tone: 'orange' },
  order_status: { emoji: '✅', tone: 'green' },
  order_settled: { emoji: '💰', tone: 'green' },
  withdraw_result: { emoji: '💳', tone: 'blue' },
  force_close: { emoji: '🚧', tone: 'red' },
  role_review: { emoji: '🛡️', tone: 'purple' },
  shop_order_new: { emoji: '🛒', tone: 'purple' },
  shop_order_status: { emoji: '📦', tone: 'green' },
  shop_group: { emoji: '👥', tone: 'purple' },
  partner_review: { emoji: '🏪', tone: 'purple' },
  todo_due: { emoji: '📝', tone: 'orange' },
  cat_point: { emoji: '', tone: 'green', foxPose: 'cheer' },
  cat_exchange: { emoji: '', tone: 'green', foxPose: 'food' },
  rider_grab: { emoji: '🛵', tone: 'orange' },
  rider_dispatch: { emoji: '📡', tone: 'blue' },
  role_apply_admin: { emoji: '📝', tone: 'purple' },
  report_new: { emoji: '🚩', tone: 'red' },
}

const FALLBACK_META: NotifyMeta = { emoji: '🔔', tone: 'green' }

/** 未知 kind（后续新增类型）也能安全渲染 */
export function notifyMeta(kind: string): NotifyMeta {
  return NOTIFY_META[kind as NotifyKind] || FALLBACK_META
}

/** 相对时间：刚刚 / 12 分钟前 / 3 小时前 / 2 天前 / 03-18 */
export function relTime(iso: string, at: Date = new Date()): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Math.max(0, at.getTime() - t)
  const minute = 60 * 1000
  if (diff < minute) return '刚刚'
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`
  if (diff < 7 * 24 * 60 * minute) return `${Math.floor(diff / (24 * 60 * minute))} 天前`
  const d = new Date(t)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* ---------------- 读 ---------------- */

/** 我的通知（最新在前，最多 100 条） */
export async function fetchNotifications(uid: string, limitN = 100): Promise<QueryRes<NotifyRow>> {
  if (!uid) return { rows: [], error: null }
  try {
    const res: Any = await (cbRdb().from('notifications') as Any)
      .select('*')
      .eq('uid', uid)
      .order('id', { ascending: false })
      .limit(limitN)
    const err = readError(res?.error)
    if (err) return { rows: [], error: err }
    const data = Array.isArray(res?.data) ? (res.data as NotifyRow[]) : []
    return { rows: data, error: null }
  } catch (e) {
    return { rows: [], error: errText(e) }
  }
}

export interface NotifyPageRes {
  rows: NotifyRow[]
  nextBeforeId: number | null
  hasMore: boolean
  error: string | null
}

/** 通知历史游标分页；ID 倒序且使用 exclusive cursor，最多返回 100 条。 */
export async function fetchNotificationsPage(
  uid: string,
  beforeId?: number | null,
  pageSize = 100,
): Promise<NotifyPageRes> {
  const size = Number.isSafeInteger(pageSize) ? Math.max(1, Math.min(pageSize, 100)) : 100
  if (!uid) return { rows: [], nextBeforeId: null, hasMore: false, error: null }
  if (beforeId != null && (!Number.isSafeInteger(beforeId) || beforeId <= 0)) {
    return { rows: [], nextBeforeId: null, hasMore: false, error: '通知分页位置无效，请刷新后重试。' }
  }
  try {
    let query: Any = (cbRdb().from('notifications') as Any)
      .select('*')
      .eq('uid', uid)
    if (beforeId != null) query = query.lt('id', beforeId)
    const res: Any = await query.order('id', { ascending: false }).limit(size + 1)
    const err = readError(res?.error)
    if (err) return { rows: [], nextBeforeId: null, hasMore: false, error: err }
    const data = Array.isArray(res?.data) ? (res.data as NotifyRow[]) : []
    const hasMore = data.length > size
    const rows = data.slice(0, size)
    return {
      rows,
      nextBeforeId: hasMore && rows.length ? rows[rows.length - 1].id : null,
      hasMore,
      error: null,
    }
  } catch (e) {
    return { rows: [], nextBeforeId: null, hasMore: false, error: errText(e) }
  }
}

/** 未读数（基于最近 100 条统计；通知量为小数据量，避免新增计数 RPC） */
export async function fetchUnreadCount(uid: string): Promise<{ count: number; error: string | null }> {
  const res = await fetchNotifications(uid, 100)
  if (res.error) return { count: 0, error: res.error }
  return { count: res.rows.filter((row) => !row.read_at).length, error: null }
}

/* ---------------- 写（仅已读标记，走 RPC） ---------------- */

export async function notifyMarkRead(ids: number[]): Promise<MutateRes> {
  if (!ids.length) return { error: null }
  return rpc('notify_mark_read', { p_ids: ids })
}

export async function notifyMarkAllRead(): Promise<MutateRes> {
  return rpc('notify_mark_all_read', {})
}
