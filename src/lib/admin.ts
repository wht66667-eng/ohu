/**
 * 后台成员与用户治理数据层（仅最高管理员可用）
 *
 * - 成员列表：直接读 admin_accounts（RLS 已收紧为 is_admin_user() 可见）
 * - 成员/用户治理：走服务端 SECURITY DEFINER RPC，函数内部自校验 is_super_admin_user()，
 *   客户端即使被绕过也无法越权（普通管理员 / 被封用户一律被服务端拒绝）。
 * - 幂等由服务端保证：admin_add_member ON CONFLICT upsert；封禁自动批量下架内容在单事务内完成。
 */
import { cbRdb } from './cb'
import type { QueryRes, MutateRes } from './market'

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

/* ---------------- 类型 ---------------- */

export type AdminRole = 'admin' | 'super_admin'

/** 站长统一使用角色介绍，不在介绍里混入手机号或自动提权提示。 */
export const STATION_TITLE = '站长'
export const STATION_INTRO = '拥有全部后台管理权限，可管理内容、举报、公告、经营资格、财务费率和管理员成员。'

/** admin_accounts 行（RLS 已允许管理员读取） */
export interface AdminAccountRow {
  id: number
  account: string
  display_name: string
  role: AdminRole
  perms: string[] | null
  note: string | null
  created_at?: string
  updated_at?: string
}

/** admin_search_users 返回的用户行 */
export interface AdminUserRow {
  uid: string
  account: string
  nickname: string
  is_admin: boolean
  is_super_admin: boolean
  banned: boolean
  banned_note: string
}

/* ---------------- 后台成员列表 ---------------- */

/** 成员列表：超管行固定置顶，其余按创建时间倒序 */
export async function fetchAdminAccounts(): Promise<QueryRes<AdminAccountRow>> {
  try {
    const q: Any = cbRdb().from('admin_accounts').select('*')
    const res = await q
    const err = readError(res?.error)
    if (err) return { rows: [], error: err }
    const data = Array.isArray(res?.data) ? (res.data as AdminAccountRow[]) : []
    const rows = data.map((row) => row.role === 'super_admin' ? { ...row, display_name: STATION_TITLE, note: STATION_INTRO } : row).sort((a, b) => {
      if (a.role === 'super_admin' && b.role !== 'super_admin') return -1
      if (b.role === 'super_admin' && a.role !== 'super_admin') return 1
      return String(b.created_at || '').localeCompare(String(a.created_at || ''))
    })
    return { rows, error: null }
  } catch (e) {
    return { rows: [], error: errText(e) }
  }
}

/* ---------------- 治理 RPC 封装 ---------------- */

async function rpc(name: string, params: Record<string, unknown>): Promise<MutateRes> {
  try {
    const res: Any = await (cbRdb() as Any).rpc(name, params)
    return { error: readError(res?.error) }
  } catch (e) {
    return { error: errText(e) }
  }
}

/** 按 手机号 / 用户名 / 昵称 搜索用户（限 10 条，含是否管理员 / 是否封禁） */
export async function searchUsers(q: string): Promise<QueryRes<AdminUserRow>> {
  try {
    const res: Any = await (cbRdb() as Any).rpc('admin_search_users', { q })
    const err = readError(res?.error)
    if (err) return { rows: [], error: err }
    const data = Array.isArray(res?.data) ? (res.data as AdminUserRow[]) : []
    return { rows: data, error: null }
  } catch (e) {
    return { rows: [], error: errText(e) }
  }
}

/** 添加普通管理员：account 为已注册的手机号或用户名，服务端原子同步 admin_accounts + profiles.is_admin */
export function addMember(account: string, displayName: string, note: string): Promise<MutateRes> {
  return rpc('admin_add_member', { account, display_name: displayName, note })
}

/** 移除普通管理员（最高管理员不可移除，也不能移除自己） */
export function removeMember(account: string): Promise<MutateRes> {
  return rpc('admin_remove_member', { account })
}

/** 封禁用户：填原因，服务端同事务批量下架其已发布内容 */
export function banUser(account: string, reason: string): Promise<MutateRes> {
  return rpc('admin_ban_user', { account, reason })
}

/** 解封用户 */
export function unbanUser(account: string): Promise<MutateRes> {
  return rpc('admin_unban_user', { account })
}

/** Account flag and community restriction commit together; retrying the same target state is safe. */
export async function setAccountAccess(account: string, uid: string, banned: boolean, reason: string): Promise<MutateRes> {
  if (!account.trim() || !uid.trim()) return { error: '缺少需要处理的账号' }
  try {
    const res: Any = await (cbRdb() as Any).rpc('admin_set_account_access', { account, target_uid: uid, banned, reason })
    const error = readError(res?.error)
    if (error) return { error }
    const result = Array.isArray(res?.data) && res.data.length === 1 ? res.data[0] : res?.data
    if (result?.ok !== true || result.account !== account || result.banned !== banned || result.uid !== uid) {
      return { error: '账号处理结果尚未确认，请重新查询该用户后重试' }
    }
    return { error: null }
  } catch (error) { return { error: errText(error) } }
}
