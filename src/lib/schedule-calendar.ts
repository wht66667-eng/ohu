import { captureQbankSession, subscribeQbank } from './qbank'

/**
 * 课表日历：内置国家节假日仅作提示；本人确认后才影响课程日期
 * - 内置国务院办公厅放假安排（2025–2026）作为建议，不自动停课或补课
 * - 用户确认学校通知后可应用为个人校历规则，也可手动添加覆盖
 * - 用户可自行增加放假 / 调课 / 取消某天内置规则
 *
 * day 约定与课表一致：1=周一 … 7=周日
 */
export type DayKind = 'off' | 'makeup'

export type CalendarOverride = {
  /** YYYY-MM-DD */
  date: string
  kind: DayKind
  /** makeup 时：这天按星期几的课上（1–7） */
  treatAsDay?: number
  label?: string
  /** gov=内置国定；user=学生自定义 */
  source: 'gov' | 'user'
}

export type DayStatus = {
  date: string
  /** 是否因放假/自定义而整天无课 */
  off: boolean
  /** 实际应取课表的星期（1–7）；off 时仍给自然星期供展示 */
  effectiveDay: number
  /** 自然星期 1–7 */
  calendarDay: number
  label: string
  source: 'none' | 'gov' | 'user'
  kind: DayKind | 'normal'
}

export type CourseDateException = {
  id: string
  date: string
  kind: 'add' | 'cancel' | 'replace'
  /** Course to add, or the replacement course name. */
  name: string
  sections: number[]
  room: string
  teacher: string
  /** Existing course targeted by cancel/replace. */
  targetName?: string
  targetSections?: number[]
  label: string
}

const LEGACY_LS_KEY = 'schedule.calendar.overrides'
const CALENDAR_EVENT = 'ohhu-schedule-calendar'
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function storageKey(uid = captureQbankSession().uid): string {
  return uid ? `schedule.calendar.v2:uid:${encodeURIComponent(uid)}` : 'schedule.calendar.v2:guest'
}

function legacyClaimKey(uid = captureQbankSession().uid): string {
  return `schedule.calendar.legacy-claimed:v1:${encodeURIComponent(uid || 'guest')}`
}

function announceCalendarChange() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(CALENDAR_EVENT))
  // Home cards and reminder reconciliation already listen to this event.
  window.dispatchEvent(new Event('ohhu-schedule-cache'))
}

subscribeQbank(announceCalendarChange)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === LEGACY_LS_KEY || event.key?.startsWith('schedule.calendar.v2:')) announceCalendarChange()
  })
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseDateKey(key: string): Date {
  const [y, m, day] = key.split('-').map(Number)
  return new Date(y, m - 1, day)
}

/** 自然星期 → 1=周一 … 7=周日 */
export function calendarDayIdx(d: Date): number {
  return ((d.getDay() + 6) % 7) + 1
}

export function dayName(day: number): string {
  return DAYS[Math.max(1, Math.min(7, day)) - 1] || ''
}

