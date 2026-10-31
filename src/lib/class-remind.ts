/**
 * 课表上课提醒（借鉴酱海带 notification + 下一节课）
 * - 原生壳：Capacitor Local Notifications
 * - H5：浏览器 Notification（需用户授权）
 * 提前提醒分钟数可配置，默认 15。
 */
import { buildReminderNotification, prepareReminderPresentation } from './reminder-presentation'
import { exactAlarmGranted } from './alarm-notify'
import { classesOnDate, describeScheduleSnapshotStatus, getNextClass, loadScheduleCache, scheduleStudentIdForSnapshot, validateScheduleSnapshot } from './schedule-cache'
import type { TtRow } from './timetable'
import { captureQbankSession } from './qbank'
import { runPersonalReminder } from './personal-reminders'
import { clearReminderOverlays, syncReminderOverlays } from './reminder-overlay'
import { clearCourseReminderPlan, getCourseReminderPlanState, syncCourseReminderPlan } from './reminder-plan'
import { COURSE_MAX_LATENESS_MS, courseReminderExpiry } from './course-reminder-expiry'

const LS_ENABLED = 'schedule.remind.enabled'
const LS_MINUTES = 'schedule.remind.minutes'
const LS_SOON_ENABLED = 'schedule.remind.soon.enabled'
const LS_START_ENABLED = 'schedule.remind.start.enabled'
const LS_ALARM_CLOCK = 'schedule.remind.alarmClock.enabled'
const LS_LAST_POP = 'schedule.remind.lastPop'
export const CLASS_REMIND_PREF_EVENT = 'ohhu-class-remind-pref-change'
/** 一次排未来这么多天，关 App 也不用每天打开才有闹钟 */
const HORIZON_DAYS = 7
const MAX_PER_DAY = 8
/** An old course alert must never ring when the device finally wakes up. */
export const CLASS_REMINDER_MAX_LATENESS_MS = COURSE_MAX_LATENESS_MS

export function isClassRemindEnabled(): boolean {
  return localStorage.getItem(LS_ENABLED) !== '0'
}

function publishPreferenceChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CLASS_REMIND_PREF_EVENT))
}

export function setClassRemindEnabled(on: boolean) {
  localStorage.setItem(LS_ENABLED, on ? '1' : '0')
  publishPreferenceChange()
}

/** Both phases remain enabled for existing users until explicitly changed. */
export function isClassSoonRemindEnabled(): boolean {
  return localStorage.getItem(LS_SOON_ENABLED) !== '0'
}

export function setClassSoonRemindEnabled(on: boolean) {
  localStorage.setItem(LS_SOON_ENABLED, on ? '1' : '0')
  publishPreferenceChange()
}

export function isClassStartRemindEnabled(): boolean {
  return localStorage.getItem(LS_START_ENABLED) !== '0'
}

export function setClassStartRemindEnabled(on: boolean) {
  localStorage.setItem(LS_START_ENABLED, on ? '1' : '0')
  publishPreferenceChange()
}

/** User-facing course alarms avoid Android's ordinary idle-alarm batching. */
export function isClassAlarmClockEnabled(): boolean { return localStorage.getItem(LS_ALARM_CLOCK) !== '0' }
export function setClassAlarmClockEnabled(on: boolean) {
  localStorage.setItem(LS_ALARM_CLOCK, on ? '1' : '0')
  publishPreferenceChange()
}

export function getRemindMinutes(): number {
  const n = parseInt(localStorage.getItem(LS_MINUTES) || '15', 10)
  return Number.isFinite(n) ? Math.min(60, Math.max(5, n)) : 15
}

export function setRemindMinutes(m: number) {
  if (!Number.isFinite(m)) throw new Error('提前提醒分钟数无效')
  localStorage.setItem(LS_MINUTES, String(Math.min(60, Math.max(5, Math.trunc(m)))))
  publishPreferenceChange()
}

export type ClassRemindPayload = {
  kind: 'class-soon' | 'class-start'
  title: string
  body: string
  at: Date
  /** Original due time; moving an imminent native alarm cannot extend its lifetime. */
  reminderAt?: Date
  classStartAt?: Date
  classEndAt?: Date
  id: number
}

