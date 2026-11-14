import type { TtRow } from './timetable'
import type { PeriodPair } from './schedule-prefs'
export type ShareVisibility = 'full' | 'busy'

type ScheduleShare = {
  defaultName: string
  visibility: ShareVisibility
  rows: TtRow[]
  termStart: string
}

export type SharedSchedule = ScheduleShare & {
  id: string
  localName: string
}

export type FreeSlot = {
  day: number
  startSection: number
  endSection: number
  sectionLabel: string
  timeLabel: string
}

const SHARE_SCHEMA = 'ohu.schedule-share'
export const MAX_SCHEDULE_SHARE_LENGTH = 256_000
const MAX_ROWS = 1500
const MAX_IMPORTS = 20

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function isWhole(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function scheduleName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 30) throw new Error('课表名称须为 1 到 30 个字符')
  return value.trim()
}

function readShare(value: unknown): ScheduleShare {
  const data = asRecord(value)
  const { visibility, termStart, rows } = data
  if (visibility !== 'busy' && visibility !== 'full') throw new Error('课表分享范围不正确')
  if (typeof termStart !== 'string' || !validDateKey(termStart)) throw new Error('课表缺少有效的学期起始日期')
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS) throw new Error('课表的课程数量不正确')
  return {
    defaultName: scheduleName(data.defaultName),
    visibility,
    termStart,
    rows: rows.map(value => {
      const row = asRecord(value)
      const { week, day, sections, name, room, teacher } = row
      if (!isWhole(week, 1, 60) || !isWhole(day, 1, 7) || !Array.isArray(sections) || !sections.length
        || sections.length > 14 || !sections.every(section => isWhole(section, 1, 14))) {
        throw new Error('课表含有无效周次、星期或节次')
      }
      const position = { week, day, sections: [...new Set<number>(sections)].sort((a, b) => a - b) }
      if (visibility === 'busy') return { ...position, name: '课程', room: '', teacher: '' }
      if (typeof name !== 'string' || !name.trim() || name.length > 200 || typeof room !== 'string'
        || room.length > 200 || typeof teacher !== 'string' || teacher.length > 200) {
        throw new Error('课表含有无效的课程名称、教室或教师')
      }
      return { ...position, name, room, teacher }
    }),
  }
}

export function encodeScheduleShare(share: ScheduleShare): string {
  const text = JSON.stringify({ schema: SHARE_SCHEMA, version: 1, ...readShare(share) })
  if (text.length > MAX_SCHEDULE_SHARE_LENGTH) throw new Error('课表文本太长，请使用忙闲模式')
  return text
}

export function decodeScheduleShare(text: string): ScheduleShare {
  if (text.length > MAX_SCHEDULE_SHARE_LENGTH) throw new Error('课表文本太长')
  let value: unknown
  try { value = JSON.parse(text) }
  catch { throw new Error('请粘贴同学从哦狐复制的完整课表文本') }
  const data = asRecord(value)
  if (data.schema !== SHARE_SCHEMA || data.version !== 1) throw new Error('无法识别这个课表文本版本')
  return readShare(data)
}

function storeKey(uid: string): string {
  return 'ohu.schedule-group.local.v1:' + JSON.stringify(uid)
}

export function readLocalScheduleShares(uid: string): SharedSchedule[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(storeKey(uid)) ?? '[]')
    if (!Array.isArray(data) || data.length > MAX_IMPORTS) throw new Error()
    const ids = new Set<string>()
    return data.map(value => {
      const item = asRecord(value)
      if (typeof item.id !== 'string' || (!/^\d+$/.test(item.id) || !Number.isSafeInteger(Number(item.id))) || ids.has(item.id)) throw new Error()
      ids.add(item.id)
      return { ...readShare(item), id: item.id, localName: scheduleName(item.localName) }
    })
  } catch {
    throw new Error('暂时无法读取本机课表，请保留设备数据后重试')
  }
}

function saveLocalScheduleShares(uid: string, items: SharedSchedule[]) {
  try { localStorage.setItem(storeKey(uid), JSON.stringify(items)) }
  catch { throw new Error('本机无法保存课表，请检查存储空间后重试') }
}

export function importLocalScheduleShare(uid: string, text: string) {
  const share = decodeScheduleShare(text)
  const items = readLocalScheduleShares(uid)
  const formatted = encodeScheduleShare(share)
  const existing = items.find(item => encodeScheduleShare(item) === formatted)
  if (existing) return { items, active: existing, duplicate: true }
  if (items.length >= MAX_IMPORTS) throw new Error('本机最多保留 20 份课表，请先移除一份')
  const id = String(Math.max(0, ...items.map(item => Number(item.id))) + 1)
  const active = { ...share, id, localName: share.defaultName }
  const next = [active, ...items]
  saveLocalScheduleShares(uid, next)
  return { items: next, active, duplicate: false }
}

export function renameLocalScheduleShare(uid: string, id: string, name: string): SharedSchedule[] {
  const localName = scheduleName(name)
  const next = readLocalScheduleShares(uid).map(item => item.id === id ? { ...item, localName } : item)
  saveLocalScheduleShares(uid, next)
  return next
}

