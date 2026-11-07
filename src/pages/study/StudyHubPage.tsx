import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { todayMinutes } from '../../lib/focus-stats'
import { PageHeader } from '../../components/PageHeader'
import { PasswordInput } from '../../components/PasswordInput'
import { FoxRequestIndicator } from '../../components/fox/FoxRequestIndicator'
import { useToast } from '../../context/ToastContext'
import { CampusAccountCard } from '../../components/CampusAccountCard'
import { certCatalog, studyMilestones, studyTips } from '../../data/study'
import {
  loadAcademicMeta,
  loadExamsCache,
  loadGradesCache,
  saveExamsCache,
  saveGradesCache,
  ACADEMIC_CACHE_EVENT,
  type ExamRowRemote,
  type GradeRowRemote,
} from '../../lib/academic-cache'
import {
  addGrade,
  claimLegacyGradeBook,
  hasUnclaimedGradeBook,
  loadGradeBook,
  removeGrade,
  roughGpa,
  type GradeRow,
} from '../../lib/grade-book'
import {
  clearSavedPassword,
  isRememberPasswordEnabled,
  loadSavedPassword,
  loadSavedStuid,
  saveTimetableCredentials,
} from '../../lib/schedule-credentials'
import { loadScheduleCache, saveScheduleCache } from '../../lib/schedule-cache'
import { captureQbankSession, isQbankSessionCurrent } from '../../lib/qbank'
import { useQbankRevision } from '../../lib/useQbankRevision'
import { useAuth } from '../../lib/auth'
import { examCountdown, rescheduleExamReminders, sortExamsUpcoming } from '../../lib/exam-utils'
import { rescheduleClassReminders } from '../../lib/class-remind'
import {
  VIRTUAL_CERT_DEMO,
  certCountdown,
  getCertReminder,
  removeCertReminder,
  rescheduleCertReminders,
  upsertCertReminder,
} from '../../lib/cert-remind'
import { fireAlertBurst } from '../../lib/alert-effects'
import { probePortal } from '../../lib/portal-probe'
import { CAMPUS_LINKS, openCampusLink, openExternalUrl } from '../../lib/campus-links'
import { loadCampusAccount } from '../../lib/campus-account'
import { fetchCaptcha, queryAcademic, type TimetableError } from '../../lib/timetable'
import { motion } from 'motion/react'
import { fadeUp } from '../../lib/animations'
import { useUiMotion } from '../../lib/motion-pref'
import { useUiVariant } from '../../lib/ui-variant'
import { FocusIcon } from '../../components/focus/FocusIcon'
import { academicTermForDate, academicTermLabel, availableGradeTerms, gradesForScope } from '../../lib/academic-terms'
import { readPocketUni } from '../../lib/pocketuni-store'
import { readQuality } from '../../lib/quality-store'
import { puDisplayTotal, puRowsWithCredit } from '../../lib/pocketuni-parse'
import styles from './StudyHub.module.css'

type Tab = 'home' | 'grades' | 'exams' | 'certs' | 'ports'
const TABS: Tab[] = ['home', 'grades', 'exams', 'certs', 'ports']

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}

export function StudyHubPage() {
  useQbankRevision()
  const session = captureQbankSession()
  return <StudyHubContent key={`${session.uid}:${session.revision}`} />
}

