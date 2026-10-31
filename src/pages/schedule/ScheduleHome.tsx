import { FoxSheetPose } from '../../components/fox/FoxSheetPose'
import { FoxRequestIndicator } from '../../components/fox/FoxRequestIndicator'
import { ScheduleAiChangeSheet } from '../../components/ScheduleAiChangeSheet'
import { ScheduleGroupSheet } from '../../components/ScheduleGroupSheet'
import { ScheduleImageImportSheet } from '../../components/ScheduleImageImportSheet'
/**
 * 课表查询 · 江苏海洋大学（sunshine-campus 风格重制）
 *
 * 设计要点：
 *  - 与 app 共享 design tokens（--green/--mint/--card/--shadow），不再注入独立蓝色主题
 *  - 首次使用 = 「绑定教务账号」卡片；可选记住学号/密码（仅本机）
 *  - 验证码两条路并存：服务端 OCR 自动识别（/api/timetable/auto，免手输）
 *    与手输验证码；自动识别不可用时会把服务端已取好的图填进手输框，用户接着输即可
 *  - 同步成功后本地缓存课表，并刷新今日上课提醒（系统通知 + 首页弹窗）
 *  - 顶部横向周次胶囊条（‹ 上一周 / 下一周 ›），今天所在周用黄圈标出
 *  - 「今日」快捷卡片：一眼看到今天还剩哪几节课，轻触看详情
 *  - 周视图：11 节 × 周一至周日（含周末）；表头显示「周几 + 月/日」；今日列底色提示
 *  - 课程色块按课名稳定取色（同一门课始终同色），轻触弹出课程详情
 *  - 接口契约：src/lib/timetable.ts 的 fetchCaptcha / queryTimetable / queryAcademic
 *  - MOCK 模式：后端环境变量 MOCK=1 启动返回样例课表（无需真实教务账号）
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { PasswordInput } from '../../components/PasswordInput'
import {
  fetchCaptcha,
  queryAcademic,
  type TimetableError,
  type TtRow,
} from '../../lib/timetable'
import {
  fetchRemotePeriods,
  claimLegacyPeriodsForCurrentAccount,
  getOfficialPeriods,
  getLegacyPeriodsImportStatus,
  isCustomPeriods,
  loadLocalPeriods,
  officialSeasonLabel,
  sanitizePeriods,
  savePeriods,
  toMin,
  type PeriodPair,
} from '../../lib/schedule-prefs'
import {
  clearAllUserCalendar,
  applyGovRule,
  claimLegacyCalendarForCurrentAccount,
  dayName,
  getLegacyCalendarImportStatus,
  getDayStatus,
  listNearbyRules,
  removeUserOverride,
  setGovDisabled,
  toDateKey,
  applySchedulePhrase,
  upsertUserOverride,
  upsertConfirmedScheduleChanges,
  listCourseDateExceptions,
  removeCourseDateException,
  type CourseDateException,
  type CalendarOverride,
} from '../../lib/schedule-calendar'
import {
  buildScheduleIcs,
  getScheduleRowsForDate,
  teachingWeekForDate,
  downloadIcs,
  guessTeachingWeek,
  describeScheduleSnapshotStatus,
  loadScheduleCache,
  saveScheduleCache,
  restoreScheduleBeforePhoto,
  hasScheduleBeforePhoto,
  scheduleStudentIdForSnapshot,
  validateScheduleSnapshot,
  getScheduleTermStart,
  saveScheduleTermStart,
} from '../../lib/schedule-cache'
import {
  clearSavedPassword,
  hasUnboundCampusCredentials,
  isRememberPasswordEnabled,
  loadSavedPassword,
  loadSavedStuid,
  saveTimetableCredentials,
} from '../../lib/schedule-credentials'
import { saveExamsCache, saveGradesCache, loadGradesCache, loadExamsCache, ACADEMIC_CACHE_EVENT } from '../../lib/academic-cache'
import { captureQbankSession, isQbankSessionCurrent } from '../../lib/qbank'
import type { ScheduleAiChange } from '../../lib/schedule-ai'
/* 免手输路径：服务端 OCR 识别验证码（/api/timetable/auto），失败自动退回手输 */
import { beginAcademicSync, isAcademicSyncCurrent, runAutoSync } from '../../lib/auto-sync'
/* 访客没有提醒归属（提醒按账号隔离），同步成功后要把这件事讲清楚而不是静默放过 */
import { useAuth } from '../../lib/auth'
import { useQbankRevision } from '../../lib/useQbankRevision'
import { rescheduleClassReminders, type ClassReminderResult } from '../../lib/class-remind'
import { rescheduleExamReminders } from '../../lib/exam-utils'
import { ScheduleTypeIcon } from '../../components/ScheduleTypeIcon'
import { EmptyState, ErrorState } from '../../components/ui/StateViews'
import { DialogLayer } from '../../components/ui/DialogLayer'
import styles from './ScheduleHome.module.css'

const NS = 11

/** 课程配色：柔和底色 + 深色文字，保证在浅色背景上可读 */
const PALETTE: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: '#E3F5E1', fg: '#256B2A' },
  { bg: '#E1EEFB', fg: '#1E5A9E' },
  { bg: '#FFF0DC', fg: '#9A5B14' },
  { bg: '#F0E8FB', fg: '#6244A8' },
  { bg: '#FDE7EC', fg: '#A6384C' },
  { bg: '#DFF2F6', fg: '#1E6E80' },
  { bg: '#FBEFE2', fg: '#8C5222' },
  { bg: '#E9EAFB', fg: '#44479E' },
]

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/* ============================================================
 * 工具函数
 * ============================================================ */

/** 课名 → 稳定配色索引（同课同色，不随名称长度抖动） */
function colorOf(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return PALETTE[Math.abs(h) % PALETTE.length]
}

/** 节次区间 → 「08:05-09:45」（时间表可由用户自定义，走合成后的 tm） */
function sectionTime(tm: ReadonlyArray<readonly [string, string]>, a: number, b: number): string {
  const s = tm[clamp(a, 1, tm.length) - 1]
  const e = tm[clamp(b, 1, tm.length) - 1]
  return `${s[0]}-${e[1]}`
}

/** 把离散周次压缩成 1-3/5/8-12 形式 */
function compressWeeks(ws: number[]): string {
  const s = [...new Set(ws)].sort((a, b) => a - b)
  if (!s.length) return ''
  const parts: string[] = []
  let i = 0
  while (i < s.length) {
    let j = i
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++
    parts.push(i === j ? `${s[i]}` : `${s[i]}-${s[j]}`)
    i = j + 1
  }
  return parts.join('/')
}

/** 今天是本周第几天（1=周一 … 7=周日） */
function todayDayIdx(): number {
  return ((new Date().getDay() + 6) % 7) + 1
}

/** 课表视图与缓存、提醒使用同一学期起点。 */
function guessCurrentWeek(): number {
  return guessTeachingWeek()
}

/** 某教学周、某星期（1=周一…7=周日）对应的日历日期 */
function dateOfTeachingDay(week: number, day: number, termStart: string): Date {
  const start = new Date(`${termStart}T00:00:00`)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  const d = new Date(start)
  d.setDate(start.getDate() + (week - 1) * 7 + (day - 1))
  return d
}

