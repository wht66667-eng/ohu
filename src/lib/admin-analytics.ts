/**
 * 管理端 · 用户日活与制裁明细（admin-analytics）。
 *
 * 设计参考（模式借鉴，不引代码）：Supabase Dashboard 的用户封禁列表交互、
 * Metabase 的日活柱状趋势、Appsmith 管理模板的权限区块。
 *
 * 数据口径：
 * - 日活来自 `user_engagement.last_active_at`（engagement 写入端已存在），
 *   经 SECURITY DEFINER RPC `admin_activity_overview` 聚合（is_admin_user 守卫）；
 *   RPC 未部署时返回 { unavailable: true }，UI 给出迁移引导，不造假数据。
 * - 制裁明细直读 `user_sanctions`（RLS：本人或管理员可读；管理员可增删），
 *   迁移见 docs/release/plaza-sanctions.sql（重建基线）。
 * 纯函数（fillDaySeries / sanctionRemainingText / kindLabel）可在 Node 直接测试。
 */
import { cbRdb } from './cb'
import {
  adminInviteRowFromJson,
  adminInviteUnavailableReason,
  sanctionRemainingText,
  kindLabel,
  fillDaySeries,
  activeRate,
  type AdminInviteRowView,
} from './admin-analytics-helpers'

export type Any = Record<string, any>

export interface AdminActivityOverview {
  unavailable?: boolean
  reason?: string
  dau: number
  wau: number
  mau: number
  total: number
  days: Array<{ day: string; active: number }>
}

export interface AdminSanctionRow {
  id: number
  uid: string
  username: string
  kind: 'mute' | 'hall_ban' | 'account'
  until_at: string | null
  reason: string
  actor_uid: string
  created_at: string
  remainingText: string
}

export { sanctionRemainingText, kindLabel, fillDaySeries, activeRate }

/** 从 SDK 返回值提取可读错误（CloudBase 的 error.message / 字符串本身）；无错误返回空串 */
function resErrorText(res: unknown): string {
  const e = (res as Any)?.error
  if (!e) return ''
  return String(typeof e === 'string' ? e : e?.message ?? e?.msg ?? e ?? '').trim()
}

/** 近 N 天日活概览；RPC 未部署（42883/function not found）或被 RLS 拒绝时返回 unavailable。
 *  2026-11-14 修正：SDK 对失败 rpc 返回 {data:null, error}（不抛异常），此前 `res?.data ?? res`
 *  会把错误包装对象误当 payload 渲染成全 0 假数据；现在先检查 error，绝不渲染虚构数值。 */
export async function fetchAdminActivity(days = 14): Promise<AdminActivityOverview> {
  try {
    const res: Any = await (cbRdb() as Any).rpc('admin_activity_overview', { p_days: days })
    const errMessage = resErrorText(res)
    if (errMessage) {
      return { unavailable: true, reason: errMessage.includes('admin_activity_overview') ? '聚合 RPC 尚未部署（docs/sql/admin-analytics-166.sql）' : errMessage.slice(0, 120), dau: 0, wau: 0, mau: 0, total: 0, days: [] }
    }
    const data = res?.data ?? res
    const payload = Array.isArray(data) ? data[0] : data
    if (!payload || typeof payload !== 'object') throw new Error('empty')
    const rawDays: Array<{ day: string; active: number }> = Array.isArray(payload.days)
      ? payload.days.map((item: Any) => ({ day: String(item.day ?? '').slice(0, 10), active: Number(item.active) || 0 }))
      : []
    return {
      dau: Number(payload.dau) || 0,
      wau: Number(payload.wau) || 0,
      mau: Number(payload.mau) || 0,
      total: Number(payload.total) || 0,
      days: fillDaySeries(rawDays, days),
    }
  } catch (error) {
    const message = String((error as Any)?.message ?? error ?? '')
    return { unavailable: true, reason: message.includes('admin_activity_overview') ? '聚合 RPC 尚未部署（docs/sql/admin-analytics-166.sql）' : message.slice(0, 120), dau: 0, wau: 0, mau: 0, total: 0, days: [] }
  }
}

