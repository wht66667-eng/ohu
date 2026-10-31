import { cbRdb } from './cb'
import type { Activity, LostItem, News, QueryRes } from './bulletin'

export const INFO_FILTERS = ['全部', '公告', '活动', '失物招领', '互助'] as const
export const INFO_KIND_FILTER = { news: '公告', activity: '活动', lost: '失物招领' } as const
export type InfoTargetKind = keyof typeof INFO_KIND_FILTER
export interface InfoTarget { kind: InfoTargetKind; id: number }
export type InfoTargetRecord = { kind: 'news'; row: News } | { kind: 'activity'; row: Activity } | { kind: 'lost'; row: LostItem }

/** Old /info?id=... announcement links remain valid; ambiguous/invalid input never reaches a query. */
export function parseInfoTarget(params: URLSearchParams): { target: InfoTarget | null; error: string | null } {
  if (!params.has('id') && !params.has('kind')) return { target: null, error: null }
  if (params.getAll('id').length !== 1 || params.getAll('kind').length > 1) return { target: null, error: '这条链接缺少信息编号，或包含重复参数。' }
  const rawId = params.get('id') || ''
  const kind = params.get('kind') || (params.has('kind') ? '' : 'news')
  const id = Number(rawId)
  if (!Object.hasOwn(INFO_KIND_FILTER, kind) || !/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(id)) return { target: null, error: '信息类型或编号无效，请从校园动态重新打开。' }
  return { target: { kind: kind as InfoTargetKind, id }, error: null }
}

export function infoTargetPath(kind: InfoTargetKind, id: number): string {
  const params = new URLSearchParams({ kind, id: String(id) })
  return parseInfoTarget(params).target ? `/info?${params.toString()}` : '/info'
}

export function infoTargetKey(target: InfoTarget): string {
  return `${{ news: 'n', activity: 'a', lost: 'l' }[target.kind]}-${target.id}`
}

/** Query the actual public view by ID, independently of the limited latest-list window. */
export async function fetchInfoTarget(target: InfoTarget): Promise<QueryRes<InfoTargetRecord>> {
  const validated = parseInfoTarget(new URLSearchParams({ kind: target.kind, id: String(target.id) }))
  if (!validated.target) return { rows: [], error: validated.error }
  const views = { news: 'v_news_public', activity: 'v_activities_public', lost: 'v_lost_public' } as const
  try {
    const result = await cbRdb().from(views[target.kind]).select('*').eq('id', target.id).limit(1) as unknown as { data: Record<string, unknown>[] | null; error: unknown }
    if (result.error) {
      const message = typeof result.error === 'string' ? result.error : typeof result.error === 'object' && 'message' in result.error && typeof result.error.message === 'string' ? result.error.message : ''
      return { rows: [], error: message || '这条信息暂时无法读取，请重试。' }
    }
    const row = Array.isArray(result.data) ? result.data[0] : null
    if (!row || Number(row.id) !== target.id) return { rows: [], error: null }
    const normalized = { ...row, id: target.id }
    if (target.kind === 'news') return { rows: [{ kind: 'news', row: normalized as unknown as News }], error: null }
    if (target.kind === 'activity') return { rows: [{ kind: 'activity', row: normalized as unknown as Activity }], error: null }
    return { rows: [{ kind: 'lost', row: normalized as unknown as LostItem }], error: null }
  } catch { return { rows: [], error: '这条信息暂时无法读取，请检查网络后重试。' } }
}