export function buildHorizonReminders(rows: TtRow[], leadMin: number, horizonDays = HORIZON_DAYS, now = Date.now()): ClassRemindPayload[] {
  const out: ClassRemindPayload[] = []
  const soonEnabled = isClassSoonRemindEnabled(), startEnabled = isClassStartRemindEnabled()
  for (let d = 0; d < Math.min(210, Math.max(0, horizonDays)); d++) {
    const day = new Date(now)
    day.setHours(0, 0, 0, 0)
    day.setDate(day.getDate() + d)
    const classes = classesOnDate(day, rows).slice(0, MAX_PER_DAY)
    classes.forEach((b, i) => {
      if (!Number.isFinite(b.startMin) || !Number.isFinite(b.endMin) || b.endMin <= b.startMin) return
      const startAt = new Date(day)
      startAt.setMinutes(b.startMin)
      const endAt = new Date(day)
      endAt.setMinutes(b.endMin)
      const leadAt = new Date(startAt.getTime() - leadMin * 60_000)
      const baseId = 43000 + d * 20 + i * 2
      if (soonEnabled && leadAt.getTime() > now) {
        out.push({
          kind: 'class-soon',
          id: baseId,
          at: leadAt,
          classStartAt: startAt,
          classEndAt: endAt,
          title: `下节课 · ${b.name}`,
          body: `${b.timeLabel} 开始 · ${b.room ? `教室 ${b.room}` : '教室见课表'}${b.teacher ? ` · ${b.teacher}` : ''}`,
        })
      }
      if (startEnabled && startAt.getTime() > now) {
        out.push({
          kind: 'class-start',
          id: baseId + 1,
          at: startAt,
          classStartAt: startAt,
          classEndAt: endAt,
          title: `上课时间 · ${b.name}`,
          body: `现在开始 · ${b.room ? `请前往 ${b.room}` : '请按时到教室'}`,
        })
      }
    })
  }
  return out
}

/**
 * Permissions/channel creation can cross a just-upcoming event. Keep it once with
 * a safe native lead, but never replay events already past when this plan began.
 * A long-open permission screen must not ring old classes after returning.
 */
export function normalizeClassReminderTimes(items: ClassRemindPayload[], plannedAt: number, schedulingAt = Date.now()): ClassRemindPayload[] {
  return items.flatMap((item) => {
    const at = item.at.getTime()
    const reminderAt = item.reminderAt ?? item.at
    const expiresAt = courseReminderExpiry(item.kind, reminderAt.getTime(), item.classStartAt?.getTime(), item.classEndAt?.getTime())
    if (!Number.isFinite(at) || !Number.isFinite(expiresAt) || at <= plannedAt || schedulingAt - at > 60_000 || schedulingAt + 1_000 >= expiresAt) return []
    return [{ ...item, reminderAt, at: new Date(Math.max(at, schedulingAt + 1_000)) }]
  })
}

async function ensureWebPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const r = await Notification.requestPermission()
  return r === 'granted'
}

