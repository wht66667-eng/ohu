/**
 * 管理端分析纯函数层（零副作用，Node 可测）。
 * 与 admin-analytics.ts 分离：那边带 rdb 副作用，这里只有日期与文案计算。
 * 唯一 import 是 social-invites-helpers（同为零副作用纯函数层，Node 22+ 可直接加载）；
 * 带 .ts 扩展名 import（tsconfig allowImportingTsExtensions + Node ESM 双兼容）。
 */
import { relationLabel, type SpaceRelation } from './social-invites-helpers.ts'

export const SANCTION_KIND_LABEL: Record<string, string> = {
  mute: '禁言',
  hall_ban: '封大厅',
  account: '封账号',
}

export function kindLabel(kind: string): string {
  return SANCTION_KIND_LABEL[kind] ?? kind
}

/** 本地日期键 YYYY-MM-DD（与手账 day 同口径）。 */
export function formatDayKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 把 RPC 返回的稀疏日活序列补成连续 N 天（旧→新），缺失日补 0。 */
export function fillDaySeries(rows: Array<{ day: string; active: number }>, days: number): Array<{ day: string; active: number }> {
  const byDay = new Map(rows.map(row => [row.day.slice(0, 10), Math.max(0, Math.round(row.active))]))
  const out: Array<{ day: string; active: number }> = []
  const now = Date.now()
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = formatDayKey(now - i * 86_400_000)
    out.push({ day: key, active: byDay.get(key) ?? 0 })
  }
  return out
}

/** 制裁剩余时长文案；null=永久，过期=已过期。 */
export function sanctionRemainingText(untilAt: string | null | undefined): string {
  if (!untilAt) return '永久'
  const ms = Date.parse(untilAt)
  if (!Number.isFinite(ms)) return '未知'
  const left = ms - Date.now()
  if (left <= 0) return '已过期'
  const days = Math.floor(left / 86_400_000)
  if (days >= 1) return `剩余 ${days} 天`
  const hours = Math.floor(left / 3_600_000)
  if (hours >= 1) return `剩余 ${hours} 小时`
  return '不足 1 小时'
}

/** 活跃率的展示口径：min(100, round(active / total * 100))，total=0 时 0。 */
export function activeRate(active: number, total: number): number {
  if (!total || total <= 0) return 0
  return Math.min(100, Math.round((active / total) * 100))
}

/* ===== 管理员邀请码发放面板（TASK-C2，直读 social_invites 行的纯解析与文案） ===== */

/** social_invites 一行（管理面板视图；created_by_role 决定码的用量口径） */
export interface AdminInviteRowView {
  code: string
  createdByUid: string
  createdByRole: 'admin' | 'student' | 'other'
  /** 服务端 used_count（成功兑换次数） */
  usedCount: number
  /** 服务端 max_uses；null = 不限次数（管理员码） */
  maxUses: number | null
  /** used_by_uids 数组长度（绑定过的人数） */
  boundCount: number
  expiresAt: string | null
  revoked: boolean
  relation: SpaceRelation
  relationLabel: string
  note: string
  createdAt: string
}

/** 直读行 → 视图；缺 code 的行丢弃（不抛错，宽容解析） */
export function adminInviteRowFromJson(raw: unknown): AdminInviteRowView | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const code = typeof r.code === 'string' ? r.code : ''
  if (!code) return null
  const usedCount = Number(r.used_count)
  const maxUsesRaw = r.max_uses
  const usedBy = Array.isArray(r.used_by_uids) ? r.used_by_uids : []
  const relation = String(r.relation || 'friend')
  return {
    code,
    createdByUid: typeof r.created_by_uid === 'string' ? r.created_by_uid : '',
    createdByRole: r.created_by_role === 'admin' ? 'admin' : r.created_by_role === 'student' ? 'student' : 'other',
    usedCount: Number.isFinite(usedCount) ? Math.max(0, usedCount) : 0,
    maxUses: maxUsesRaw == null || !Number.isFinite(Number(maxUsesRaw)) ? null : Math.max(0, Math.round(Number(maxUsesRaw))),
    boundCount: usedBy.length,
    expiresAt: typeof r.expires_at === 'string' && r.expires_at ? r.expires_at : null,
    revoked: r.revoked === true,
    relation: relation as SpaceRelation,
    relationLabel: relationLabel(relation, typeof r.relation_label === 'string' ? r.relation_label : ''),
    note: typeof r.note === 'string' ? r.note : '',
    createdAt: typeof r.created_at === 'string' ? r.created_at : '',
  }
}

