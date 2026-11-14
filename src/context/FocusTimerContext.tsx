import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useLocation, useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { FocusIcon } from '../components/focus/FocusIcon'
import { useToast } from './ToastContext'
import { useAuth } from '../lib/auth'
import { focusEnterNative, focusExitNative, focusHasDndAccess, focusConsumeNotificationRoute } from '../lib/focus-lock'
import { loadFocusPrefs } from '../lib/focus-prefs'
import { focusRemainingSeconds, pauseFocusSession, resumeFocusSession, extendFocusSession, restoreFocusSession, formatFocusClock } from '../lib/focus-timer'
import { playFocusAudio, stopFocusAudio, remindFocusComplete, unlockFocusAudio, getFocusAudioError } from '../lib/focus-audio'
import { currentFocusRepository, setFocusScope, notifyFocusStats } from '../lib/focus-store'
import { syncFocusNotifications } from '../lib/focus-notify'
import { checkReminderHealth } from '../lib/notify-setup'
import { isNativeApp } from '../lib/native'
import { studentHaptic } from '../lib/student-haptics'
import { playSound, SoundEvent } from '../lib/sound'
import { fadeUp, fadeOnly } from '../lib/animations'
import type { FocusOptions } from '../lib/focus-settings'
import { saveFocusSession, setFocusImmersive, type FocusSession } from '../services/focus'
import ui from '../components/focus/focus-interactions.module.css'

type FocusControls = {
  session: FocusSession | null
  paused: boolean
  audioMuted: boolean
  reminderStatus: string
  isRestoring: boolean
  begin: (options: FocusOptions, todoId?: number | null) => Promise<boolean>
  togglePause: () => void
  extend: () => void
  requestEnd: () => void
  toggleAudio: () => void
}
const FocusTimerContext = createContext<FocusControls | null>(null)
const FocusClockContext = createContext(0)
export function useFocusControls() {
  const value = useContext(FocusTimerContext)
  if (!value) throw new Error('FocusTimerProvider is required')
  return value
}
export function useFocusTimer() { return { ...useFocusControls(), left: useContext(FocusClockContext) } }