function StudyHubContent() {
  const auth = useAuth()
  const ownerSession = useRef(captureQbankSession()).current
  const uiVariant = useUiVariant()
  const cute = uiVariant === 'cute'
  const upgraded = cute || uiVariant === 'minimal'
  const toast = useToast()
  const reduce = useUiMotion()
  const tabId = useId()
  const tabsRef = useRef<HTMLDivElement>(null)
  const syncForm = useRef<HTMLFormElement>(null)
  const capSequence = useRef(0)
  const captchaSession = useRef<ReturnType<typeof captureQbankSession> | null>(null)
  const capInFlight = useRef(false)
  const syncInFlight = useRef(false)
  const certInFlight = useRef(false)
  const flashTimer = useRef<number | null>(null)
  const [focusMinutes, setFocusMinutes] = useState(todayMinutes)
  const today = new Date()
  const minDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab') as Tab | null
  const [tab, setTab] = useState<Tab>(() => (tabParam && TABS.includes(tabParam) ? tabParam : 'home'))

  const campus = useMemo(() => loadCampusAccount(), [])
  const [memoGrades, setMemoGrades] = useState<GradeRow[]>(() => loadGradeBook())
  const [legacyGradeBookAvailable, setLegacyGradeBookAvailable] = useState(() => hasUnclaimedGradeBook())
  const [remoteGrades, setRemoteGrades] = useState<GradeRowRemote[]>(() => loadGradesCache())
  const [exams, setExams] = useState<ExamRowRemote[]>(() => loadExamsCache())
  const [meta, setMeta] = useState(() => loadAcademicMeta())

  const [stuid, setStuid] = useState(() => loadSavedStuid() || campus.stuid || '')
  const [pwd, setPwd] = useState(() => loadSavedPassword() || campus.jwPassword || '')
  const [captcha, setCaptcha] = useState('')
  const [sid, setSid] = useState('')
  const [capImg, setCapImg] = useState('')
  const [capBusy, setCapBusy] = useState(false)
  const [capError, setCapError] = useState('')
  const [syncAttempted, setSyncAttempted] = useState(false)
  const [rememberPwd, setRememberPwd] = useState(
    () => isRememberPasswordEnabled() || campus.remember,
  )
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [syncErr, setSyncErr] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [probeMsg, setProbeMsg] = useState<Record<string, string>>({})
  const [probeBusy, setProbeBusy] = useState<string | null>(null)
  const [certDates, setCertDates] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    for (const c of certCatalog) {
      const r = getCertReminder(c.id)
      if (r) m[c.id] = r.date
    }
    return m
  })
  const [certBusy, setCertBusy] = useState<string | null>(null)
  const [certFlash, setCertFlash] = useState<string | null>(null)
  const [certResults, setCertResults] = useState<Record<string, string>>({})
  const [examReminderBusy, setExamReminderBusy] = useState(false)

  const [gradeScope, setGradeScope] = useState('current')
  const [gradeQ, setGradeQ] = useState('')
  const [term, setTerm] = useState('2026-2027-1')
  const [course, setCourse] = useState('')
  const [credit, setCredit] = useState('2')
  const [score, setScore] = useState('')
  const [formMsg, setFormMsg] = useState('')

  const currentGradeTerm = academicTermForDate(today)
  const previousGradeTerms = useMemo(() => availableGradeTerms(remoteGrades, currentGradeTerm), [remoteGrades, currentGradeTerm])
  const currentGrades = useMemo(() => gradesForScope(remoteGrades, 'current', currentGradeTerm), [remoteGrades, currentGradeTerm])

  const activeGradeScope = gradeScope === 'current' || gradeScope === 'all' || previousGradeTerms.includes(gradeScope)
    ? gradeScope : 'current'

  /** 进页面时读一次；从 PU 页返回会重新挂载，能拿到刚保存的结果。 */
  const [puSummary] = useState(() => readPocketUni())
  const [qualitySummary] = useState(() => readQuality())
  const puTotal = puSummary ? puDisplayTotal(puSummary) : null
  const puCount = puSummary ? puRowsWithCredit(puSummary).length : 0

  const filteredGrades = useMemo(() => {
    const q = gradeQ.trim().toLowerCase()
    return gradesForScope(remoteGrades, activeGradeScope, currentGradeTerm).filter((g) => {
      if (!q) return true
      return (
        g.name.toLowerCase().includes(q) ||
        g.code.toLowerCase().includes(q) ||
        g.nature.toLowerCase().includes(q)
      )
    })
  }, [remoteGrades, activeGradeScope, currentGradeTerm, gradeQ])

  const remoteGpa = useMemo(() => {
    const asBook = filteredGrades.map((g, i) => ({
      id: String(i),
      term: `${g.year}-${g.term}`,
      course: g.name,
      credit: g.credit,
      score: g.score,
      updatedAt: '',
    }))
    return roughGpa(asBook)
  }, [filteredGrades])
  const currentGpa = useMemo(() => roughGpa(currentGrades.map((g, i) => ({
    id: String(i), term: `${g.year}-${g.term}`, course: g.name, credit: g.credit, score: g.score, updatedAt: '',
  }))), [currentGrades])
  const memoGpa = useMemo(() => roughGpa(memoGrades), [memoGrades])
  const sortedExams = useMemo(() => sortExamsUpcoming(exams), [exams])
  const hasSchedule = loadScheduleCache().rows.length > 0

  useEffect(() => {
    const refreshMemoGrades = () => {
      setMemoGrades(loadGradeBook())
      setLegacyGradeBookAvailable(hasUnclaimedGradeBook())
    }
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key.startsWith('study.gradeBook.v2:uid:') || event.key === 'study.gradeBook.v1') refreshMemoGrades()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('ohhu-account-session-change', refreshMemoGrades)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('ohhu-account-session-change', refreshMemoGrades)
    }
  }, [])

  useEffect(() => {
    const refresh = () => {
      setRemoteGrades(loadGradesCache())
      setExams(loadExamsCache())
      setMeta(loadAcademicMeta())
    }
    const onStorage = (event: StorageEvent) => { if (!event.key || event.key.startsWith('study.academic.v2:')) refresh() }
    window.addEventListener(ACADEMIC_CACHE_EVENT, refresh)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(ACADEMIC_CACHE_EVENT, refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  useEffect(() => {
    if (auth.isSigned && (tab === 'grades' || tab === 'exams') && !sid && !capBusy && !capError) void loadCap()
  }, [tab, sid, capBusy, capError, auth.isSigned])

  useEffect(() => {
    const update = () => setFocusMinutes(todayMinutes())
    window.addEventListener('focus-stats-change', update)
    window.addEventListener('focus', update)
    return () => {
      window.removeEventListener('focus-stats-change', update)
      window.removeEventListener('focus', update)
      capSequence.current += 1
      capInFlight.current = false
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    }
  }, [])

  /** 从课表等入口带 ?tab=grades 进来时，切到对应页 */
  useEffect(() => {
    if (tabParam && TABS.includes(tabParam) && tabParam !== tab) {
      setTab(tabParam)
    }
  }, [tabParam, tab])

  useEffect(() => {
    if (!cooldown) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  function switchTab(next: Tab) {
    setTab(next)
    const nextParams = new URLSearchParams(params)
    if (next === 'home') nextParams.delete('tab')
    else nextParams.set('tab', next)
    setParams(nextParams, { replace: true })
  }

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, current: Tab) {
    const index = TABS.indexOf(current)
    const target = event.key === 'ArrowRight' ? (index + 1) % TABS.length
      : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : -1
    if (target < 0) return
    event.preventDefault()
    switchTab(TABS[target])
    tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target]?.focus()
  }

  async function loadCap() {
    if (!auth.isSigned || !ownerSession.uid || !isQbankSessionCurrent(ownerSession)) return
    if (capInFlight.current) return
    capInFlight.current = true
    const request = ++capSequence.current
    const session = captureQbankSession()
    captchaSession.current = null
    setCaptcha('')
    setSid('')
    setCapImg('')
    setCapError('')
    setCapBusy(true)
    try {
      const d = await fetchCaptcha()
      if (request !== capSequence.current || !isQbankSessionCurrent(session)) return
      if (!d.sid || !d.image) throw new Error('验证码暂不可用，请重新加载')
      captchaSession.current = session
      setSid(d.sid)
      setCapImg(d.image)
    } catch (e) {
      if (request === capSequence.current && isQbankSessionCurrent(session)) setCapError((e as Error).message || '验证码加载失败，请重试')
    } finally {
      if (request === capSequence.current && isQbankSessionCurrent(session)) {
        capInFlight.current = false
        setCapBusy(false)
      }
    }
  }

  function showCertFlash(message: string) {
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    setCertFlash(message)
    flashTimer.current = window.setTimeout(() => setCertFlash(null), 6000)
  }

  async function testCertAlert() {
    if (certInFlight.current) return
    certInFlight.current = true
    setCertBusy('demo')
    const session = captureQbankSession()
    try {
      const result = await fireAlertBurst({
        title: '考证提醒试响', body: `${VIRTUAL_CERT_DEMO.name}，这是一条本机演示提醒。`, notify: true,
      })
      if (!isQbankSessionCurrent(session)) return
      const enabled = [result.spoken ? '语音' : '', result.vibrated ? '震动' : '', result.notified ? '通知' : ''].filter(Boolean)
      showCertFlash(enabled.length ? `本次试响：${enabled.join('、')}。没有创建考证日期。` : '当前设备未开启声音、震动或通知；没有创建考证日期。')
    } catch {
      if (isQbankSessionCurrent(session)) toast.err('提醒试响失败，请检查通知和声音设置')
    } finally {
      certInFlight.current = false
      if (isQbankSessionCurrent(session)) setCertBusy(null)
    }
  }

  async function saveCertDate(certId: string, date: string, note: string) {
    if (certInFlight.current) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || certCountdown(date).past) {
      toast.err('请选择今天或之后的日期')
      return
    }
    certInFlight.current = true
    setCertBusy(certId)
    const session = captureQbankSession()
    try {
      const saved = upsertCertReminder({ certId, date, note }, session)
      const scheduled = await rescheduleCertReminders()
      if (!isQbankSessionCurrent(session)) return
      const message = `日期已保存在本机 · ${scheduled.message}`
      setCertResults((previous) => ({ ...previous, [certId]: message }))
      showCertFlash(`${saved.name} · ${date}。${scheduled.message}`)
      if (scheduled.count > 0) toast.ok('考证日期已保存')
      else toast.err(`日期已保存，${scheduled.message}`)
    } catch (error) {
      if (!isQbankSessionCurrent(session)) return
      const message = (error as Error).message || '保存或安排提醒失败，请重试。'
      setCertResults((previous) => ({ ...previous, [certId]: message }))
      toast.err(message)
    } finally {
      certInFlight.current = false
      if (isQbankSessionCurrent(session)) setCertBusy(null)
    }
  }

  async function cancelCertDate(certId: string) {
    if (certInFlight.current) return
    certInFlight.current = true
    setCertBusy(certId)
    const session = captureQbankSession()
    try {
      removeCertReminder(certId, session)
      setCertDates((previous) => { const next = { ...previous }; delete next[certId]; return next })
      const scheduled = await rescheduleCertReminders()
      if (!isQbankSessionCurrent(session)) return
      setCertResults((previous) => ({ ...previous, [certId]: `本机日期已移除 · ${scheduled.message}` }))
    } catch {
      if (!isQbankSessionCurrent(session)) return
      setCertResults((previous) => ({ ...previous, [certId]: '移除或更新提醒失败，请重试。' }))
      toast.err('移除或更新提醒失败，请重试')
    } finally {
      certInFlight.current = false
      if (isQbankSessionCurrent(session)) setCertBusy(null)
    }
  }

  async function onSyncAcademic() {
    if (!isQbankSessionCurrent(ownerSession)) return
    if (!auth.isSigned || !ownerSession.uid) { auth.openLogin('同步教务数据前，请先用学号登录哦狐'); return }
    if (syncInFlight.current || cooldown > 0 || capInFlight.current || !sid || !capImg) return
    if (!captchaSession.current || !isQbankSessionCurrent(captchaSession.current)) {
      void loadCap()
      return
    }
    setSyncAttempted(true)
    if (!stuid.trim() || !pwd || !captcha.trim()) {
      setSyncMsg('请填写学号、密码和验证码')
      setSyncErr(true)
      requestAnimationFrame(() => syncForm.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus())
      return
    }
    const session = captureQbankSession()
    syncInFlight.current = true
    setSyncing(true)
    setSyncMsg('')
    try {
      const data = await queryAcademic(
        sid,
        { username: stuid.trim(), password: pwd, captcha: captcha.trim() },
        ['schedule', 'grades', 'exams'],
      )
      if (!isQbankSessionCurrent(session)) return
      const scheduleRows = data.rows ?? []
      const scheduleSaved = saveScheduleCache(scheduleRows, stuid.trim(), session)
      const gradesReceived = !data.grades_error && Array.isArray(data.grades)
      const examsReceived = !data.exams_error && Array.isArray(data.exams)
      const gradesSaved = gradesReceived && saveGradesCache(data.grades!, stuid.trim(), session)
      const examsSaved = examsReceived && saveExamsCache(data.exams!, stuid.trim(), session)
      if (gradesSaved) {
        setRemoteGrades(data.grades!)
      }
      if (examsSaved) {
        setExams(data.exams!)
      }
      setMeta(loadAcademicMeta())
      saveTimetableCredentials({
        stuid: stuid.trim(),
        password: pwd,
        rememberStuid: true,
        rememberPassword: rememberPwd,
      }, session)
      if (!rememberPwd) {
        clearSavedPassword(session)
        setPwd('')
      }
      const classRem = scheduleSaved ? await rescheduleClassReminders().catch(() => null) : null
      const rem = examsSaved ? await rescheduleExamReminders().catch(() => null) : null
      if (!isQbankSessionCurrent(session)) return
      const parts = [
        scheduleSaved ? scheduleRows.length ? `课表 ${scheduleRows.length} 条` : '课表 0 条（已清除旧课程与提醒）' : null,
        gradesSaved ? `成绩 ${data.grades!.length} 门` : null,
        examsSaved ? `考试 ${data.exams!.length} 场` : null,
      ].filter(Boolean)
      let msg = parts.length ? `已同步：${parts.join(' · ')}` : '本次未取得新的教务数据'
      if (classRem?.count) msg += ` · ${classRem.message}`
      if (rem?.count) msg += ` · ${rem.message}`
      if (data.grades_error) msg += ` · 成绩未同步：${data.grades_error}，已保留上次缓存`
      else if (!gradesSaved) msg += ' · 成绩已读取，但本机保存失败，请检查存储空间后重试'
      if (data.exams_error) msg += ` · 考试未同步：${data.exams_error}，已保留上次缓存`
      else if (!examsSaved) msg += ' · 考试已读取，但本机保存失败，请检查存储空间后重试'
      if (!scheduleSaved) msg += ' · 课程已读取，但本机课表保存失败，请检查存储空间后重试'
      setSyncMsg(msg)
      setSyncErr(!scheduleSaved || !gradesSaved || !examsSaved || parts.length === 0)
      void loadCap()
    } catch (e) {
      if (!isQbankSessionCurrent(session)) return
      const err = e as TimetableError
      setSyncMsg(err.message || '同步失败')
      setSyncErr(true)
      if (err.code === '1001') void loadCap()
      if (err.code === '1004') setCooldown(clamp(Math.round(err.retryAfter || 60), 5, 180))
    } finally {
      syncInFlight.current = false
      if (isQbankSessionCurrent(session)) setSyncing(false)
    }
  }

  function onAddGrade() {
    if (!course.trim() || !score.trim()) {
      setFormMsg('请填写课程名和成绩')
      return
    }
    setMemoGrades(
      addGrade({
        term: term.trim() || '未分学期',
        course: course.trim(),
        credit: credit.trim() || '0',
        score: score.trim(),
      }),
    )
    setCourse('')
    setScore('')
    setFormMsg('已记入本机成绩本')
  }

  function exportGradesTxt() {
    const lines = [
      '# 哦狐 · 成绩导出',
      meta?.savedAt ? `# 同步于 ${meta.savedAt}` : '',
      '',
      ...filteredGrades.map(
        (g) =>
          `${g.year}\t第${g.term}学期\t${g.name}\t${g.credit}学分\t${g.score}${g.gpa ? `\t绩点${g.gpa}` : ''}`,
      ),
    ].filter(Boolean)
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `grades-${stuid || 'export'}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const syncCard = (
    <div className={`${styles.card} ${tab === 'grades' ? styles.syncCardFeatured : ''}`}>
      <h3 className={styles.cardTitle}>从教务一键同步</h3>
      <p className={styles.muted}>
        填验证码即可同步课表 · 成绩 · 考试
        {meta?.savedAt
          ? ` 上次：${new Date(meta.savedAt).toLocaleString('zh-CN', { hour12: false })}`
          : ''}
      </p>
      {!auth.isSigned ? <button type="button" className={styles.btnMain} onClick={() => auth.openLogin('同步教务数据前，请先用学号登录哦狐')}>学号登录后同步</button> : <form ref={syncForm} className={styles.form} aria-busy={syncing} onSubmit={(event) => { event.preventDefault(); void onSyncAcademic() }}>
        <div className={styles.field}>
          <label htmlFor={`${tabId}-stuid`}>学号</label>
          <input
          id={`${tabId}-stuid`}
          className={styles.input}
          placeholder="输入学号"
          aria-invalid={syncAttempted && !stuid.trim()}
          aria-describedby={syncErr ? `${tabId}-sync-message` : undefined}
          disabled={syncing}
          autoComplete="username"
          value={stuid}
          onChange={(e) => setStuid(e.target.value)}
        />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${tabId}-password`}>教务密码</label>
          <PasswordInput
          id={`${tabId}-password`}
          className={styles.input}
          placeholder="输入教务密码"
          aria-invalid={syncAttempted && !pwd}
          aria-describedby={syncErr ? `${tabId}-sync-message` : undefined}
          disabled={syncing}
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
        />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${tabId}-captcha`}>验证码</label>
          <div className={styles.captchaRow}>
          <input
            id={`${tabId}-captcha`}
            className={styles.input}
            placeholder="输入图中字符"
            aria-label="验证码"
            aria-invalid={syncAttempted && !captcha.trim()}
            aria-describedby={capError ? `${tabId}-captcha-message` : syncErr ? `${tabId}-sync-message` : undefined}
            maxLength={10}
            value={captcha}
            onChange={(e) => setCaptcha(e.target.value)}
            disabled={syncing || cooldown > 0 || capBusy || !sid}
          />
          <button type="button" className={styles.captchaButton} disabled={syncing || capBusy || cooldown > 0}
            aria-label={capBusy ? '正在加载验证码' : capImg ? '刷新验证码' : '重新加载验证码'}
            aria-busy={capBusy} onClick={() => void loadCap()}>
            {capBusy ? syncing ? <span>正在加载…</span> : <FoxRequestIndicator label="加载中…" /> : capImg ? <img className={styles.capImg} src={capImg} alt="验证码图片" onError={() => { setCapImg(''); setSid(''); setCapError('验证码图片无法显示，请重新加载') }} /> : <span>重新加载</span>}
          </button>
          </div>
        </div>
        {capError ? <p id={`${tabId}-captcha-message`} className={styles.formErr} role="alert">{capError}</p> : null}
        <label className={styles.check}>
          <input
            type="checkbox"
            disabled={syncing}
            checked={rememberPwd}
            onChange={(e) => {
              setRememberPwd(e.target.checked)
              if (!e.target.checked) clearSavedPassword(ownerSession)
            }}
          />
          记住密码（仅本机）
        </label>
        <button
          type="submit"
          className={styles.btnMain}
          aria-busy={syncing}
          disabled={syncing || cooldown > 0 || capBusy || !sid || !capImg}
        >
          {syncing
            ? <FoxRequestIndicator label="正在同步教务…" pose="reading" />
            : cooldown > 0
              ? `请稍候 ${cooldown}s`
              : capBusy ? '验证码加载中…' : !sid ? '先加载验证码' : '同步课表 · 成绩 · 考试'}
        </button>
        {syncMsg ? <p id={`${tabId}-sync-message`} className={syncErr ? styles.formErr : styles.formMsg} role={syncErr ? 'alert' : 'status'}>{syncMsg}</p> : null}
      </form>}
    </div>
  )

  return (
    <motion.div className={styles.page} {...fadeUp(reduce)}>
      <PageHeader title="学业中心" />

      <div className={`${styles.hero} ${tab !== 'home' ? styles.heroCompact : ''}`}>
        <div className={styles.heroText}>
          <h2>{tab === 'grades' ? '每一份努力，都有迹可循' : cute ? '把学习的小事，安排好～' : '把学习安排清楚'}</h2>
          <p>{tab === 'grades' ? '先看本学期，也可以切换学期回顾成绩。' : '课表、成绩、考试和专注，按今天的需要选一个。'}</p>
        </div>
        <img className={styles.heroFox} src="/brand/ohu-original/fox-grades-transparent.png" alt="" width="92" height="92" />
        <div className={styles.heroStats}>
          <div>
            <b>{hasSchedule ? '已同步' : '未同步'}</b>
            <span>课表</span>
          </div>
          <div>
            <b>{currentGrades.length}</b>
            <span>本学期成绩</span>
          </div>
          <div>
            <b>{exams.length}</b>
            <span>考试</span>
          </div>
        </div>
        <div className={styles.heroActions}><Link to="/study/focus" className={styles.focusEntry}>
          <span><b>开始专注</b><small>{focusMinutes > 0 ? `今天已专注 ${focusMinutes} 分钟` : '从一小段专注开始'}</small></span>
          <span aria-hidden="true">↗</span>
        </Link>
        {upgraded ? (
          <Link to="/study/goals" className={styles.goalsEntry}>
            <FocusIcon name="tasks" size={20} />
            <span><b>目标墙</b><small>{cute ? '看看大家正在努力什么～' : '看看大家正在努力什么'}</small></span>
            <span aria-hidden="true">↗</span>
          </Link>
        ) : (
          <Link to="/study/goals" className={styles.focusEntry}>
            <span><b>目标墙</b><small>看看别人正在努力什么</small></span>
            <span aria-hidden="true">↗</span>
          </Link>
        )}
        {upgraded ? (
          <Link to="/study/plan" className={styles.goalsEntry}>
            <FocusIcon name="tasks" size={20} />
            <span><b>我的目标</b><small>{cute ? '给成长种下一片小叶子' : '记录下一步，按计划前进'}</small></span>
            <span aria-hidden="true">↗</span>
          </Link>
        ) : (
          <Link to="/study/plan" className={styles.focusEntry}>
            <span><b>我的目标</b><small>记录下一步，按计划前进</small></span>
            <span aria-hidden="true">↗</span>
          </Link>
        )}</div>
      </div>

      <div ref={tabsRef} className={styles.tabs} role="tablist" aria-label="学习内容">
        {(
          [
            ['home', '总览'],
            ['grades', '成绩'],
            ['exams', '考试'],
            ['certs', '考证'],
            ['ports', '入口'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`${tabId}-${id}`}
            aria-controls={`${tabId}-panel`}
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            onKeyDown={(event) => onTabKey(event, id)}
            className={tab === id ? `${styles.tab} ${styles.tabOn}` : styles.tab}
            onClick={() => switchTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div id={`${tabId}-panel`} role="tabpanel" aria-labelledby={`${tabId}-${tab}`} tabIndex={0} className={styles.tabPanel}>
      {tab === 'home' ? (
        <section className={styles.sec}>
          <div className={styles.quickGrid}>
            <button type="button" className={styles.quick} onClick={() => switchTab('grades')}>
              <span className={styles.quickIc} data-tone="blue">
                分
              </span>
              <b>成绩</b>
              <span>
                {currentGrades.length
                  ? `${currentGrades.length} 条 · 参考均分 ${currentGpa.avg ?? '—'}`
                  : '本学期成绩待公布'}
              </span>
            </button>
            <button type="button" className={styles.quick} onClick={() => switchTab('exams')}>
              <span className={styles.quickIc} data-tone="amber">
                考
              </span>
              <b>考试安排</b>
              <span>{exams.length ? `${exams.length} 场已缓存` : '同步后显示时间教室'}</span>
            </button>
            <Link to="/study/pu" className={styles.quick}>
              <span className={styles.quickIc}>PU</span>
              <b>PU 二课</b>
              <span>{puTotal !== null ? `${puTotal} 学分 · ${puCount} 条明细` : '口袋校园第二课堂学分'}</span>
            </Link>
            <Link to="/schedule" className={styles.quick}>
              <span className={styles.quickIc} data-tone="green">
                课
              </span>
              <b>我的课表</b>
              <span>{stuid ? `学号 ${stuid}` : '同步教务课表'}</span>
            </Link>
            <button type="button" className={styles.quick} onClick={() => switchTab('certs')}>
              <span className={styles.quickIc} data-tone="violet">
                证
              </span>
              <b>四六级 · 普通话</b>
              <span>考证节点与查分</span>
            </button>
            <Link to="/zhongce" className={styles.quick}>
              <span className={styles.quickIc} data-tone="amber">
                综
              </span>
              <b>综测加分</b>
              <span>分学院细则 · 材料自查</span>
            </Link>
            <Link to="/english" className={styles.quick}>
              <span className={styles.quickIc} data-tone="blue">
                词
              </span>
              <b>英语学习</b>
              <span>单词·四六级真题·组卷自测</span>
            </Link>
          </div>

          {sortedExams.slice(0, 2).length > 0 ? (
            <>
              <h3 className={styles.h3}>最近考试</h3>
              <ul className={styles.examList}>
                {sortedExams.slice(0, 2).map((ex, i) => {
                  const cd = examCountdown(ex.datetime)
                  return (
                    <li key={`home-${ex.code}-${i}`}>
                      <b>{ex.name}</b>
                      <span className={styles.examWhen}>
                        {ex.datetime || '时间待定'} · {cd.label}
                      </span>
                      <span>
                        {[ex.room && `教室 ${ex.room}`, ex.seat && `座 ${ex.seat}`]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : null}

          <details className={styles.reference}>
            <summary>近期节点与学习提示</summary>
          <h3 className={styles.h3}>近期节点</h3>
          <ul className={styles.mileList}>
            {studyMilestones.map((m) => (
              <li key={m.id}>
                <div className={styles.mileWhen}>{m.when}</div>
                <div className={styles.mileBody}>
                  <b>{m.title}</b>
                  <span>{m.note}</span>
                </div>
              </li>
            ))}
          </ul>

          <h3 className={styles.h3}>小提示</h3>
          <ul className={styles.tipList}>
            {studyTips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          </details>
        </section>
      ) : null}


      {tab === 'exams' ? (
        <section className={styles.sec}>
          <CampusAccountCard
            onApplied={(a) => {
              setStuid(a.stuid)
              setPwd(a.jwPassword)
              setRememberPwd(a.remember)
            }}
          />
          {syncCard}
        </section>
      ) : null}

      {tab === 'grades' ? (
        <section className={styles.sec}>
          <Link to="/study/oneclick" className={`${styles.card} ${styles.puEntry}`}>
            <div className={styles.cardHead}>
              <div>
                <span className={styles.gradeEyebrow}>设备内登录 · 不经过云端</span>
                <h3 className={styles.cardTitle}>一键获取校园数据</h3>
              </div>
              <span className={styles.gpaPill}>新</span>
            </div>
            <p className={styles.puEntryCopy}>学号 + 校园网密码 + 统一认证密码，读取课表、成绩、考试；体测、PU、学习通各授权一次后也能一键更新。</p>
            <span className={styles.puEntryLink}>去一键获取 ›</span>
          </Link>
          {syncCard}
          <Link to="/study/pu" className={`${styles.card} ${styles.puEntry}`}>
            <div className={styles.cardHead}>
              <div>
                <span className={styles.gradeEyebrow}>第二课堂 · 口袋校园</span>
                <h3 className={styles.cardTitle}>PU 二课</h3>
              </div>
              <span className={styles.gpaPill}>{puTotal !== null ? `${puTotal} 学分` : '未导入'}</span>
            </div>
            <p className={styles.puEntryCopy}>
              {puTotal !== null
                ? `已保存 ${puCount} 条有学分的明细；与教务「校园档案」分开计算，不互相抵扣。`
                : '在口袋校园「成绩明细」页复制文字，回到哦狐粘贴，即可查看总学分与 A/B/C 类明细。'}
            </p>
            <span className={styles.puEntryLink}>打开 PU 二课 ›</span>
          </Link>
          <Link to="/study/quality" className={`${styles.card} ${styles.puEntry}`}>
            <div className={styles.cardHead}>
              <div>
                <span className={styles.gradeEyebrow}>实践系统 · 7058</span>
                <h3 className={styles.cardTitle}>校园档案</h3>
              </div>
              <span className={styles.gpaPill}>{qualitySummary ? `${qualitySummary.totalCredit} 学分` : '未同步'}</span>
            </div>
            <p className={styles.puEntryCopy}>
              {qualitySummary
                ? `类型2 ${qualitySummary.type2} · 类型3 ${qualitySummary.type3} · 排名 ${qualitySummary.rank || '—'} · 更新 ${new Date(qualitySummary.syncedAt).toLocaleDateString('zh-CN')}`
                : '在「一键获取」读取 7058；与 PU 官方分开存、不相加。'}
            </p>
            <span className={styles.puEntryLink}>查看校园档案 ›</span>
          </Link>
          <div className={`${styles.card} ${styles.gradeCard}`}>
            <div className={styles.cardHead}>
              <div><span className={styles.gradeEyebrow}>教务同步成绩</span><h3 className={styles.cardTitle}>{activeGradeScope === 'current' ? '本学期成绩' : activeGradeScope === 'all' ? '全部成绩' : academicTermLabel(activeGradeScope)}</h3></div>
              {remoteGpa.avg != null ? (
                <span className={styles.gpaPill}>
                  参考加权均分 {remoteGpa.avg} · {Number(remoteGpa.credited.toFixed(2))} 学分
                </span>
              ) : null}
            </div>
            {remoteGrades.length > 0 ? (
              <div className={styles.filterRow}>
                <select
                  className={styles.select}
                  value={activeGradeScope}
                  onChange={(e) => setGradeScope(e.target.value)}
                  aria-label="选择成绩学期"
                >
                  <option value="current">本学期 · {academicTermLabel(currentGradeTerm)}</option>
                  {previousGradeTerms.map((termKey) => <option key={termKey} value={termKey}>{academicTermLabel(termKey)}</option>)}
                  <option value="all">全部成绩</option>
                </select>
                <input
                  className={styles.input}
                  placeholder="搜课程名 / 代码"
                  aria-label="搜索课程名或代码"
                  value={gradeQ}
                  onChange={(e) => setGradeQ(e.target.value)}
                />
                <button type="button" className={styles.btnGhost} onClick={exportGradesTxt} disabled={!filteredGrades.length}>
                  导出
                </button>
              </div>
            ) : null}
            {filteredGrades.length === 0 ? (
              <div className={styles.gradeEmpty} role="status">
                <img src="/brand/ohu-original/fox-grades-transparent.png" alt="" width="70" height="70" loading="lazy" />
                <p>
                {gradeQ.trim() ? '没有匹配的课程，试试其他关键词。' : remoteGrades.length && activeGradeScope === 'current' ? '当前同步结果中暂无本学期成绩。可选择其他学期或全部成绩。' : remoteGrades.length ? '这个学期还没有已同步成绩，可切换学期查看。' : '尚未同步教务成绩。使用上方“从教务一键同步”开始查询。'}
                </p>
              </div>
            ) : (
              <ul className={styles.gradeList}>
                {filteredGrades.map((g, i) => (
                  <li key={`${g.code}-${i}`}>
                    <div>
                      <b>{g.name}</b>
                      <span>
                        {g.year} 第{g.term}学期 · {g.credit} 学分
                        {g.nature ? ` · ${g.nature}` : ''}
                        {g.gpa ? ` · 绩点 ${g.gpa}` : ''}
                      </span>
                    </div>
                    <em>{g.score}</em>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <details className={styles.syncDisclosure}>
            <summary>校园账号设置 <span>管理账号与教务密码 ›</span></summary>
            <CampusAccountCard onApplied={(a) => { setStuid(a.stuid); setPwd(a.jwPassword); setRememberPwd(a.remember) }} />
          </details>

          <details className={styles.memoDisclosure}>
            <summary>本机成绩备忘 <span>{memoGrades.length} 条 · 手动记录</span></summary>
          <div className={styles.card}>
            {legacyGradeBookAvailable ? <div role="status" className={styles.formMsg}>
              <p>发现本机旧版成绩备忘。为保护账号隐私，它不会自动显示给当前账号。</p>
              {auth.isSigned ? <button type="button" onClick={() => {
                const result = claimLegacyGradeBook()
                if (result.ok) {
                  setMemoGrades(result.rows)
                  setLegacyGradeBookAvailable(hasUnclaimedGradeBook())
                  setFormMsg('旧版成绩备忘已归入当前账号')
                } else setFormMsg('认领未完成；请先确认当前账号没有成绩备忘，然后重试。')
              }}>将旧成绩备忘认领到当前账号</button> : <p>登录哦狐账号后可以选择认领。</p>}
            </div> : null}
            <div className={styles.cardHead}>
              <h3 className={styles.cardTitle}>本机成绩本</h3>
              {memoGpa.avg != null ? (
                <span className={styles.gpaPill}>备忘均分 {memoGpa.avg}</span>
              ) : null}
            </div>
            <p className={styles.muted}>可选：手动记几门；支持「优秀/良好」等等级折算。</p>
            <div className={styles.form}>
              <input
                className={styles.input}
                aria-label="学期"
                placeholder="学期"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
              />
              <input
                className={styles.input}
                aria-label="课程名"
                placeholder="课程名"
                value={course}
                onChange={(e) => setCourse(e.target.value)}
              />
              <div className={styles.formRow}>
                <input
                  className={styles.input}
                  aria-label="学分"
                placeholder="学分"
                  inputMode="decimal"
                  value={credit}
                  onChange={(e) => setCredit(e.target.value)}
                />
                <input
                  className={styles.input}
                  aria-label="成绩"
                placeholder="成绩"
                  value={score}
                  onChange={(e) => setScore(e.target.value)}
                />
              </div>
              <button type="button" className={styles.btnGhost} onClick={onAddGrade}>
                记一笔
              </button>
              {formMsg ? <p className={styles.formMsg} role="status">{formMsg}</p> : null}
            </div>
            {memoGrades.length > 0 ? (
              <ul className={styles.gradeList}>
                {memoGrades.map((g) => (
                  <li key={g.id}>
                    <div>
                      <b>{g.course}</b>
                      <span>
                        {g.term} · {g.credit} 学分
                      </span>
                    </div>
                    <em>{g.score}</em>
                    <button
                      type="button"
                      className={styles.del}
                      aria-label={`删除 ${g.course} 的备忘成绩`}
                      onClick={() => setMemoGrades(removeGrade(g.id))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          </details>
        </section>
      ) : null}

      {tab === 'exams' ? (
        <section className={styles.sec}>
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <h3 className={styles.cardTitle}>本学期考试安排</h3>
              {exams.length > 0 ? (
                <button
                  type="button"
                  className={styles.btnGhost}
                  disabled={examReminderBusy || syncing}
                  aria-busy={examReminderBusy}
                  onClick={async () => {
                    setExamReminderBusy(true)
                    try {
                      const r = await rescheduleExamReminders()
                      setSyncMsg(r.message)
                      setSyncErr(r.count === 0)
                    } catch {
                      setSyncMsg('考试提醒更新失败，请重试')
                      setSyncErr(true)
                    } finally { setExamReminderBusy(false) }
                  }}
                >
                  {examReminderBusy ? '正在更新…' : '刷新提醒'}
                </button>
              ) : null}
            </div>
            <p className={styles.muted}>
              按时间排序；时间明确的考试会按你选择的时点提醒。时间待定时不安排通知。
              {' '}<Link to="/settings?section=reminders" className={`${styles.btnGhost} ${styles.reminderSettingsLink}`}>提醒设置</Link>
            </p>
            {sortedExams.length === 0 ? (
              <p className={styles.empty}>暂无考试缓存。先完成上方同步。</p>
            ) : (
              <ul className={styles.examList}>
                {sortedExams.map((ex, i) => {
                  const cd = examCountdown(ex.datetime)
                  return (
                    <li key={`${ex.code}-${i}`} data-past={cd.past ? '1' : '0'}>
                      <div className={styles.examTop}>
                        <b>{ex.name}</b>
                        <span className={styles.cdPill} data-soon={cd.days <= 3 && !cd.past ? '1' : '0'}>
                          {cd.label}
                        </span>
                      </div>
                      <span className={styles.examWhen}>{ex.datetime || '时间待定'}</span>
                      <span>
                        {[
                          ex.room && `教室 ${ex.room}`,
                          ex.seat && `座 ${ex.seat}`,
                          ex.campus,
                          ex.form,
                          ex.teacher,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>
      ) : null}

      {tab === 'certs' ? (
        <section className={styles.sec}>
          <p className={styles.muted} style={{ marginTop: 0 }}>
            先保存考试日期，再根据设备通知权限安排提醒。想确认声音，可以手动试响；报名节点以官网为准。
          </p>
          <div className={styles.btnRow} style={{ marginBottom: 12 }}>
            <button
              type="button"
              className={styles.btnGhost}
              disabled={!!certBusy}
              aria-busy={certBusy === 'demo'}
              onClick={() => void testCertAlert()}
            >
              {certBusy === 'demo' ? '试响中…' : '试一下提醒声音'}
            </button>
          </div>
          {certFlash ? (
            <div className={styles.certFlash} role="status">
              <b>提醒反馈</b>
              <p>{certFlash}</p>
              <button type="button" className={styles.btnMain} onClick={() => setCertFlash(null)}>
                知道了
              </button>
            </div>
          ) : null}
          <div className={styles.certGrid}>
            {certCatalog.map((c) => {
              const saved = getCertReminder(c.id)
                const dateVal = certDates[c.id] ?? saved?.date ?? ''
              const cd = dateVal ? certCountdown(dateVal) : null
              return (
                <article key={c.id} className={styles.certCard}>
                  <div className={styles.certTop}>
                    <span className={styles.certTag}>{c.short}</span>
                    <h3>{c.name}</h3>
                    <p>{c.season}</p>
                  </div>
                  <p className={styles.certTip}>{c.tip}</p>
                  <label className={styles.certDateLab}>
                    考试 / 节点日
                    <input
                      type="date"
                      className={styles.certDate}
                      min={minDate}
                      disabled={!!certBusy}
                      value={dateVal}
                      onChange={(e) => {
                        setCertDates((m) => ({ ...m, [c.id]: e.target.value }))
                        setCertResults((m) => { const next = { ...m }; delete next[c.id]; return next })
                      }}
                    />
                  </label>
                  {cd && !cd.past ? (
                    <p className={styles.certDue}>{saved?.date === dateVal ? '本机日期已保存' : '日期尚未保存'} · {cd.label}</p>
                  ) : null}
                  <div className={styles.btnRow}>
                    <button
                      type="button"
                      className={styles.btnMain}
                      disabled={!!certBusy || !dateVal || cd?.past}
                      aria-busy={certBusy === c.id}
                      onClick={() => void saveCertDate(c.id, dateVal, c.short)}
                    >
                      {certBusy === c.id ? '处理中…' : '保存日期并安排提醒'}
                    </button>
                    <button
                      type="button"
                      className={styles.btnGhost}
                      onClick={() => openExternalUrl(c.queryUrl)}
                    >
                      查成绩
                    </button>
                    {c.enrollUrl ? (
                      <button
                        type="button"
                        className={styles.btnGhost}
                        onClick={() => openExternalUrl(c.enrollUrl!)}
                      >
                        报名
                      </button>
                    ) : null}
                    {saved ? (
                      <button
                        type="button"
                        className={styles.btnGhost}
                        disabled={!!certBusy}
                        onClick={() => void cancelCertDate(c.id)}
                      >
                        移除日期
                      </button>
                    ) : null}
                  </div>
                  {certResults[c.id] ? <p className={styles.certResult} role="status">{certResults[c.id]}</p> : null}
                </article>
              )
            })}
          </div>
        </section>
      ) : null}

      {tab === 'ports' ? (
        <section className={styles.sec}>
          <CampusAccountCard
            linkScope="all"
            onApplied={(a) => {
              setStuid(a.stuid)
              setPwd(a.jwPassword)
              setRememberPwd(a.remember)
            }}
          />
          <p className={styles.muted} style={{ marginTop: 0 }}>
            一点即打开 · 校外请先开 VPN
          </p>
          <h3 className={styles.secTitle} style={{ marginTop: 8 }}>
            连通探测（可选）
          </h3>
          <ul className={styles.portList}>
            {CAMPUS_LINKS.map((p) => (
              <li key={`probe-${p.id}`}>
                <div className={styles.portCard}>
                  <div className={styles.portRow}>
                    <span className={styles.portTag}>{p.tag}</span>
                    <span className={styles.portGrow}>
                      <b>{p.title}</b>
                      <span>{p.href}</span>
                    </span>
                  </div>
                  <div className={styles.portActions}>
                    <button
                      type="button"
                      className={styles.btnGhost}
                      disabled={!!probeBusy}
                      onClick={async () => {
                        setProbeBusy(p.id)
                        try {
                          const r = await probePortal(p.href)
                          setProbeMsg((m) => ({ ...m, [p.id]: `${r.ok ? '可达' : '异常'} · ${r.message}` }))
                        } catch {
                          setProbeMsg((m) => ({ ...m, [p.id]: '探测失败，请检查网络后重试' }))
                        } finally { setProbeBusy(null) }
                      }}
                    >
                      {probeBusy === p.id ? '探测中…' : '测连通'}
                    </button>
                    <button
                      type="button"
                      className={styles.btnMain}
                      onClick={() => void openCampusLink(p)}
                    >
                      一键打开
                    </button>
                  </div>
                  {probeMsg[p.id] ? <p className={styles.probeTip} role="status">{probeMsg[p.id]}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      </div>
    </motion.div>
  )
}
