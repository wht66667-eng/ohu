import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { MotionSwitch } from '../../components/ui/feedback'
import { FocusCopyButton, FocusDialog, FocusFloatingStart, FocusMusicControls, FocusNavigation, FocusSetupSheet, FocusTaskList, FocusThemeToggle, type FocusTab, type FocusTask } from '../../components/focus/FocusInteractions'
import { FocusIcon } from '../../components/focus/FocusIcon'
import { useFocusTimer } from '../../context/FocusTimerContext'
import { useToast } from '../../context/ToastContext'
import { fadeUp } from '../../lib/animations'
import { useUiMotion } from '../../lib/motion-pref'
import { goBack } from '../../lib/back'
import { focusHasDndAccess, focusOpenDndAccessSettings, focusOpenDndSettings, focusOpenPinSettings, focusOpenSetupStep, type FocusOpenResult } from '../../lib/focus-lock'
import { fmtDuration, lastDays, streakDays, todayMinutes, totalStats } from '../../lib/focus-stats'
import { loadFocusPrefs, saveFocusPrefs, type FocusPrefs } from '../../lib/focus-prefs'
import { FOCUS_NOISES, FOCUS_REMINDERS, loadFocusOptions, saveFocusOptions, type FocusOptions } from '../../lib/focus-settings'
import { formatFocusClock } from '../../lib/focus-timer'
import { captureQbankSession, isQbankSessionCurrent } from '../../lib/qbank'
import { listFocusMusic, type FocusMusic } from '../../lib/focus-music'
import { fetchTodos, updateTodo, type TodoRow } from '../../lib/todo'
import { PLATFORM } from '../../lib/platform'
import { useAuth } from '../../lib/auth'
import { saveSnapshotToJournal, journalOwnerOf } from '../../lib/journal-snapshot'
import { FoxSheetPose } from '../../components/fox/FoxSheetPose'
import { isFoxFreeVariant, useUiVariant } from '../../lib/ui-variant'
import ui from '../../components/focus/focus-interactions.module.css'
import css from './focus.module.css'

const PRESETS = [15, 25, 45]
const PLAN_KEY = 'focus.plan.v2:'
const PENDING_KEY = 'focus.pendingTodoComplete.v1:'
type FocusPlan = { id: number | null; title: string }
type PendingTodo = { todoId: number; title: string; sessionId?: string }

function readPlan(key: string): FocusPlan | null {
  try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value && typeof value.title === 'string' ? { id: Number.isInteger(value.id) ? value.id : null, title: value.title.slice(0, 120) } : null } catch { return null }
}
function storePlan(key: string, plan: FocusPlan | null) {
  try { if (plan) localStorage.setItem(key, JSON.stringify(plan)); else localStorage.removeItem(key) } catch { /* The selected goal remains available in this page. */ }
}
function readPending(key: string): PendingTodo | null {
  try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value && Number.isInteger(value.todoId) ? { todoId: value.todoId, title: typeof value.title === 'string' ? value.title : '本次待办', sessionId: value.sessionId } : null } catch { return null }
}
function clearPending(key: string, sessionId?: string) { try { if (readPending(key)?.sessionId === sessionId) localStorage.removeItem(key) } catch { /* ignore */ } }
function dueLabel(iso: string | null): string {
  if (!iso) return '未设日期'
  const date = new Date(iso)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (date.getTime() < today.getTime()) return '已逾期'
  if (date.getTime() < today.getTime() + 86400000) return '今天到期'
  return `${date.getMonth() + 1}/${date.getDate()} 到期`
}

