/**
 * 社工端邀请码与课表共享 · rdb 封装（TASK-A2/A3/A4/A5 共用）。
 *
 * 服务端契约：docs/sql/social-invites-166.sql（●待部署）。
 * - RPC：social_invite_create / social_invite_redeem / social_invite_status
 *        schedule_share_grant / schedule_share_revoke / schedule_share_read
 * - 直读：schedule_shares（RLS 限定 student_uid 或 social_uid = auth.uid()）
 *
 * 迁移未部署时（42883 / function not found），各调用返回 rpcMissing=true，
 * 由界面走「邀请码体系尚未部署」降级视图，不硬锁死 App。
 */
import { cbRdb } from './cb'
import {
  inviteRowFromJson,
  isRpcMissingError,
  normalizeInviteCodeInput,
  normalizeRelationInput,
  readableError,
  shareFieldsFrom,
  spaceFromJson,
  validateInviteCodeFormat,
  type InviteRowView,
  type ShareFields,
  type SpaceView,
} from './social-invites-helpers'

type Any = Record<string, any>

function readError(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string' && value.trim()) return value.trim()
  const anyValue = value as { message?: unknown; msg?: unknown }
  const text = typeof anyValue.message === 'string' ? anyValue.message : typeof anyValue.msg === 'string' ? anyValue.msg : ''
  return text.trim() || null
}

/** rpc 调用统一封装：不抛异常，返回 {data, error}（error 已转可读文案） */
async function callRpc(name: string, params: Record<string, unknown> = {}): Promise<{ data: unknown; error: string | null }> {
  try {
    const res: Any = await (cbRdb() as Any).rpc(name, params)
    return { data: (res as { data?: unknown })?.data ?? null, error: readError((res as { error?: unknown })?.error) }
  } catch (e) {
    return { data: null, error: readableError(e) }
  }
}

/** 结果里标记 RPC 是否未部署（让界面切换降级视图） */
function withMissing<T extends { error: string | null; rpcMissing?: boolean }>(result: T): T {
  if (result.error && isRpcMissingError(result.error)) result.rpcMissing = true
  return result
}