/** 制裁明细（跨用户）；RLS 拒绝时把原因带回给 UI（错误绝不渲染成空态假数据）。 */
export async function fetchAdminSanctions(limit = 200): Promise<{ rows: AdminSanctionRow[]; error: string | null }> {
  try {
    const res: Any = await (cbRdb() as Any).from('user_sanctions').select('*').order('created_at', { ascending: false }).limit(limit)
    const errMessage = resErrorText(res)
    if (errMessage) return { rows: [], error: errMessage.slice(0, 160) }
    const rows: Any[] = res?.data ?? []
    return {
      rows: rows.map(row => ({
        id: Number(row.id),
        uid: String(row.uid ?? ''),
        username: String(row.username ?? row.uid ?? ''),
        kind: (row.kind === 'mute' || row.kind === 'hall_ban' || row.kind === 'account' ? row.kind : 'account') as AdminSanctionRow['kind'],
        until_at: row.until_at ?? null,
        reason: String(row.reason ?? ''),
        actor_uid: String(row.actor_uid ?? ''),
        created_at: String(row.created_at ?? ''),
        remainingText: sanctionRemainingText(row.until_at),
      })),
      error: null,
    }
  } catch (error) {
    return { rows: [], error: String((error as Any)?.message ?? error ?? '').slice(0, 160) }
  }
}

/** 新增制裁：kind=mute/hall_ban/account；days=null 表示永久。写入失败（含 SDK 不抛异常的 error 对象）一律返回错误文案。 */
export async function addAdminSanction(uid: string, kind: AdminSanctionRow['kind'], days: number | null, reason: string, actorUid: string): Promise<string | null> {
  if (!uid) return '请先搜索并选中用户'
  const until = days && days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null
  try {
    const res = await (cbRdb() as Any).from('user_sanctions').insert({
      uid, kind, until_at: until, reason: (reason || '').slice(0, 120), actor_uid: actorUid, created_at: new Date().toISOString(),
    })
    const errMessage = resErrorText(res)
    if (errMessage) return errMessage.slice(0, 160)
    return null
  } catch (error) {
    return String((error as Any)?.message ?? error ?? '写入失败').slice(0, 160)
  }
}

export async function liftAdminSanction(id: number): Promise<string | null> {
  try {
    const res = await (cbRdb() as Any).from('user_sanctions').delete().match({ id })
    const errMessage = resErrorText(res)
    if (errMessage) return errMessage.slice(0, 160)
    return null
  } catch (error) {
    return String((error as Any)?.message ?? error ?? '解除失败').slice(0, 160)
  }
}

/* ===== 邀请码发放（TASK-C2） ===== */

export interface AdminInvitesResult {
  rows: AdminInviteRowView[]
  /** true = social_invites / 迁移未部署，界面走部署指引错误态（不放行、不降级） */
  unavailable: boolean
  /** 部署指引文案（unavailable 时给出），否则为 null */
  hint: string | null
  /** 其它错误原样带回 */
  error: string | null
}

/**
 * 全量邀请码列表（管理员视角直读 social_invites）。
 * RLS（social_invites_select_party）：created_by_uid = auth.uid() 或 is_admin_user() ——
 * 管理员可见全部码，普通用户只看自己发的（面板本身有 isAdmin 门槛）。
 * 生成/撤销走 src/lib/social-invites.ts 的 socialInviteCreate / socialInviteRevoke
 * （social_invite_create 对 admin 不限次数；social_invite_revoke 仅发放方本人可撤销）。
 */
export async function fetchAdminInvites(limit = 100): Promise<AdminInvitesResult> {
  try {
    const res: Any = await (cbRdb() as Any)
      .from('social_invites')
      .select('code,created_by_uid,created_by_role,used_count,max_uses,used_by_uids,expires_at,relation,relation_label,revoked,note,created_at')
      .order('created_at', { ascending: false })
      .limit(limit)
    const errRaw = (res as Any)?.error
    const message = String(errRaw?.message ?? errRaw ?? '').trim()
    if (message) {
      const hint = adminInviteUnavailableReason(message)
      return { rows: [], unavailable: hint !== null, hint, error: message.slice(0, 160) }
    }
    const rows: Any[] = Array.isArray(res?.data) ? res.data : []
    return {
      rows: rows.map(adminInviteRowFromJson).filter((v): v is AdminInviteRowView => !!v),
      unavailable: false,
      hint: null,
      error: null,
    }
  } catch (error) {
    const message = String((error as Any)?.message ?? error ?? '读取失败').slice(0, 160)
    const hint = adminInviteUnavailableReason(message)
    return { rows: [], unavailable: hint !== null, hint, error: message }
  }
}