function expandRange(start: string, end: string, label: string): CalendarOverride[] {
  const out: CalendarOverride[] = []
  const cur = parseDateKey(start)
  const last = parseDateKey(end)
  while (cur <= last) {
    out.push({ date: toDateKey(cur), kind: 'off', label, source: 'gov' })
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

/**
 * 国务院办公厅放假安排（节选 2025–2026）。
 * 调休上班日的 treatAsDay 按高校常见补课映射，可被用户覆盖。
 */
function buildGovDefaults(): CalendarOverride[] {
  const off: CalendarOverride[] = [
    // —— 2025 ——
    ...expandRange('2025-01-01', '2025-01-01', '元旦放假'),
    ...expandRange('2025-01-28', '2025-02-04', '春节放假'),
    ...expandRange('2025-04-04', '2025-04-06', '清明放假'),
    ...expandRange('2025-05-01', '2025-05-05', '劳动节放假'),
    ...expandRange('2025-05-31', '2025-06-02', '端午放假'),
    ...expandRange('2025-10-01', '2025-10-08', '国庆中秋放假'),
    // —— 2026（国办发明电〔2025〕7号）——
    ...expandRange('2026-01-01', '2026-01-03', '元旦放假'),
    ...expandRange('2026-02-15', '2026-02-23', '春节放假'),
    ...expandRange('2026-04-04', '2026-04-06', '清明放假'),
    ...expandRange('2026-05-01', '2026-05-05', '劳动节放假'),
    ...expandRange('2026-06-19', '2026-06-21', '端午放假'),
    ...expandRange('2026-09-25', '2026-09-27', '中秋放假'),
    ...expandRange('2026-10-01', '2026-10-07', '国庆放假'),
  ]

  const makeup: CalendarOverride[] = [
    // 2025 调休（常见补课映射，可改）
    { date: '2025-01-26', kind: 'makeup', treatAsDay: 5, label: '调休上班·建议上周五课', source: 'gov' },
    { date: '2025-02-08', kind: 'makeup', treatAsDay: 1, label: '调休上班·建议上周一课', source: 'gov' },
    { date: '2025-04-27', kind: 'makeup', treatAsDay: 5, label: '调休上班·建议上周五课', source: 'gov' },
    { date: '2025-09-28', kind: 'makeup', treatAsDay: 5, label: '调休上班·建议上周五课', source: 'gov' },
    { date: '2025-10-11', kind: 'makeup', treatAsDay: 1, label: '调休上班·建议上周一课', source: 'gov' },
    // 2026
    { date: '2026-01-04', kind: 'makeup', treatAsDay: 5, label: '调休上班·建议上周五课', source: 'gov' },
    { date: '2026-02-14', kind: 'makeup', treatAsDay: 5, label: '调休上班·建议上周五课', source: 'gov' },
    { date: '2026-02-28', kind: 'makeup', treatAsDay: 1, label: '调休上班·建议上周一课', source: 'gov' },
    { date: '2026-05-09', kind: 'makeup', treatAsDay: 3, label: '调休上班·建议上周三课', source: 'gov' },
    // 国庆调休：高校常见 9/20 补周二、10/10 补周三
    { date: '2026-09-20', kind: 'makeup', treatAsDay: 2, label: '调休上班·建议上周二课', source: 'gov' },
    { date: '2026-10-10', kind: 'makeup', treatAsDay: 3, label: '调休上班·建议上周三课', source: 'gov' },
  ]

  return [...off, ...makeup]
}

const GOV_BY_DATE: Map<string, CalendarOverride> = (() => {
  const m = new Map<string, CalendarOverride>()
  for (const o of buildGovDefaults()) m.set(o.date, o)
  return m
})()

function sanitizeOverride(v: unknown): CalendarOverride | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const date = String(o.date || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const kind = o.kind === 'makeup' ? 'makeup' : o.kind === 'off' ? 'off' : null
  if (!kind) return null
  const treatAsDay = Number(o.treatAsDay)
  const out: CalendarOverride = {
    date,
    kind,
    source: o.source === 'gov' ? 'gov' : 'user',
    label: typeof o.label === 'string' ? o.label : undefined,
  }
  if (kind === 'makeup') {
    if (!(treatAsDay >= 1 && treatAsDay <= 7)) return null
    out.treatAsDay = treatAsDay
  }
  return out
}

/** 用户覆盖（含「删除内置」用 disabled 列表） */
type StoredCalendar = {
  overrides: CalendarOverride[]
  /** 用户主动关掉的内置日期 */
  disabledGov: string[]
  /** One-off course changes; absent in older local records. */
  courseChanges: CourseDateException[]
}

function parseStored(raw: string | null): StoredCalendar {
  try {
    if (!raw) return { overrides: [], disabledGov: [], courseChanges: [] }
    const j = JSON.parse(raw) as Partial<StoredCalendar>
    const overrides = Array.isArray(j.overrides)
      ? j.overrides.map(sanitizeOverride).filter((x): x is CalendarOverride => !!x && x.source === 'user')
      : []
    const disabledGov = Array.isArray(j.disabledGov)
      ? j.disabledGov.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
      : []
    const courseChanges = Array.isArray(j.courseChanges)
      ? j.courseChanges.map(sanitizeCourseDateException).filter((x): x is CourseDateException => !!x)
      : []
    return { overrides, disabledGov, courseChanges }
  } catch {
    return { overrides: [], disabledGov: [], courseChanges: [] }
  }
}

function sanitizeSections(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null
  const sections = [...new Set(value.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 11))].sort((a, b) => a - b)
  return sections.length === value.length ? sections : null
}

function sanitizeCourseDateException(value: unknown): CourseDateException | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const id = typeof row.id === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(row.id) ? row.id : ''
  const date = typeof row.date === 'string' ? row.date : ''
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const dateValue = parseDateKey(date)
  if (toDateKey(dateValue) !== date) return null
  const kind = row.kind === 'add' || row.kind === 'cancel' || row.kind === 'replace' ? row.kind : null
  if (!kind) return null
  const name = typeof row.name === 'string' ? row.name.trim().slice(0, 120) : ''
  const targetName = typeof row.targetName === 'string' ? row.targetName.trim().slice(0, 120) : ''
  const sections = sanitizeSections(row.sections)
  const targetSections = row.targetSections === undefined ? [] : sanitizeSections(row.targetSections)
  if (!sections || !targetSections || !name) return null
  if ((kind === 'add' || kind === 'replace') && !sections.length) return null
  if ((kind === 'cancel' || kind === 'replace') && !targetName) return null
  if (kind === 'replace' && !targetSections.length) return null
  return {
    id, date, kind, name, sections,
    room: typeof row.room === 'string' ? row.room.trim().slice(0, 120) : '',
    teacher: typeof row.teacher === 'string' ? row.teacher.trim().slice(0, 120) : '',
    ...(targetName ? { targetName } : {}),
    ...(targetSections.length ? { targetSections } : {}),
    label: typeof row.label === 'string' ? row.label.trim().slice(0, 180) : '',
  }
}