export function removeLocalScheduleShare(uid: string, id: string): SharedSchedule[] {
  const next = readLocalScheduleShares(uid).filter(item => item.id !== id)
  saveLocalScheduleShares(uid, next)
  return next
}

function clock(pair: PeriodPair | undefined, side: 0 | 1, fallback: string): string {
  const value = pair?.[side]
  return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value) ? value : fallback
}

/** Calculate common free teaching periods for two or more selected schedules. */
export function commonFreeSlots(schedules: Array<Pick<SharedSchedule, 'rows'>>, week: number, periods: PeriodPair[], maxSection = 11): FreeSlot[] {
  if (schedules.length < 2 || !Number.isInteger(week) || week < 1) return []
  const busy = Array.from({ length: 7 }, () => new Set<number>())
  for (const schedule of schedules) for (const row of schedule.rows) {
    if (Number(row.week) !== week || row.day < 1 || row.day > 7) continue
    for (const section of row.sections) if (Number.isInteger(Number(section)) && section >= 1 && section <= maxSection) busy[row.day - 1]!.add(Number(section))
  }
  const result: FreeSlot[] = []
  for (let day = 1; day <= 7; day++) {
    let start = 0
    const flush = (end: number) => {
      if (!start || end < start) return
      result.push({
        day,
        startSection: start,
        endSection: end,
        sectionLabel: start === end ? `第 ${start} 节` : `第 ${start}–${end} 节`,
        timeLabel: `${clock(periods[start - 1], 0, '--:--')}–${clock(periods[end - 1], 1, '--:--')}`,
      })
      start = 0
    }
    for (let section = 1; section <= maxSection; section++) {
      if (!busy[day - 1]!.has(section)) start ||= section
      else flush(section - 1)
    }
    flush(maxSection)
  }
  return result
}

function validDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(year, month - 1, day, 12)
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
}

function teachingWeekAt(date: Date, termStart: string): number {
  if (!validDateKey(termStart)) return 0
  const [year, month, day] = termStart.split('-').map(Number)
  const start = new Date(year, month - 1, day, 12)
  const monday = new Date(start)
  monday.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  const actual = new Date(date)
  actual.setHours(12, 0, 0, 0)
  const utcDate = Date.UTC(actual.getFullYear(), actual.getMonth(), actual.getDate())
  const utcMonday = Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate())
  return actual < start ? 0 : Math.floor((utcDate - utcMonday) / (7 * 86_400_000)) + 1
}

/** Calculate the shared section gaps for an actual date; each imported timetable uses its own term start. */
export function commonFreeSlotsForDate(input: {
  date: string
  ownRows: TtRow[]
  ownLastWeek?: number
  ownTermStart: string
  otherSchedules: Array<Pick<SharedSchedule, 'rows' | 'termStart'>>
  periods: PeriodPair[]
  maxSection?: number
}): FreeSlot[] {
  if (!validDateKey(input.date)) throw new Error('请选择有效日期')
  if (!validDateKey(input.ownTermStart) || input.otherSchedules.some((item) => !validDateKey(item.termStart))) {
    throw new Error('有课表缺少有效的学期起始日期，暂时无法按真实日期计算')
  }
  if (!input.otherSchedules.length) return []
  const [year, month, day] = input.date.split('-').map(Number)
  const date = new Date(year, month - 1, day, 12)
  const ownWeek = teachingWeekAt(date, input.ownTermStart)
  const others = input.otherSchedules.map(item => ({ item, week: teachingWeekAt(date, item.termStart) }))
  if (input.ownLastWeek && (!ownWeek || ownWeek > input.ownLastWeek)
    || others.some(({ item, week }) => !week || week > Math.max(0, ...item.rows.map(row => row.week)))) {
    throw new Error('所选日期超出至少一份课表的已知周次，请换个日期。')
  }
  const weekday = ((date.getDay() + 6) % 7) + 1
  const maxSection = Math.min(14, Math.max(1, input.maxSection || 11))
  const busy = new Set<number>()
  const addRows = (rows: TtRow[], week: number, dayFilter: number | null) => {
    if (!week) return
    for (const row of rows) {
      if (Number(row.week) !== week || (dayFilter !== null && Number(row.day) !== dayFilter) || !Array.isArray(row.sections)) continue
      for (const section of row.sections) {
        const value = Number(section)
        if (Number.isInteger(value) && value >= 1 && value <= maxSection) busy.add(value)
      }
    }
  }
  // The caller has already projected this account's school holidays and one-day changes.
  addRows(input.ownRows, ownWeek, null)
  for (const { item, week } of others) addRows(item.rows, week, weekday)

  const result: FreeSlot[] = []
  let start = 0
  const flush = (end: number) => {
    if (!start || end < start) return
    result.push({
      day: weekday,
      startSection: start,
      endSection: end,
      sectionLabel: start === end ? `第 ${start} 节` : `第 ${start}–${end} 节`,
      timeLabel: `${clock(input.periods[start - 1], 0, '--:--')}–${clock(input.periods[end - 1], 1, '--:--')}`,
    })
    start = 0
  }
  for (let section = 1; section <= maxSection; section++) {
    if (!busy.has(section)) start ||= section
    else flush(section - 1)
  }
  flush(maxSection)
  return result
}
