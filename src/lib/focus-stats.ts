/**
 * 番茄专注 · 每日时长统计（本地持久化）
 * 供 StudyFocusPage 的可视化图表消费。
 */

import { currentFocusRepository, focusDayKey, notifyFocusStats, type FocusDay } from './focus-store'
export type { FocusDay } from './focus-store'

type Stats = Record<string, FocusDay>

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function read(): Stats {
  return currentFocusRepository().read().stats
}

/** yyyy-mm-dd（本地时区） */
export function dayKey(ts: number): string {
  return focusDayKey(ts)
}

/** 记入一次专注时长（分钟） */
export function addFocusMinutes(minutes: number, at: number = Date.now()) {
  currentFocusRepository().add(minutes, at)
  notifyFocusStats()
}

export function readStats(): Stats {
  return read()
}

export type DayPoint = {
  key: string
  date: Date
  /** 月-日，如 9-29 */
  label: string
  weekday: string
  minutes: number
  sessions: number
  isToday: boolean
}

/** 最近 n 天（含今天）的数据点，缺失补 0 */
export function lastDays(n: number, at: number = Date.now()): DayPoint[] {
  const s = read()
  const today = new Date(at)
  today.setHours(0, 0, 0, 0)
  const out: DayPoint[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const k = dayKey(d.getTime())
    const v = s[k]
    out.push({
      key: k,
      date: d,
      label: `${d.getMonth() + 1}-${d.getDate()}`,
      weekday: WEEKDAYS[d.getDay()],
      minutes: v?.minutes || 0,
      sessions: v?.sessions || 0,
      isToday: i === 0,
    })
  }
  return out
}

export function todayMinutes(at: number = Date.now()): number {
  return read()[dayKey(at)]?.minutes || 0
}

/** 连续达标天数（当天有专注即算达标，今天未专注则从昨天往前算） */
export function streakDays(at: number = Date.now()): number {
  const s = read()
  const today = new Date(at)
  today.setHours(0, 0, 0, 0)
  if (!s[dayKey(today.getTime())]?.minutes) today.setDate(today.getDate() - 1)
  let n = 0
  while (s[dayKey(today.getTime())]?.minutes > 0) {
    n++
    today.setDate(today.getDate() - 1)
  }
  return n
}

export function totalStats(): { minutes: number; sessions: number; days: number } {
  const s = read()
  let minutes = 0
  let sessions = 0
  let days = 0
  for (const k of Object.keys(s)) {
    const v = s[k]
    if (!v?.minutes) continue
    minutes += v.minutes
    sessions += v.sessions || 0
    days++
  }
  return { minutes, sessions, days }
}

export function clearStats() {
  currentFocusRepository().clearStats()
  notifyFocusStats()
}

/** 把分钟数格式化成「1 小时 25 分」 */
export function fmtDuration(min: number): string {
  const m = Math.max(0, Math.round(min))
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h} 小时 ${r} 分` : `${h} 小时`
}