function loadStored(): StoredCalendar {
  try {
    return parseStored(localStorage.getItem(storageKey()))
  } catch {
    return { overrides: [], disabledGov: [], courseChanges: [] }
  }
}

function saveStored(s: StoredCalendar): boolean {
  try {
    const key = storageKey()
    const encoded = JSON.stringify(s)
    localStorage.setItem(key, encoded)
    const saved = localStorage.getItem(key) === encoded
    if (saved) announceCalendarChange()
    return saved
  } catch {
    return false
  }
}

/** Old calendar data has no owner. It stays untouched until a signed-in user explicitly imports it. */
export function getLegacyCalendarImportStatus(): { count: number; alreadyImported: boolean } {
  try {
    const session = captureQbankSession()
    const legacy = parseStored(localStorage.getItem(LEGACY_LS_KEY))
    const dates = new Set([...legacy.overrides.map((item) => item.date), ...legacy.disabledGov])
    return {
      count: dates.size,
      alreadyImported: !!session.uid && localStorage.getItem(legacyClaimKey(session.uid)) === '1',
    }
  } catch {
    return { count: 0, alreadyImported: false }
  }
}

export function claimLegacyCalendarForCurrentAccount(): { ok: boolean; count: number; error?: string } {
  const session = captureQbankSession()
  if (!session.uid || session.uid.startsWith('local:')) {
    return { ok: false, count: 0, error: '请先登录哦狐账号，再恢复旧校历设置。' }
  }
  try {
    const status = getLegacyCalendarImportStatus()
    if (status.alreadyImported) return { ok: true, count: 0 }
    const legacy = parseStored(localStorage.getItem(LEGACY_LS_KEY))
    const current = loadStored()
    const byDate = new Map(current.overrides.map((item) => [item.date, item]))
    for (const item of legacy.overrides) byDate.set(item.date, item)
    const merged: StoredCalendar = {
      overrides: [...byDate.values()],
      disabledGov: [...new Set([...current.disabledGov, ...legacy.disabledGov])],
      courseChanges: current.courseChanges,
    }
    if (!saveStored(merged)) return { ok: false, count: 0, error: '旧校历没有复制成功，请检查设备存储空间后重试。' }
    localStorage.setItem(legacyClaimKey(session.uid), '1')
    if (localStorage.getItem(legacyClaimKey(session.uid)) !== '1') {
      return { ok: false, count: 0, error: '校历已复制到当前账号，但恢复状态未能保存；可再次点击安全重试。' }
    }
    return { ok: true, count: new Set([...legacy.overrides.map((item) => item.date), ...legacy.disabledGov]).size }
  } catch {
    return { ok: false, count: 0, error: '旧校历没有复制成功，请检查设备存储空间后重试。' }
  }
}