export type ClassReminderOverlayResult = { status: 'scheduled' | 'inactive' | 'failed'; count: number; message: string }
export type ClassReminderResult = { count: number; message: string; overlay?: ClassReminderOverlayResult; plan?: ClassReminderOverlayResult }
/** 根据缓存课表刷新未来 7 天的系统提醒；桌面镜像结果独立报告。 */
export async function rescheduleClassReminders(): Promise<ClassReminderResult> {
  let overlay: ClassReminderOverlayResult | undefined
  let plan: ClassReminderOverlayResult | undefined
  let timingWarning = ''
  const result = await runPersonalReminder('class', async ({ session, current, plugin, clear, schedule }) => {
    const clearOverlay = async () => {
      if (!plugin) return
      try {
        if (current()) await clear()
        await clearReminderOverlays(session.uid, { preserveEnabled: true })
        await clearCourseReminderPlan(session.uid)
        overlay = current() ? { status: 'inactive', count: 0, message: '本账号的课表桌面提醒已清理；系统通知按独立计划处理' } : undefined
      } catch (error) {
        overlay = current() ? { status: 'failed', count: 0, message: `桌面提醒清理失败：${(error as Error)?.message || '请重试'}；系统通知不受影响` } : undefined
      }
    }
    if (!isClassRemindEnabled()) {
      await clearOverlay()
      return { count: 0, message: '上课提醒已关闭' }
    }
    if (!isClassSoonRemindEnabled() && !isClassStartRemindEnabled()) {
      await clearOverlay()
      return { count: 0, message: '课前和开课提醒均已关闭' }
    }
    const snapshot = loadScheduleCache()
    const studentId = scheduleStudentIdForSnapshot(snapshot, '', session.uid)
    const verified = validateScheduleSnapshot(snapshot, studentId, new Date(), undefined, session.uid)
    if (verified.status !== 'ready') {
      await clearOverlay()
      return { count: 0, message: describeScheduleSnapshotStatus(verified.status)?.detail || '课表尚未通过核对，暂不安排上课提醒' }
    }
    const rows = verified.rows
    if (!rows.length) { await clearOverlay(); return { count: 0, message: '已确认当前没有课程，旧提醒已清理' } }
    const leadMinutes = getRemindMinutes()
    const timing = [isClassSoonRemindEnabled() ? `提前 ${leadMinutes} 分钟` : '', isClassStartRemindEnabled() ? '开课时提醒' : ''].filter(Boolean).join('；')
    const plannedAt = Date.now()
    let items = buildHorizonReminders(rows, leadMinutes, HORIZON_DAYS, plannedAt)
    let semesterItems = plugin ? buildHorizonReminders(rows, leadMinutes, 210, plannedAt) : []
    if (plugin && semesterItems.length) {
      let notifications: ReturnType<typeof buildReminderNotification>[]
      let semesterNotifications: ReturnType<typeof buildReminderNotification>[]
      let nativeReplaced = false
      let legacyReplacing = false
      try {
        const perm = await plugin.requestPermissions()
        if (!current()) {
          await clearOverlay()
          return { count: 0, message: '账号已变化，旧提醒已撤销' }
        }
        if (perm.display !== 'granted') throw new Error('未授予通知权限')
        const presentation = await prepareReminderPresentation('class-soon')
        if (presentation.channelState.channel?.importance === 0) throw new Error('上课通知渠道已关闭，请到系统通知设置开启')
        if (!await exactAlarmGranted()) timingWarning = '；精确闹钟权限未开启，当前仅按普通方式安排，系统可能延后，请在手机“闹钟和提醒”中允许'
        const schedulingAt = Date.now()
        items = normalizeClassReminderTimes(items, plannedAt, schedulingAt)
        semesterItems = normalizeClassReminderTimes(semesterItems, plannedAt, schedulingAt)
        const build = (it: ClassRemindPayload) => buildReminderNotification(
          { ...presentation, kind: it.kind, extra: { ...presentation.extra, reminderKind: it.kind } },
          { ...it, ownerUid: session.uid, courseAlarmClock: isClassAlarmClockEnabled() },
        )
        notifications = items.map(build)
        semesterNotifications = semesterItems.map(build)
        const capability = await getCourseReminderPlanState()
        if (!current()) return { count: 0, message: '账号已变化，旧提醒已撤销' }
        if (capability.atomicReplaceSupported) {
          // Persist and replace inside one native operation. Killing the WebView
          // during preparation must not erase the previous recoverable source.
          const stored = await syncCourseReminderPlan({ ownerUid: session.uid, notifications: semesterNotifications })
          if (!current()) return { count: 0, message: '账号已变化，旧提醒已撤销' }
          if (!stored.supported || stored.lastError) throw new Error(stored.lastError || '后台提醒计划未确认，请重试')
          nativeReplaced = true
          plan = { status: 'scheduled', count: stored.plannedCount, message: `已保存本机课表 ${stored.plannedCount} 条未来提醒，手机后台滚动安排未来 7 天；课表变动仍需同步` }
        } else {
          // Compatibility for older APKs: defer destructive work until every
          // permission/channel/time check has succeeded.
          legacyReplacing = true
          await clearCourseReminderPlan(session.uid)
          if (!current()) return { count: 0, message: '账号已变化，旧提醒已撤销' }
          const applied = await schedule({ notifications })
          if (!applied) {
            await clearOverlay()
            return { count: 0, message: '账号已变化，旧提醒已撤销' }
          }
        }
      } catch (error) {
        // Preflight failure keeps the old confirmed native window/source intact.
        // Native replacement reports recoverable failures in its own state.
        if (legacyReplacing) await clearOverlay()
        throw error
      }
      try {
        const mirrored = await syncReminderOverlays({ ownerUid: session.uid, items: notifications.map((notice) => ({ id: notice.id, title: notice.title, body: notice.body, at: notice.schedule!.at!, expiresAt: notice.extra.expiresAt, route: notice.extra.route })) })
        overlay = mirrored.lastError
          ? { status: 'failed', count: mirrored.scheduledCount, message: `桌面提醒未能完整更新：${mirrored.lastError}；系统通知已按独立计划安排` }
          : !mirrored.supported || !mirrored.enabled || !mirrored.permissionGranted
            ? { status: 'inactive', count: 0, message: !mirrored.supported ? '当前设备未提供桌面覆盖提醒；系统通知已安排' : !mirrored.enabled ? '桌面覆盖提醒未启用；系统通知已安排' : '桌面覆盖权限未开启；系统通知已安排' }
            : { status: 'scheduled', count: mirrored.scheduledCount, message: `桌面提醒已镜像 ${mirrored.scheduledCount} 条；实际显示仍需当前设备验证` }
      } catch (error) {
        overlay = { status: 'failed', count: 0, message: `桌面提醒镜像失败：${(error as Error)?.message || '请重试'}；系统通知已按独立计划安排` }
      }
      if (!current()) {
        overlay = undefined
        return { count: 0, message: '账号已变化，旧提醒已撤销' }
      }
      if (!nativeReplaced) try {
        const stored = await syncCourseReminderPlan({ ownerUid: session.uid, notifications: semesterNotifications })
        plan = stored.lastError ? { status: 'failed', count: stored.plannedCount, message: `当前通知已安排，后续后台补排需检查：${stored.lastError}` }
          : !stored.supported ? { status: 'inactive', count: 0, message: '当前 App 仅安排未来 7 天，请更新安卓 App 以启用后续后台补排' }
          : { status: 'scheduled', count: stored.plannedCount, message: `已保存本机课表 ${stored.plannedCount} 条未来提醒，手机后台滚动安排未来 7 天；课表变动仍需同步` }
      } catch (error) {
        plan = { status: 'failed', count: 0, message: `当前通知已安排，后续后台补排失败：${(error as Error)?.message || '请重试'}` }
      }
      if (!current()) { await clearCourseReminderPlan(session.uid); return { count: 0, message: '账号已变化，旧提醒已撤销' } }
    } else if (!plugin) {
      const ok = await ensureWebPermission()
      if (!current()) return { count: 0, message: '账号已变化，旧提醒已撤销' }
      if (!ok) return { count: 0, message: '浏览器未允许通知' }
      return {
        count: 0,
        message: '网页版关闭后无法准点响，请用 App 并允许通知',
      }
    }
    if (plugin && !semesterItems.length) await clearOverlay()
    return {
      count: items.length,
      message: items.length
        ? `已安排未来 ${HORIZON_DAYS} 天 ${items.length} 条上课提醒（${timing}；横幅、锁屏及声音由系统设置决定）${plan?.status === 'scheduled' ? '，后续本机课表已保存供后台补排' : ''}${timingWarning}`
        : plan?.status === 'scheduled' ? '本周暂无课程，后续本机课表已保存供后台补排' : `未来 ${HORIZON_DAYS} 天没有待提醒课程`,
    }
  }, { preserveExisting: true })
  return { ...result, ...(overlay ? { overlay } : {}), ...(plan ? { plan } : {}) }
}

