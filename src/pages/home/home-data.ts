import { fetchActivities, fetchLostList, fetchNews } from '../../lib/bulletin'
import type { TodoRow } from '../../lib/todo'
import { infoTargetPath, type InfoTargetKind } from '../../lib/info-target'

export interface CampusHighlight {
  id: string
  kind: '公告' | '活动' | '失物'
  sourceKind: InfoTargetKind
  recordId: number
  title: string
  detail: string
  to: string
}

function latest<T extends { created_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0))
}

export async function loadCampusHighlights(): Promise<{ rows: CampusHighlight[]; error: string | null }> {
  const [news, activities, lost] = await Promise.all([fetchNews(), fetchActivities(), fetchLostList()])
  const announcement = [...news.rows].sort((a, b) => Number(b.is_top) - Number(a.is_top) || (Date.parse(b.published_at || b.created_at) || 0) - (Date.parse(a.published_at || a.created_at) || 0))[0]
  const activity = latest(activities.rows).find((item) => item.status === 'open' && (!item.end_at || Date.parse(item.end_at) > Date.now()))
  const lostItem = latest(lost.rows).find((item) => item.status === 'open')
  const rows: CampusHighlight[] = []
  if (announcement) rows.push({ id: `news-${announcement.id}`, kind: '公告', sourceKind: 'news', recordId: announcement.id, title: announcement.title, detail: announcement.source || announcement.summary || '校园公告', to: infoTargetPath('news', announcement.id) })
  if (activity) rows.push({ id: `activity-${activity.id}`, kind: '活动', sourceKind: 'activity', recordId: activity.id, title: activity.title, detail: `${activity.location || '地点待补充'} · 报名中`, to: infoTargetPath('activity', activity.id) })
  if (lostItem) rows.push({ id: `lost-${lostItem.id}`, kind: '失物', sourceKind: 'lost', recordId: lostItem.id, title: lostItem.title, detail: `${lostItem.place || '地点待补充'} · ${lostItem.kind === 'found' ? '招领中' : '寻找中'}`, to: infoTargetPath('lost', lostItem.id) })
  // Preserve available sections and surface partial failures separately.
  const failures = [news.error && '公告', activities.error && '活动', lost.error && '失物信息'].filter(Boolean)
  return { rows, error: failures.length ? `${failures.join('、')}暂时未能同步` : null }
}

/** A due task takes precedence; undated plans use newest-created order. */
export function nearestOpenTodo(rows: TodoRow[]): TodoRow | null {
  const open = rows.filter((item) => !item.done)
  return [...open].sort((a, b) => {
    const aDue = a.due_at ? Date.parse(a.due_at) : NaN
    const bDue = b.due_at ? Date.parse(b.due_at) : NaN
    if (Number.isFinite(aDue) && Number.isFinite(bDue)) return aDue - bDue || a.id - b.id
    if (Number.isFinite(aDue)) return -1
    if (Number.isFinite(bDue)) return 1
    return (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0)
  })[0] || null
}