/** 仅用户确认的规则才影响课程日期；国家节假日默认只是建议。 */
export function getOverrideForDate(dateKey: string): CalendarOverride | null {
  const { overrides } = loadStored()
  return overrides.find((o) => o.date === dateKey) ?? null
}

export function getDayStatus(d: Date = new Date()): DayStatus {
  const date = toDateKey(d)
  const calendarDay = calendarDayIdx(d)
  const ov = getOverrideForDate(date)
  if (!ov) {
    return {
      date,
      off: false,
      effectiveDay: calendarDay,
      calendarDay,
      label: '',
      source: 'none',
      kind: 'normal',
    }
  }
  if (ov.kind === 'off') {
    return {
      date,
      off: true,
      effectiveDay: calendarDay,
      calendarDay,
      label: ov.label || '放假不上课',
      source: ov.source,
      kind: 'off',
    }
  }
  const treat = ov.treatAsDay && ov.treatAsDay >= 1 && ov.treatAsDay <= 7 ? ov.treatAsDay : calendarDay
  return {
    date,
    off: false,
    effectiveDay: treat,
    calendarDay,
    label: ov.label || `调课 · 上${dayName(treat)}的课`,
    source: ov.source,
    kind: 'makeup',
  }
}

/** 今日应取课表的星期；放假返回 null */
export function effectiveDayForDate(d: Date = new Date()): number | null {
  const st = getDayStatus(d)
  if (st.off) return null
  return st.effectiveDay
}

export function listUserOverrides(): CalendarOverride[] {
  return loadStored().overrides.slice().sort((a, b) => a.date.localeCompare(b.date))
}

