/**
 * 课表本地缓存（借鉴酱海带：首页下一节课 / 今日时间轴依赖本地快照）。
 * 按 App 身份存课程行与学号，不存教务密码。旧版无归属快照保留但不自动认领。
 */
import type { TtRow } from './timetable'
import { DEFAULT_TM, loadLocalPeriods, toMin, type PeriodPair } from './schedule-prefs'
import { calendarDayIdx, effectiveDayForDate, getDayStatus, listCourseDateExceptions, toDateKey } from './schedule-calendar'
import { captureQbankSession, isQbankSessionCurrent } from './qbank'

/** 与 ScheduleHome 学期起点对齐 */
export const SCHEDULE_TERM_START = '2026-08-31'
export const SCHEDULE_CACHE_EVENT = 'ohhu-schedule-cache'
const TERM_START_KEY = 'schedule.term-start.v1:'

function termStartKey(uid = captureQbankSession().uid) {
  return `${TERM_START_KEY}${uid ? `uid:${encodeURIComponent(uid)}` : 'guest'}`
}

function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00`)
  return Number.isFinite(date.getTime()) && toDateKey(date) === value
}

/** Account-local academic term start; the built-in date is only a fallback. */
export function getScheduleTermStart(uid = captureQbankSession().uid): string {
  try {
    const value = localStorage.getItem(termStartKey(uid)) || ''
    return isDateKey(value) ? value : SCHEDULE_TERM_START
  } catch {
    return SCHEDULE_TERM_START
  }
}

/** Save the explicit term start and notify every date-derived course consumer. */
export function saveScheduleTermStart(value: string): boolean {
  const session = captureQbankSession()
  if (!isDateKey(value) || !isQbankSessionCurrent(session)) return false
  try {
    const key = termStartKey(session.uid)
    localStorage.setItem(key, value)
    if (localStorage.getItem(key) !== value || !isQbankSessionCurrent(session)) return false
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(SCHEDULE_CACHE_EVENT))
    return true
  } catch {
    return false
  }
}

export type ScheduleCacheMeta = {
  stuid: string
  savedAt: string
  termStart: string
  /** Absent only in legacy snapshots; never inferred from the first signed-in user. */
  ownerUid?: string
  /** Photo/AI imports are user-confirmed local schedules, not registrar records. */
  source?: 'official' | 'photo'
  /** True only when a successful school response explicitly returned no courses. */
  confirmedEmpty?: boolean
}

export type ScheduleSnapshot = { rows: TtRow[]; meta: ScheduleCacheMeta | null }
export type ScheduleSnapshotStatus = 'ready' | 'unbound' | 'missing' | 'invalid' | 'owner-unverified' | 'owner-mismatch' | 'term-mismatch' | 'before-term' | 'outside-coverage'
export type ValidatedScheduleSnapshot = ScheduleSnapshot & { status: ScheduleSnapshotStatus }

/** One user-facing explanation shared by Home, the schedule view, and reminder diagnostics. */
export function describeScheduleSnapshotStatus(status: ScheduleSnapshotStatus): { title: string; detail: string } | null {
  switch (status) {
    case 'ready': return null
    case 'unbound': return { title: '绑定课表，安排更清楚', detail: '绑定校园账号并同步课程，即可查看上课时间和教室。' }
    case 'missing': return { title: '课表还未同步', detail: '同步后，在这里查看下一节课。' }
    case 'invalid': return { title: '课表需要重新同步', detail: '本机课表暂时无法读取；原有数据仍保留，请到课表页重新同步。' }
    case 'owner-unverified': return { title: '课表需要重新同步', detail: '旧课表尚未确认归属，请在当前 App 账号下重新同步。' }
    case 'owner-mismatch': return { title: '课表需要重新同步', detail: '已存课表属于其他账号，请同步当前账号的课表。' }
    case 'term-mismatch': return { title: '课表学期需要核对', detail: '本机仍保留旧课表，但学期起点与当前设置不一致；首页不展示这份数据，上课提醒暂停，请核对学期后重新同步。' }
    case 'before-term': return { title: '当前学期尚未开始', detail: '本机课表仍保留；学期开始前不会用于首页和上课提醒。' }
    case 'outside-coverage': return { title: '课表周次需要核对', detail: '本机课表仍保留，但当前周次超出已同步课程范围；首页不展示这份数据，上课提醒暂停，请核对后重新同步。' }
  }
}

/** A synced, account-owned snapshot remains usable when the student chose not to remember their number. */
export function scheduleStudentIdForSnapshot(snapshot: ScheduleSnapshot, savedStuid: string, currentOwnerUid: string): string {
  if (snapshot.meta?.source === 'photo') return ''
  const saved = normalizeStudentId(savedStuid)
  if (saved) return saved
  if (!currentOwnerUid || snapshot.meta?.ownerUid !== currentOwnerUid) return ''
  return typeof snapshot.meta.stuid === 'string' ? normalizeStudentId(snapshot.meta.stuid) : ''
}

function normalizeStudentId(value: string): string {
  return value.trim().normalize('NFKC')
}

/** Validate the known term and returned week coverage; no invented cache-age TTL. */
export function validateScheduleSnapshot(
  snapshot: ScheduleSnapshot,
  boundStuid: string,
  now = new Date(),
  expectedTermStart = getScheduleTermStart(),
  currentOwnerUid = captureQbankSession().uid,
): ValidatedScheduleSnapshot {
  const reject = (status: ScheduleSnapshotStatus): ValidatedScheduleSnapshot => ({ status, rows: [], meta: null })
  const meta = snapshot.meta
  if (!meta) return reject('missing')
  if (typeof meta.stuid !== 'string' || typeof meta.termStart !== 'string' || typeof meta.savedAt !== 'string' || !Number.isFinite(Date.parse(meta.savedAt))) return reject('invalid')
  if (meta.ownerUid === undefined) return reject('owner-unverified')
  if (typeof meta.ownerUid !== 'string') return reject('invalid')
  if (meta.ownerUid !== currentOwnerUid) return reject('owner-mismatch')
  if (meta.source !== 'photo') {
    const owner = normalizeStudentId(boundStuid)
    if (!owner) return reject('unbound')
    if (normalizeStudentId(meta.stuid) !== owner) return reject('owner-mismatch')
  }
  if (meta.termStart !== expectedTermStart) return reject('term-mismatch')
  const termStart = new Date(`${meta.termStart}T00:00:00`)
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(termStart.getTime()) || toDateKey(termStart) !== meta.termStart) return reject('invalid')
  if (now < termStart) return reject('before-term')
  if (!Array.isArray(snapshot.rows) || snapshot.rows.some((row) => !row || !Number.isInteger(Number(row.week)) || Number(row.week) < 1 || !Number.isInteger(Number(row.day)) || Number(row.day) < 1 || Number(row.day) > 7 || typeof row.name !== 'string' || !row.name.trim() || (row.room != null && typeof row.room !== 'string') || (row.teacher != null && typeof row.teacher !== 'string') || !Array.isArray(row.sections) || !row.sections.length || row.sections.some((section) => !Number.isInteger(Number(section)) || Number(section) < 1 || Number(section) > 11))) return reject('invalid')
  // A legacy/partial empty record is not proof. Only a successful sync may set
  // confirmedEmpty, which prevents stale courses and their reminders returning.
  if (!snapshot.rows.length) {
    if (meta.confirmedEmpty !== true) return reject('missing')
    return { status: 'ready', rows: [], meta }
  }
  const lastCoveredWeek = snapshot.rows.reduce((last, row) => Math.max(last, Number(row.week)), 0)
  // The last returned course week is coverage, not proof of the official term end.
  if (lastCoveredWeek > 0 && teachingWeekForDate(now, meta.termStart) > lastCoveredWeek) return reject('outside-coverage')
  return { status: 'ready', rows: snapshot.rows, meta }
}

function announceScheduleCache() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SCHEDULE_CACHE_EVENT))
}

export type NextClassInfo = {
  name: string
  room: string
  teacher: string
  week: number
  day: number
  start: number
  end: number
  timeLabel: string
  status: 'now' | 'soon' | 'done' | 'empty' | 'holiday'
  hint: string
}

export function guessTeachingWeek(termStart = getScheduleTermStart()): number {
  return teachingWeekForDate(new Date(), termStart)
}

/** 某一天所在教学周（以包含真实开学日的周一为第一周起点） */
export function teachingWeekForDate(date: Date, termStart = getScheduleTermStart()): number {
  const start = new Date(`${termStart}T00:00:00`)
  const day = new Date(date)
  day.setHours(0, 0, 0, 0)
  // Teaching weeks always run Monday–Sunday; the actual term start may fall midweek.
  const startMonday = new Date(start)
  startMonday.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  const dayNumber = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate())
  const startNumber = Date.UTC(startMonday.getFullYear(), startMonday.getMonth(), startMonday.getDate())
  const diff = Math.floor((dayNumber - startNumber) / (7 * 86400_000)) + 1
  return Math.max(1, diff)
}

export function todayDayIdx(): number {
  return ((new Date().getDay() + 6) % 7) + 1
}

function snapshotKey(uid: string): string {
  return uid ? `schedule.v2:uid:${encodeURIComponent(uid)}:snapshot` : 'schedule.v2:guest:snapshot'
}
function photoBackupKey(uid: string): string {
  return uid ? `schedule.v2:uid:${encodeURIComponent(uid)}:photo-backup` : 'schedule.v2:guest:photo-backup'
}

/** A network caller must pass the session captured before its request. */
export function saveScheduleCache(rows: TtRow[], stuid: string, session = captureQbankSession()): boolean {
  if (!isQbankSessionCurrent(session)) return false
  try {
    const meta: ScheduleCacheMeta = {
      stuid,
      savedAt: new Date().toISOString(),
      termStart: getScheduleTermStart(session.uid),
      ownerUid: session.uid,
      source: 'official',
      ...(rows.length ? {} : { confirmedEmpty: true }),
    }
    // One write keeps rows and ownership together, even if storage is full.
    const key = snapshotKey(session.uid)
    const encoded = JSON.stringify({ rows, meta } satisfies ScheduleSnapshot)
    localStorage.setItem(key, encoded)
    if (localStorage.getItem(key) !== encoded) return false
    localStorage.removeItem(photoBackupKey(session.uid))
    announceScheduleCache()
    return true
  } catch {
    return false
  }
}

/** Save a reviewed photo timetable, keeping the previous schedule recoverable. */
export function savePhotoScheduleCache(rows: TtRow[], termStart: string, session = captureQbankSession()): boolean {
  if (!isQbankSessionCurrent(session) || !isDateKey(termStart) || !rows.length || rows.length > 300) return false
  if (rows.some(row => !row || !Number.isInteger(Number(row.week)) || Number(row.week) < 1 || Number(row.week) > 30
    || !Number.isInteger(Number(row.day)) || Number(row.day) < 1 || Number(row.day) > 7
    || typeof row.name !== 'string' || !row.name.trim() || row.name.trim().length > 80
    || !Array.isArray(row.sections) || !row.sections.length || row.sections.length > 11
    || row.sections.some(section => !Number.isInteger(Number(section)) || Number(section) < 1 || Number(section) > 11))) return false
  const activeKey = snapshotKey(session.uid)
  const backupKey = photoBackupKey(session.uid)
  const termKey = termStartKey(session.uid)
  let previousTerm: string | null = null
  let previousSnapshot: string | null = null
  try {
    const current = localStorage.getItem(activeKey)
    previousSnapshot = current
    previousTerm = localStorage.getItem(termKey)
    if (current && !localStorage.getItem(backupKey)) localStorage.setItem(backupKey, current)
    const meta: ScheduleCacheMeta = { stuid: '', savedAt: new Date().toISOString(), termStart, ownerUid: session.uid, source: 'photo' }
    const encoded = JSON.stringify({ rows, meta } satisfies ScheduleSnapshot)
    localStorage.setItem(termKey, termStart)
    localStorage.setItem(activeKey, encoded)
    if (localStorage.getItem(activeKey) !== encoded || !isQbankSessionCurrent(session)) throw new Error('schedule import write failed')
    announceScheduleCache()
    return true
  } catch {
    try {
      if (previousSnapshot) localStorage.setItem(activeKey, previousSnapshot)
      else localStorage.removeItem(activeKey)
      if (previousTerm) localStorage.setItem(termKey, previousTerm)
      else localStorage.removeItem(termKey)
    } catch { /* Keep recovery best-effort; no source image is persisted. */ }
    return false
  }
}

export function restoreScheduleBeforePhoto(session = captureQbankSession()): boolean {
  if (!isQbankSessionCurrent(session)) return false
  try {
    const key = snapshotKey(session.uid)
    const backupKey = photoBackupKey(session.uid)
    const backup = localStorage.getItem(backupKey)
    if (!backup) return false
    const parsed = JSON.parse(backup) as ScheduleSnapshot
    if (parsed?.meta?.ownerUid !== session.uid || parsed.meta.source === 'photo') return false
    localStorage.setItem(key, backup)
    if (localStorage.getItem(key) !== backup || !isQbankSessionCurrent(session)) return false
    if (parsed.meta.termStart && isDateKey(parsed.meta.termStart)) localStorage.setItem(termStartKey(session.uid), parsed.meta.termStart)
    localStorage.removeItem(backupKey)
    announceScheduleCache()
    return true
  } catch { return false }
}

export function hasScheduleBeforePhoto(session = captureQbankSession()): boolean {
  try { return Boolean(localStorage.getItem(photoBackupKey(session.uid))) } catch { return false }
}

export function loadScheduleCache(): ScheduleSnapshot {
  try {
    const uid = captureQbankSession().uid
    const snapshot = JSON.parse(localStorage.getItem(snapshotKey(uid)) || 'null') as ScheduleSnapshot | null
    const rows = snapshot?.rows
    const meta = snapshot?.meta
    // Legacy global keys remain untouched. A matching saved student number alone
    // does not prove that an App account owns those courses.
    if (!Array.isArray(rows) || !meta || typeof meta.ownerUid !== 'string' || meta.ownerUid !== uid) return { rows: [], meta: null }
    return { rows, meta }
  } catch {
    return { rows: [], meta: null }
  }
}

export function clearScheduleCache() {
  try {
    const uid = captureQbankSession().uid
    localStorage.removeItem(snapshotKey(uid))
    localStorage.removeItem(photoBackupKey(uid))
    announceScheduleCache()
    return true
  } catch {
    return false
  }
}

type Block = {
  name: string
  room: string
  teacher: string
  week: number
  day: number
  start: number
  end: number
}

function mergeDayBlocks(rows: TtRow[], week: number, day: number): Block[] {
  const list = rows
    .filter((r) => Number(r.week) === week && Number(r.day) === day)
    .map((r) => {
      const secs =
        Array.isArray(r.sections) && r.sections.length
          ? r.sections.map(Number).filter((n) => n >= 1 && n <= 11)
          : [1]
      const start = Math.min(...secs)
      const end = Math.max(...secs)
      return {
        name: r.name,
        room: r.room || '',
        teacher: r.teacher || '',
        week,
        day,
        start,
        end,
      }
    })
  list.sort((a, b) => a.start - b.start || a.name.localeCompare(b.name))
  const out: Block[] = []
  for (const b of list) {
    const last = out[out.length - 1]
    if (last && last.name === b.name && b.start <= last.end + 1) {
      last.end = Math.max(last.end, b.end)
      if (!last.room && b.room) last.room = b.room
    } else out.push({ ...b })
  }
  return out
}

/** Resolve recurring timetable rows plus account-local one-day exceptions for one calendar date. */
export function getScheduleRowsForDate(date: Date, rows?: TtRow[], termStart = getScheduleTermStart()): TtRow[] {
  const data = rows ?? loadScheduleCache().rows
  const actualStart = new Date(`${termStart}T00:00:00`)
  const calendarDate = new Date(date)
  calendarDate.setHours(0, 0, 0, 0)
  if (calendarDate < actualStart) return []
  const status = getDayStatus(date)
  const week = teachingWeekForDate(date, termStart)
  const base = status.off ? [] : data.filter((row) => Number(row.week) === week && Number(row.day) === status.effectiveDay).map((row) => ({
    ...row,
    sections: [...row.sections],
  }))
  const exceptions = listCourseDateExceptions(toDateKey(date))
  const matchesTarget = (row: TtRow, exception: (typeof exceptions)[number]) => {
    if ((row.name || '').trim().toLocaleLowerCase() !== (exception.targetName || '').trim().toLocaleLowerCase()) return false
    const target = exception.targetSections || []
    return !target.length || row.sections.some((section) => target.includes(Number(section)))
  }
  const removeTargetSections = (rows: TtRow[], exception: (typeof exceptions)[number]) => rows.flatMap((row) => {
    if (!matchesTarget(row, exception)) return [row]
    const target = exception.targetSections || []
    if (!target.length) return []
    const remaining = row.sections.filter((section) => !target.includes(Number(section)))
    return remaining.length ? [{ ...row, sections: remaining }] : []
  })
  let projected = base
  for (const exception of exceptions) {
    if (exception.kind === 'cancel') projected = removeTargetSections(projected, exception)
    if (exception.kind === 'replace') {
      projected = removeTargetSections(projected, exception)
      projected.push({ week, day: status.off ? calendarDayIdx(date) : status.effectiveDay, sections: exception.sections, name: exception.name, room: exception.room, teacher: exception.teacher })
    }
    if (exception.kind === 'add') {
      projected.push({ week, day: status.off ? calendarDayIdx(date) : status.effectiveDay, sections: exception.sections, name: exception.name, room: exception.room, teacher: exception.teacher })
    }
  }
  return projected
}

function sectionTime(tm: PeriodPair[], start: number, end: number): string {
  const s = tm[Math.max(0, start - 1)] || tm[0]
  const e = tm[Math.max(0, end - 1)] || s
  return `${s[0]}-${e[1]}`
}

/** 首页「下一节课」（已识别法定假 / 调课） */
export function getNextClass(rows?: TtRow[]): NextClassInfo {
  const data = rows ?? loadScheduleCache().rows
  const tm = loadLocalPeriods(new Date()) || DEFAULT_TM
  const week = guessTeachingWeek()
  const calDay = todayDayIdx()
  const dayStatus = getDayStatus(new Date())
  const todayRows = getScheduleRowsForDate(new Date(), data)
  if (!data.length && !todayRows.length) {
    return {
      name: '',
      room: '',
      teacher: '',
      week,
      day: calDay,
      start: 0,
      end: 0,
      timeLabel: '',
      status: 'empty',
      hint: '去课表页同步一次，首页就能显示下一节课',
    }
  }
  if (dayStatus.off && !todayRows.length) {
    return {
      name: '',
      room: '',
      teacher: '',
      week,
      day: calDay,
      start: 0,
      end: 0,
      timeLabel: '',
      status: 'holiday',
      hint: dayStatus.label || '今天放假，不用上课',
    }
  }
  const day = dayStatus.effectiveDay
  const blocks = mergeDayBlocks(todayRows, week, day)
  const now = new Date().getHours() * 60 + new Date().getMinutes()
  const makeupHint =
    dayStatus.kind === 'makeup' && day !== calDay ? `（${dayStatus.label || '调课'}）` : ''

  for (const b of blocks) {
    const startM = toMin((tm[b.start - 1] || tm[0])[0])
    const endM = toMin((tm[b.end - 1] || tm[0])[1])
    if (now >= startM && now <= endM) {
      return {
        ...b,
        timeLabel: sectionTime(tm, b.start, b.end),
        status: 'now',
        hint: `正在上课${makeupHint}`,
      }
    }
    if (now < startM) {
      const mins = startM - now
      return {
        ...b,
        timeLabel: sectionTime(tm, b.start, b.end),
        status: 'soon',
        hint:
          (mins < 60 ? `${mins} 分钟后开始` : `${Math.floor(mins / 60)} 小时后开始`) + makeupHint,
      }
    }
  }
  return {
    name: '',
    room: '',
    teacher: '',
    week,
    day,
    start: 0,
    end: 0,
    timeLabel: '',
    status: 'done',
    hint: blocks.length ? `今天的课已上完${makeupHint}` : dayStatus.kind === 'makeup' ? `今天调课但该日无课` : '今天没有课',
  }
}

export type DatedClass = {
  name: string
  room: string
  teacher: string
  startMin: number
  endMin: number
  timeLabel: string
}

/** 某一天实际要上的课（放假为空；调课日按 effectiveDay）。供系统闹钟预排。 */
export function classesOnDate(date: Date, rows?: TtRow[]): DatedClass[] {
  const data = rows ?? loadScheduleCache().rows
  const week = teachingWeekForDate(date)
  const tm = loadLocalPeriods(date) || DEFAULT_TM
  return mergeDayBlocks(getScheduleRowsForDate(date, data), week, effectiveDayForDate(date) ?? calendarDayIdx(date)).map((b) => ({
    name: b.name,
    room: b.room,
    teacher: b.teacher,
    startMin: toMin((tm[b.start - 1] || tm[0])[0]),
    endMin: toMin((tm[b.end - 1] || tm[0])[1]),
    timeLabel: sectionTime(tm, b.start, b.end),
  }))
}

/** 今日时间轴（首页简版；放假返回空） */
export function getTodayTimeline(rows?: TtRow[]): Array<Block & { timeLabel: string; state: 'past' | 'now' | 'future' }> {
  const data = rows ?? loadScheduleCache().rows
  const tm = loadLocalPeriods(new Date()) || DEFAULT_TM
  const week = guessTeachingWeek()
  const day = effectiveDayForDate(new Date()) ?? calendarDayIdx(new Date())
  const blocks = mergeDayBlocks(getScheduleRowsForDate(new Date(), data), week, day)
  const now = new Date().getHours() * 60 + new Date().getMinutes()
  return blocks.map((b) => {
    const startM = toMin((tm[b.start - 1] || tm[0])[0])
    const endM = toMin((tm[b.end - 1] || tm[0])[1])
    let state: 'past' | 'now' | 'future' = 'future'
    if (now > endM) state = 'past'
    else if (now >= startM) state = 'now'
    return { ...b, timeLabel: sectionTime(tm, b.start, b.end), state }
  })
}

/** 导出 ICS（跳过放假日；调课日按 effectiveDay 落课） */
export function buildScheduleIcs(rows: TtRow[], termStart = getScheduleTermStart()): string {
  const tm = loadLocalPeriods() || DEFAULT_TM
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SunshineCampus//Schedule//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ]
  const startMon = new Date(`${termStart}T00:00:00`)
  // align to Monday of term start week
  const dow = (startMon.getDay() + 6) % 7
  startMon.setDate(startMon.getDate() - dow)

  // Extend the export range to include explicitly saved one-off changes.
  const exceptionWeeks = listCourseDateExceptions().map((item) => teachingWeekForDate(new Date(`${item.date}T12:00:00`), termStart))
  const maxWeek = Math.max(rows.reduce((m, r) => Math.max(m, Number(r.week) || 1), 1), ...exceptionWeeks, 1)

  const stamp = formatIcsUtc(new Date())
  let uid = 0
  for (let w = 1; w <= maxWeek + 1; w++) {
    for (let cal = 1; cal <= 7; cal++) {
      const dayDate = new Date(startMon)
      dayDate.setDate(startMon.getDate() + (w - 1) * 7 + (cal - 1))
      const dayRows = getScheduleRowsForDate(dayDate, rows, termStart)
      for (const r of dayRows) {
        const secs = Array.isArray(r.sections) ? r.sections.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 11) : []
        if (!secs.length) continue
        const sSec = Math.min(...secs)
        const eSec = Math.max(...secs)
        const dayTm = loadLocalPeriods(dayDate) || tm
        const [sh, sm] = (dayTm[sSec - 1] || ['08:00', '08:45'])[0].split(':').map(Number)
        const [eh, em] = (dayTm[eSec - 1] || ['08:00', '08:45'])[1].split(':').map(Number)
        const dtStart = new Date(dayDate)
        dtStart.setHours(sh, sm, 0, 0)
        const dtEnd = new Date(dayDate)
        dtEnd.setHours(eh, em, 0, 0)
        uid += 1
        lines.push(
          'BEGIN:VEVENT',
          `UID:sunshine-${uid}-${stamp}@local`,
          `DTSTAMP:${stamp}`,
          `DTSTART:${formatIcsLocal(dtStart)}`,
          `DTEND:${formatIcsLocal(dtEnd)}`,
          `SUMMARY:${escapeIcs(r.name || '课程')}`,
          `LOCATION:${escapeIcs(r.room || '')}`,
          `DESCRIPTION:${escapeIcs([r.teacher, `第${sSec}-${eSec}节`].filter(Boolean).join(' · '))}`,
          'END:VEVENT',
        )
      }
    }
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function formatIcsLocal(d: Date) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`
}

function formatIcsUtc(d: Date) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

function escapeIcs(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

export function downloadIcs(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const a = document.createElement('a')
  const url = URL.createObjectURL(blob)
  a.href = url
  a.download = filename
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