export type InAppClassTip = {
  name: string
  room: string
  timeLabel: string
  hint: string
  status: 'now' | 'soon'
  classStartAt?: number
  classEndAt?: number
  reminderAt?: number
}

function classStartAt(tip: Pick<InAppClassTip, 'timeLabel'>, now: number): number {
  const clock = tip.timeLabel.match(/^\s*([01]?\d|2[0-3]):([0-5]\d)(?=$|\s|[–—~-])/)
  if (!clock) return NaN
  const start = new Date(now)
  start.setHours(Number(clock[1]), Number(clock[2]), 0, 0)
  return start.getTime()
}

/** Also used for queued popups: a still-running long class is not a new reminder. */
export function classReminderExpiresAt(tip: InAppClassTip, now = Date.now()): number {
  const start = tip.classStartAt ?? classStartAt(tip, now)
  const due = tip.reminderAt ?? start - (tip.status === 'soon' ? getRemindMinutes() * 60_000 : 0)
  return courseReminderExpiry(tip.status === 'soon' ? 'class-soon' : 'class-start', due, start, tip.classEndAt)
}

export function isClassReminderTipCurrent(tip: InAppClassTip, now = Date.now()): boolean {
  const start = tip.classStartAt ?? classStartAt(tip, now)
  const expires = classReminderExpiresAt(tip, now)
  if (!Number.isFinite(start) || !Number.isFinite(expires) || now >= expires) return false
  return tip.status === 'soon' ? now < start && start - now <= getRemindMinutes() * 60_000 : now >= start
}

