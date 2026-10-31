import type { TtRow } from './timetable'
import type { PeriodPair } from './schedule-prefs'
import { cbRdb } from './cb'
import { captureQbankSession, isQbankSessionCurrent } from './qbank'

export type ShareVisibility = 'full' | 'busy'

export type SharedSchedule = {
  id: string
  code: string
  ownerUid: string
  defaultName: string
  localName: string
  visibility: ShareVisibility
  rows: TtRow[]
  termStart: string
  updatedAt: string
  revoked: boolean
  mine: boolean
}

export type FreeSlot = {
  day: number
  startSection: number
  endSection: number
  sectionLabel: string
  timeLabel: string
}

type Any = any

function errorText(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value && 'message' in value) return String((value as { message?: unknown }).message || '')
  return String(value)
}

function normalizeRows(value: unknown): TtRow[] {
  if (!Array.isArray(value)) return []
  return value.filter((row): row is TtRow => !!row && typeof row === 'object'
    && Number.isInteger(Number((row as TtRow).week)) && Number((row as TtRow).week) > 0
    && Number.isInteger(Number((row as TtRow).day)) && Number((row as TtRow).day) >= 1 && Number((row as TtRow).day) <= 7
    && Array.isArray((row as TtRow).sections) && (row as TtRow).sections.length > 0
    && typeof (row as TtRow).name === 'string')
}

function normalizeShare(row: Any): SharedSchedule {
  return {
    id: String(row.id || row.share_id || ''),
    code: String(row.code || ''),
    ownerUid: String(row.owner_uid || ''),
    defaultName: String(row.default_name || '同学课表'),
    localName: String(row.local_name || row.default_name || '同学课表'),
    visibility: row.visibility === 'busy' ? 'busy' : 'full',
    rows: normalizeRows(row.rows),
    termStart: String(row.term_start || ''),
    updatedAt: String(row.updated_at || ''),
    revoked: row.revoked === true,
    mine: row.mine === true,
  }
}

async function rpc(name: string, params: Record<string, unknown> = {}): Promise<Any[]> {
  const session = captureQbankSession()
  if (!session.uid) throw new Error('请先登录哦狐账号')
  const response: Any = await (cbRdb() as Any).rpc(name, params)
  if (!isQbankSessionCurrent(session)) throw new Error('账号已切换，请重新操作')
  if (response?.error) throw new Error(errorText(response.error) || '多人课表服务暂不可用')
  return Array.isArray(response?.data) ? response.data : response?.data ? [response.data] : []
}

export async function publishScheduleShare(input: {
  defaultName: string
  visibility: ShareVisibility
  rows: TtRow[]
  termStart: string
}): Promise<SharedSchedule> {
  if (!input.defaultName.trim()) throw new Error('请填写课表名称')
  if (!input.rows.length) throw new Error('当前没有可分享的课程')
  // Busy-only shares should never send course names, locations, or teachers to the RPC.
  const sharedRows = input.visibility === 'busy'
    ? input.rows.map((row) => ({ week: row.week, day: row.day, sections: [...row.sections], name: '课程', room: '', teacher: '' }))
    : input.rows
  const rows = await rpc('schedule_share_publish', {
    p_default_name: input.defaultName.trim().slice(0, 30),
    p_visibility: input.visibility,
    p_rows: sharedRows,
    p_term_start: input.termStart,
  })
  if (!rows[0]) throw new Error('分享码生成失败，请重试')
  return normalizeShare(rows[0])
}

export async function importScheduleShare(code: string): Promise<SharedSchedule> {
  const normalized = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (normalized.length < 6) throw new Error('请输入完整分享码')
  const rows = await rpc('schedule_share_import', { p_code: normalized })
  if (!rows[0]) throw new Error('分享码不存在或已撤销')
  return normalizeShare(rows[0])
}

export async function listScheduleShares(): Promise<SharedSchedule[]> {
  return (await rpc('schedule_share_list')).map(normalizeShare).filter((item) => item.id && !item.revoked)
}

export async function renameImportedSchedule(shareId: string, localName: string): Promise<void> {
  if (!localName.trim()) throw new Error('名称不能为空')
  await rpc('schedule_share_rename', { p_share_id: shareId, p_local_name: localName.trim().slice(0, 30) })
}

export async function removeImportedSchedule(shareId: string): Promise<void> {
  await rpc('schedule_share_remove', { p_share_id: shareId })
}

export async function revokeScheduleShare(shareId: string): Promise<void> {
  await rpc('schedule_share_revoke', { p_share_id: shareId })
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
  addRows(input.ownRows, teachingWeekAt(date, input.ownTermStart), null)
  for (const item of input.otherSchedules) addRows(item.rows, teachingWeekAt(date, item.termStart), weekday)

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
