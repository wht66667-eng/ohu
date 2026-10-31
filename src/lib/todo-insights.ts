/**
 * 待办模块的数据看板（量力的「番茄钟 + 数据看板」接到待办里）
 *
 * 两块数据，来源不同但都不新增表：
 *   - 完成趋势：todos.done_at 落在本机的哪一天（近 n 天）
 *   - 专注趋势：focus-stats 的本地专注台账（近 n 天分钟数 / 次数）
 * 全部是纯函数（除 focus 读取外），方便 tools/*.test.mjs 直接断言。
 */
import { lastDays, streakDays, todayMinutes, type DayPoint } from './focus-stats'

export interface DoneRowLike {
  done?: boolean
  done_at?: string | null
}

export interface TrendPoint {
  key: string
  /** 月-日，如 9-29 */
  label: string
  weekday: string
  isToday: boolean
  done: number
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

export function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/** 近 n 天（含今天）的完成数，缺失补 0 */
export function doneTrend(rows: DoneRowLike[], n = 7, now = Date.now()): TrendPoint[] {
  const buckets = new Map<string, number>()
  for (const r of rows) {
    if (!r.done || !r.done_at) continue
    const t = new Date(r.done_at).getTime()
    if (!Number.isFinite(t)) continue
    const k = dayKeyOf(new Date(t))
    buckets.set(k, (buckets.get(k) || 0) + 1)
  }
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const out: TrendPoint[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const k = dayKeyOf(d)
    out.push({
      key: k,
      label: `${d.getMonth() + 1}-${d.getDate()}`,
      weekday: WEEKDAYS[d.getDay()],
      isToday: i === 0,
      done: buckets.get(k) || 0,
    })
  }
  return out
}

export interface BoardSummary {
  focus: DayPoint[]
  done: TrendPoint[]
  focusToday: number
  focusWeek: number
  streak: number
  doneToday: number
  doneWeek: number
  /** 近 7 天里完成最多的一天做了几件，用于给柱状图定标尺 */
  doneBest: number
  focusBest: number
}

export function buildBoard(rows: DoneRowLike[], n = 7, now = Date.now()): BoardSummary {
  const focus = lastDays(n, now)
  const done = doneTrend(rows, n, now)
  return {
    focus,
    done,
    focusToday: todayMinutes(now),
    focusWeek: focus.reduce((s, d) => s + (d.minutes || 0), 0),
    streak: streakDays(now),
    doneToday: done[done.length - 1]?.done || 0,
    doneWeek: done.reduce((s, d) => s + d.done, 0),
    doneBest: done.reduce((m, d) => Math.max(m, d.done), 0),
    focusBest: focus.reduce((m, d) => Math.max(m, d.minutes), 0),
  }
}

/** 柱状图高度百分比（0-100），最大值不足 1 时给个最小可见高度 */
export function barPct(value: number, best: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  const top = Math.max(1, best || 1)
  return Math.max(8, Math.min(100, Math.round((value / top) * 100)))
}