function fmtMd(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** 当前处于第几节（用于时间轴高亮）；非上课时间返回 0 */
function currentSection(tm: ReadonlyArray<readonly [string, string]>): number {
  const mins = new Date().getHours() * 60 + new Date().getMinutes()
  for (let i = 0; i < tm.length; i++) {
    if (mins >= toMin(tm[i][0]) && mins <= toMin(tm[i][1])) return i + 1
  }
  return 0
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}

/* ============================================================
 * 单元格分组：同天同课且节次连续/相邻的合并成一格
 * ============================================================ */

interface CellGroup {
  day: number
  name: string
  room: string
  teacher: string
  start: number
  end: number
  /** 这门课在本学期出现的所有周次 */
  allWeeks: number[]
}

function groupRows(rows: TtRow[], week: number): Record<number, CellGroup[]> {
  const filtered = rows.filter((r) => Number(r.week) === week)
  /* 先统计每门课（按 天|课名）在本学期出现过的所有周，供详情页展示 */
  const weeksOf = new Map<string, Set<number>>()
  for (const r of rows) {
    const k = `${r.day}|${r.name}`
    const set = weeksOf.get(k) ?? new Set<number>()
    set.add(Number(r.week))
    weeksOf.set(k, set)
  }
  const byKey: Record<string, Omit<CellGroup, 'start' | 'end'> & { ivs: Array<[number, number]> }> = {}
  for (const r of filtered) {
    const day = Number(r.day) || 1
    const ss = Array.isArray(r.sections) && r.sections.length ? r.sections : [1]
    const s0 = clamp(Math.min(...ss), 1, NS)
    const s1 = clamp(Math.max(...ss), s0, NS)
    const k = `${day}|${r.name}|${r.room || ''}|${r.teacher || ''}`
    const bucket = byKey[k] ?? (byKey[k] = { day, name: r.name, room: r.room, teacher: r.teacher, ivs: [], allWeeks: [] })
    bucket.ivs.push([s0, s1])
  }
  const out: Record<number, CellGroup[]> = {}
  for (const v of Object.values(byKey)) {
    v.ivs.sort((a, b) => a[0] - b[0])
    const merged: Array<[number, number]> = []
    for (const iv of v.ivs) {
      const last = merged[merged.length - 1]
      if (last && iv[0] <= last[1] + 1) last[1] = Math.max(last[1], iv[1])
      else merged.push([...iv])
    }
    const aw = [...(weeksOf.get(`${v.day}|${v.name}`) ?? [])]
    const list = merged.map<CellGroup>(([start, end]) => ({
      day: v.day,
      name: v.name,
      room: v.room,
      teacher: v.teacher,
      start,
      end,
      allWeeks: aw,
    }))
    out[v.day] = (out[v.day] ?? []).concat(list)
  }
  for (const k of Object.keys(out)) out[Number(k)].sort((a, b) => a.start - b.start)
  return out
}

/* ============================================================
 * 页面
 * ============================================================ */

type ScheduleAction = 'bind' | 'periods' | 'calendar' | 'export' | 'ai' | 'group'
type ResumedScheduleAction = { id: number; kind: ScheduleAction; session: ReturnType<typeof captureQbankSession> }

export function ScheduleHome() {
  useQbankRevision()
  const auth = useAuth()
  const [resumedAction, setResumedAction] = useState<ResumedScheduleAction | null>(null)
  const actionSequence = useRef(0)
  useEffect(() => () => { actionSequence.current++ }, [])
  async function requestAction(kind: ScheduleAction) {
    const request = ++actionSequence.current
    const allowed = auth.isSigned || await auth.ensureSignedIn('使用课表功能前，请先用手机号登录哦狐；登录后继续绑定学校教务账号。')
    if (!allowed || request !== actionSequence.current) return
    const owner = captureQbankSession()
    if (!owner.uid) return
    setResumedAction({ id: request, kind, session: owner })
  }
  const session = captureQbankSession()
  // Reset open course details and in-memory query results before another
  // identity renders this page, including an A -> B -> A transition.
  return <ScheduleHomeContent key={`${session.uid}:${session.revision}`} resumedAction={resumedAction} requestAction={requestAction} />
}

function ScheduleHomeContent({ resumedAction = null, requestAction }: {
  resumedAction?: ResumedScheduleAction | null
  requestAction?: (kind: ScheduleAction) => Promise<void>
} = {}) {
  const auth = useAuth()
  const ownerSession = useRef(captureQbankSession()).current
  function requireSigned(kind: ScheduleAction): boolean {
    if (!isQbankSessionCurrent(ownerSession)) return false
    if (auth.isSigned && ownerSession.uid) return true
    if (requestAction) void requestAction(kind)
    else auth.openLogin('使用课表功能前，请先用手机号登录哦狐')
    return false
  }
  const [stuid, setStuid] = useState(() => loadSavedStuid())
  const [pwd, setPwd] = useState(() => loadSavedPassword())
  const [captcha, setCaptcha] = useState('')
  const [sid, setSid] = useState('')
  const [capImg, setCapImg] = useState('')
  const [capLoading, setCapLoading] = useState(false)
  const captchaSequence = useRef(0)
  const captchaSession = useRef<ReturnType<typeof captureQbankSession> | null>(null)
  const [remember, setRemember] = useState(() => !!loadSavedStuid())
  const [rememberPwd, setRememberPwd] = useState(() => isRememberPasswordEnabled())
  const [msg, setMsg] = useState('')
  const [msgErr, setMsgErr] = useState(false)
  const [syncRequest, setSyncRequest] = useState<'manual' | 'auto' | null>(null)
  const submitting = syncRequest !== null
  /** 被限流（1004）后的冷却秒数：期间禁用提交与验证码刷新，避免越点越糟 */
  const [cooldown, setCooldown] = useState(0)

  const [rows, setRows] = useState<TtRow[]>(() => loadScheduleCache().rows)
  const rowsBeforeBind = useRef<TtRow[] | null>(null)
  const [termStart, setTermStart] = useState(() => getScheduleTermStart(ownerSession.uid))
  const [currentWeek, setCurrentWeek] = useState(() => guessCurrentWeek())
  const [scheduleAiOpen, setScheduleAiOpen] = useState(false)
  const [scheduleGroupOpen, setScheduleGroupOpen] = useState(false)
  const [scheduleImageOpen, setScheduleImageOpen] = useState(false)
  const [scheduleAiContext, setScheduleAiContext] = useState<{
    date: string
    dayLabel: string
    courseName: string
    sections: number[]
    room: string
    teacher: string
  } | null>(null)
  const [sheet, setSheet] = useState<CellGroup | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const thisWeek = useMemo(() => guessCurrentWeek(), [termStart])

  /* ---------- 节次时间（默认海大官网夏/秋冬，可自定义，按账号云端同步） ---------- */
  const [tm, setTm] = useState<PeriodPair[]>(() => loadLocalPeriods())
  const [tmOpen, setTmOpen] = useState(false)
  const [tmDraft, setTmDraft] = useState<PeriodPair[]>([])
  const [tmSaving, setTmSaving] = useState(false)
  const tmSaveBusy = useRef(false)
  const [tmMsg, setTmMsg] = useState('')
  const [tmCustom, setTmCustom] = useState(() => isCustomPeriods())
  const [legacyPeriods, setLegacyPeriods] = useState(() => getLegacyPeriodsImportStatus())

  /* ---------- 假期 / 调课 ---------- */
  const [calOpen, setCalOpen] = useState(false)
  const [calRules, setCalRules] = useState(() => listNearbyRules())
  const [courseDateChanges, setCourseDateChanges] = useState<CourseDateException[]>(() => listCourseDateExceptions())
  const [legacyCalendar, setLegacyCalendar] = useState(() => getLegacyCalendarImportStatus())
  const [calDate, setCalDate] = useState(() => toDateKey(new Date()))
  const [calKind, setCalKind] = useState<'off' | 'makeup'>('off')
  const [calTreatAs, setCalTreatAs] = useState(1)
  const [calLabel, setCalLabel] = useState('')
  const [calTick, setCalTick] = useState(0)
  const [view, setView] = useState<'week' | 'day'>('day')
  const [dayFocus, setDayFocus] = useState(() => todayDayIdx())
  const [phrase, setPhrase] = useState('')

  useEffect(() => {
    const refreshCalendarView = () => {
      setCalRules(listNearbyRules())
      setLegacyCalendar(getLegacyCalendarImportStatus())
      setCalTick((n) => n + 1)
    }
    window.addEventListener('ohhu-schedule-calendar', refreshCalendarView)
    return () => window.removeEventListener('ohhu-schedule-calendar', refreshCalendarView)
  }, [])

  /* 纯展示状态：未绑定时的空态开关、下一节课倒计时滴答（不参与任何业务逻辑） */
  const [bindOpen, setBindOpen] = useState(false)
  const bindVisible = useRef(false)
  bindVisible.current = bindOpen && auth.isSigned && !!ownerSession.uid
  const handledAction = useRef(0)
  const [nowTick, setNowTick] = useState(() => Date.now())

  /* 成绩 / 考试已同步数量（教务缓存变化时刷新，供课表页入口展示） */
  const [academicCounts, setAcademicCounts] = useState(() => ({
    grades: loadGradesCache().length,
    exams: loadExamsCache().length,
  }))
  useEffect(() => {
    const onCache = () =>
      setAcademicCounts({ grades: loadGradesCache().length, exams: loadExamsCache().length })
    window.addEventListener(ACADEMIC_CACHE_EVENT, onCache)
    return () => window.removeEventListener(ACADEMIC_CACHE_EVENT, onCache)
  }, [])

  useEffect(() => {
    // 有缓存课表时刷新今日上课提醒
    if (loadScheduleCache().rows.length) {
      void rescheduleClassReminders().catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // No school requests while browsing as a guest or before opening its form.
  useEffect(() => {
    if (!bindOpen || !auth.isSigned || !ownerSession.uid) return
    void loadCaptcha()
    return () => { captchaSequence.current++; captchaSession.current = null }
    // loadCaptcha uses the account-owned form and a request sequence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindOpen, auth.isSigned])

  useEffect(() => {
    if (!resumedAction || resumedAction.id === handledAction.current || !auth.isSigned
      || !isQbankSessionCurrent(resumedAction.session)) return
    handledAction.current = resumedAction.id
    if (resumedAction.kind === 'bind') onReQuery()
    else if (resumedAction.kind === 'periods') openTmSheet()
    else if (resumedAction.kind === 'calendar') openCalSheet()
    else if (resumedAction.kind === 'ai') setScheduleAiOpen(true)
    else exportCalendar()
    // An explicit action survives the guest-to-signed form remount; no secrets do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumedAction, auth.isSigned])

  /* 云端有保存过的节次时间则覆盖本地（换设备不丢） */
  useEffect(() => {
    const session = captureQbankSession()
    void (async () => {
      const remote = await fetchRemotePeriods()
      if (remote && isQbankSessionCurrent(session)) {
        setTm(remote)
        setTmCustom(isCustomPeriods())
      }
    })()
  }, [])

  function openTmSheet() {
    if (!requireSigned('periods')) return
    if (tmSaveBusy.current) return
    setLegacyPeriods(getLegacyPeriodsImportStatus())
    setTmDraft(tm.map((p) => [p[0], p[1]] as PeriodPair))
    setTmMsg('')
    setTmOpen(true)
  }

  function openCalSheet() {
    if (!requireSigned('calendar')) return
    setCalRules(listNearbyRules())
    setLegacyCalendar(getLegacyCalendarImportStatus())
    setCalDate(toDateKey(new Date()))
    setCalKind('off')
    setCalTreatAs(1)
    setCalLabel('')
    setCalOpen(true)
  }

  function refreshCal(): Promise<ClassReminderResult> {
    setCalRules(listNearbyRules())
    setCourseDateChanges(listCourseDateExceptions())
    setLegacyCalendar(getLegacyCalendarImportStatus())
    setCalTick((n) => n + 1)
    return rescheduleClassReminders().catch((error) => ({
      count: 0,
      message: `课表提醒刷新失败：${error instanceof Error ? error.message : '请稍后重试'}`,
      plan: {
        status: 'failed' as const,
        count: 0,
        message: `课表提醒刷新失败：${error instanceof Error ? error.message : '请稍后重试'}`,
      },
    }))
  }

  function setDraftAt(i: number, j: 0 | 1, v: string) {
    if (tmSaveBusy.current) return
    setTmDraft((d) => d.map((p, k) => (k === i ? ((j === 0 ? [v, p[1]] : [p[0], v]) as PeriodPair) : p)))
  }

  async function saveTm() {
    if (!requireSigned('periods')) return
    if (tmSaveBusy.current) return
    const ok = sanitizePeriods(tmDraft)
    if (!ok) {
      setTmMsg('每节都要是合法的起止时间，且开始要早于结束')
      return
    }
    const session = captureQbankSession()
    tmSaveBusy.current = true
    setTmSaving(true)
    try {
      const r = await savePeriods(ok)
      if (!isQbankSessionCurrent(session)) return
      setTm(ok)
      setTmCustom(true)
      void rescheduleClassReminders().catch(() => undefined)
      if (r.error) {
        setTmMsg(`保存到云端失败：${r.error}（本机已生效）`)
        return
      }
      setTmOpen(false)
    } finally {
      tmSaveBusy.current = false
      if (isQbankSessionCurrent(session)) setTmSaving(false)
    }
  }

  function resetTmDraft() {
    if (tmSaveBusy.current) return
    const official = getOfficialPeriods()
    setTmDraft(official)
    setTmMsg(`已填入${officialSeasonLabel()}，点保存后生效`)
  }

  async function applyOfficialTm() {
    if (!requireSigned('periods')) return
    if (tmSaveBusy.current) return
    const session = captureQbankSession()
    const official = getOfficialPeriods()
    tmSaveBusy.current = true
    setTmSaving(true)
    try {
      const r = await savePeriods(official, { custom: false })
      if (!isQbankSessionCurrent(session)) return
      setTm(official)
      setTmDraft(official)
      setTmCustom(false)
      setTmMsg(r.error ? `已恢复官方（云端：${r.error}）` : `已恢复${officialSeasonLabel()}`)
      void rescheduleClassReminders().catch(() => undefined)
    } finally {
      tmSaveBusy.current = false
      if (isQbankSessionCurrent(session)) setTmSaving(false)
    }
  }

  function addCalRule() {
    if (!requireSigned('calendar')) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(calDate)) return
    const payload: Omit<CalendarOverride, 'source'> = {
      date: calDate,
      kind: calKind,
      label: calLabel.trim() || (calKind === 'off' ? '自定义放假' : `调课 · 上${dayName(calTreatAs)}的课`),
    }
    if (calKind === 'makeup') payload.treatAsDay = calTreatAs
    upsertUserOverride(payload)
    refreshCal()
  }

  /* 冷却倒计时：每秒递减，归零后自动恢复可提交 */
  useEffect(() => {
    if (!cooldown) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  /* 仅驱动顶部「下一节课」倒计时刷新（30 秒一次），与业务无关 */
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  async function loadCaptcha() {
    if (!auth.isSigned || !ownerSession.uid || !bindVisible.current || !isQbankSessionCurrent(ownerSession)) return
    const session = captureQbankSession()
    const request = ++captchaSequence.current
    captchaSession.current = null
    setMsg('')
    setMsgErr(false)
    setCaptcha('')
    setSid('')
    setCapImg('')
    setCapLoading(true)
    try {
      const d = await fetchCaptcha()
      if (!bindVisible.current || request !== captchaSequence.current || !isQbankSessionCurrent(session)) return
      if (!d.sid || !d.image) throw new Error('验证码暂不可用，请重新加载')
      captchaSession.current = session
      setSid(d.sid)
      setCapImg(d.image)
    } catch (e) {
      if (!bindVisible.current || request !== captchaSequence.current || !isQbankSessionCurrent(session)) return
      const err = e as TimetableError
      setMsg(err.message || '验证码加载失败，请重试')
      setMsgErr(true)
      /* 取验证码也被限流时同样进入冷却，避免连点 */
      if (err.code === '1004') setCooldown(clamp(Math.round(err.retryAfter || 60), 5, 180))
    } finally {
      if (request === captchaSequence.current && isQbankSessionCurrent(session)) setCapLoading(false)
    }
  }

  async function onSubmit() {
    if (!requireSigned('bind') || cooldown > 0 || submitting) return
    if (!stuid.trim() || !pwd || !captcha.trim()) {
      showMsg('请填写完整学号、密码和验证码', true)
      return
    }
    if (!sid || !capImg || !captchaSession.current || !isQbankSessionCurrent(captchaSession.current)) {
      showMsg('验证码需要重新加载，请使用当前账号的验证码后重试', true)
      void loadCaptcha()
      return
    }
    const session = captureQbankSession()
    const syncRun = beginAcademicSync(session)
    setSyncRequest('manual')
    showMsg('')
    try {
      const data = await queryAcademic(
        sid,
        {
          username: stuid.trim(),
          password: pwd,
          captcha: captcha.trim(),
        },
        ['schedule', 'grades', 'exams'],
      )
      if (!isAcademicSyncCurrent(syncRun)) return
      const gradesReceived = !data.grades_error && Array.isArray(data.grades)
      const examsReceived = !data.exams_error && Array.isArray(data.exams)
      const gradesSaved = gradesReceived && saveGradesCache(data.grades!, stuid.trim(), session)
      if (!isAcademicSyncCurrent(syncRun)) return
      const examsSaved = examsReceived && saveExamsCache(data.exams!, stuid.trim(), session)
      const scheduleRows = data.rows || []
      setPwd(rememberPwd ? pwd : '')
      if (!isAcademicSyncCurrent(syncRun)) return
      const cacheSaved = saveScheduleCache(scheduleRows, stuid.trim(), session)
      if (cacheSaved) {
        setRows(scheduleRows)
        rowsBeforeBind.current = null
      }
      if (!isAcademicSyncCurrent(syncRun)) return
      const credentialsSaved = saveTimetableCredentials({
        stuid: stuid.trim(),
        password: pwd,
        rememberStuid: remember,
        rememberPassword: rememberPwd,
      }, session)
      if (!isAcademicSyncCurrent(syncRun)) return
      const rem = cacheSaved ? await rescheduleClassReminders().catch(() => null) : null
      if (!isAcademicSyncCurrent(syncRun)) return
      if (examsSaved) void rescheduleExamReminders().catch(() => null)
      const extras: string[] = []
      if (!credentialsSaved) extras.push('本机账号信息未保存，请检查存储空间后重试')
      if (gradesSaved) extras.push(`成绩 ${data.grades!.length} 门`)
      else extras.push(data.grades_error ? '成绩未取到，已保留当前账号缓存' : '成绩保存失败，请检查存储空间')
      if (examsSaved) extras.push(`考试 ${data.exams!.length} 场`)
      else extras.push(data.exams_error ? '考试未取到，已保留当前账号缓存' : '考试保存失败，请检查存储空间')
      /*
       * 提醒要说清楚，不能静默：访客没有提醒归属（提醒按账号隔离，
       * personal-reminders 对空 uid 直接返回「等待登录状态确认」），
       * 而登录用户排不上时也要给出原因（课表为空 / 开关关着 / 通知权限没给）。
       */
      const notice = [
        cacheSaved
          ? scheduleRows.length ? '课表已更新' : '教务确认本学期暂无课程，已清除旧课程与提醒'
          : '课程已读取，但本机课表保存失败；请检查存储空间后重试',
        cacheSaved
          ? rem?.count
            ? `已安排 ${rem.count} 条上课提醒`
            : auth.isSigned
              ? (rem?.message ? `上课提醒未安排：${rem.message}` : '')
              : '登录后才会安排上课提醒（提醒按账号隔离）'
          : '',
        extras.length ? extras.join(' · ') : '',
      ]
        .filter(Boolean)
        .join('；')
      showMsg(notice, !cacheSaved || !gradesSaved || !examsSaved)
      if (cacheSaved) {
        const weeks = [...new Set(scheduleRows.map((r) => Number(r.week)).filter(Boolean))].sort(
          (a, b) => a - b,
        )
        if (weeks.length) setCurrentWeek(weeks.includes(thisWeek) ? thisWeek : weeks[0])
      }
      return
    } catch (e) {
      if (!isAcademicSyncCurrent(syncRun)) return
      const err = e as TimetableError
      showMsg(err.message || '查询失败', true)
      if (err.code === '1001') {
        /* 验证码错/会话过期：自动换图并清空验证码输入（loadCaptcha 内已清空） */
        void loadCaptcha()
      } else if (err.code === '1004') {
        /* 被限流：按后端 Retry-After 做冷却倒计时，冷却期间禁用提交 */
        setCooldown(clamp(Math.round(err.retryAfter || 60), 5, 180))
      }
    } finally {
      if (isQbankSessionCurrent(session)) setSyncRequest(null)
    }
  }

  /**
   * 免手输：交给服务端 OCR 识别验证码（/api/timetable/auto）。
   * 成功后课表/成绩/考试一并落库并重排提醒（runAutoSync 内部已处理）；
   * 识别不出来时，把服务端**已经取好的**验证码图直接填进表单，用户接着手输即可——
   * 不会白跑一次请求，也不会和手输流程抢 sid。
   */
  async function onAutoSubmit() {
    if (!requireSigned('bind') || cooldown > 0 || submitting) return
    const id = stuid.trim()
    if (!id || !pwd) {
      showMsg('请先填写学号和教务密码', true)
      return
    }
    const session = captureQbankSession()
    const syncRun = beginAcademicSync(session)
    setSyncRequest('auto')
    showMsg('正在由服务端识别验证码并登录教务…')
    try {
      const r = await runAutoSync({ stuid: id, password: pwd, run: syncRun })
      if (!isAcademicSyncCurrent(syncRun)) return
      if (r.ok) {
        setRows(r.rows)
        rowsBeforeBind.current = null
        setPwd(rememberPwd ? pwd : '')
        const credentialsSaved = saveTimetableCredentials({
          stuid: id,
          password: pwd,
          rememberStuid: remember,
          rememberPassword: rememberPwd,
        }, session)
        if (!isAcademicSyncCurrent(syncRun)) return
        const weeks = [...new Set(r.rows.map((x) => Number(x.week)).filter(Boolean))].sort(
          (a, b) => a - b,
        )
        if (weeks.length) setCurrentWeek(weeks.includes(thisWeek) ? thisWeek : weeks[0])
        /* 同上：访客同步得到的是本机缓存，提醒要等登录后才会排上 */
        showMsg(
          [r.message || '已自动同步课表', r.reminderStatus, credentialsSaved ? '' : '本机账号信息未保存，请检查存储空间后重试']
            .filter(Boolean)
            .join('；'),
          !credentialsSaved || !!r.reminderStatus,
        )
        return
      }
      /* 自动识别不可用 / 失败：把服务端已经取到的验证码直接用起来 */
      if (r.needCaptcha && r.captchaSid && r.captchaImage) {
        captchaSession.current = session
        setSid(r.captchaSid)
        setCapImg(r.captchaImage)
        setCaptcha('')
      }
      showMsg(r.message || '自动同步没成功，请手输验证码后重试', true)
    } catch (e) {
      if (!isAcademicSyncCurrent(syncRun)) return
      const err = e as TimetableError
      showMsg(err.message || '自动同步失败', true)
      if (err.code === '1004') setCooldown(clamp(Math.round(err.retryAfter || 60), 5, 180))
    } finally {
      if (isQbankSessionCurrent(session)) setSyncRequest(null)
    }
  }

  function showMsg(text: string, err = false) {
    setMsg(text || '')
    setMsgErr(!!err)
  }

  function changeTermStart(value: string) {
    if (!isQbankSessionCurrent(ownerSession)) return
    if (value === termStart) return
    if (!saveScheduleTermStart(value)) {
      showMsg('学期开始日期没有保存，请检查登录状态和设备存储后重试。', true)
      return
    }
    setTermStart(value)
    const week = guessTeachingWeek()
    setCurrentWeek(week)
    setDayFocus(todayDayIdx())
    showMsg(loadScheduleCache().rows.length
      ? '学期日期已保存。为避免旧课表错位，请重新同步；旧快照保留供核对，首页与提醒会先暂停使用。'
      : '学期开始日期已保存，之后同步的课表将按此日期计算周次。')
  }

  function applyAiScheduleChanges(changes: ScheduleAiChange[]): boolean {
    if (!requireSigned('ai')) return false
    const session = captureQbankSession()
    const selected = changes.filter((item) => item.selected)
    if (!selected.length) return false
    const dayChanges = selected.filter((item) => item.kind === 'off' || item.kind === 'makeup')
    const courseChanges = selected.filter((item) => item.kind === 'add' || item.kind === 'cancel' || item.kind === 'replace')
    const saved = upsertConfirmedScheduleChanges(dayChanges.map((item) => ({
      date: item.date,
      kind: item.kind as 'off' | 'makeup',
      ...(item.kind === 'makeup' ? { treatAsDay: item.treatAsDay || undefined } : {}),
      label: item.kind === 'off' ? 'AI 确认的整日停课' : `AI 确认：按${dayName(item.treatAsDay || 1)}课表上课`,
    })), courseChanges.map((item) => ({
      date: item.date,
      kind: item.kind as 'add' | 'cancel' | 'replace',
      name: item.courseName || item.targetName,
      sections: item.sections,
      room: item.room,
      teacher: item.teacher,
      ...(item.targetName ? { targetName: item.targetName } : {}),
      ...(item.targetSections.length ? { targetSections: item.targetSections } : {}),
      label: item.summary,
    })))
    if (!saved) {
      showMsg('调整没有保存，原课表未改变；请检查设备存储后重试。', true)
      return false
    }
    const firstDate = new Date(`${selected[0].date}T12:00:00`)
    const firstWeek = Number.isFinite(firstDate.getTime()) ? teachingWeekForDate(firstDate) : Number.NaN
    const canOpenFirstChange = Number.isFinite(firstWeek) && weekRange.includes(firstWeek)
    if (canOpenFirstChange) {
      setCurrentWeek(firstWeek)
      setDayFocus(((firstDate.getDay() + 6) % 7) + 1)
      setView('day')
    }
    void finishAiScheduleApply(selected.length, session, canOpenFirstChange ? selected[0].date : '')
    return true
  }

  async function finishAiScheduleApply(count: number, session: ReturnType<typeof captureQbankSession>, reviewDate: string) {
    const reminders = await refreshCal()
    if (!isQbankSessionCurrent(session)) return
    const reminderWarnings = [
      reminders.plan?.status === 'failed' ? reminders.plan.message : '',
      reminders.overlay?.status === 'failed' ? reminders.overlay.message : '',
    ].filter(Boolean)
    const reminderInfo = [
      reminders.message,
      reminders.plan?.status === 'inactive' ? reminders.plan.message : '',
    ].filter(Boolean)
    const reminderText = reminderWarnings.length
      ? `提醒排程需核对：${[...new Set(reminderWarnings)].join('；')}`
      : `提醒状态：${[...new Set(reminderInfo)].join('；')}`
    const reviewNote = reviewDate ? `已切到首项调整日期 ${reviewDate}，可直接检查课表。` : '请在个人校历中查看调整日期。'
    showMsg(`已保存 ${count} 项到本机个人校历；${reviewNote}不会修改教务系统，也暂不跨设备同步。${reminderText}`, reminderWarnings.length > 0)
  }

  function onReQuery() {
    if (!requireSigned('bind')) return
    rowsBeforeBind.current = rows.length ? rows : loadScheduleCache().rows
    setRows([])
    setSheet(null)
    setCaptcha('')
    setPwd(loadSavedPassword())
    setStuid(loadSavedStuid(ownerSession))
    setBindOpen(true)
    if (bindOpen) void loadCaptcha()
  }

  function exportCalendar() {
    if (!requireSigned('export')) return
    if (!rows.length) { showMsg('请先绑定并同步当前账号的课表', true); return }
    downloadIcs(`课表-${stuid || 'sunshine'}.ics`, buildScheduleIcs(rows))
    showMsg('已导出 ICS，可导入系统日历 / Google 日历')
  }

  const hasData = rows.length > 0
  const cachedSnapshot = loadScheduleCache()
  const cachedStudentId = scheduleStudentIdForSnapshot(cachedSnapshot, stuid, ownerSession.uid)
  const cachedScheduleStatus = validateScheduleSnapshot(cachedSnapshot, cachedStudentId, new Date(), undefined, ownerSession.uid)
  const cachedScheduleNotice = cachedSnapshot.rows.length && cachedScheduleStatus.status !== 'ready'
    ? describeScheduleSnapshotStatus(cachedScheduleStatus.status)
    : null
  /** 本学期出现的完整周次范围（含没课的周，保证胶囊条连续） */
  const weekRange = useMemo(() => {
    const ws = [...new Set(rows.map((r) => Number(r.week)).filter(Boolean))]
    if (!ws.length) return [] as number[]
    const lo = Math.min(...ws)
    const hi = Math.max(...ws)
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
  }, [rows])

  /** 切周时把当前胶囊滚进可视区 */
  useEffect(() => {
    stripRef.current
      ?.querySelector<HTMLElement>(`[data-active="1"]`)
      ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [currentWeek, weekRange.length])

  const todayStatus = useMemo(() => getDayStatus(new Date()), [calTick])
  const todayCalDay = todayDayIdx()
  const todayRows = getScheduleRowsForDate(new Date(), rows)
  const todayGroups = groupRows(todayRows, guessTeachingWeek())
  const todayList = todayGroups[todayStatus.effectiveDay] ?? []
  const todayClock = tmCustom ? tm : getOfficialPeriods(new Date())
  const nowSec = currentSection(todayClock)
  const dateLabel = `${new Date().getMonth() + 1}月${new Date().getDate()}日 ${WEEK_CN[new Date().getDay()]}`
  /** 始终展示周一至周日，方便有周末课的同学 */
  const visibleDays = useMemo(() => [1, 2, 3, 4, 5, 6, 7], [])
  const dayDates = useMemo(
    () => visibleDays.map((d) => dateOfTeachingDay(currentWeek, d, termStart)),
    [visibleDays, currentWeek, termStart],
  )
  /** 周视图每列：按该日放假/调课取对应星期的课 */
  const columnGroups = useMemo(() => {
    void calTick
    return visibleDays.map((calDay, i) => {
      const d = dayDates[i]
      const st = getDayStatus(d)
      const dayRows = getScheduleRowsForDate(d, rows)
      const projected = groupRows(dayRows, teachingWeekForDate(d))
      return { calDay, status: st, groups: projected[st.effectiveDay] ?? [] }
    })
  }, [visibleDays, dayDates, rows, termStart, calTick])

  function clockFor(date: Date) {
    return tmCustom ? tm : getOfficialPeriods(date)
  }
  const afternoonStarts = dayDates.map((d) => clockFor(d)[4]?.[0] || '')
  const mixedClock = new Set(afternoonStarts).size > 1
  function clashes(list: CellGroup[], g: CellGroup) {
    return list.filter((other) => other !== g && other.start <= g.end && g.start <= other.end)
  }
  const focusCol = columnGroups.find((col) => col.calDay === dayFocus) || columnGroups[0]
  const focusDate = dayDates[dayFocus - 1] ?? new Date()
  const focusClock = clockFor(focusDate)
  const focusCourses = focusCol?.groups ?? []
  const isFocusedToday = toDateKey(focusDate) === toDateKey(new Date(nowTick))
  const isFocusedPast = focusDate.getTime() < new Date(`${toDateKey(new Date(nowTick))}T00:00:00`).getTime()
  const focusMinutesNow = new Date(nowTick).getHours() * 60 + new Date(nowTick).getMinutes()
  const completedCourses = focusCourses.filter(g => isFocusedPast || (isFocusedToday && toMin(focusClock[g.end - 1]?.[1] ?? '23:59') < focusMinutesNow)).length
  const lessonMinutes = focusCourses.reduce((sum, g) => {
    const start = focusClock[g.start - 1]?.[0], end = focusClock[g.end - 1]?.[1]
    return sum + (start && end ? Math.max(0, toMin(end) - toMin(start)) : 0)
  }, 0)
  const selectedDateLabel = `${focusDate.getMonth() + 1}月${focusDate.getDate()}日 ${DAYS[dayFocus - 1]}`
  const openCol = sheet ? columnGroups.find((col) => col.groups.includes(sheet)) : null
  const openHits = openCol && sheet ? clashes(openCol.groups, sheet) : []
  const openClock = openCol ? clockFor(dayDates[openCol.calDay - 1]!) : todayClock

  /** 顶部「下一节课」卡片：正在上的课优先，其次取今天第一节未开始的课，仅用于展示 */
  const nextInfo = useMemo<{
    g: CellGroup
    ongoing: boolean
    clock: string
    room: string
    label: string
  } | null>(() => {
    if (todayStatus.off) return null
    const now = new Date(nowTick)
    const mins = now.getHours() * 60 + now.getMinutes()
    for (const g of todayList) {
      const s = toMin(todayClock[g.start - 1]?.[0] ?? '08:00')
      const e = toMin(todayClock[g.end - 1]?.[1] ?? '18:00')
      if (mins >= s && mins <= e) {
        const left = e - mins
        return {
          g,
          ongoing: true,
          clock: sectionTime(todayClock, g.start, g.end),
          room: g.room,
          label: left <= 0 ? '即将下课' : `${left} 分钟后下课`,
        }
      }
      if (mins < s) {
        const diff = s - mins
        return {
          g,
          ongoing: false,
          clock: sectionTime(todayClock, g.start, g.end),
          room: g.room,
          label: diff <= 0 ? '马上开始' : `${diff} 分钟后开始`,
        }
      }
    }
    return null
  }, [todayStatus.off, todayList, todayClock, nowTick])

  return (
    <div className={styles.page}>
      <PageHeader
        title="课表"
        right={<div className={styles.headerActions}>
          <Link to="/meet" className={styles.textBtn} aria-label="碰个空，找同学一起活动">碰个空</Link>
          <Link to="/settings?section=reminders" className={styles.textBtn} aria-label="上课与考试提醒设置">提醒</Link>
          {hasData ? <button type="button" className={styles.textBtn} onClick={onReQuery}>换账号</button> : null}
        </div>}
      />

      <div className={styles.v4Hero} aria-hidden="true">
        <img className={styles.v4Wordmark} src="/brand/ohu-original/ohu-wordmark-transparent.png" alt="" width="104" height="60" />
        <p><strong>加油！</strong><br />今天也是元气满满<br />的学习日！<span>♥</span></p>
        <FoxSheetPose className={styles.v4Fox} pose="waving" />
      </div>

      {cachedScheduleNotice ? (
        <section className={styles.cacheNotice} role="status" aria-live="polite">
          <div><strong>{cachedScheduleNotice.title}</strong><p>{cachedScheduleNotice.detail}</p></div>
          <button type="button" onClick={onReQuery} disabled={submitting}>重新同步</button>
        </section>
      ) : null}

      {Capacitor.getPlatform() === 'android' ? (
        <details className={styles.widgetGuide}>
          <summary>把课表放到手机桌面</summary>
          <p>在手机桌面空白处长按，选择“小组件”→“哦狐”，添加“今日课表”或“下一节课”。同步过的课表会保留在本机供桌面显示；切换哦狐账号或退出登录时会清除。轻触桌面卡片可直接打开课表。</p>
          <small>桌面卡片可能被他人看到，请按需添加。</small>
        </details>
      ) : null}

      {!hasData ? (
        /* ---------- 绑定教务账号 ---------- */
        <div className={`${styles.loginCard} ${styles.v4LoginCard}`}>
          {!bindOpen ? (
            <EmptyState
              title="还没有绑定课表"
              hint="绑定教务账号后，自动同步课表、成绩与考试安排"
              action={
                <button type="button" onClick={onReQuery}>
                  绑定课表
                </button>
              }
            />
          ) : (
            <>
          <div className={styles.hero}>
            <h2>{rememberPwd && stuid && pwd ? '一键同步课表' : '绑定教务账号'}</h2>
            <p>
              通过学校教务抓取课表（云端代登，App 不直连 WebVPN）。
              <br />
              点「自动同步」由服务端识别验证码、免手输；识别不出来时再手输一次即可。
            </p>
            <button type="button" className={styles.textBtn} disabled={submitting} onClick={() => {
              setBindOpen(false)
              setPwd('')
              setStuid('')
              setCaptcha('')
              setSid('')
              setCapImg('')
              setRows(rowsBeforeBind.current ?? loadScheduleCache().rows)
              rowsBeforeBind.current = null
            }}>返回浏览</button>
          </div>
          {!stuid && hasUnboundCampusCredentials() ? <p className={styles.captchaTip}>旧版保存的账号信息仍保留在本机。为保护账号，请重新输入并保存到当前哦狐账号。</p> : null}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="sch-stuid">学号</label>
            <input
              id="sch-stuid"
              className={styles.input}
              placeholder="例如 2023123456"
              autoComplete="username"
              disabled={submitting}
              value={stuid}
              onChange={(e) => setStuid(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="sch-pwd">教务密码</label>
            <PasswordInput
              id="sch-pwd"
              className={styles.input}
              placeholder="••••••••"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="sch-cap">验证码</label>
            <div className={styles.captchaRow}>
              <input
                id="sch-cap"
                className={styles.input}
                placeholder="输入右侧字符"
                maxLength={10}
                autoComplete="off"
                value={captcha}
                onChange={(e) => setCaptcha(e.target.value)}
                disabled={submitting || capLoading}
              />
              {capLoading ? (
                <div className={styles.captchaState}><FoxRequestIndicator label="获取中…" /></div>
              ) : capImg ? (
                <img
                  className={styles.captchaImg}
                  src={capImg || undefined}
                  alt="验证码"
                  title={cooldown > 0 ? `请稍候 ${cooldown}s 再刷新` : '看不清？点击刷新'}
                  onClick={() => {
                    if (!cooldown && !submitting) void loadCaptcha()
                  }}
                />
              ) : msgErr ? (
                <div className={styles.captchaState}>
                  <ErrorState
                    compact
                    title="验证码加载失败"
                    hint={cooldown > 0 ? `操作过于频繁，请稍候 ${cooldown}s` : '点下方按钮重新获取'}
                    action={
                      <button
                        type="button"
                        onClick={() => void loadCaptcha()}
                        disabled={cooldown > 0 || submitting}
                      >
                        重试
                      </button>
                    }
                  />
                </div>
              ) : (
                <button type="button" className={styles.captchaState} disabled={submitting || cooldown > 0} onClick={() => void loadCaptcha()}>获取验证码</button>
              )}
            </div>
            <p className={styles.captchaTip}>
              {cooldown > 0 ? `操作过于频繁，请稍候 ${cooldown}s` : '看不清？点图片刷新'}
            </p>
          </div>
          <label className={styles.remember}>
            <input type="checkbox" checked={remember} disabled={submitting} onChange={(e) => setRemember(e.target.checked)} />
            记住学号
          </label>
          <label className={styles.remember}>
            <input
              type="checkbox"
              checked={rememberPwd}
              disabled={submitting}
              onChange={(e) => {
                setRememberPwd(e.target.checked)
                if (!e.target.checked) clearSavedPassword(ownerSession)
              }}
            />
            记住密码（仅本机，便于下次一键同步）
          </label>
              <button
                className={styles.btn}
                type="button"
                onClick={() => void onSubmit()}
                disabled={submitting || cooldown > 0}
                aria-busy={syncRequest === 'manual'}
              >
                {syncRequest === 'manual'
                  ? <FoxRequestIndicator label="正在查询…" pose="studying" />
                  : cooldown > 0
                    ? `请稍候 ${cooldown}s`
                    : rememberPwd && pwd
                      ? '一键同步课表'
                      : '开始查询'}
              </button>
              {/*
                免手输通道：服务端 OCR 识别验证码（/api/timetable/auto）。
                没填验证码也能点；识别不出来会自动把手输验证码框填好，用户接着输即可。
              */}
              <button
                className={styles.btnAlt}
                type="button"
                onClick={() => void onAutoSubmit()}
                disabled={submitting || cooldown > 0 || !stuid.trim() || !pwd}
                aria-busy={syncRequest === 'auto'}
                title="由服务端识别验证码，无需手输"
              >
                {syncRequest === 'auto' ? <FoxRequestIndicator label="正在同步…" pose="studying" /> : '自动同步（免验证码）'}
              </button>
              {msg && !msgErr && !submitting ? <p className={styles.formMsgOk}>{msg}</p> : null}
              {msgErr && msg && capImg ? (
                <ErrorState
                  compact
                  title={msg}
                  hint="检查学号、密码与验证码后可以重试"
                  action={
                    <button
                      type="button"
                      onClick={() => void onSubmit()}
                      disabled={submitting || cooldown > 0}
                    >
                      重试
                    </button>
                  }
                />
              ) : null}
            </>
          )}
          <button type="button" className={styles.scheduleStudyAiLink} onClick={() => setScheduleImageOpen(true)}>拍照上传课表，AI 一键整理 <span aria-hidden="true">›</span></button>
          <Link className={styles.scheduleStudyAiLink} to="/schedule/guide">查询本校及其他学校的官方课表入口 <span aria-hidden="true">›</span></Link>
        </div>
      ) : (
        /* ---------- 课表视图 ---------- */
        <>
          {cachedSnapshot.meta?.source === 'photo' ? <div className={styles.schedulePhotoSource} role="status">
            <span>当前课表来自照片识别 · 请以核对后的内容为准</span>
            {hasScheduleBeforePhoto(ownerSession) ? <button type="button" onClick={() => {
              if (!restoreScheduleBeforePhoto(ownerSession)) { showMsg('恢复原教务课表失败，请稍后重试', true); return }
              const restored = loadScheduleCache()
              setRows(restored.rows); setTermStart(getScheduleTermStart(ownerSession.uid))
              showMsg('已恢复导入前的课表'); void rescheduleClassReminders().catch(() => undefined)
            }}>恢复原课表</button> : null}
          </div> : null}
          <nav className={styles.v4WeekNav} aria-label="选择课表日期">
            <button type="button" className={styles.v4WeekArrow} aria-label="上一周" disabled={currentWeek <= (weekRange[0] ?? 1)} onClick={() => setCurrentWeek(w => Math.max(weekRange[0] ?? 1, w - 1))}>‹</button>
            <div className={styles.v4Days} ref={stripRef}>
              {columnGroups.map((col, index) => <button type="button" key={col.calDay}
                className={`${styles.v4Day} ${dayFocus === col.calDay ? styles.v4DayActive : ''}`}
                data-active={dayFocus === col.calDay ? '1' : '0'}
                aria-pressed={dayFocus === col.calDay}
                aria-label={`${DAYS[col.calDay - 1]} ${fmtMd(dayDates[index]!)}${col.status.off ? '，放假' : ''}`}
                onClick={() => { setDayFocus(col.calDay); setView('day') }}>
                <strong>{DAYS[col.calDay - 1]}</strong><small>{fmtMd(dayDates[index]!)}</small>
              </button>)}
            </div>
            <button type="button" className={styles.v4WeekArrow} aria-label="下一周" disabled={currentWeek >= (weekRange[weekRange.length - 1] ?? currentWeek)} onClick={() => setCurrentWeek(w => Math.min(weekRange[weekRange.length - 1] ?? w, w + 1))}>›</button>
          </nav>

          <button type="button" className={styles.scheduleAiButton} onClick={() => { if (requireSigned('ai')) {
            const referenceDate = dayDates[dayFocus - 1]
            setScheduleAiContext(referenceDate ? {
              date: toDateKey(referenceDate), dayLabel: DAYS[dayFocus - 1] || '',
              courseName: '', sections: [], room: '', teacher: '',
            } : null)
            setScheduleAiOpen(true)
          } }}>
            <svg className={styles.scheduleAiIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z"/></svg><span><strong>AI 一句话改课表</strong><small>粘贴老师通知或写一句调整要求；预览确认后，仅修改指定日期的本机个人课表</small></span><svg className={styles.scheduleAiChevron} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
          </button>
          <details className={styles.scheduleMoreTools}>
            <summary><span><strong>更多课表工具</strong><small>学习 AI、多人课表与官方课表入口</small></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg></summary>
            <div className={styles.scheduleMoreLinks}>
              <Link className={styles.scheduleStudyAiLink} to="/study?tab=ai">打开学习中心的 8 项 AI 工具 <span aria-hidden="true">›</span></Link>
              <button type="button" className={styles.scheduleStudyAiLink} onClick={() => { if (requireSigned('group')) setScheduleGroupOpen(true) }}>分享课表、导入同学课表 <span aria-hidden="true">›</span></button>
              <button type="button" className={styles.scheduleStudyAiLink} onClick={() => setScheduleImageOpen(true)}>拍照上传课表，AI 一键整理 <span aria-hidden="true">›</span></button>
              <Link className={styles.scheduleStudyAiLink} to="/schedule/guide">查询本校及其他学校的官方课表入口 <span aria-hidden="true">›</span></Link>
            </div>
          </details>
          {msg ? <p className={msgErr ? styles.bannerErr : styles.bannerOk} role={msgErr ? 'alert' : 'status'}>{msg}</p> : null}

          <div className={styles.v4SectionHead}>
            <div><h2>{view === 'day' ? isFocusedToday ? '今日课表' : '当日课表' : '本周课表'} <span aria-hidden="true">🐾</span></h2><span>{selectedDateLabel} · 第{currentWeek}周</span></div>
            <button type="button" onClick={() => setView(view === 'day' ? 'week' : 'day')} aria-pressed={view === 'week'}>{view === 'day' ? '本周课表 ›' : '返回日程 ›'}</button>
          </div>

          {view === 'day' ? <section className={styles.v4Timeline} aria-label={`${selectedDateLabel}课程`}>
            {focusCol.status.off ? <EmptyState title={focusCol.status.label || '今天不上课'} hint="课程安排已按假期和调课规则调整" /> : focusCourses.length ? (
              focusCourses.map((g, index) => {
                const palette = colorOf(g.name)
                const startTime = focusClock[g.start - 1]?.[0] ?? '--:--'
                const endTime = focusClock[g.end - 1]?.[1] ?? '--:--'
                const ongoing = isFocusedToday && toMin(startTime) <= focusMinutesNow && focusMinutesNow <= toMin(endTime)
                const upcoming = isFocusedToday && toMin(startTime) > focusMinutesNow
                const isLunchBreak = index > 0 && focusCourses[index - 1]!.end <= 4 && g.start >= 5
                return <div className={styles.v4TimelineItem} key={`${g.day}-${g.start}-${g.name}`}>
                  {isLunchBreak ? <div className={styles.v4Lunch}><span className={styles.v4LunchSun} aria-hidden="true">☀</span><span className={styles.v4LunchCopy}>午休时间 · 给自己补充能量</span><FoxSheetPose pose="resting" /></div> : null}
                  <div className={styles.v4TimelineRow}>
                    <div className={styles.v4Time}><strong>{startTime}</strong><span>{endTime}</span><i aria-hidden="true" /></div>
                    <button type="button" className={`${styles.v4Course} ${ongoing ? styles.v4CourseNow : ''} ${index === 0 && g.name.length < 14 ? styles.v4CourseWithFox : ''}`} style={{ background: `linear-gradient(100deg, ${palette.bg}, color-mix(in srgb, ${palette.bg} 44%, #fffdf7))` }} onClick={() => setSheet(g)} aria-haspopup="dialog" aria-label={`${g.name}，${startTime}到${endTime}，查看课程详情`}>
                      <span className={styles.v4CourseIcon} style={{ color: palette.fg }}><ScheduleTypeIcon name={g.name} size={24} /></span>
                      <span className={styles.v4CourseText}><strong>{g.name}</strong><small>{[g.teacher, g.room].filter(Boolean).join(' · ') || '教室和教师未提供'}</small></span>
                      {index === 0 && g.name.length < 14 ? <FoxSheetPose className={styles.v4CourseFox} pose="reading" /> : null}
                      {ongoing ? <span className={styles.v4Status}>进行中</span> : upcoming && index === focusCourses.findIndex(item => toMin(focusClock[item.start - 1]?.[0] ?? '23:59') > focusMinutesNow) ? <span className={styles.v4StatusNext}>下节课</span> : <span className={styles.v4Chevron} aria-hidden="true">›</span>}
                    </button>
                  </div>
                </div>
              })
            ) : <EmptyState title="这一天没有课程" hint="可以切换日期，看看本周其他安排" />}
          </section> : null}

          {view === 'day' ? <div className={styles.v4BottomCards}>
            <Link className={styles.v4ReminderCard} to="/study?tab=exams"><strong>重要提醒 <span aria-hidden="true">🔔</span></strong><span>{academicCounts.exams ? `已同步 ${academicCounts.exams} 场考试，查看考试安排` : '考试安排同步后会显示在这里'}</span><small>查看考试安排 ›</small></Link>
            <div className={styles.v4Encourage}><strong>保持状态！</strong><span>今天也和阿狐一起前进</span><FoxSheetPose pose="cool" /></div>
          </div> : null}

          {view === 'day' ? <section className={styles.v4Summary} aria-label="所选日期课程小结"><h2>当日课程小结</h2><div><span><strong>{focusCourses.length}</strong> 节课<small>所选日期</small></span><span><strong>{completedCourses}/{focusCourses.length}</strong><small>已结束</small></span><span><strong>{lessonMinutes ? `${Math.round(lessonMinutes / 60 * 10) / 10}` : '0'}</strong> 小时<small>课程时长</small></span></div><FoxSheetPose pose="cheering" /></section> : null}

          <details className={styles.v4Tools}><summary>课表工具与同步信息 <span>展开设置 ›</span></summary>
          {/* 今日速览 */}
          <div className={styles.todayCard}>
            <div className={styles.todayHead}>
              <div className={styles.todayHeadMain}>
                <h3>今日课程</h3>
                <span>{dateLabel} · 第 {currentWeek} 周</span>
              </div>
              <span className={styles.weekPill}>第 {currentWeek} 周</span>
            </div>
            {todayStatus.off ? (
              <p className={styles.todayEmpty}>
                {todayStatus.label || '法定节假日'} · 今天不用上课
              </p>
            ) : todayStatus.kind === 'makeup' && todayStatus.effectiveDay !== todayStatus.calendarDay ? (
              <p className={styles.calBanner}>
                今天调课：上{dayName(todayStatus.effectiveDay)}的课
                {todayStatus.label ? `（${todayStatus.label}）` : ''}
              </p>
            ) : null}
            {nextInfo ? (
              <div className={`${styles.nextCard} ${nextInfo.ongoing ? styles.nextNow : ''}`}>
                <div className={styles.nextMain}>
                  <span className={styles.nextKicker}>{nextInfo.ongoing ? '正在上' : '下一节课'}</span>
                  <b className={styles.nextName}>{nextInfo.g.name}</b>
                  <span className={styles.nextMeta}>
                    {nextInfo.clock}
                    {nextInfo.room ? ` · @${nextInfo.room}` : ''}
                  </span>
                </div>
                <span className={styles.nextCount}>{nextInfo.label}</span>
              </div>
            ) : null}
            {!todayStatus.off && todayList.length ? (
              <div className={styles.todayList}>
                {todayList.map((g, i) => {
                  const c = colorOf(g.name)
                  return (
                    <div
                      key={`td-${i}`}
                      className={`${styles.miniCourse} ${
                        nowSec >= g.start && nowSec <= g.end ? styles.miniNow : ''
                      }`}
                      onClick={() => setSheet(g)}
                    >
                      <div className={styles.miniTime}>
                        第{g.start}-{g.end}节
                        <br />
                        {sectionTime(tm, g.start, g.end)}
                      </div>
                      <div className={styles.miniBody}>
                        <span className={styles.miniName} style={{ color: c.fg }}>{g.name}</span>
                        <span className={styles.miniMeta}>
                          {[g.room && `@${g.room}`, g.teacher].filter(Boolean).join(' · ') || '教室待定'}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : !todayStatus.off ? (
              <EmptyState compact title="今天没有课程安排" hint="今天没有课，好好休息" />
            ) : null}
            <Link className={styles.todoLink} to="/todo">
              <span>作业、工作任务放「待办」</span>
              <span className={styles.todoLinkArrow}>去记录 ›</span>
            </Link>
            <Link className={styles.todoLink} to="/study/focus">
              <span>番茄专注：屏蔽消息，狐狸陪你倒计时</span>
              <span className={styles.todoLinkArrow}>去专注 ›</span>
            </Link>
            <Link className={styles.todoLink} to="/study?tab=grades">
              <span>
                成绩 · 考试安排
                {academicCounts.grades || academicCounts.exams
                  ? `（已同步 ${academicCounts.grades} 门成绩 · ${academicCounts.exams} 场考试）`
                  : '（同步后在此查看）'}
              </span>
              <span className={styles.todoLinkArrow}>去查看 ›</span>
            </Link>
            <Link className={styles.todoLink} to="/study?tab=ports">
              <span>教务账号管理 · 学校平台入口</span>
              <span className={styles.todoLinkArrow}>去管理 ›</span>
            </Link>
            <div className={styles.exportRow}>
              <button
                type="button"
                className={styles.exportBtn}
                onClick={exportCalendar}
              >
                导出日历（ICS）
              </button>
              <button
                type="button"
                className={styles.exportBtnGhost}
                onClick={() => {
                  if (!requireSigned('bind')) return
                  setRows([])
                  setPwd('')
                  setBindOpen(true)
                  showMsg('已退出课表视图，可重新绑定教务', false)
                }}
              >
                重新绑定
              </button>
            </div>
          </div>
          </details>

          {/* 周视图 */}
          <div className={styles.viewCard} hidden={view !== 'week'}>
            <div className={styles.weekStrip}>
              <button
                className={styles.navChip}
                onClick={() => setCurrentWeek((w) => Math.max(weekRange[0] ?? 1, w - 1))}
                aria-label="上一周"
              >
                ‹
              </button>
              {weekRange.map((w) => (
                <button
                  key={w}
                  data-active={w === currentWeek ? '1' : '0'}
                  className={`${styles.weekChip} ${w === currentWeek ? styles.active : ''} ${
                    w === thisWeek ? styles.current : ''
                  }`}
                  onClick={() => setCurrentWeek(w)}
                >
                  第{w}周
                </button>
              ))}
              <button
                className={styles.navChip}
                onClick={() => setCurrentWeek((w) => Math.min(weekRange[weekRange.length - 1] ?? NS, w + 1))}
                aria-label="下一周"
              >
                ›
              </button>
            </div>

            <div className={styles.gridWrap} hidden={view === 'day'}>
              <div className={`${styles.grid} ${styles.grid7}`}>
                <div />
                {columnGroups.map((col, i) => {
                  const d = col.calDay
                  const isToday = d === todayCalDay && currentWeek === thisWeek
                  return (
                    <div
                      key={`hd-${d}`}
                      className={`${isToday ? styles.hdToday : styles.hd} ${
                        d >= 6 && !isToday ? styles.hdWeekend : ''
                      }`}
                    >
                      <span className={styles.hdWeek}>{DAYS[d - 1]}</span>
                      <span className={styles.hdDate}>{fmtMd(dayDates[i]!)}</span>
                      {mixedClock ? <span className={styles.hdDate}>下午 {afternoonStarts[i]}</span> : null}
                      {col.status.off ? (
                        <span className={styles.hdTagOff}>休</span>
                      ) : col.status.kind === 'makeup' && col.status.effectiveDay !== d ? (
                        <span className={styles.hdTagMakeup}>调{dayName(col.status.effectiveDay)[1]}</span>
                      ) : null}
                    </div>
                  )
                })}
                {/* 时间轴 */}
                {tm.map((row, i) => (
                  <div
                    key={`ax-${i}`}
                    className={nowSec === i + 1 ? `${styles.axis} ${styles.axisNow}` : styles.axis}
                    style={{ gridArea: `${i + 2} / 1 / ${i + 3} / 2` }}
                  >
                    <span className={styles.axisSn}>{i + 1}</span>
                    <span>{row[0]}</span>
                    <span>{row[1]}</span>
                  </div>
                ))}
                {/* 每天一列（含放假清空 / 调课换星期） */}
                {columnGroups.map((col, idx) => {
                  const d = col.calDay
                  const isToday = d === todayCalDay && currentWeek === thisWeek
                  return (
                    <div
                      key={`col-${d}`}
                      className={`${styles.col} ${isToday ? styles.colToday : ''} ${
                        col.status.off ? styles.colOff : ''
                      } ${d >= 6 && !isToday ? styles.colWeekend : ''}`}
                      style={{ gridArea: `2 / ${idx + 2} / ${NS + 2} / ${idx + 3}` }}
                    >
                      {col.status.off ? (
                        <div className={styles.colOffLabel}>{col.status.label || '放假'}</div>
                      ) : (
                        col.groups.map((g, i) => {
                          const c = colorOf(g.name)
                          const hit = clashes(col.groups, g)
                          const clock = clockFor(dayDates[idx]!)
                          return (
                            <button
                              key={`${d}-${i}-${g.name}`}
                              type="button"
                              className={hit.length ? `${styles.cell} ${styles.cellClash}` : styles.cell}
                              style={{ gridArea: `${g.start} / 1 / ${g.end + 1} / 2`, background: c.bg, color: c.fg }}
                              aria-label={`${DAYS[d - 1]} ${g.name} 第${g.start}-${g.end}节 ${sectionTime(clock, g.start, g.end)}${g.room ? `，教室 ${g.room}` : ''}${hit.length ? '，有撞课' : ''}`}
                              aria-haspopup="dialog"
                              onClick={() => setSheet(g)}
                            >
                              <ScheduleTypeIcon name={g.name} className={styles.cellIcon} />
                              <span className={styles.cellName}>{g.name}</span>
                              <span className={styles.cellMeta}>{sectionTime(clock, g.start, g.end)}</span>
                              {g.room ? <span className={styles.cellMeta}>@{g.room}</span> : null}
                              {hit.length ? <span className={styles.cellTeacher}>撞课</span> : null}
                            </button>
                          )
                        })
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {view === 'day' && focusCol ? (
              <div className={styles.todayList}>
                <p className={styles.calBanner}>
                  {DAYS[focusCol.calDay - 1]} {fmtMd(dayDates[focusCol.calDay - 1]!)}
                  {focusCol.status.off ? ` · ${focusCol.status.label || '放假'}` : ` · 下午 ${afternoonStarts[focusCol.calDay - 1] || ''}`}
                </p>
                {focusCol.status.off ? null : focusCol.groups.map((g) => {
                  const hit = clashes(focusCol.groups, g)
                  const clock = clockFor(dayDates[focusCol.calDay - 1]!)
                  return (
                    <button key={`${g.name}-${g.start}`} type="button" className={styles.miniCourse} onClick={() => setSheet(g)}>
                      {g.name} · {sectionTime(clock, g.start, g.end)}
                      {g.room ? ` · ${g.room}` : ''}
                      {hit.length ? ` · 与${hit.map((item) => item.name).join('、')}撞课` : ''}
                    </button>
                  )
                })}
                {!focusCol.status.off && !focusCol.groups.length ? (
                  <EmptyState compact title="这一天没有课" />
                ) : null}
              </div>
            ) : null}

            <form
              className={styles.phraseForm}
              onSubmit={(e) => {
                e.preventDefault()
                if (!requireSigned('calendar')) return
                const res = applySchedulePhrase(phrase)
                showMsg(res.message, !res.ok)
                if (res.ok) {
                  setPhrase('')
                  refreshCal()
                }
              }}
            >
              <input
                className={styles.exportBtnGhost}
                value={phrase}
                placeholder="10月10日按周三课表上课"
                onChange={(e) => setPhrase(e.target.value)}
              />
              <button className={styles.exportBtn} type="submit">记下</button>
            </form>
            <div className={styles.termStartSetting}>
              <label htmlFor="schedule-term-start">本学期开始日期</label>
              <input
                id="schedule-term-start"
                type="date"
                value={termStart}
                onChange={(event) => changeTermStart(event.target.value)}
                aria-describedby="schedule-term-start-hint"
              />
              <small id="schedule-term-start-hint">教学周按周一至周日划分，第一周包含学期开始日期。修改后请重新同步课表，旧快照保留核对，首页和提醒暂时停用。</small>
            </div>
            <div className={styles.footerBar}>
              <span className={styles.footerHint}>
                共 {new Set(rows.map((r) => r.name)).size} 门课 · 当前第 {currentWeek} 周
                {mixedClock ? ' · 本周下午作息在 10 月 1 日换成 14:00' : ''}
              </span>
              <span className={styles.footerBtns}>
                <button className={styles.textBtn} onClick={() => setView(view === 'week' ? 'day' : 'week')}>
                  {view === 'week' ? '日视图' : '周视图'}
                </button>
                <button className={styles.textBtn} onClick={() => setDayFocus((d) => (d <= 1 ? 7 : d - 1))}>前一天</button>
                <button className={styles.textBtn} onClick={() => setDayFocus((d) => (d >= 7 ? 1 : d + 1))}>后一天</button>
                <button className={styles.textBtn} onClick={openCalSheet}>假期调课</button>
                <button className={styles.textBtn} onClick={openTmSheet}>
                  节次时间
                </button>
                <button className={styles.textBtn} onClick={() => setCurrentWeek(thisWeek)}>
                  回到本周
                </button>
              </span>
            </div>
          </div>
        </>
      )}

      {/* ---------- 课程详情 Sheet ---------- */}
      {sheet ? (
        <DialogLayer title={`${sheet.name}课程详情`} className={styles.sheet} onClose={() => setSheet(null)}>
            <div className={styles.sheetHeader}>
              <h3 className={styles.sheetTitle}>{sheet.name}</h3>
              <button type="button" className={styles.sheetClose} onClick={(event) => event.currentTarget.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))} aria-label="关闭课程详情">
                ✕
              </button>
            </div>
            <div className={styles.sheetBody}>
              <div className={styles.sheetRow}>
                <span className={styles.sheetLabel}>时间</span>
                <span>
                  {DAYS[sheet.day - 1]} 第{sheet.start}-{sheet.end}节
                  <br />
                  <span className={styles.sheetSub}>{sectionTime(openClock, sheet.start, sheet.end)}</span>
                </span>
              </div>
              <div className={styles.sheetRow}>
                <span className={styles.sheetLabel}>教室</span>
                <span>{sheet.room || '—'}</span>
              </div>
              <div className={styles.sheetRow}>
                <span className={styles.sheetLabel}>教师</span>
                <span>{sheet.teacher || '（教务未返回）'}</span>
              </div>
              {openHits.length ? (
                <div className={styles.sheetRow}>
                  <span className={styles.sheetLabel}>撞课</span>
                  <span>
                    {openHits.map((item) => `${item.name} 第${item.start}-${item.end}节${item.room ? ` @${item.room}` : ''}`).join('；')}
                  </span>
                </div>
              ) : null}
              <div className={styles.sheetRow}>
                <span className={styles.sheetLabel}>周次</span>
                <span>
                  {compressWeeks(sheet.allWeeks)
                    .split('/')
                    .map((w) => (
                      <span key={w} className={styles.sheetTag}>{w}周</span>
                    ))}
                </span>
              </div>
              <button
                type="button"
                className={styles.scheduleAiButton}
                onClick={() => {
                  if (!requireSigned('ai')) return
                  const courseDate = dayDates[sheet.day - 1]
                  setScheduleAiContext({
                    date: courseDate ? toDateKey(courseDate) : '',
                    dayLabel: DAYS[sheet.day - 1] || '',
                    courseName: sheet.name,
                    sections: Array.from({ length: sheet.end - sheet.start + 1 }, (_, index) => sheet.start + index),
                    room: sheet.room,
                    teacher: sheet.teacher,
                  })
                  setSheet(null)
                  setScheduleAiOpen(true)
                }}
              >
                <svg className={styles.scheduleAiIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z"/></svg><span><strong>用 AI 帮我调整这门课</strong><small>写一句这次要怎么改；AI 参考原安排，确认后只影响选定日期</small></span><svg className={styles.scheduleAiChevron} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
              </button>
            </div>
        </DialogLayer>
      ) : null}

      {/* ---------- 节次时间设置 Sheet ---------- */}
      {tmOpen ? (
        <DialogLayer title="节次时间" className={styles.sheet} onClose={() => setTmOpen(false)} allowClose={!tmSaving}>
            <div className={styles.sheetHeader}>
              <h3 className={styles.sheetTitle}>节次时间</h3>
              <button type="button" className={styles.sheetClose} disabled={tmSaving} onClick={(event) => event.currentTarget.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))} aria-label="关闭节次时间设置">
                ✕
              </button>
            </div>
            <div className={styles.sheetBody}>
              {legacyPeriods.count > 0 ? (
                <div className={styles.tmTip}>
                  <p>发现此设备旧版自定义作息。旧记录没有账号归属；确认属于你后，可复制到当前账号。原记录会保留。</p>
                  <button
                    type="button"
                    className={styles.calMiniBtn}
                    disabled={tmSaving || legacyPeriods.alreadyImported}
                    onClick={async () => {
                      if (!requireSigned('periods')) return
                      if (tmSaveBusy.current) return
                      const session = captureQbankSession()
                      tmSaveBusy.current = true
                      setTmSaving(true)
                      try {
                        const result = claimLegacyPeriodsForCurrentAccount()
                        if (!result.ok || !result.periods) {
                          setTmMsg(result.error || '旧作息恢复失败，请重试。')
                          return
                        }
                        setTm(result.periods)
                        setTmDraft(result.periods.map((period) => [...period] as PeriodPair))
                        setTmCustom(true)
                        setLegacyPeriods(getLegacyPeriodsImportStatus())
                        const saved = await savePeriods(result.periods)
                        if (!isQbankSessionCurrent(session)) return
                        setTmMsg(saved.error ? `旧作息已复制到本机；云端同步失败：${saved.error}` : '旧作息已复制到当前账号并同步。')
                        void rescheduleClassReminders().catch(() => undefined)
                      } finally {
                        tmSaveBusy.current = false
                        if (isQbankSessionCurrent(session)) setTmSaving(false)
                      }
                    }}
                  >
                    {legacyPeriods.alreadyImported ? '已复制到此账号' : '确认属于我，复制到此账号'}
                  </button>
                </div>
              ) : null}
              <p className={styles.tmTip}>
                默认已按江苏海洋大学教务处作息表（
                <a href="https://jwc.jou.edu.cn/jsfz1/zxsj.htm" target="_blank" rel="noreferrer">
                  官网
                </a>
                ）填入。当前季节：{officialSeasonLabel()}
                {tmCustom ? ' · 你已自定义。自动换季不会改这张表，点「恢复官方」回到当天的海大作息（10月1日起第5节 14:00）。' : ' · 使用官方'}。可改每节起止，今日课程、周视图、上课提醒都会跟着变。
              </p>
              {tmDraft.map((p, i) => (
                <div key={`tm-${i}`} className={styles.tmRow}>
                  <span className={styles.tmLabel}>第{i + 1}节</span>
                  <input
                    className={styles.tmInput}
                    type="time"
                    disabled={tmSaving}
                    aria-label={`第${i + 1}节开始`}
                    value={p[0]}
                    onChange={(e) => setDraftAt(i, 0, e.target.value)}
                  />
                  <span className={styles.tmDash}>–</span>
                  <input
                    className={styles.tmInput}
                    type="time"
                    disabled={tmSaving}
                    aria-label={`第${i + 1}节结束`}
                    value={p[1]}
                    onChange={(e) => setDraftAt(i, 1, e.target.value)}
                  />
                </div>
              ))}
              {tmMsg ? <p className={styles.tmMsg}>{tmMsg}</p> : null}
              <div className={styles.tmFoot}>
                <button className={styles.tmReset} onClick={() => void applyOfficialTm()} disabled={tmSaving}>
                  恢复官方
                </button>
                <button
                  className={styles.tmReset}
                  onClick={resetTmDraft}
                  disabled={tmSaving}
                  title="仅填入官方时间到编辑框，需再点保存"
                >
                  填入官方
                </button>
                <button className={styles.tmSave} onClick={() => void saveTm()} disabled={tmSaving}>
                  {tmSaving ? '保存中…' : '保存'}
                </button>
              </div>
            </div>
        </DialogLayer>
      ) : null}

      {/* ---------- 假期 / 调课 Sheet ---------- */}
      {calOpen ? (
        <DialogLayer title="假期与调课" className={styles.sheet} onClose={() => setCalOpen(false)}>
            <div className={styles.sheetHeader}>
              <h3 className={styles.sheetTitle}>假期与调课</h3>
              <button type="button" className={styles.sheetClose} onClick={(event) => event.currentTarget.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))} aria-label="关闭假期与调课设置">
                ✕
              </button>
            </div>
            <div className={styles.sheetBody}>
              <p className={styles.tmTip}>
                内置国家节假日仅作日期提示，不会自动改变课程或提醒。请核对学校校历后点“应用到课表”，调休补课日也请以学校通知为准。个人校历按账号在此设备隔离保存，暂不云端同步。
              </p>
              {legacyCalendar.count > 0 ? (
                <div className={styles.tmTip}>
                  <p>发现此设备旧版校历设置，共 {legacyCalendar.count} 条。旧数据没有账号归属；确认属于你后，可复制到当前哦狐账号。原记录会保留。</p>
                  <button
                    type="button"
                    className={styles.calMiniBtn}
                    disabled={legacyCalendar.alreadyImported}
                    onClick={() => {
                      if (!requireSigned('calendar')) return
                      const result = claimLegacyCalendarForCurrentAccount()
                      if (!result.ok) showMsg(result.error || '旧校历恢复失败，请重试。', true)
                      else showMsg(result.count ? `已将 ${result.count} 条旧校历设置复制到当前账号。` : '旧校历已在当前账号恢复。')
                      refreshCal()
                    }}
                  >
                    {legacyCalendar.alreadyImported ? '已复制到此账号' : '确认属于我，复制到此账号'}
                  </button>
                </div>
              ) : null}
              <div className={styles.calForm}>
                <label className={styles.calField}>
                  <span>日期</span>
                  <input
                    className={styles.tmInput}
                    type="date"
                    value={calDate}
                    onChange={(e) => setCalDate(e.target.value)}
                  />
                </label>
                <label className={styles.calField}>
                  <span>类型</span>
                  <select
                    className={styles.tmInput}
                    value={calKind}
                    onChange={(e) => setCalKind(e.target.value === 'makeup' ? 'makeup' : 'off')}
                  >
                    <option value="off">放假不上课</option>
                    <option value="makeup">调课（上另一天的课）</option>
                  </select>
                </label>
                {calKind === 'makeup' ? (
                  <label className={styles.calField}>
                    <span>上星期几的课</span>
                    <select
                      className={styles.tmInput}
                      value={calTreatAs}
                      onChange={(e) => setCalTreatAs(Number(e.target.value))}
                    >
                      {DAYS.map((name, i) => (
                        <option key={name} value={i + 1}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className={styles.calField}>
                  <span>备注（可选）</span>
                  <input
                    className={styles.tmInput}
                    type="text"
                    placeholder="例如：院系通知补周二课"
                    value={calLabel}
                    onChange={(e) => setCalLabel(e.target.value)}
                  />
                </label>
                <button type="button" className={styles.tmSave} onClick={addCalRule}>
                  添加 / 覆盖
                </button>
              </div>
              <ul className={styles.calList}>
                {calRules.map((r) => {
                  const disabled = !!(r as CalendarOverride & { disabled?: boolean }).disabled
                  return (
                    <li key={`${r.date}-${r.kind}-${r.source}`} className={disabled ? styles.calItemDisabled : styles.calItem}>
                      <div className={styles.calItemMain}>
                        <strong>{r.date}</strong>
                        <span>
                          {r.kind === 'off'
                            ? '放假'
                            : `调课·上${dayName(r.treatAsDay || 1)}`}
                          {r.label ? ` · ${r.label}` : ''}
                          {r.source === 'gov' ? ' · 国家节假日建议，尚未应用' : r.label?.startsWith('已按学校校历确认：') ? ' · 已按学校校历应用' : ' · 自定义'}
                          {disabled ? ' · 已忽略' : ''}
                        </span>
                      </div>
                      <div className={styles.calItemActs}>
                        {r.source === 'gov' ? (
                          <>
                            {disabled ? (
                              <button type="button" className={styles.calMiniBtn} onClick={() => {
                                if (!requireSigned('calendar')) return
                                setGovDisabled(r.date, false)
                                refreshCal()
                              }}>恢复提示</button>
                            ) : (
                              <>
                                <button type="button" className={styles.calMiniBtn} onClick={() => {
                                  if (!requireSigned('calendar')) return
                                  const saved = applyGovRule(r.date)
                                  showMsg(saved ? '已应用到个人校历，课程与提醒会按此日期计算。' : '校历未能保存，请重试。', !saved)
                                  refreshCal()
                                }}>应用到课表</button>
                                <button type="button" className={styles.calMiniBtn} onClick={() => {
                                  if (!requireSigned('calendar')) return
                                  setGovDisabled(r.date, true)
                                  refreshCal()
                                }}>忽略</button>
                              </>
                            )}
                          </>
                        ) : (
                          <button
                            type="button"
                            className={styles.calMiniBtn}
                            onClick={() => {
                              if (!requireSigned('calendar')) return
                              removeUserOverride(r.date)
                              refreshCal()
                            }}
                          >
                            删除
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
              {courseDateChanges.length ? <>
                <h3>单次课程变更</h3>
                <ul className={styles.calList}>
                  {courseDateChanges.map((item) => <li key={item.id} className={styles.calItem}>
                    <div className={styles.calItemMain}>
                      <strong>{item.date} · {item.kind === 'add' ? '新增' : item.kind === 'cancel' ? '取消' : '调整'}</strong>
                      <span>{item.kind === 'add' ? item.name : `${item.targetName || item.name}${item.targetSections?.length ? ` · 第 ${item.targetSections.join('、')} 节` : ''}`}{item.kind !== 'cancel' ? ` → ${item.name} · 第 ${item.sections.join('、')} 节${item.room ? ` · ${item.room}` : ''}` : ''}</span>
                    </div>
                    <div className={styles.calItemActs}><button type="button" className={styles.calMiniBtn} onClick={() => {
                      if (!requireSigned('calendar')) return
                      if (removeCourseDateException(item.id)) showMsg('已撤销这条单次课程变更。')
                      else showMsg('撤销没有保存，请重试。', true)
                      refreshCal()
                    }}>撤销</button></div>
                  </li>)}
                </ul>
              </> : null}
              <button
                type="button"
                className={styles.tmReset}
                onClick={() => {
                  if (!requireSigned('calendar')) return
                  clearAllUserCalendar()
                  refreshCal()
                }}
              >
                清除全部自定义（保留国定，并重新启用）
              </button>
            </div>
        </DialogLayer>
      ) : null}
      {scheduleAiOpen ? <ScheduleAiChangeSheet context={scheduleAiContext} onClose={() => { setScheduleAiOpen(false); setScheduleAiContext(null) }} onApply={applyAiScheduleChanges} scheduleRows={rows} /> : null}
      {scheduleGroupOpen ? <ScheduleGroupSheet rows={rows} termStart={termStart} periods={tm} onClose={() => setScheduleGroupOpen(false)} /> : null}
      {scheduleImageOpen ? <ScheduleImageImportSheet defaultSchool="江苏海洋大学" onClose={() => setScheduleImageOpen(false)} onSaved={(photoRows, photoTerm) => {
        setRows(photoRows); setTermStart(photoTerm); setCurrentWeek(guessTeachingWeek(photoTerm)); setScheduleImageOpen(false)
        showMsg('照片课表已保存到当前设备，原课表可随时恢复')
        void rescheduleClassReminders().catch(() => undefined)
      }} /> : null}
    </div>
  )
}
