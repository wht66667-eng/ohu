import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { checkReminderHealth, markNotifyConsentAsked, requestNotifyPermission, refreshAllReminders, wasNotifyConsentAsked, type ReminderRefreshResult } from '../lib/notify-setup'
import { checkInAppClassPopup, classReminderExpiresAt, isClassReminderTipCurrent, getRemindMinutes, isClassRemindEnabled, isClassSoonRemindEnabled, isClassStartRemindEnabled, CLASS_REMIND_PREF_EVENT, notifyClassNow, rescheduleClassReminders, type InAppClassTip } from '../lib/class-remind'
import { getNextClass, SCHEDULE_CACHE_EVENT } from '../lib/schedule-cache'
import { restoreKeepAliveIfWanted, updateKeepAliveText, DEFAULT_KEEP_ALIVE_TEXT } from '../lib/keep-alive'
import { scheduleTestReminder } from '../lib/reminder-self-test'
import { examCountdown, getDueExamReminders, rescheduleExamReminders, type DueExamReminder } from '../lib/exam-utils'
import { EXAM_REMIND_PREF_EVENT } from '../lib/exam-reminder-prefs'
import { getDueCertReminders } from '../lib/cert-remind'
import { checkInAppTodoPopup, refreshTodoReminderState, TODO_DATA_CHANGED_EVENT } from '../lib/todo-remind'
import { fireAlertBurst } from '../lib/alert-effects'
import { getClassReminderEffects, getReminderStyle } from '../lib/reminder-presentation'
import { enqueueReminderCards, getReminderPopupStyle, reminderActionRoute, subscribeReminderPopup, type ReminderCard } from '../lib/reminder-popup'
import { ReminderPopup } from './ReminderPopup'
import { DialogLayer } from './ui/DialogLayer'
import styles from './RemindHost.module.css'
import { IS_NATIVE } from '../lib/platform'
import { useAuth } from '../lib/auth'
import { captureQbankSession, isQbankSessionCurrent, subscribeQbank } from '../lib/qbank'
import { clearPersonalReminders, getPersonalReminderScope, PERSONAL_REMINDER_ERROR_EVENT } from '../lib/personal-reminders'
import { ACADEMIC_CACHE_EVENT } from '../lib/academic-cache'
import { onReminderOverlayOpened } from '../lib/reminder-overlay'

type NotificationAction = Parameters<typeof reminderActionRoute>[0]
let deferredAction: { action: NotificationAction; receivedAt: number } | null = null
const ACTION_EVENT = 'ohhu-reminder-action-ready'

type ExpiringReminderCard = ReminderCard & { expiresAt?: number }
const liveCard = (card: ExpiringReminderCard, now = Date.now()) => card.expiresAt === undefined || now < card.expiresAt
function classReminderCard(tip: InAppClassTip, date = new Date().toDateString()): ExpiringReminderCard {
  return { id: `class:${tip.status}:${tip.name}:${tip.timeLabel}:${date}`, kind: tip.status === 'now' ? 'class-start' : 'class-soon', title: tip.status === 'now' ? '正在上课' : '快上课了', name: tip.name, detail: [tip.timeLabel, tip.room].filter(Boolean).join(' · '), hint: tip.hint, route: '/schedule', actionLabel: '查看课表', expiresAt: classReminderExpiresAt(tip) }
}

function examReminderCard(due: DueExamReminder, uid: string): ReminderCard {
  const exam = due.exam
  return { id: `exam-pop:${encodeURIComponent(uid)}:${due.key}`, kind: 'exam', title: due.kind === 'evening' ? '明日考试提醒' : due.kind === 'start' ? '开考提醒' : '考前提醒', name: exam.name, detail: [exam.datetime, exam.room, exam.seat ? `座位 ${exam.seat}` : ''].filter(Boolean).join(' · '), hint: due.kind === 'evening' ? '请提前核对准考证、文具与出行安排' : examCountdown(exam.datetime).label, route: '/study?tab=exams', actionLabel: '考试安排' }
}

export function RemindHost() {
  const scope = useSyncExternalStore(subscribeQbank, getPersonalReminderScope, getPersonalReminderScope)
  return <RemindAccountHost key={scope} />
}

