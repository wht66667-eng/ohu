/**
 * 广场处置：禁言 / 封大厅 / 封广场发言。
 * 服务端策略见 docs/release/plaza-sanctions.sql。
 * 表还没部署时，查询失败则放行发送，避免学生端被误锁；管理端写操作会把错误原样提示。
 */
import { cbRdb } from './cb'

type Any = Record<string, any>

export type SanctionKind = 'mute' | 'hall_ban' | 'account'

export interface PlazaGate {
  mute: boolean
  hall: boolean
  account: boolean
  reason: string
  /** 处置表不存在或查询失败：学生端放行 */
  lookupError: boolean
}

export interface SanctionRow {
  id: number
  uid: string
  kind: SanctionKind
  until_at: string | null
  reason: string
  actor_uid: string
  created_at: string
}

const EMPTY_GATE: PlazaGate = {
  mute: false,
  hall: false,
  account: false,
  reason: '',
  lookupError: false,
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
  return (e as { message?: string }).message || null
}

function active(until: string | null | undefined): boolean {
  if (!until) return true
  const t = new Date(until).getTime()
  return Number.isFinite(t) && t > Date.now()
}

export async function fetchPlazaGate(uid: string): Promise<PlazaGate> {
  if (!uid) return EMPTY_GATE
  try {
    const res: Any = await (cbRdb().from('user_sanctions') as Any)
      .select('kind,until_at,reason')
      .eq('uid', uid)
      .limit(40)
    const err = readError(res?.error)
    if (err) return { ...EMPTY_GATE, lookupError: true, reason: err }
    const rows = Array.isArray(res?.data) ? res.data : []
    const gate: PlazaGate = { ...EMPTY_GATE }
    for (const raw of rows) {
      if (!active(raw?.until_at)) continue
      const kind = String(raw?.kind || '')
      const reason = String(raw?.reason || '')
      if (kind === 'account') {
        gate.account = true
        gate.reason = reason || gate.reason
      } else if (kind === 'mute') {
        gate.mute = true
        gate.reason = reason || gate.reason
      } else if (kind === 'hall_ban') {
        gate.hall = true
        gate.reason = reason || gate.reason
      }
    }
    return gate
  } catch (e) {
    return { ...EMPTY_GATE, lookupError: true, reason: errText(e) }
  }
}

/** 返回 null 表示可以发；否则是给学生看的原因 */
export async function assertPlazaWrite(uid: string, where: 'hall' | 'post'): Promise<string | null> {
  const gate = await fetchPlazaGate(uid)
  if (gate.lookupError) return null
  if (gate.account) return gate.reason || '账号已被限制发言'
  if (gate.mute) return gate.reason || '你已被禁言'
  if (where === 'hall' && gate.hall) return gate.reason || '你已被限制进入大厅'
  return null
}

export async function fetchActiveSanctions(): Promise<{ rows: SanctionRow[]; error: string | null }> {
  try {
    const res: Any = await (cbRdb().from('user_sanctions') as Any)
      .select('*')
      .order('id', { ascending: false })
      .limit(200)
    const err = readError(res?.error)
    if (err) return { rows: [], error: err }
    const rows = (Array.isArray(res?.data) ? res.data : [])
      .map((raw: Any) => ({
        id: Number(raw.id || 0),
        uid: String(raw.uid || ''),
        kind: String(raw.kind || 'mute') as SanctionKind,
        until_at: raw.until_at ? String(raw.until_at) : null,
        reason: String(raw.reason || ''),
        actor_uid: String(raw.actor_uid || ''),
        created_at: String(raw.created_at || ''),
      }))
      .filter((r: SanctionRow) => active(r.until_at))
    return { rows, error: null }
  } catch (e) {
    return { rows: [], error: errText(e) }
  }
}

/** hours 为空表示一直有效，直到管理员解除 */
export async function applySanction(input: {
  uid: string
  kind: SanctionKind
  hours: number | null
  reason: string
  actorUid: string
}): Promise<{ error: string | null }> {
  const uid = input.uid.trim()
  if (!uid) return { error: '缺少用户' }
  const until = input.hours == null ? null : new Date(Date.now() + input.hours * 3600_000).toISOString()
  try {
    const res: Any = await (cbRdb().from('user_sanctions') as Any).insert({
      uid,
      kind: input.kind,
      until_at: until,
      reason: input.reason.trim().slice(0, 120) || '违反校园社区规范',
      actor_uid: input.actorUid || '',
      created_at: new Date().toISOString(),
    })
    return { error: readError(res?.error) }
  } catch (e) {
    return { error: errText(e) }
  }
}

export async function liftSanctions(uid: string, kind?: SanctionKind): Promise<{ error: string | null }> {
  if (!uid) return { error: '缺少用户' }
  try {
    let q: Any = (cbRdb().from('user_sanctions') as Any).delete().eq('uid', uid)
    if (kind) q = q.eq('kind', kind)
    const res = await q
    return { error: readError(res?.error) }
  } catch (e) {
    return { error: errText(e) }
  }
}

export function sanctionKindText(kind: SanctionKind): string {
  if (kind === 'mute') return '禁言'
  if (kind === 'hall_ban') return '封大厅'
  return '封广场发言'
}
