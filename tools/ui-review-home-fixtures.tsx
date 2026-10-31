/** NON-PRODUCTION. Explicit synthetic homepage states; no remote APIs or notification writes. */
import { useSyncExternalStore } from 'react'
import { clearScheduleCache } from '../src/lib/schedule-cache'
import { getPreviewIdentity, getPreviewDelay, seedSchedule, selectPreviewIdentity, setPreviewDelay, sampleImage } from './ui-review-fixtures'
import type { Task, Item } from '../src/lib/market'
import type { TodoRow } from '../src/lib/todo'
import type { WeatherNow } from '../src/lib/weather'
import type { CampusHighlight } from '../src/pages/home/home-data'

// Keep the existing schedule/chat fixtures independent from homepage-only data.
export * from './ui-review-fixtures'
export type HomePreviewScenario = 'signed' | 'guest' | 'empty' | 'error' | 'slow'
export const HOME_PREVIEW_SCENARIOS: ReadonlyArray<{ value: HomePreviewScenario; label: string }> = [
  { value: 'signed', label: '已登录 · 合成内容' },
  { value: 'guest', label: '游客' },
  { value: 'empty', label: '空数据' },
  { value: 'error', label: '加载失败' },
  { value: 'slow', label: '4 秒延迟' },
]
let snapshot = { mode: 'signed' as HomePreviewScenario, revision: 0 }
const scenarioListeners = new Set<() => void>()
export function useHomePreviewScenario() {
  return useSyncExternalStore((notify) => { scenarioListeners.add(notify); return () => { scenarioListeners.delete(notify) } }, () => snapshot, () => snapshot)
}
export function selectHomePreviewScenario(mode: HomePreviewScenario) {
  if (mode === 'guest') selectPreviewIdentity('')
  else if (!getPreviewIdentity()) selectPreviewIdentity('local:ui-review-a')
  if (mode === 'empty' || mode === 'guest') clearScheduleCache()
  else seedSchedule()
  setPreviewDelay(mode === 'slow' ? 4000 : 180)
  snapshot = { mode, revision: snapshot.revision + 1 }
  scenarioListeners.forEach((notify) => notify())
}
const wait = () => new Promise<void>((resolve) => setTimeout(resolve, getPreviewDelay()))
async function rowsFor<T>(rows: T[]) {
  const mode = snapshot.mode
  await wait()
  return { rows: mode === 'empty' || mode === 'error' ? [] : rows, error: mode === 'error' ? '本地合成错误：模拟加载失败' : null }
}
const iso = (offset = 0) => new Date(Date.now() + offset).toISOString()
export async function fetchTasks() {
  return rowsFor<Task>([
    { id: 801, title: '本地样例 · 帮取教材', description: '合成需求，用于检查首页布局', kind: 'errand', reward: '8', location: '样例教学楼', deadline: '', creator_name: '本地样例甲', status: 'open', created_at: iso(-60_000), images: [sampleImage] },
    { id: 802, title: '本地样例 · 一起整理课程笔记', description: '合成需求，不是真实校园任务', kind: 'help', reward: '0', location: '样例阅览室', deadline: '', creator_name: '本地样例乙', status: 'doing', created_at: iso(-180_000) },
  ])
}
export async function fetchItems() {
  return rowsFor<Item>([
    { id: 901, title: '本地样例 · 闲置教材', description: '合成物品，不会产生交易', category: 'books', condition: '样例', price: 12, images: [sampleImage], building: '样例教学楼', creator_name: '本地样例乙', status: 'on', created_at: iso(-120_000) },
  ])
}
export const ITEM_STATUS_TEXT = { on: '在售', sold: '已出', off: '已下架' }
export const TASK_STATUS_TEXT = { open: '待接单', doing: '进行中', done: '已完成', cancelled: '已取消' }
export const fmtTime = (value?: string) => value ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : ''
export async function fetchTodos() {
  if (!getPreviewIdentity()) return rowsFor<TodoRow>([])
  return rowsFor<TodoRow>([
    { id: 701, title: '本地样例 · 整理英语课堂笔记', note: '仅用于 UI 验收', due_at: iso(4 * 60 * 60_000), done: false, done_at: null, created_at: iso(-30 * 60_000), load: 2 },
    { id: 702, title: '本地样例 · 复习课程', note: '合成计划', due_at: iso(24 * 60 * 60_000), done: false, done_at: null, created_at: iso(-60 * 60_000), load: 3 },
  ])
}
// Production scanner writes notifications; the preview deliberately returns no reminders.
export const todoRemindScan = async () => ({ data: { due: [], created: 0, today: 0, overdue: 0 }, error: null })
export function nearestOpenTodo(rows: TodoRow[]): TodoRow | null {
  return [...rows].filter((row) => !row.done).sort((a, b) => {
    const aDue = a.due_at ? Date.parse(a.due_at) : NaN, bDue = b.due_at ? Date.parse(b.due_at) : NaN
    if (Number.isFinite(aDue) && Number.isFinite(bDue)) return aDue - bDue || a.id - b.id
    if (Number.isFinite(aDue)) return -1
    if (Number.isFinite(bDue)) return 1
    return (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0)
  })[0] || null
}
export async function loadCampusHighlights() {
  return rowsFor<CampusHighlight>([
    { id: 'local-news', kind: '公告', sourceKind: 'news', recordId: 601, title: '本地样例 · 阅读空间开放说明', detail: '合成公告，不代表学校安排', to: '/info?tab=news&id=601' },
    { id: 'local-activity', kind: '活动', sourceKind: 'activity', recordId: 602, title: '本地样例 · 课程笔记交流', detail: '合成活动 · 无实际报名', to: '/info?tab=activity&id=602' },
    { id: 'local-lost', kind: '失物', sourceKind: 'lost', recordId: 603, title: '本地样例 · 水杯招领', detail: '合成失物 · 样例地点', to: '/info?tab=lost&id=603' },
  ])
}
export async function fetchCampusWeather(): Promise<WeatherNow | null> {
  const mode = snapshot.mode
  await wait()
  return mode === 'empty' || mode === 'error' ? null : { city: '本地样例', label: '合成晴天', emoji: '☀', temp: 22, feelsLike: 22, humidity: 50, weatherCode: 0, windLevel: 2, windMs: 2, precip: 0, high: 25, low: 17, updatedAt: iso() }
}
export async function fetchUnreadCount() {
  const mode = snapshot.mode, signed = !!getPreviewIdentity()
  await wait()
  return { count: mode === 'error' ? null : !signed || mode === 'empty' ? 0 : 2, error: mode === 'error' ? '本地合成错误：未读读取失败' : null }
}
export async function fetchChatThreads() {
  const mode = snapshot.mode, signed = !!getPreviewIdentity()
  await wait()
  return { data: { items: [], total: 0, unread_total: !signed || mode === 'empty' || mode === 'error' ? 0 : 3, has_more: false, next_cursor: null }, error: mode === 'error' ? '本地合成错误：会话读取失败' : null }
}