export function StudyFocusPage() {
  const variant = useUiVariant()
  const minimal = variant === 'minimal'
  const foxfree = isFoxFreeVariant(variant)
  const toast = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { isSigned: signed, user, phase: authPhase } = useAuth()
  const pendingKey = PENDING_KEY + (user?.uid || '')
  const planKey = PLAN_KEY + (user?.uid || 'guest')
  const timer = useFocusTimer()
  const { session, left, paused, audioMuted } = timer
  const reduce = useUiMotion()
  const [tab, setTab] = useState<FocusTab>('timer')
  const [options, setOptions] = useState<FocusOptions>(loadFocusOptions)
  const [music, setMusic] = useState<FocusMusic[]>([])
  const [prefs, setPrefs] = useState<FocusPrefs>(loadFocusPrefs)
  const [setup, setSetup] = useState<'start' | 'save' | null>(null)
  const [starting, setStarting] = useState(false)
  const [plan, setPlan] = useState<FocusPlan | null>(() => readPlan(planKey))
  const planScope = useRef(planKey)
  const [todos, setTodos] = useState<TodoRow[]>([])
  const [todoState, setTodoState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [todoError, setTodoError] = useState('')
  const [pending, setPending] = useState<PendingTodo | null>(() => user?.uid ? readPending(pendingKey) : null)
  const [marking, setMarking] = useState(false)
  const markingRef = useRef(false)
  const [markError, setMarkError] = useState('')
  const [dndGranted, setDndGranted] = useState(false)
  const [statsTick, setStatsTick] = useState(0)
  const [celebrating, setCelebrating] = useState(false)
  const [foxSpriteReady, setFoxSpriteReady] = useState(false)
  const [range, setRange] = useState(7)
  const [details, setDetails] = useState(false)
  const [savingJournal, setSavingJournal] = useState(false)
  const alive = useRef(true)
  const todoRequest = useRef(0)
  const uidRef = useRef(user?.uid)
  uidRef.current = user?.uid
  const android = PLATFORM.native && PLATFORM.os === 'android'
  const busy = !!session || starting || timer.isRestoring
  const immersive = session?.phase !== 'break' && !!session && !paused && !prefs.oceanTimer && prefs.muteApp
  const showTab = immersive ? 'timer' : tab

  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    const image = new Image()
    image.onload = () => setFoxSpriteReady(true)
    image.src = '/brand/ohu-original/focus-reading-blink-v1.png'
    return () => { image.onload = null }
  }, [])
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const onComplete = () => { setCelebrating(true); clearTimeout(timeout); timeout = setTimeout(() => setCelebrating(false), 1400) }
    window.addEventListener('focus-session-complete', onComplete)
    return () => { clearTimeout(timeout); window.removeEventListener('focus-session-complete', onComplete) }
  }, [])
  useEffect(() => {
    const refresh = () => { void listFocusMusic().then((list) => { if (alive.current) setMusic(list) }).catch(() => undefined) }
    refresh(); window.addEventListener('focus-music-change', refresh)
    return () => window.removeEventListener('focus-music-change', refresh)
  }, [])

  const refreshTodos = useCallback(async () => {
    const request = ++todoRequest.current
    if (!signed) { setTodos([]); setTodoState('ready'); return }
    setTodoState('loading'); setTodoError('')
    try {
      const response = await fetchTodos()
      if (!alive.current || request !== todoRequest.current) return
      if (response.error) { setTodoState('error'); setTodoError(response.error); return }
      const deadline = new Date(); deadline.setHours(24, 0, 0, 0)
      setTodos(response.rows.filter((row) => !row.done && (!row.due_at || new Date(row.due_at).getTime() < deadline.getTime())).sort((a, b) => (a.due_at || '9999').localeCompare(b.due_at || '9999')).slice(0, 8))
      setTodoState('ready')
    } catch { if (alive.current && request === todoRequest.current) { setTodoState('error'); setTodoError('待办暂时加载失败，请检查网络后重试') } }
  }, [signed, user?.uid])
  useEffect(() => { void refreshTodos() }, [refreshTodos])
  useEffect(() => { setPending(user?.uid ? readPending(pendingKey) : null); setMarkError('') }, [pendingKey, user?.uid])
  useEffect(() => {
    if (planScope.current === planKey) return
    planScope.current = planKey
    const next = readPlan(planKey)
    setPlan(next)
    setSetup(null)
    setDetails(false)
    setOptions((old) => ({ ...old, title: next?.title || old.theme }))
  }, [planKey])

  useEffect(() => {
    if (authPhase === 'booting') return
    const title = params.get('plan')?.trim()
    if (title) { const next = { id: null, title: title.slice(0, 120) }; setPlan(next); storePlan(planKey, next); setOptions((old) => ({ ...old, title: next.title })) }
    if (params.get('start') === '1' && !session && signed) setSetup('start')
    if (title || params.get('start') === '1') { const next = new URLSearchParams(params); next.delete('plan'); next.delete('start'); setParams(next, { replace: true }) }
  }, [params, session, setParams, signed, authPhase, planKey])

  useEffect(() => {
    const refresh = () => setStatsTick((tick) => tick + 1)
    const complete = (event: Event) => {
      refresh()
      const detail = (event as CustomEvent<{ todoId?: number; title?: string; sessionId?: string; userId?: string }>).detail
      if (!detail?.todoId || (detail.userId && detail.userId !== user?.uid)) return
      if (!user?.uid) return
      const next = readPending(pendingKey) || { todoId: detail.todoId, title: detail.title || plan?.title || '本次待办', sessionId: detail.sessionId }
      setPending(next); setMarkError('')
    }
    window.addEventListener('focus-stats-change', refresh)
    window.addEventListener('focus-stats-changed', refresh)
    window.addEventListener('focus-session-complete', complete)
    return () => { window.removeEventListener('focus-stats-change', refresh); window.removeEventListener('focus-stats-changed', refresh); window.removeEventListener('focus-session-complete', complete) }
  }, [plan?.title, pendingKey, user?.uid])

  useEffect(() => {
    if (!android) return
    const refresh = () => { void focusHasDndAccess().then((granted) => { if (alive.current) setDndGranted(granted) }) }
    refresh()
    const visible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('focus', refresh)
    let disposed = false
    let remove: (() => Promise<void>) | undefined
    void import('@capacitor/app').then(async ({ App }) => {
      const listener = await App.addListener('appStateChange', ({ isActive }) => { if (isActive) refresh() })
      if (disposed) void listener.remove(); else remove = () => listener.remove()
    }).catch(() => undefined)
    return () => { disposed = true; void remove?.(); document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', refresh) }
  }, [android])

  const stats = useMemo(() => {
    const days = lastDays(range)
    const week = lastDays(7)
    return { days, week, today: todayMinutes(), streak: streakDays(), total: totalStats(), todaySessions: week.find((day) => day.isToday)?.sessions || 0, weekMinutes: week.reduce((sum, day) => sum + day.minutes, 0), best: days.reduce((best, day) => Math.max(best, day.minutes), 0) }
  }, [statsTick, range, user?.uid])

  async function saveTodayToJournal() {
    if (savingJournal) return
    setSavingJournal(true)
    try {
      const body = stats.today
        ? `今日专注 ${stats.today} 分钟，完成 ${stats.todaySessions} 轮，连续 ${stats.streak} 天。`
        : '今天还没有完整结束的专注，先安排一轮吧。'
      await saveSnapshotToJournal(journalOwnerOf(signed, user?.uid), '专注 · 今日摘要', body)
    } catch { toast.err('保存失败，请重试。') } finally { setSavingJournal(false) }
  }

  function choosePlan(row: TodoRow) {
    const next = { id: row.id, title: row.title }
    setPlan(next); storePlan(planKey, next); setOptions((old) => ({ ...old, title: row.title })); setTab('timer')
    toast.ok('已选择专注目标')
  }
  function clearPlan() { setPlan(null); storePlan(planKey, null); setOptions((old) => ({ ...old, title: old.theme })) }
  function patchPrefs(patch: Partial<FocusPrefs>) {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    try { saveFocusPrefs(next) } catch { toast.warn('设置暂时无法保存，重新打开后可能恢复') }
  }
  async function openSetting(kind: 'dnd' | 'rules' | 'pin' | 'setup') {
    let result: FocusOpenResult
    if (kind === 'dnd') result = await focusOpenDndAccessSettings()
    else if (kind === 'rules') result = await focusOpenDndSettings()
    else if (kind === 'pin') result = await focusOpenPinSettings()
    else result = await focusOpenSetupStep('auto')
    if (!result.ok) toast.err(result.error || '系统设置暂时无法打开')
    else toast(result.hint || '在系统中完成设置后返回这里')
  }
  function openSetup() { if (!signed) { navigate('/profile'); return }; if (!busy) { if (plan) setOptions((old) => ({ ...old, title: plan.title })); setSetup('start') } }
  async function confirmOptions(next: FocusOptions): Promise<boolean> {
    if (setup === 'save') { setOptions(next); saveFocusOptions(next); toast.ok('已保存下一轮设置'); return true }
    setStarting(true)
    try { const todoId = plan?.id && todos.some((row) => row.id === plan.id) ? plan.id : null; const started = await timer.begin(next, todoId); if (started && alive.current) { setOptions(next); setTab('timer') }; return started }
    finally { if (alive.current) setStarting(false) }
  }
  function pickTask(task: FocusTask) { if (!signed) { navigate('/profile'); return }; setPlan(null); storePlan(planKey, null); setOptions((old) => ({ ...old, title: task.title, minutes: task.minutes, theme: task.theme })); setSetup('start') }
  function dismissPending() { if (markingRef.current) return; clearPending(pendingKey, pending?.sessionId); setPending(null); setMarkError('') }
  async function markComplete() {
    if (!pending || markingRef.current || !signed) return
    const session = captureQbankSession()
    if (!session.uid || session.uid !== user?.uid) return
    markingRef.current = true
    setMarking(true); setMarkError('')
    try {
      const response = await updateTodo(pending.todoId, { done: true }, session)
      if (!alive.current || uidRef.current !== session.uid || !isQbankSessionCurrent(session)) return
      if (response.error) { setMarkError(response.error); return }
      setTodos((rows) => rows.filter((row) => row.id !== pending.todoId))
      if (plan?.id === pending.todoId) clearPlan()
      setPending(null)
      clearPending(pendingKey, pending.sessionId)
      toast.ok('待办已标为完成')
    } catch { if (alive.current) setMarkError('更新失败，请检查网络后重试') }
    finally { markingRef.current = false; if (alive.current) setMarking(false) }
  }

  const clock = formatFocusClock(session ? left : options.minutes * 60)
  const isBreak = session?.phase === 'break'
  const title = session?.title || plan?.title || options.title
  const noise = session?.noise || options.noise
  const noiseChoices = [...FOCUS_NOISES, ...music.map((track) => ({ label: track.name, value: `local:${track.id}` })), ...options.customNoises]
  const noiseLabel = noiseChoices.find((item) => item.value === noise)?.label || '导入音乐'
  const nextNoiseLabel = noiseChoices.find((item) => item.value === options.noise)?.label || '导入音乐'
  const nextReminderLabel = FOCUS_REMINDERS.find((item) => item.value === options.reminder)?.label || '完成提醒'
  const reminder = session?.reminder || options.reminder
  const reminderLabel = FOCUS_REMINDERS.find((item) => item.value === reminder)?.label || '完成提醒'
  const progress = session ? Math.max(0, Math.min(1, left / (session.minutes * 60))) : 1

  return <div className={`${css.page} ${session ? css.pageWithSession : ''} ${immersive ? css.immersive : ''}`}>
    <header className={css.header}><button type="button" className={ui.iconButton} aria-label={immersive ? '结束并退出专注' : '返回学业'} onClick={() => { if (immersive) timer.requestEnd(); else goBack(navigate, '/study') }}><FocusIcon name="back" /></button><div><h1>专注</h1><p>给眼前的事留一段完整时间</p></div><FocusThemeToggle /></header>
    <AnimatePresence initial={false} mode="wait"><motion.section key={showTab} className={css.content} {...fadeUp(reduce)} aria-label={{ timer: '专注计时', tasks: '专注任务', stats: '专注数据', settings: '专注设置' }[showTab]}>
      {showTab === 'timer' ? <>
        <div className={css.todaySummary} aria-label="今日专注概况"><div><span>今日专注</span><strong>{stats.today}<small>分钟</small></strong></div><div><span>完成轮次</span><strong>{stats.todaySessions}<small>次</small></strong></div><div><span>连续专注</span><strong>{stats.streak}<small>天</small></strong></div></div>
        <div className={css.timerCard}>
          <div className={css.cardHead}><span className={css.statusBadge}>{timer.isRestoring ? '恢复计时中' : paused ? '计时已暂停' : session ? isBreak ? '休息中' : '专注中' : '准备开始'}</span><span className={css.cardCaption}>给自己一段专心的时间</span></div>
          <div className={css.timerDial} style={{ background: `conic-gradient(${minimal || foxfree ? 'var(--green)' : 'var(--fox-orange)'} ${progress * 360}deg, var(--green-soft) 0deg)` }}><div className={css.dialInner}>
            {minimal || foxfree ? null : <AnimatePresence mode="wait" initial={false}><motion.div key={celebrating ? 'complete' : isBreak ? 'break' : paused ? 'paused' : session ? 'active' : 'ready'} className={css.foxStage} initial={reduce ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: -4 }} transition={{ duration: reduce ? 0 : 0.22 }}>{celebrating ? <FoxSheetPose pose="yay" className={css.dialFox} /> : isBreak ? <FoxSheetPose pose="resting" className={css.dialFox} /> : foxSpriteReady ? <div className={`${css.blinkFox} ${session && !paused && !reduce ? css.blinking : ''}`} role="img" aria-label="阿狐陪你专注" /> : <FoxSheetPose pose="reading" className={css.dialFox} />}</motion.div></AnimatePresence>}
            <div className={css.clock} role="timer" aria-live="off" aria-label={`剩余 ${Math.floor((session ? left : options.minutes * 60) / 60)} 分 ${(session ? left : options.minutes * 60) % 60} 秒`}>{clock}</div><p className={css.clockHint}>{isBreak ? '休息片刻，下一轮再继续' : session ? '剩余时间' : '专注时长'}</p>
          </div></div><h2 className={css.timerGoal}>{title}</h2>
          {!session ? <div className={css.presets} aria-label="快速选择时长">{PRESETS.map((minutes) => <button type="button" key={minutes} aria-pressed={options.minutes === minutes} disabled={starting || timer.isRestoring} className={options.minutes === minutes ? css.presetSelected : css.preset} onClick={() => setOptions((old) => ({ ...old, minutes }))}>{minutes} 分钟</button>)}</div> : null}
          {session ? <><div className={css.activeActions}><button type="button" className={ui.primaryButton} onClick={timer.togglePause}><FocusIcon name={paused ? 'play' : 'pause'} />{paused ? '继续计时' : '暂停计时'}</button><button type="button" className={ui.secondaryButton} onClick={timer.extend}><FocusIcon name="plus" />延长 5 分钟</button></div><div className={css.secondaryActions}><button type="button" className={ui.copyButton} disabled={noise === 'off' || paused} aria-pressed={!audioMuted} onClick={timer.toggleAudio}><FocusIcon name={audioMuted ? 'mute' : 'sound'} />{noise === 'off' ? '声音已关闭' : audioMuted ? '播放声音' : '关闭声音'}</button><button type="button" className={css.endButton} onClick={timer.requestEnd}>{isBreak ? '结束休息' : '结束本次'}</button></div></> : <><button type="button" className={`${ui.primaryButton} ${css.startButton}`} disabled={starting || timer.isRestoring} onClick={openSetup}><FocusIcon name="play" />{starting ? '正在准备…' : timer.isRestoring ? '正在恢复…' : signed ? '设置并开始专注' : '登录后开始专注'}</button><button type="button" className={css.settingsLink} onClick={() => setSetup('save')}>调整休息、声音与提醒</button></>}
        </div>
        <div className={css.sessionMeta}><span><FocusIcon name="sound" size={16} />{noiseLabel}</span><span>{reminderLabel}</span><FocusCopyButton text={`${title} · 专注 ${session?.minutes || options.minutes} 分钟`} label="复制目标" /></div>
        {session && timer.reminderStatus ? <p className={css.reminderStatus} role="status">{timer.reminderStatus}</p> : null}
        <div className={css.planCard}><div className={ui.sectionHead}><h2>本次目标</h2><button type="button" className={ui.copyButton} disabled={busy} onClick={() => setTab('tasks')}>选择待办</button></div>{plan ? <div className={css.selectedPlan}><FocusIcon name="tasks" /><span>{plan.title}</span><button type="button" className={ui.iconButton} aria-label="取消专注目标" disabled={busy} onClick={clearPlan}><FocusIcon name="close" size={18} /></button></div> : <p className={css.helper}>可选择一条待办，完成专注后再决定是否勾选它。</p>}</div>
        <details className={css.ambienceCard}><summary><span><FocusIcon name="sound" size={19} /><strong>专注环境音</strong></span><span>{noiseLabel}<i aria-hidden="true">⌄</i></span></summary><FocusMusicControls options={options} onChange={(next) => { setOptions(next); saveFocusOptions(next) }} /><p className={css.ambienceHint}>音源和音量会保存在当前设备；播放音频不影响计时。</p></details>
        <p className={css.footnote}>完整结束的专注计入统计；暂停、休息和提前结束不计入。</p>
      </> : showTab === 'tasks' ? <>
        <FocusTaskList key={user?.uid || 'guest'} storageScope={user?.uid || 'guest'} onPick={pickTask} disabled={busy} />
        <div className={css.planCard}><div className={ui.sectionHead}><h2>今日待办</h2><Link to="/todo" className={ui.copyButton}>查看全部</Link></div>
          {!signed ? <div className={css.emptyState}><p>登录后连接你的待办</p><span>本地任务与已有统计仍保存在当前设备。</span><Link to="/profile" className={ui.secondaryButton}>去登录</Link></div> : todoState === 'loading' ? <p className={css.helper} role="status">正在加载待办…</p> : todoState === 'error' ? <div className={css.emptyState}><p role="alert">{todoError}</p><button type="button" className={ui.secondaryButton} onClick={() => void refreshTodos()}>重新加载</button></div> : todos.length ? <div className={css.todoList}>{todos.map((row) => <button type="button" key={row.id} className={css.todoRow} disabled={busy} onClick={() => choosePlan(row)}><span><strong>{row.title}</strong><small>{dueLabel(row.due_at)}</small></span><span className={css.todoSelect}>{plan?.id === row.id ? '已选择' : '选为目标'}<FocusIcon name={plan?.id === row.id ? 'check' : 'plus'} size={16} /></span></button>)}</div> : <div className={css.emptyState}><p>今天没有待处理事项</p><span>在待办里记下任务，再安排一段专注时间。</span><Link to="/todo" className={ui.secondaryButton}>添加待办</Link></div>}
        </div>
      </> : showTab === 'stats' ? <>
        <div className={ui.sectionHead}><h2>专注记录</h2><button type="button" className={ui.copyButton} disabled={savingJournal} onClick={() => void saveTodayToJournal()}>{savingJournal ? '正在保存…' : '记入手账'}</button><button type="button" className={ui.copyButton} onClick={() => setDetails(true)}>每日明细</button></div><p className={css.helper}>统计来自当前设备上完整结束的专注。</p>
        <div className={css.statsGrid}><div><span>本周累计</span><strong>{fmtDuration(stats.weekMinutes)}</strong></div><div><span>累计时长</span><strong>{fmtDuration(stats.total.minutes)}</strong></div><div><span>累计次数</span><strong>{stats.total.sessions}<small>次</small></strong></div><div><span>专注天数</span><strong>{stats.total.days}<small>天</small></strong></div></div>
        <div className={css.chartCard}><div className={css.chartHead}><h3>每日专注时长</h3><div className={css.rangeChoices}>{[7, 14, 30].map((days) => <button type="button" key={days} aria-pressed={range === days} onClick={() => setRange(days)}>{days} 天</button>)}</div></div><div className={css.chart} role="img" aria-label={`近 ${range} 天专注时长，最高 ${stats.best} 分钟`}><div className={css.chartColumns}>{stats.days.map((day) => <div key={day.key} className={css.chartColumn} title={`${day.label}：${day.minutes} 分钟，${day.sessions} 次`}><span className={css.chartValue}>{day.minutes || ''}</span><div className={css.chartTrack}><i className={day.isToday ? css.chartToday : ''} style={{ transform: `scaleY(${day.minutes / Math.max(1, stats.best)})` }} /></div><span className={css.chartLabel}>{range <= 14 ? day.isToday ? '今天' : day.label : day.date.getDate()}</span></div>)}</div></div>{!stats.days.some((day) => day.minutes) ? <p className={css.helper}>这段时间还没有记录。完成第一轮专注后，数据会显示在这里。</p> : null}</div>
      </> : <>
        <div className={ui.sectionHead}><h2>专注设置</h2><button type="button" className={ui.copyButton} onClick={() => setSetup('save')}>编辑下一轮</button></div>
        <div className={css.planCard}><h3>下一轮安排</h3><dl className={css.settingsSummary}><div><dt>专注 / 休息</dt><dd>{options.minutes} / {options.breakMinutes} 分钟</dd></div><div><dt>声音 / 提醒</dt><dd>{nextNoiseLabel} / {nextReminderLabel}</dd></div></dl></div>
        <div className={css.planCard}><h3>专注音乐</h3><FocusMusicControls options={options} onChange={(next) => { setOptions(next); saveFocusOptions(next) }} />{session ? <p className={css.helper}>音量立即应用；音源选择用于下一轮专注。</p> : <p className={css.helper}>导入后选择音乐，开始专注时会循环播放。</p>}</div><div className={css.planCard}><h3>减少干扰</h3><label className={css.toggleRow}><span><strong>减少站内干扰</strong><small>专注时减少应用内消息和辅助提示</small></span><MotionSwitch label="减少站内干扰" checked={prefs.muteApp} disabled={!!session} onChange={(checked) => patchPrefs({ muteApp: checked })} /></label><label className={css.toggleRow}><span><strong>保留功能导航</strong><small>关闭后只显示当前计时与操作</small></span><MotionSwitch label="保留功能导航" checked={prefs.oceanTimer} disabled={!!session} onChange={(checked) => patchPrefs({ oceanTimer: checked })} /></label>{session ? <p className={css.helper}>当前计时结束后可调整，避免中途改变原生权限状态。</p> : null}</div>
        <div className={css.planCard}><h3>系统权限</h3>{android ? <><p className={css.helper}>按需开启。系统勿扰可能影响铃声与其他通知；重要联系人按系统规则放行。</p><div className={css.nativeRow}><label className={css.toggleRow}><span><strong>系统勿扰</strong><small>{dndGranted ? '已授权；只在专注期间启用' : '需要先授予勿扰权限'}</small></span><MotionSwitch label="系统勿扰" checked={prefs.blockSystem} disabled={!!session} onChange={(checked) => patchPrefs({ blockSystem: checked })} /></label><button type="button" className={ui.secondaryButton} onClick={() => void openSetting('dnd')}>{dndGranted ? '查看授权' : '去授权'}</button></div><div className={css.nativeRow}><label className={css.toggleRow}><span><strong>屏幕固定</strong><small>需在系统安全设置开启；结束后解除</small></span><MotionSwitch label="屏幕固定" checked={prefs.lockTask} disabled={!!session} onChange={(checked) => patchPrefs({ lockTask: checked })} /></label><button type="button" className={ui.secondaryButton} onClick={() => void openSetting('pin')}>去设置</button></div><div className={css.nativeActions}><button type="button" className={ui.secondaryButton} onClick={() => void openSetting('setup')}>配置权限步骤</button><button type="button" className={ui.copyButton} onClick={() => void openSetting('rules')}>勿扰详细规则</button></div></> : <p className={css.helper}>系统勿扰和屏幕固定在 Android App 内设置。当前环境可正常使用计时、声音、本地任务与统计。</p>}</div>
      </>}
    </motion.section></AnimatePresence>
    {!immersive ? <FocusNavigation active={tab} onChange={(next) => { setTab(next); document.querySelector<HTMLElement>('[data-app-page]')?.scrollTo({ top: 0, behavior: reduce ? 'instant' : 'smooth' }) }} /> : null}
    {!busy && !immersive && tab !== 'timer' ? <FocusFloatingStart onClick={openSetup} /> : null}
    <AnimatePresence>{setup ? <FocusSetupSheet key="setup" initial={options} mode={setup} onClose={() => setSetup(null)} onConfirm={confirmOptions} /> : null}</AnimatePresence>
    <AnimatePresence>{details ? <FocusDialog title="每日专注明细" onClose={() => setDetails(false)}><div className={css.dayList}>{[...stats.days].reverse().filter((day) => day.minutes).map((day) => <div key={day.key} className={css.dayRow}><span>{day.label}<small>周{day.weekday}</small></span><strong>{day.minutes} 分钟</strong><span>{day.sessions} 次</span></div>)}</div>{!stats.days.some((day) => day.minutes) ? <p className={css.helper}>这段时间还没有记录。完整结束的专注会记录在这里。</p> : null}</FocusDialog> : null}</AnimatePresence>
    <AnimatePresence>{pending ? <FocusDialog title="这项待办完成了吗？" onClose={dismissPending}><p className={css.completionTitle}>{pending.title}</p><p className={css.helper}>本轮专注已记录。只有你确认后，才会将待办标为完成。</p>{markError ? <p role="alert" className={ui.errorText}>{markError}</p> : null}{!signed ? <p className={css.helper}>需要登录后才能更新云端待办。</p> : null}<div className={ui.dialogFooter}><button type="button" className={ui.secondaryButton} disabled={marking} onClick={dismissPending}>暂不完成</button>{signed ? <button type="button" className={ui.primaryButton} disabled={marking} onClick={() => void markComplete()}>{marking ? '正在更新…' : '标为完成'}</button> : <Link to="/profile" className={ui.primaryButton}>去登录</Link>}</div></FocusDialog> : null}</AnimatePresence>
  </div>
}