/** 近期内置 + 用户规则（用于设置页列表） */
export function listNearbyRules(from: Date = new Date(), days = 120): Array<CalendarOverride & { disabled?: boolean }> {
  const { overrides, disabledGov } = loadStored()
  const userBy = new Map(overrides.map((o) => [o.date, o]))
  const out: Array<CalendarOverride & { disabled?: boolean }> = []
  const seen = new Set<string>()
  const cur = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  for (let i = 0; i < days; i++) {
    const key = toDateKey(cur)
    const user = userBy.get(key)
    const gov = GOV_BY_DATE.get(key)
    if (user) {
      out.push(user)
      seen.add(key)
    } else if (gov) {
      out.push({ ...gov, disabled: disabledGov.includes(key) })
      seen.add(key)
    }
    cur.setDate(cur.getDate() + 1)
  }
  // 再附上不在窗口内的用户自定义
  for (const u of overrides) {
    if (!seen.has(u.date)) out.push(u)
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

export function upsertUserOverride(input: Omit<CalendarOverride, 'source'> & { source?: 'user' }): boolean {
  return upsertUserOverrides([input])
}

/** Save a confirmed set atomically so AI batch results cannot be half-applied. */
export function upsertUserOverrides(inputs: Array<Omit<CalendarOverride, 'source'> & { source?: 'user' }>): boolean {
  return upsertConfirmedScheduleChanges(inputs, [])
}

/** Apply day rules and course exceptions with one localStorage write and one refresh event. */
export function upsertConfirmedScheduleChanges(
  inputs: Array<Omit<CalendarOverride, 'source'> & { source?: 'user' }>,
  courseInputs: Array<Omit<CourseDateException, 'id'> & { id?: string }>,
): boolean {
  if (!inputs.length && !courseInputs.length) return false
  const clean = inputs.map((input) => sanitizeOverride({ ...input, source: 'user' }))
  if (clean.some((item) => !item)) return false
  const valid = clean.filter((item): item is CalendarOverride => item !== null)
  const courseClean = courseInputs.map((input, index) => sanitizeCourseDateException({
    ...input,
    id: input.id || `course-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 10)}`,
  }))
  if (courseClean.some((item) => !item)) return false
  const validCourses = courseClean.filter((item): item is CourseDateException => !!item)
  const s = loadStored()
  const byDate = new Map(s.overrides.map((item) => [item.date, item]))
  for (const item of valid) byDate.set(item.date, item)
  s.overrides = [...byDate.values()]
  const changedDates = new Set(valid.map((item) => item.date))
  // 用户自定义时从 disabled 里去掉该日。
  s.disabledGov = s.disabledGov.filter((date) => !changedDates.has(date))
  const existingIds = new Set(s.courseChanges.map((item) => item.id))
  if (validCourses.some((item) => existingIds.has(item.id))) return false
  s.courseChanges = [...s.courseChanges, ...validCourses]
  return saveStored(s)
}

/** Save a reviewed set of one-day course changes in the signed-in account's local calendar. */
export function upsertCourseDateExceptions(inputs: Array<Omit<CourseDateException, 'id'> & { id?: string }>): boolean {
  return upsertConfirmedScheduleChanges([], inputs)
}

export function listCourseDateExceptions(date?: string): CourseDateException[] {
  const items = loadStored().courseChanges
  return items.filter((item) => !date || item.date === date).slice().sort((a, b) => a.date.localeCompare(b.date))
}

export function removeCourseDateException(id: string): boolean {
  const stored = loadStored()
  const next = stored.courseChanges.filter((item) => item.id !== id)
  if (next.length === stored.courseChanges.length) return false
  stored.courseChanges = next
  return saveStored(stored)
}

const PHRASE_DAY = '一二三四五六日'

function phraseDate(month: number, day: number, now = new Date()): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  let year = now.getFullYear()
  const guess = new Date(year, month - 1, day)
  if (guess.getMonth() !== month - 1 || guess.getDate() !== day) return null
  if (guess.getTime() < now.getTime() - 180 * 86400000) year += 1
  const again = new Date(year, month - 1, day)
  if (again.getMonth() !== month - 1) return null
  return toDateKey(again)
}

/** 把一句调课写进本机记录。例：10月10日按周三课表上课 / 10月8日停课 */
export function applySchedulePhrase(raw: string): { ok: boolean; message: string } {
  const text = raw.replace(/\s+/g, '')
  const makeup = text.match(/^(\d{1,2})月(\d{1,2})日(?:按|上|补)周([一二三四五六日])(?:的)?课(?:表上课|表)?$/)
  const off = text.match(/^(\d{1,2})月(\d{1,2})日停课$/)
  const hit = makeup || off
  if (!hit) return { ok: false, message: '可以说「10月10日按周三课表上课」或「10月8日停课」' }
  const date = phraseDate(Number(hit[1]), Number(hit[2]))
  if (!date) return { ok: false, message: '这个日期读不出来' }
  if (off) {
    const saved = upsertUserOverride({ date, kind: 'off', label: '停课' })
    return saved
      ? { ok: true, message: `${date} 已记为停课` }
      : { ok: false, message: '校历未能保存，请检查设备存储空间后重试。' }
  }
  const treatAsDay = PHRASE_DAY.indexOf(hit[3]) + 1
  const saved = upsertUserOverride({
    date,
    kind: 'makeup',
    treatAsDay,
    label: `按${dayName(treatAsDay)}课表上课`,
  })
  return saved
    ? { ok: true, message: `${date} 按${dayName(treatAsDay)}课表上课` }
    : { ok: false, message: '校历未能保存，请检查设备存储空间后重试。' }
}

export function removeUserOverride(dateKey: string): void {
  const s = loadStored()
  s.overrides = s.overrides.filter((o) => o.date !== dateKey)
  saveStored(s)
}

/** 忽略／恢复国家节假日提示（不影响已应用的个人校历规则）。 */
export function setGovDisabled(dateKey: string, disabled: boolean): void {
  const s = loadStored()
  if (disabled) {
    if (!s.disabledGov.includes(dateKey)) s.disabledGov.push(dateKey)
    s.overrides = s.overrides.filter((o) => o.date !== dateKey)
  } else {
    s.disabledGov = s.disabledGov.filter((d) => d !== dateKey)
  }
  saveStored(s)
}

/** 将某条国家节假日建议明确应用为本人校历规则。 */
export function applyGovRule(dateKey: string): boolean {
  const rule = GOV_BY_DATE.get(dateKey)
  if (!rule) return false
  return upsertUserOverride({
    ...rule,
    source: 'user',
    label: `已按学校校历确认：${rule.label || (rule.kind === 'off' ? '放假不上课' : `按${dayName(rule.treatAsDay || 1)}课表上课`)}`,
  })
}

export function clearAllUserCalendar(): void {
  saveStored({ overrides: [], disabledGov: [], courseChanges: [] })
}