/** App 打开时：若即将上课/正在上课，返回弹窗内容（去重） */
export function checkInAppClassPopup(): InAppClassTip | null {
  const { uid } = captureQbankSession()
  if (!uid) return null
  if (!isClassRemindEnabled()) return null
  const next = getNextClass()
  if (next.status !== 'now' && next.status !== 'soon') return null
  if (next.status === 'now' && !isClassStartRemindEnabled()) return null
  const now = new Date(), actual = classesOnDate(now).find(row => row.name === next.name && row.timeLabel === next.timeLabel)
  const startAt = actual ? new Date(now) : null, endAt = actual ? new Date(now) : null
  startAt?.setHours(0, actual!.startMin, 0, 0); endAt?.setHours(0, actual!.endMin, 0, 0)
  const bounds = startAt && endAt ? { classStartAt: startAt.getTime(), classEndAt: endAt.getTime(), reminderAt: startAt.getTime() - (next.status === 'soon' ? getRemindMinutes() * 60_000 : 0) } : {}
  if (!isClassReminderTipCurrent({ ...next, ...bounds, status: next.status })) return null
  // soon：仅提前 remindMinutes 内弹
  if (next.status === 'soon') {
    if (!isClassSoonRemindEnabled()) return null
    // The display hint rounds whole hours down; use the actual period start instead.
    const clock = next.timeLabel.match(/^\s*([01]?\d|2[0-3]):([0-5]\d)(?=$|\s|[–—~-])/)
    if (!clock) return null
    const now = new Date(), startAt = new Date(now)
    startAt.setHours(Number(clock[1]), Number(clock[2]), 0, 0)
    const remaining = startAt.getTime() - now.getTime()
    if (remaining <= 0 || remaining > getRemindMinutes() * 60_000) return null
  }
  const key = `${next.status}|${next.name}|${next.timeLabel}|${new Date().toDateString()}`
  const ownedKey = `${LS_LAST_POP}:uid:${encodeURIComponent(uid)}`
  if (localStorage.getItem(ownedKey) === key) return null
  localStorage.setItem(ownedKey, key)
  return {
    name: next.name,
    room: next.room,
    timeLabel: next.timeLabel,
    hint: next.hint,
    status: next.status,
    ...bounds,
  }
}

/** H5 即时通知（用于测试 / 即将上课） */
export async function notifyClassNow(tip: InAppClassTip) {
  if (!isClassReminderTipCurrent(tip)) return { count: 0, message: '课程提醒已过期，不再补发' }
  const title = tip.status === 'now' ? `正在上课 · ${tip.name}` : `快上课了 · ${tip.name}`
  const body = `${tip.timeLabel}${tip.room ? ` · 去 ${tip.room}` : ''}`
  return runPersonalReminder('class-now', async ({ session, current, plugin, schedule }) => {
  if (plugin) {
      const presentation = await prepareReminderPresentation(tip.status === 'now' ? 'class-start' : 'class-soon')
      if (!isClassReminderTipCurrent(tip)) return { count: 0, message: '课程提醒已过期，不再补发' }
      if (presentation.channelState.channel?.importance === 0) throw new Error('上课通知渠道已关闭，请到系统通知设置开启')
      const applied = await schedule({
        notifications: [
          buildReminderNotification(presentation, {
            id: 40999,
            title,
            body,
            at: new Date(Date.now() + 800),
            reminderAt: new Date(tip.reminderAt ?? (tip.classStartAt ?? classStartAt(tip, Date.now())) - (tip.status === 'soon' ? getRemindMinutes() * 60_000 : 0)),
            classStartAt: tip.classStartAt === undefined ? undefined : new Date(tip.classStartAt),
            classEndAt: tip.classEndAt === undefined ? undefined : new Date(tip.classEndAt),
            courseAlarmClock: isClassAlarmClockEnabled(),
            ownerUid: session.uid,
          }),
        ],
      })
      return { count: applied ? 1 : 0, message: applied ? '已安排本次上课通知；实际显示由系统决定' : '账号已变化，旧提醒已撤销' }
  }
  if (current() && isClassReminderTipCurrent(tip) && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    // The foreground host applies the independent course tone/vibration once.
    new Notification(title, { body, tag: 'class-soon', silent: true })
  }
  return { count: 0, message: '已记录上课提醒' }
  })
}
