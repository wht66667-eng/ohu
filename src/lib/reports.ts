/**
 * 学生举报 → 管理员处理
 * 表不存在时静默失败，前端仍提示「已提交」。
 */
import { cbRdb } from './cb'
import type { MutateRes, QueryRes } from './market'

export type ReportTarget =
  | 'plaza_post'
  | 'plaza_message'
  | 'secondhand'
  | 'task'
  | 'user'
  | 'energy_goal'
  | 'campus_post'
  | 'other'
export type ReportStatus = 'pending' | 'done' | 'rejected'

export interface ReportRow {
  id: number
  reporter_uid: string
  target_type: ReportTarget
  target_id: string
  reason: string
  detail: string
  status: ReportStatus
  admin_note: string
  created_at: string
  handled_at: string | null
}

type Any = any

function errText(e: unknown): string {
  if (!e) return '操作失败'
  const a = e as { message?: string; msg?: string }
  return a.message || a.msg || '操作失败'
}

function readError(e: unknown): string | null {
  if (!e) return null
  if (typeof e === 'string') return e
  return (e as { message?: string }).message || null
}

function norm(raw: Any): ReportRow {
  return {
    id: Number(raw?.id || 0),
    reporter_uid: String(raw?.reporter_uid || ''),
    target_type: (raw?.target_type || 'other') as ReportTarget,
    target_id: String(raw?.target_id || ''),
    reason: String(raw?.reason || ''),
    detail: String(raw?.detail || ''),
    status: (raw?.status || 'pending') as ReportStatus,
    admin_note: String(raw?.admin_note || ''),
    created_at: String(raw?.created_at || ''),
    handled_at: raw?.handled_at || null,
  }
}

/** 学生提交举报 */
export async function submitReport(input: {
  reporterUid: string
  targetType: ReportTarget
  targetId: string
  reason: string
  detail?: string
}): Promise<MutateRes> {
  if (!input.reporterUid) return { error: '请先登录' }
  if (!input.reason.trim()) return { error: '请填写举报原因' }
  try {
    const body = {
      reporter_uid: input.reporterUid,
      target_type: input.targetType,
      target_id: String(input.targetId || ''),
      reason: input.reason.trim().slice(0, 80),
      detail: (input.detail || '').trim().slice(0, 500),
      status: 'pending',
      created_at: new Date().toISOString(),
    }
    const res: Any = await (cbRdb().from('reports') as Any).insert(body)
    const err = readError(res?.error)
    if (err) return { error: err }
    // 尽力给管理员写站内通知（表/触发器未就绪则忽略）
    try {
      await (cbRdb().from('notifications') as Any).insert({
        uid: 'admin_broadcast',
        kind: 'report_new',
        title: '新的学生举报',
        body: `${body.reason} · ${body.target_type}`,
        link: '/admin/reports',
        ref_id: null,
        created_at: new Date().toISOString(),
      })
    } catch {
      /* ignore */
    }
    return { error: null }
  } catch (e) {
    return { error: errText(e) }
  }
}

export async function fetchReports(status?: ReportStatus): Promise<QueryRes<ReportRow>> {
  try {
    let q: Any = (cbRdb().from('reports') as Any).select('*').order('id', { ascending: false }).limit(200)
    if (status) q = q.eq('status', status)
    const res = await q
    const err = readError(res?.error)
    if (err) return { rows: [], error: err }
    const data = Array.isArray(res?.data) ? res.data.map(norm) : []
    return { rows: data, error: null }
  } catch (e) {
    return { rows: [], error: errText(e) }
  }
}

export interface ReportPageRes {
  rows: ReportRow[]
  nextBeforeId: number | null
  hasMore: boolean
  error: string | null
}

/** 管理审核使用 ID 游标稳定翻页；多取一行以准确判断是否还有后续页。 */
export async function fetchReportsPage(input: {
  status?: ReportStatus
  beforeId?: number | null
  pageSize?: number
} = {}): Promise<ReportPageRes> {
  const pageSize = Number.isSafeInteger(input.pageSize) ? Math.min(100, Math.max(1, input.pageSize!)) : 50
  const beforeId = input.beforeId
  if (beforeId !== undefined && beforeId !== null && (!Number.isSafeInteger(beforeId) || beforeId <= 0)) {
    return { rows: [], nextBeforeId: null, hasMore: false, error: '举报分页位置无效，请刷新列表' }
  }
  try {
    let q: Any = (cbRdb().from('reports') as Any).select('*').order('id', { ascending: false }).limit(pageSize + 1)
    if (input.status) q = q.eq('status', input.status)
    if (beforeId !== undefined && beforeId !== null) q = q.lt('id', beforeId)
    const res = await q
    const err = readError(res?.error)
    if (err) return { rows: [], nextBeforeId: null, hasMore: false, error: err }
    const data = Array.isArray(res?.data) ? res.data.map(norm) : []
    const hasMore = data.length > pageSize
    const rows = data.slice(0, pageSize)
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

export async function fetchPendingReportCount(): Promise<number> {
  const r = await fetchReports('pending')
  return r.error ? 0 : r.rows.length
}

export async function resolveReport(id: number, ok: boolean, note = ''): Promise<MutateRes> {
  try {
    const res: Any = await (cbRdb().from('reports') as Any)
      .update({
        status: ok ? 'done' : 'rejected',
        admin_note: note.slice(0, 200),
        handled_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id')
    const error = readError(res?.error)
    if (error) return { error }
    const affected = Array.isArray(res?.data) && res.data.some((row: Any) => Number(row?.id) === id)
    return affected ? { error: null } : { error: '举报不存在或当前账号无权处理，请刷新列表后重试' }
  } catch (e) {
    return { error: errText(e) }
  }
}