/** 码仍可被绑定？未撤销 + 未过期 + 未用尽；max_uses=null 视为不限次数（管理员码） */
export function adminInviteActive(invite: AdminInviteRowView, now = Date.now()): boolean {
  if (invite.revoked) return false
  if (invite.maxUses != null && invite.usedCount >= invite.maxUses) return false
  if (invite.expiresAt) {
    const t = new Date(invite.expiresAt).getTime()
    if (!Number.isFinite(t) || t <= now) return false
  }
  return true
}

/** 码的来源一句话：管理员码（不限次数） / 学生码（每码限 1 人） */
export function adminInviteRoleText(invite: AdminInviteRowView): string {
  return invite.createdByRole === 'admin' ? '管理员码' : invite.createdByRole === 'student' ? '学生码' : '邀请码'
}

/** 一行状态文案：撤销/过期/用量（列表主文案） */
export function adminInviteUsageText(invite: AdminInviteRowView, now = Date.now()): string {
  if (invite.revoked) return '已撤销，不能再被绑定'
  if (invite.expiresAt) {
    const t = new Date(invite.expiresAt).getTime()
    if (Number.isFinite(t) && t <= now) return '已过期，不能再被绑定'
  }
  if (invite.maxUses == null) return `已绑定 ${invite.boundCount} 人 · 不限次数`
  if (invite.usedCount >= invite.maxUses) return `名额已用尽（${invite.usedCount}/${invite.maxUses}）`
  return `已绑定 ${invite.usedCount}/${invite.maxUses} 人`
}

/** 剩余有效期一句话（整天向下取整，与 sanctionRemainingText 同口径）；已过期/已撤销返回空串 */
export function adminInviteExpiryText(invite: AdminInviteRowView, now = Date.now()): string {
  if (invite.revoked || !invite.expiresAt) return ''
  const t = new Date(invite.expiresAt).getTime()
  if (!Number.isFinite(t) || t <= now) return ''
  const days = Math.floor((t - now) / 86_400_000)
  if (days <= 0) return '今天到期'
  if (days === 1) return '明天到期'
  return `${days} 天后到期`
}

/** 撤销按钮可用性：服务端 social_invite_revoke 只允许发放方本人撤销（WHERE created_by_uid = v_me） */
export function adminInviteCanRevoke(invite: AdminInviteRowView, myUid: string): boolean {
  return !invite.revoked && !!myUid && invite.createdByUid === myUid
}

/** 撤销按钮的禁用提示（空串=可撤销）；管理员面板里学生码只读展示 */
export function adminInviteRevokeHint(invite: AdminInviteRowView, myUid: string): string {
  if (invite.revoked) return '已撤销'
  if (adminInviteCanRevoke(invite, myUid)) return ''
  return '仅发放方可撤销'
}

/** 列表顶部汇总：共 N 枚 · 可绑定 M · 已失效 K */
export function adminInviteSummaryText(rows: AdminInviteRowView[], now = Date.now()): string {
  const active = rows.filter((r) => adminInviteActive(r, now)).length
  return `共 ${rows.length} 枚 · 可绑定 ${active} · 已失效 ${rows.length - active}`
}

/**
 * 直读 social_invites 的错误分类：迁移未部署（表不存在 / 42883 / PGRST 缓存）返回
 * 部署指引文案，界面据此切错误态（不放行、不降级、无绕过，对齐 A 窗口硬门口径）；
 * 其它错误返回 null（原样展示）。
 */
export function adminInviteUnavailableReason(error: string | null | undefined): string | null {
  const text = String(error ?? '')
  if (!text) return null
  const missing = /42883|PGRST20[0-9]|schema cache|does not exist|could not find the (function|table)|relation .* does not exist/i.test(text)
  if (!missing) return null
  return '邀请码体系尚未部署：请在生产库执行 docs/sql/social-invites-166.sql（42 条，--SPLIT-- 分块）与守卫依赖后刷新；管理员码发放、学生发放与绑定共用这套迁移。'
}