export function FocusTimerProvider({ children }: { children: ReactNode }) {
  const toast = useToast(), auth = useAuth(), location = useLocation()
  const navigate = useNavigate()
  const [session, setSession] = useState<FocusSession | null>(null)
  const live = useRef<FocusSession | null>(null), scopeRef = useRef<string | null>(null)
  const starting = useRef(false), audioToken = useRef(0), nativeGeneration = useRef(0)
  const nativeQueue = useRef<Promise<void>>(Promise.resolve())
  const scheduled = useRef(new Map<string, boolean>())
  const storageWarned = useRef(false)
  const [now, setNow] = useState(Date.now), [audioMuted, setAudioMuted] = useState(true)
  const [askEnd, setAskEnd] = useState(false), [reminderStatus, setReminderStatus] = useState('计时开始后安排提醒')
  const isRestoring = auth.phase === 'booting'

  useEffect(() => {
    const host = window as Window & { __SC_FOCUS_ROUTE__?: string }
    const open = () => { delete host.__SC_FOCUS_ROUTE__; navigate('/study/focus'); void focusConsumeNotificationRoute() }
    let active = true
    window.addEventListener('native-focus-notification', open)
    if (host.__SC_FOCUS_ROUTE__ === '/study/focus') open()
    else void focusConsumeNotificationRoute().then((route) => { if (active && route === '/study/focus') navigate(route) })
    return () => { active = false; window.removeEventListener('native-focus-notification', open) }
  }, [navigate])

  const publish = useCallback((next: FocusSession | null) => {
    live.current = next; setSession(next); setNow(Date.now())
  }, [])
  const storageWarning = useCallback((durable: boolean) => {
    if (!durable && !storageWarned.current) { storageWarned.current = true; toast.warn('本地存储不可用，本次计时与统计无法在重启后恢复') }
  }, [toast])
  const commit = useCallback((next: FocusSession | null) => { storageWarning(saveFocusSession(next)); publish(next) }, [publish, storageWarning])
  const silence = useCallback(() => { audioToken.current++; stopFocusAudio(); setAudioMuted(true) }, [])
  const play = useCallback(async (current: FocusSession) => {
    const token = ++audioToken.current
    if (!current.noise || current.noise === 'off') { setAudioMuted(true); return }
    const ok = await playFocusAudio(current.noise)
    if (token !== audioToken.current || live.current?.sessionId !== current.sessionId || live.current?.pausedLeftMs != null) return
    setAudioMuted(!ok)
    if (!ok) toast.warn(getFocusAudioError() || '声音暂时无法播放，可用声音按钮重试')
  }, [toast])

  const syncNative = useCallback((next: FocusSession | null, requestPermission = false) => {
    const generation = ++nativeGeneration.current
    const operation = nativeQueue.current.catch(() => {}).then(async () => {
      if (generation !== nativeGeneration.current) return
      try {
        if (next && next.phase !== 'break' && next.pausedLeftMs == null) {
          const prefs = loadFocusPrefs()
          const health = prefs.blockSystem && isNativeApp() ? await checkReminderHealth() : null
          // Without an exact release alarm, holding system DND would risk indefinite silence.
          const dnd = prefs.blockSystem && health?.exactAlarm !== false
          const result = await focusEnterNative({ dnd, lockTask: prefs.lockTask, sessionId: next.sessionId, endsAt: next.endsAt })
          if (generation !== nativeGeneration.current) return
          if (requestPermission && prefs.blockSystem && health?.exactAlarm === false) toast.warn('未授权精确闹钟，本次不启用系统勿扰；计时继续')
          else if (requestPermission && prefs.blockSystem && isNativeApp() && !result.dndApplied) toast.warn('系统勿扰未生效，请检查授权')
          if (requestPermission && prefs.lockTask && isNativeApp() && !result.lockApplied) toast.warn('屏幕固定未生效，请检查系统设置')
        } else await focusExitNative()
        const result = await syncFocusNotifications(next, requestPermission)
        if (generation !== nativeGeneration.current) return
        if (next?.sessionId) scheduled.current.set(next.sessionId, result.scheduled)
        setReminderStatus(result.text)
      } catch {
        if (generation === nativeGeneration.current) {
          if (next?.sessionId) scheduled.current.set(next.sessionId, false)
          setReminderStatus('系统提醒安排失败，返回前台将重试；页面内计时继续')
          if (requestPermission) toast.warn('系统提醒安排失败，请检查通知授权和 App 版本')
        }
      }
    })
    nativeQueue.current = operation
    return operation
  }, [toast])

  const completeExpired = useCallback(() => {
    const previous = live.current, time = Date.now()
    if (!previous || previous.pausedLeftMs != null || previous.endsAt > time) return
    const breakMinutes = previous.breakMinutes || 0, breakEnd = previous.endsAt + breakMinutes * 60000
    const next: FocusSession | null = previous.phase !== 'break' && breakMinutes && breakEnd > time ? {
      ...previous, sessionId: `${previous.sessionId}:break`, phase: 'break', minutes: breakMinutes,
      startedAt: previous.endsAt, endsAt: breakEnd, pausedLeftMs: null, noise: 'off', breakMinutes: 0,
    } : null
    const result = currentFocusRepository().finish(previous, next)
    if (!result.applied) { publish(result.active); void syncNative(result.active); return }
    storageWarning(result.durable)
    // Persistence happens before publishing or external effects; repeated wake events cannot claim twice.
    publish(next); silence(); setFocusImmersive(false); notifyFocusStats()
    /* 专注完成已有专属铃声/震动通路；只有它不响时才补任务完成音，避免双重发声。 */
    const dedicatedChime = (!isNativeApp() || scheduled.current.get(previous.sessionId || '') === false) && (previous.reminder || 'sound') === 'sound'
    if (!isNativeApp() || scheduled.current.get(previous.sessionId || '') === false) {
      if (document.visibilityState === 'visible') remindFocusComplete(previous.reminder || 'sound')
    }
    if (!dedicatedChime) playSound(SoundEvent.TaskComplete)
    if (previous.phase === 'break') toast.ok('休息结束，可以开始下一轮了', dedicatedChime ? { sound: false } : undefined)
    else if (result.recorded) {
      if (document.visibilityState === 'visible') studentHaptic()
      toast.ok(`专注完成 ${previous.minutes} 分钟，已记入统计`, { sound: false })
      if (previous.todoId != null && previous.userId) {
        try { localStorage.setItem(`focus.pendingTodoComplete.v1:${previous.userId}`, JSON.stringify({ ...previous, id: previous.todoId, completedAt: previous.endsAt })) } catch { /* the live event still offers confirmation */ }
      }
      window.dispatchEvent(new CustomEvent('focus-session-complete', { detail: { ...previous, completedAt: previous.endsAt } }))
    }
    void syncNative(next)
  }, [publish, silence, storageWarning, syncNative, toast])

  useEffect(() => {
    if (auth.phase === 'booting') return
    const scope = auth.isSigned && auth.user ? auth.user.uid : 'device'
    if (scopeRef.current !== null && scopeRef.current !== scope) {
      currentFocusRepository().save(null); silence(); setAskEnd(false); setFocusImmersive(false)
    }
    scopeRef.current = scope
    const repository = setFocusScope(scope, auth.isSigned)
    const restored = auth.isSigned ? restoreFocusSession(repository.read().active) : null
    publish(restored)
    if (restored && restored.pausedLeftMs == null && restored.endsAt <= Date.now()) completeExpired()
    else void syncNative(restored)
    // No ambient sound auto-play after cold start: requires a fresh user gesture.
  }, [auth.phase, auth.isSigned, auth.user?.uid, publish, silence, completeExpired, syncNative])

  useEffect(() => {
    if (!session || session.pausedLeftMs != null) return
    const pulse = () => { setNow(Date.now()); completeExpired() }
    const timer = window.setInterval(pulse, 1000)
    return () => window.clearInterval(timer)
  }, [session, completeExpired])
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState !== 'visible') return
      setNow(Date.now()); completeExpired()
      if (live.current) void syncNative(live.current)
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key !== currentFocusRepository().key) return
      const next = currentFocusRepository().read().active
      if (!next || next.pausedLeftMs != null || next.sessionId !== live.current?.sessionId || next.noise !== live.current?.noise) silence()
      publish(next)
      if (next && next.pausedLeftMs == null && next.endsAt <= Date.now()) completeExpired()
      else void syncNative(next)
    }
    window.addEventListener('focus', wake); window.addEventListener('native-reminder-resume', wake)
    document.addEventListener('visibilitychange', wake); window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('focus', wake); window.removeEventListener('native-reminder-resume', wake)
      document.removeEventListener('visibilitychange', wake); window.removeEventListener('storage', onStorage)
    }
  }, [completeExpired, publish, silence, syncNative])
  useEffect(() => {
    const prefs = loadFocusPrefs()
    setFocusImmersive(!!session && session.phase !== 'break' && session.pausedLeftMs == null && !prefs.oceanTimer && prefs.muteApp && location.pathname === '/study/focus')
  }, [session, location.pathname])
  useEffect(() => {
    const onAbort = () => { if (live.current) setAskEnd(true) }
    window.addEventListener('pet-focus-abort-request', onAbort)
    return () => { window.removeEventListener('pet-focus-abort-request', onAbort); audioToken.current++; stopFocusAudio() }
  }, [])

  const begin = useCallback(async (options: FocusOptions, todoId: number | null = null) => {
    if (starting.current || isRestoring) return false
    if (!auth.isSigned || !auth.user) { toast.warn('登录后再开始专注'); return false }
    if (live.current?.phase === 'focus') { toast.warn('先结束当前计时，再开始新的专注'); return false }
    if (!Number.isInteger(options.minutes) || options.minutes < 5 || options.minutes > 120 || !Number.isInteger(options.breakMinutes) || options.breakMinutes < 0 || options.breakMinutes > 30) { toast.warn('请检查专注和休息时长'); return false }
    const prefs = loadFocusPrefs()
    starting.current = true
    try {
      if (prefs.blockSystem && isNativeApp() && !await focusHasDndAccess()) { toast.warn('请先授权系统勿扰，或在设置中关闭它'); return false }
      if (scopeRef.current !== auth.user.uid) return false
      const startedAt = Date.now()
      const next: FocusSession = { version: 3, sessionId: crypto.randomUUID(), userId: auth.user.uid,
        minutes: options.minutes, startedAt, endsAt: startedAt + options.minutes * 60000, phase: 'focus', title: options.title.trim().slice(0, 120) || '学习',
        breakMinutes: options.breakMinutes, noise: options.noise, reminder: options.reminder, todoId, pausedLeftMs: null }
      commit(next); void unlockFocusAudio(); void play(next)
      await syncNative(next, true)
      return true
    } finally { starting.current = false }
  }, [auth.isSigned, auth.user, isRestoring, commit, play, syncNative, toast])
  const togglePause = useCallback(() => {
    const current = live.current
    if (!current) return
    if (!focusRemainingSeconds(current)) { completeExpired(); return }
    const pausing = current.pausedLeftMs == null
    const next = pausing ? pauseFocusSession(current) : resumeFocusSession(current)
    commit(next); if (pausing) silence(); else void play(next)
    void syncNative(next)
  }, [commit, completeExpired, play, silence, syncNative])
  const extend = useCallback(() => {
    const current = live.current
    if (!current) return
    if (current.pausedLeftMs == null && current.endsAt <= Date.now()) { completeExpired(); return }
    const next = extendFocusSession(current)
    if (next.minutes === current.minutes) { toast.warn(current.phase === 'break' ? '休息最多 30 分钟' : '单次专注最多 120 分钟'); return }
    commit(next); void syncNative(next); toast.ok(`已延长 ${next.minutes - current.minutes} 分钟`)
  }, [commit, completeExpired, syncNative, toast])
  const toggleAudio = useCallback(() => {
    const current = live.current
    if (!current?.noise || current.noise === 'off') { toast('本次未开启白噪音'); return }
    if (current.pausedLeftMs != null) { toast('继续计时后再播放声音'); return }
    if (!audioMuted) silence(); else void play(current)
  }, [audioMuted, play, silence, toast])
  const requestEnd = useCallback(() => { if (live.current) setAskEnd(true) }, [])
  const confirmEnd = useCallback(() => {
    const previous = live.current
    setAskEnd(false); commit(null); silence(); setFocusImmersive(false); void syncNative(null)
    toast(previous?.phase === 'break' ? '已结束休息' : '已结束计时，本次不计入统计')
  }, [commit, silence, syncNative, toast])
  const controls = useMemo(() => ({ session, paused: session?.pausedLeftMs != null, audioMuted, reminderStatus, isRestoring,
    begin, togglePause, extend, requestEnd, toggleAudio }), [session, audioMuted, reminderStatus, isRestoring, begin, togglePause, extend, requestEnd, toggleAudio])
  return <FocusTimerContext.Provider value={controls}><FocusClockContext.Provider value={session ? focusRemainingSeconds(session, now) : 0}>
    {children}
    {createPortal(<AnimatePresence>{askEnd && session ? <ConfirmSheet key="end-focus" title={session.phase === 'break' ? '结束休息？' : '结束本次专注？'} desc={session.phase === 'break' ? '结束后可立即开始下一轮。' : '提前结束不会记入专注统计。'} confirmText="结束计时" onClose={() => setAskEnd(false)} onConfirm={confirmEnd} danger /> : null}</AnimatePresence>, document.querySelector('[data-app-body]') || document.body)}
  </FocusClockContext.Provider></FocusTimerContext.Provider>
}
export function FocusTimerBar() {
  const timer = useFocusTimer()
  const location = useLocation()
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const [expanded, setExpanded] = useState(false)
  const [activity, setActivity] = useState(0)
  const card = useRef<HTMLDivElement>(null)
  const { session, left, paused } = timer

  useEffect(() => { setExpanded(false) }, [location.pathname, session?.startedAt])
  useEffect(() => {
    if (!expanded) return
    const timeout = window.setTimeout(() => {
      if (!card.current?.matches(':focus-within')) setExpanded(false)
    }, 4500)
    return () => window.clearTimeout(timeout)
  }, [expanded, activity])

  return <AnimatePresence initial={false}>{session ? <motion.div data-focus-timer-bar="" className={`${ui.timerBar} ${location.pathname !== '/study/focus' ? ui.timerBarWide : ''}`} {...fadeUp(!!reduce)} ref={card} onPointerDown={() => { if (expanded) setActivity((n) => n + 1) }} onKeyDown={() => setActivity((n) => n + 1)} onBlur={() => setActivity((n) => n + 1)}>
    <button type="button" className={ui.timerBarTrigger} aria-expanded={expanded} aria-controls="focus-timer-actions" onClick={(event) => { setExpanded(!expanded); if (event.detail > 0) event.currentTarget.blur() }}>
      <FocusIcon name={paused ? 'pause' : 'timer'} size={18} />
      <span className={ui.barClock}>{formatFocusClock(left)}</span>
      <span className={ui.barTitle}>{session.phase === 'break' ? '休息一下' : session.title}</span>
      <span className={ui.barState}>{paused ? '已暂停' : session.phase === 'break' ? '休息中' : '专注中'}</span>
      <FocusIcon name="down" size={16} />
    </button>
    <div className={ui.barProgress} aria-hidden="true"><i style={{ transform: `scaleX(${Math.min(1, left / (session.minutes * 60))})` }} /></div>
    <AnimatePresence>{expanded ? <motion.div id="focus-timer-actions" className={ui.timerActions} {...fadeOnly(!!reduce)}>
      <p>{session.title || '专注计时'}<span>{session.minutes} 分钟</span></p>
      <div className={ui.actionRow}>
        <button type="button" onClick={timer.togglePause}><FocusIcon name={paused ? 'play' : 'pause'} />{paused ? '继续' : '暂停'}</button>
        <button type="button" onClick={timer.extend}><FocusIcon name="plus" />延长 5 分钟</button>
        <button type="button" className={ui.dangerText} onClick={timer.requestEnd}>结束</button>
      </div>
      <button type="button" className={ui.returnTimer} onClick={() => { navigate('/study/focus'); setExpanded(false) }}>回到计时页面</button>
    </motion.div> : null}</AnimatePresence>
  </motion.div> : null}</AnimatePresence>
}