function RemindAccountHost() {
  const auth = useAuth()
  const nav = useNavigate()
  const session = captureQbankSession()
  const signed = auth.isSigned && auth.user?.uid === session.uid
  const variant = useSyncExternalStore(subscribeReminderPopup, getReminderPopupStyle, () => 'banner' as const)
  const [reminderError, setReminderError] = useState('')
  const [reminderNotice, setReminderNotice] = useState('')
  const [askNotify, setAskNotify] = useState(false)
  const [busy, setBusy] = useState(false)
  const [queue, setQueue] = useState<ExpiringReminderCard[]>([])
  const [showQueue, setShowQueue] = useState(false)
  const announced = useRef(new Set<string>())
  const visibleQueue = queue.filter((card) => liveCard(card))
  const active = visibleQueue[0]

  function applyRefresh(result: ReminderRefreshResult) {
    if (!isQbankSessionCurrent(session)) return
    setReminderError(result.errors.join('；'))
    setReminderNotice(result.notices.join('；'))
  }
  async function syncKeepAliveNotice(result?: ReminderRefreshResult) {
    if (!isQbankSessionCurrent(session)) return
    let text = ''
    try {
      const next = getNextClass()
      if (next?.name && next.status === 'now') text = `正在上课 · ${next.name}`
      else if (next?.name && next.status === 'soon') text = `下节课 · ${next.name} ${next.timeLabel}`.trim()
    } catch { /* Fall back to the confirmed scheduling count. */ }
    if (!text) {
      const total = result ? result.classCount + result.examCount + result.certCount + result.todoCount : 0
      text = total ? `已安排 ${total} 条提醒` : DEFAULT_KEEP_ALIVE_TEXT
    }
    await updateKeepAliveText(text)
  }

  useEffect(() => {
    const host = window as Window & { __SC_TEST_REMINDER__?: number }
    let alive = true
    const run = () => {
      const secs = Number(host.__SC_TEST_REMINDER__) || 60
      delete host.__SC_TEST_REMINDER__
      void scheduleTestReminder(secs).then((r) => { if (alive && isQbankSessionCurrent(session) && !r.ok) setReminderError(r.message) })
    }
    window.addEventListener('native-test-reminder', run)
    if (host.__SC_TEST_REMINDER__) run()
    return () => { alive = false; window.removeEventListener('native-test-reminder', run) }
  }, [session.uid, session.revision])

  useEffect(() => {
    if (!signed) return
    const fail = () => { if (isQbankSessionCurrent(session)) setReminderError('提醒更新失败，请检查系统权限后重试。') }
    const academic = () => { void rescheduleExamReminders().catch(fail) }
    const schedule = () => { void rescheduleClassReminders().catch(fail) }
    const todo = () => { void refreshTodoReminderState(session).catch(fail) }
    window.addEventListener(PERSONAL_REMINDER_ERROR_EVENT, fail)
    window.addEventListener(ACADEMIC_CACHE_EVENT, academic)
    window.addEventListener(SCHEDULE_CACHE_EVENT, schedule)
    window.addEventListener(TODO_DATA_CHANGED_EVENT, todo)
    return () => {
      window.removeEventListener(PERSONAL_REMINDER_ERROR_EVENT, fail)
      window.removeEventListener(ACADEMIC_CACHE_EVENT, academic)
      window.removeEventListener(SCHEDULE_CACHE_EVENT, schedule)
      window.removeEventListener(TODO_DATA_CHANGED_EVENT, todo)
    }
  }, [signed, session.uid, session.revision])

  useEffect(() => {
    if (!signed) return
    void restoreKeepAliveIfWanted().catch(() => { if (isQbankSessionCurrent(session)) setReminderNotice('常驻提醒恢复失败，请在通知与提醒设置中重试；系统闹钟独立运行。') })
    if (!wasNotifyConsentAsked()) {
      const timer = window.setTimeout(() => { if (isQbankSessionCurrent(session)) setAskNotify(true) }, 600)
      return () => clearTimeout(timer)
    }
    void refreshAllReminders().then((result) => { applyRefresh(result); return syncKeepAliveNotice(result) }).catch(() => { if (isQbankSessionCurrent(session)) setReminderError('提醒更新失败，请重试。') })
  }, [signed, session.uid, session.revision])

  useEffect(() => {
    if (!IS_NATIVE) return
    let alive = true
    const handles: { remove(): Promise<void> }[] = []
    const reconcile = async () => {
      if (!signed) return
      try {
        await restoreKeepAliveIfWanted().catch(() => { if (alive && isQbankSessionCurrent(session)) setReminderNotice('常驻提醒恢复失败，请在通知与提醒设置中重试；系统闹钟独立运行。') })
        if (!alive || !isQbankSessionCurrent(session)) return
        const health = await checkReminderHealth()
        if (!alive || !isQbankSessionCurrent(session)) return
        window.dispatchEvent(new CustomEvent('native-reminder-resume', { detail: health }))
        const result = await refreshAllReminders()
        if (!alive) return
        applyRefresh(result)
        await syncKeepAliveNotice(result)
      } catch { if (alive && isQbankSessionCurrent(session)) setReminderError('提醒更新失败，请检查系统通知权限后重试。') }
    }
    const retain = async (handle: { remove(): Promise<void> }) => { if (!alive) await handle.remove(); else handles.push(handle) }
    const consumeAction = () => {
      if (!alive || !isQbankSessionCurrent(session) || !deferredAction) return
      if (Date.now() - deferredAction.receivedAt > 120_000) { deferredAction = null; return }
      const route = reminderActionRoute(deferredAction.action, signed ? session.uid : '')
      if (route) { deferredAction = null; nav(route) }
      else if (signed) deferredAction = null
    }
    window.addEventListener(ACTION_EVENT, consumeAction)
    consumeAction()
    void import('@capacitor/app').then(async ({ App }) => {
      await retain(await App.addListener('appStateChange', ({ isActive }) => { if (isActive) void reconcile() }))
    }).catch(() => { if (alive) setReminderNotice('无法监听前台恢复，请在设置中手动刷新提醒。') })
    void import('@capacitor/local-notifications').then(async ({ LocalNotifications }) => {
      await retain(await LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
        // A late retained callback from the guest host forwards to the newly authenticated host.
        deferredAction = { action: event, receivedAt: Date.now() }
        window.dispatchEvent(new Event(ACTION_EVENT))
      }))
    }).catch(() => { if (alive) setReminderNotice('通知点击监听未就绪，请从课表或待办入口查看。') })
    // Retained cold-start clicks must wait for authentication rather than be consumed by the guest host.
    if (signed) void onReminderOverlayOpened((event) => {
      if (alive && isQbankSessionCurrent(session) && event.ownerUid === session.uid && event.route === '/schedule') nav('/schedule')
    }).then(retain).catch(() => { /* System notification navigation is independent. */ })
    void reconcile()
    return () => { alive = false; window.removeEventListener(ACTION_EVENT, consumeAction); for (const handle of handles) void handle.remove() }
  }, [session.uid, session.revision, signed, nav])

  useEffect(() => {
    if (!signed) return
    const tick = () => {
      if (!isQbankSessionCurrent(session) || document.visibilityState === 'hidden') return
      setQueue((previous) => previous.filter((card) => liveCard(card)))
      const cards: ReminderCard[] = []
      const tip = checkInAppClassPopup()
      if (tip) {
        cards.push(classReminderCard(tip))
        // Native has already scheduled this event; a second immediate notice would ring twice.
        if (!IS_NATIVE) void notifyClassNow(tip).catch(() => { if (isQbankSessionCurrent(session)) setReminderError('上课通知发送失败，请重试。') })
      }
      for (const due of getDueExamReminders()) {
        const card = examReminderCard(due, session.uid)
        if (sessionStorage.getItem(card.id) !== '1') {
          sessionStorage.setItem(card.id, '1')
          cards.push(card)
        }
      }
      const todo = checkInAppTodoPopup()
      if (todo) cards.push({ id: `todo:${todo.id}:${todo.status}`, kind: 'todo', title: todo.status === 'due' ? '待办到期' : '待办提醒', name: todo.title, detail: '', hint: todo.hint, route: '/todo', actionLabel: '查看待办' })
      const cert = getDueCertReminders()[0]
      if (cert) {
        const key = `cert-pop:${encodeURIComponent(session.uid)}:${cert.certId}:${cert.date}`
        if (sessionStorage.getItem(key) !== '1') {
          sessionStorage.setItem(key, '1')
          cards.push({ id: key, kind: 'cert', title: '考证提醒', name: cert.name, detail: [cert.date, cert.note].filter(Boolean).join(' · '), hint: '请确认准考证、文具与出行时间', route: '/study?tab=certs', actionLabel: '考证目录' })
        }
      }
      if (cards.length) setQueue((previous) => enqueueReminderCards(previous, cards))
    }
    const refreshClassQueue = () => {
      if (!isQbankSessionCurrent(session)) return
      const next = getNextClass()
      const now = new Date()
      const startClock = next?.timeLabel.match(/^\s*([01]?\d|2[0-3]):([0-5]\d)(?=$|\s|[–—~-])/)
      const minutesUntilStart = startClock ? Number(startClock[1]) * 60 + Number(startClock[2]) - now.getHours() * 60 - now.getMinutes() : Infinity
      const enabled = isClassRemindEnabled()
      const soonAllowed = enabled && isClassSoonRemindEnabled() && next?.status === 'soon' && minutesUntilStart >= 0 && minutesUntilStart <= getRemindMinutes()
      const startAllowed = enabled && isClassStartRemindEnabled() && next?.status === 'now' && isClassReminderTipCurrent({ ...next, status: 'now' })
      const currentCard = next && (soonAllowed || startAllowed) ? classReminderCard({ ...next, status: soonAllowed ? 'soon' : 'now' }, now.toDateString()) : null
      setQueue((previous) => previous.flatMap((item) => {
        if (item.kind === 'class-soon' || item.kind === 'class-start') return currentCard?.id === item.id ? [currentCard] : []
        return [item]
      }))
      // Recheck immediately; the shared seen key still prevents a dismissed event from repeating.
      tick()
    }
    const refreshExamQueue = () => {
      if (!isQbankSessionCurrent(session)) return
      const currentCards = new Map(getDueExamReminders().map((due) => { const card = examReminderCard(due, session.uid); return [card.id, card] }))
      setQueue((previous) => previous.flatMap((item) => {
        if (item.kind !== 'exam') return [item]
        const current = currentCards.get(item.id)
        return current ? [current] : []
      }))
      tick()
    }
    tick()
    const timer = window.setInterval(tick, 10_000)
    window.addEventListener(CLASS_REMIND_PREF_EVENT, refreshClassQueue)
    window.addEventListener(SCHEDULE_CACHE_EVENT, refreshClassQueue)
    window.addEventListener(EXAM_REMIND_PREF_EVENT, refreshExamQueue)
    window.addEventListener(ACADEMIC_CACHE_EVENT, refreshExamQueue)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(timer); window.removeEventListener(CLASS_REMIND_PREF_EVENT, refreshClassQueue); window.removeEventListener(SCHEDULE_CACHE_EVENT, refreshClassQueue); window.removeEventListener(EXAM_REMIND_PREF_EVENT, refreshExamQueue); window.removeEventListener(ACADEMIC_CACHE_EVENT, refreshExamQueue); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick) }
  }, [signed, session.uid, session.revision])

  useEffect(() => {
    if (!active || !liveCard(active) || askNotify || reminderError || showQueue || !isQbankSessionCurrent(session) || announced.current.has(active.id)) return
    announced.current.add(active.id)
    const scope = active.kind.startsWith('class') ? 'class' : active.kind === 'exam' ? 'exam' : active.kind === 'todo' ? 'todo' : null
    const quiet = scope && getReminderStyle(scope) === 'quiet'
    // Android channel owns sound/vibration; avoid doubling its scheduled alert in the WebView.
    if (!IS_NATIVE && scope === 'class') {
      const effects = getClassReminderEffects()
      void fireAlertBurst({ title: active.title, body: `${active.name}，${active.detail || active.hint}`, ring: effects.sound, vibrate: effects.vibration, speak: false, notify: false })
    } else if (!IS_NATIVE && !quiet) void fireAlertBurst({ title: active.title, body: `${active.name}，${active.detail || active.hint}`, notify: false })
  }, [active?.id, askNotify, reminderError, showQueue, session.uid, session.revision])

  async function retryReminders() {
    if (busy) return
    setBusy(true)
    try {
      await clearPersonalReminders()
      if (!isQbankSessionCurrent(session)) return
      const result = await refreshAllReminders()
      applyRefresh(result)
      await syncKeepAliveNotice(result)
    } catch { if (isQbankSessionCurrent(session)) setReminderError('提醒更新失败，请检查系统权限后重试。') }
    finally { if (isQbankSessionCurrent(session)) setBusy(false) }
  }
  async function onAllowNotify() {
    if (busy) return
    setBusy(true)
    try {
      const ok = await requestNotifyPermission()
      if (!isQbankSessionCurrent(session)) return
      setAskNotify(false)
      if (ok) {
        const health = await checkReminderHealth()
        if (isQbankSessionCurrent(session)) window.dispatchEvent(new CustomEvent('native-reminder-resume', { detail: health }))
      } else setReminderNotice('通知权限尚未开启，可在设置中重新检查。')
    } catch { if (isQbankSessionCurrent(session)) setReminderError('无法开启通知权限，请在设置中重试。') }
    finally { if (isQbankSessionCurrent(session)) setBusy(false) }
  }
  function onDenyNotify() { markNotifyConsentAsked(); setAskNotify(false) }
  const dismiss = () => setQueue((previous) => previous.filter((card) => liveCard(card) && card.id !== active?.id))

  return <>
    {reminderError && !askNotify ? <section className={styles.notice} role="alert" aria-busy={busy}>
      <span className={styles.noticeText}><strong>提醒更新失败</strong>{reminderError}</span>
      <button type="button" className={styles.noticeAct} disabled={busy} onClick={() => void retryReminders()}>{busy ? <><span className={styles.spinner} aria-hidden="true" />正在重试</> : '重试'}</button>
      <button type="button" className={styles.noticeClose} disabled={busy} onClick={() => setReminderError('')} aria-label="稍后处理提醒错误">×</button>
    </section> : null}
    {reminderNotice && !reminderError && !active && !askNotify ? <section className={styles.notice} role="status">
      <span className={styles.noticeText}>{reminderNotice}</span>
      {reminderNotice.includes('课表') ? <Link className={styles.noticeAct} to="/schedule" onClick={() => setReminderNotice('')}>去同步</Link> : null}
      <button type="button" className={styles.noticeClose} onClick={() => setReminderNotice('')} aria-label="关闭提示">×</button>
    </section> : null}
    {askNotify ? <DialogLayer title="通知权限" onClose={onDenyNotify} allowClose={!busy} className={styles.sheet}>
      <h2>开启课程与日程提醒</h2>
      <p>允许通知后，可按已保存的课表、考试与待办安排系统提醒。声音和震动可在系统通知设置调整。</p>
      <div className={styles.btns}><button type="button" className={styles.ghost} disabled={busy} onClick={onDenyNotify}>暂不</button><button type="button" className={styles.main} disabled={busy} onClick={() => void onAllowNotify()}>{busy ? '正在请求…' : '允许通知'}</button></div>
    </DialogLayer> : null}
    {active && !askNotify && !reminderError && !showQueue ? <ReminderPopup key={active.id + variant} item={active} variant={variant} remaining={visibleQueue.length - 1} onDismiss={dismiss} onQueue={() => setShowQueue(true)} /> : null}
    {showQueue && !askNotify && !reminderError ? <DialogLayer title="待处理提醒" onClose={() => setShowQueue(false)} className={styles.sheet}>
      <h2>待处理提醒 <span className={styles.count}>{visibleQueue.length}</span></h2><p>一次展示一条，查看后从列表移除。</p>
      <ul className={styles.list}>{visibleQueue.map((card) => <li key={card.id}><Link to={card.route} onClick={() => { setQueue((previous) => previous.filter((item) => item.id !== card.id)); setShowQueue(false) }}><small>{card.title}</small><strong>{card.name}</strong><span>{card.detail || card.hint}</span></Link><button type="button" aria-label={`关闭${card.name}提醒`} onClick={() => setQueue((previous) => previous.filter((item) => item.id !== card.id))}>×</button></li>)}</ul>
      {!visibleQueue.length ? <p role="status">提醒已全部处理。</p> : null}
      <button type="button" className={styles.ghost} onClick={() => setShowQueue(false)}>返回当前页面</button>
    </DialogLayer> : null}
  </>
}