/** jsonb 返回值可能是对象或单元素数组，统一收敛成对象 */
function asJsonObject(data: unknown): Record<string, unknown> | null {
  if (data && typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>
  if (Array.isArray(data)) {
    const first = data[0]
    if (first && typeof first === 'object' && !Array.isArray(first)) return first as Record<string, unknown>
  }
  return null
}

export interface InviteStatus {
  /** anon=未登录/匿名；student=已发学生码；social=普通社工视角；admin=管理员 */
  role: 'anon' | 'student' | 'social' | 'admin' | 'unknown'
  /** 社工绑定态：任一邀请码的 used_by 里含自己 */
  bound: boolean
  /** 绑定所用的邀请码（未绑定为空串） */
  boundCode: string
  /** 我发出的邀请码（学生/管理员视角） */
  invites: InviteRowView[]
  /** 我所在的有效双人空间（P2-04b 首轮） */
  spaces: SpaceView[]
  /** 迁移未部署（42883） */
  rpcMissing: boolean
  error: string | null
}

const ANON_STATUS: InviteStatus = { role: 'anon', bound: false, boundCode: '', invites: [], spaces: [], rpcMissing: false, error: null }

/** 当前用户视角的邀请码状态（匿名时按未绑定处理，不抛错） */
export async function socialInviteStatus(): Promise<InviteStatus> {
  const { data, error } = await callRpc('social_invite_status')
  if (error) return { ...ANON_STATUS, error, rpcMissing: isRpcMissingError(error) }
  const obj = asJsonObject(data)
  if (!obj) return { ...ANON_STATUS, error: '邀请码状态返回格式异常' }
  const roleRaw = String(obj.role || 'unknown')
  const role: InviteStatus['role'] = roleRaw === 'student' || roleRaw === 'social' || roleRaw === 'admin' || roleRaw === 'anon' ? roleRaw : 'unknown'
  const invitesRaw = Array.isArray(obj.invites) ? obj.invites : []
  const spacesRaw = Array.isArray(obj.spaces) ? obj.spaces : []
  return {
    role,
    bound: obj.bound === true,
    boundCode: typeof obj.bound_code === 'string' ? obj.bound_code : '',
    invites: invitesRaw.map(inviteRowFromJson).filter((v): v is InviteRowView => !!v),
    spaces: spacesRaw.map(spaceFromJson).filter((v): v is SpaceView => !!v && v.status === 'active'),
    rpcMissing: false,
    error: null,
  }
}

/** 生成邀请码（一次性、默认 7 天有效；学生每枚绑定 1 位社工、同时最多 3 枚有效；管理员无限） */
export async function socialInviteCreate(
  note = '',
  relation = 'friend',
  relationLabel = '',
): Promise<{ ok: boolean; code: string; error: string | null; rpcMissing: boolean }> {
  const normalized = normalizeRelationInput(relation, relationLabel)
  const { data, error } = await callRpc('social_invite_create', {
    p_note: note,
    p_relation: normalized.relation,
    p_relation_label: normalized.label,
  })
  const result = { ok: false, code: '', error, rpcMissing: false }
  if (error) return withMissing(result)
  const obj = asJsonObject(data)
  if (!obj || obj.ok !== true || typeof obj.code !== 'string') {
    return { ...result, error: error || '邀请码生成失败，请重试' }
  }
  return { ok: true, code: obj.code, error: null, rpcMissing: false }
}

/** 发放方撤销自己的邀请码（撤销后不可再绑定） */
export async function socialInviteRevoke(rawCode: string): Promise<{ ok: boolean; error: string | null; rpcMissing: boolean }> {
  const code = normalizeInviteCodeInput(rawCode)
  if (!code) return { ok: false, error: '邀请码格式不正确，无法撤销', rpcMissing: false }
  const { error } = await callRpc('social_invite_revoke', { p_code: code })
  const result = { ok: !error, error, rpcMissing: false }
  if (error) return withMissing(result)
  return result
}

/** 兑换（绑定）邀请码并原子配对双人空间：格式预校验 + 归一化，失败给可读错误 */
export async function socialInviteRedeem(rawCode: string): Promise<{
  ok: boolean
  remaining: number | null
  space: SpaceView | null
  error: string | null
  rpcMissing: boolean
}> {
  const code = normalizeInviteCodeInput(rawCode)
  if (!code) {
    return { ok: false, remaining: null, space: null, error: '邀请码格式不正确：请输入 8 位码（如 ABCD-EF23）', rpcMissing: false }
  }
  const { data, error } = await callRpc('social_invite_redeem', { p_code: code })
  const result = { ok: false, remaining: null as number | null, space: null as SpaceView | null, error, rpcMissing: false }
  if (error) return withMissing(result)
  const obj = asJsonObject(data)
  if (!obj || obj.ok !== true) return { ...result, error: '绑定未成功，请核对邀请码后重试' }
  const remainingRaw = obj.remaining
  const remaining = remainingRaw == null ? null : Number(remainingRaw)
  const spaceRaw = obj.space
  return {
    ok: true,
    remaining: remaining != null && Number.isFinite(remaining) ? remaining : null,
    space: spaceRaw ? spaceFromJson(spaceRaw) : null,
    error: null,
    rpcMissing: false,
  }
}

/** 结束双人空间：mode='dissolve' 解除 / 'block' 屏蔽；服务端级联撤销该对的课表共享 */
export async function socialSpaceClose(spaceId: number, mode: 'dissolve' | 'block' = 'dissolve'): Promise<{ ok: boolean; error: string | null; rpcMissing: boolean }> {
  if (!Number.isFinite(spaceId) || spaceId <= 0) return { ok: false, error: '缺少要关闭的双人空间', rpcMissing: false }
  const { error } = await callRpc('social_space_close', { p_space_id: spaceId, p_mode: mode })
  const result = { ok: !error, error, rpcMissing: false }
  if (error) return withMissing(result)
  return result
}

/** schedule_shares 表的一行（双方视角共用） */
export interface ShareRowView {
  id: number
  studentUid: string
  socialUid: string
  fields: ShareFields
  revoked: boolean
  updatedAt: string
}

function shareRowFromJson(raw: Any): ShareRowView | null {
  if (!raw || typeof raw !== 'object') return null
  const id = Number(raw.id)
  const studentUid = String(raw.student_uid || '')
  const socialUid = String(raw.social_uid || '')
  if (!studentUid || !socialUid) return null
  return {
    id: Number.isFinite(id) ? id : 0,
    studentUid,
    socialUid,
    fields: shareFieldsFrom(raw.fields),
    revoked: raw.revoked === true,
    updatedAt: typeof raw.updated_at === 'string' ? raw.updated_at : '',
  }
}

/** 学生：授予/更新课表共享（对象可为社工用户 uid 或其绑定码） */
export async function scheduleShareGrant(key: string, fields: ShareFields): Promise<{ ok: boolean; granted: number; error: string | null; rpcMissing: boolean }> {
  const trimmed = String(key ?? '').trim()
  if (!trimmed) return { ok: false, granted: 0, error: '请填写要授权的社工用户 uid 或其绑定码', rpcMissing: false }
  const { data, error } = await callRpc('schedule_share_grant', { p_social_uid: trimmed, p_fields: fields })
  const result = { ok: false, granted: 0, error, rpcMissing: false }
  if (error) return withMissing(result)
  const obj = asJsonObject(data)
  if (!obj || obj.ok !== true) return { ...result, error: '授权未成功，请稍后重试' }
  const granted = Number(obj.granted)
  return { ok: true, granted: Number.isFinite(granted) ? granted : 0, error: null, rpcMissing: false }
}

/** 学生：撤销对某社工的共享（幂等） */
export async function scheduleShareRevoke(socialUid: string): Promise<{ ok: boolean; error: string | null; rpcMissing: boolean }> {
  const trimmed = String(socialUid ?? '').trim()
  if (!trimmed) return { ok: false, error: '缺少要撤销授权的社工用户', rpcMissing: false }
  const { error } = await callRpc('schedule_share_revoke', { p_social_uid: trimmed })
  const result = { ok: !error, error, rpcMissing: false }
  if (error) return withMissing(result)
  return result
}

/** 社工：读取某学生授权给我的共享（fields + 课表快照） */
export async function scheduleShareRead(studentUid: string): Promise<{
  ok: boolean
  fields: ShareFields | null
  snapshot: unknown
  updatedAt: string
  reason: string
  error: string | null
  rpcMissing: boolean
}> {
  const trimmed = String(studentUid ?? '').trim()
  if (!trimmed) {
    return { ok: false, fields: null, snapshot: null, updatedAt: '', reason: 'MISSING_STUDENT', error: null, rpcMissing: false }
  }
  const { data, error } = await callRpc('schedule_share_read', { p_student_uid: trimmed })
  const base = { ok: false, fields: null as ShareFields | null, snapshot: null as unknown, updatedAt: '', reason: '', error, rpcMissing: false }
  if (error) return { ...withMissing({ ...base, error }), snapshot: null }
  const obj = asJsonObject(data)
  if (!obj) return { ...base, reason: 'BAD_FORMAT' }
  if (obj.ok !== true) {
    return { ...base, reason: String(obj.reason || 'NOT_SHARED'), ok: false }
  }
  return {
    ok: true,
    fields: shareFieldsFrom(obj.fields),
    snapshot: obj.snapshot ?? null,
    updatedAt: typeof obj.updated_at === 'string' ? obj.updated_at : '',
    reason: '',
    error: null,
    rpcMissing: false,
  }
}

/** 直读 schedule_shares（RLS 限定可见行）；who=student 取我授权出去的，who=social 取授权给我的 */
async function listShares(who: 'student' | 'social'): Promise<{ rows: ShareRowView[]; error: string | null }> {
  try {
    const res: Any = await (cbRdb().from('schedule_shares') as Any)
      .select('id,student_uid,social_uid,fields,revoked,updated_at')
      .order('updated_at', { ascending: false })
      .limit(100)
    const err = readError(res?.error)
    if (err) return { rows: [], error: err }
    const rows = Array.isArray(res?.data) ? res.data : []
    const list = rows.map(shareRowFromJson).filter((v: ShareRowView | null): v is ShareRowView => !!v)
    if (who === 'student') return { rows: list, error: null }
    return { rows: list.filter((v) => !v.revoked), error: null }
  } catch (e) {
    return { rows: [], error: readableError(e) }
  }
}

/** 学生视角：我授权出去的共享（含被撤销的行，界面自行过滤） */
export async function listMyScheduleShares(): Promise<{ rows: ShareRowView[]; error: string | null }> {
  return listShares('student')
}

/** 社工视角：授权给我的学生共享 */
export async function listGrantsToMe(): Promise<{ rows: ShareRowView[]; error: string | null }> {
  return listShares('social')
}

export { validateInviteCodeFormat, normalizeInviteCodeInput }
