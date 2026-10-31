/**
 * 考试安排辅助：解析时间、倒计时、近期列表
 */
import type { ExamRowRemote } from './academic-cache'
import { loadExamsCache } from './academic-cache'
import { buildReminderNotification, prepareReminderPresentation } from './reminder-presentation'
import { runPersonalReminder } from './personal-reminders'
import { getExamReminderPreferences, type ExamReminderPreferences } from './exam-reminder-prefs'

const validClock = (hour: number, minute: number, second = 0) => hour >= 0 && hour < 24 && minute >= 0 && minute < 60 && second >= 0 && second < 60
/** Only explicit, valid timestamps can become an alarm; a date alone does not imply 09:00. */
export function parseExamStart(datetime: string): Date | null {
  const s = (datetime || '').trim()
  if (!s) return null
  // ISO offsets are parsed separately so an ordinary 09:00-11:00 range is never treated as a timezone.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/)
  const local = iso ? null : s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})[日号]?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*[-~～—–至]\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  const match = iso ?? local
  if (!match) return null
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number)
  const second = Number(match[6] || 0)
  if (!validClock(hour, minute, second)) return null
  if (local?.[7] && !validClock(+local[7], +local[8], Number(local[9] || 0))) return null
  const zone = iso?.[8]
  const millisecond = iso?.[7] ? Number(iso[7].padEnd(3, '0')) : 0
  const date = zone
    ? new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond))
    : new Date(year, month - 1, day, hour, minute, second, millisecond)
  const actual = zone
    ? [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
    : [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()]
  if (![year, month, day, hour, minute, second].every((value, index) => value === actual[index])) return null
  if (zone && zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3)), offsetMinute = Number(zone.slice(4, 6))
    if (!validClock(offsetHour, offsetMinute)) return null
    const offset = (offsetHour * 60 + offsetMinute) * 60_000 * (zone[0] === '+' ? 1 : -1)
    return new Date(date.getTime() - offset)
  }
  return date
}

export function examCountdown(datetime: string): { label: string; days: number; past: boolean } {
  const d = parseExamStart(datetime)
  if (!d) return { label: '时间待定', days: 999, past: false }
  const diff = d.getTime() - Date.now()
  if (diff < -3 * 3600_000) return { label: '已结束', days: -1, past: true }
  if (diff < 0) return { label: '进行中/今日', days: 0, past: false }
  const days = Math.floor(diff / 86400_000)
  const hours = Math.floor((diff % 86400_000) / 3600_000)
  if (days === 0) return { label: hours <= 1 ? '即将开考' : `${hours} 小时后`, days: 0, past: false }
  if (days === 1) return { label: '明天', days: 1, past: false }
  return { label: `${days} 天后`, days, past: false }
}

export function sortExamsUpcoming(rows: ExamRowRemote[]): ExamRowRemote[] {
  return [...rows].sort((a, b) => {
    const da = parseExamStart(a.datetime)?.getTime() ?? Number.MAX_SAFE_INTEGER
    const db = parseExamStart(b.datetime)?.getTime() ?? Number.MAX_SAFE_INTEGER
    return da - db
  })
}

/** 首页：未来 N 天内考试（默认 21 天） */
export function getUpcomingExams(withinDays = 21, limit = 3): ExamRowRemote[] {
  const now = Date.now()
  const end = now + withinDays * 86400_000
  return sortExamsUpcoming(loadExamsCache())
    .filter((e) => {
      const t = parseExamStart(e.datetime)?.getTime()
      if (t == null) return true
      return t >= now - 2 * 3600_000 && t <= end
    })
    .slice(0, limit)
}

export type ExamReminderPhase = 'evening' | 'lead' | 'start'
export type DueExamReminder = { kind: ExamReminderPhase; key: string; exam: ExamRowRemote; at: Date }
type ExamReminderNode = { kind: ExamReminderPhase; at: Date; until: Date }

function examReminderNodes(start: Date, preferences: ExamReminderPreferences): ExamReminderNode[] {
  const nodes: ExamReminderNode[] = []
  if (preferences.eveningEnabled) {
    const at = new Date(start), until = new Date(start)
    const [hour, minute] = preferences.eveningTime.split(':').map(Number)
    at.setDate(at.getDate() - 1); at.setHours(hour, minute, 0, 0)
    until.setTime(at.getTime() + 60_000)
    nodes.push({ kind: 'evening', at, until })
  }
  if (preferences.leadEnabled) {
    const at = new Date(start.getTime() - Math.round(preferences.leadHours * 60) * 60_000)
    nodes.push({ kind: 'lead', at, until: new Date(at.getTime() + 60_000) })
  }
  if (preferences.startEnabled) nodes.push({ kind: 'start', at: start, until: new Date(start.getTime() + 60_000) })
  return nodes
}

/** Each exam contributes only its most recently triggered applicable phase; no uncertain clocks are inferred. */
export function getDueExamReminders(): DueExamReminder[] {
  const preferences = getExamReminderPreferences()
  if (!preferences.enabled) return []
  const now = Date.now(), due: DueExamReminder[] = []
  for (const exam of getUpcomingExams(2, Number.MAX_SAFE_INTEGER)) {
    const start = parseExamStart(exam.datetime)
    if (!start) continue
    const triggered = examReminderNodes(start, preferences).filter(node => node.at.getTime() <= now)
    const latest = triggered.reduce<ExamReminderNode | null>((chosen, node) => !chosen || node.at.getTime() >= chosen.at.getTime() ? node : chosen, null)
    // An expired newer phase must not bring an older already-triggered phase back into view.
    if (!latest || now >= latest.until.getTime()) continue
    due.push({ kind: latest.kind, at: latest.at, exam, key: `exam:${JSON.stringify([latest.kind, exam.code || '', exam.name, start.getTime(), latest.at.getTime()])}` })
    if (due.length === 5) break
  }
  return due
}

export function rescheduleExamReminders(): Promise<{ count: number; message: string }> {
  return runPersonalReminder('exam', async ({ session, current, plugin, schedule }) => {
  const preferences = getExamReminderPreferences()
  if (!preferences.enabled) return { count: 0, message: '考试提醒已关闭' }
  if (!preferences.eveningEnabled && !preferences.leadEnabled && !preferences.startEnabled) return { count: 0, message: '考试的三个提醒时点均已关闭' }
  const exams = sortExamsUpcoming(loadExamsCache())
  const unknownCount = exams.filter((exam) => !parseExamStart(exam.datetime)).length
  const unknownHint = unknownCount ? `；另有 ${unknownCount} 场考试时间待定，未安排精确提醒` : ''
  const list = exams.filter((e) => {
    const c = examCountdown(e.datetime)
    return !c.past && c.days <= 14
  })
  if (!list.length) return { count: 0, message: unknownCount ? `${unknownCount} 场考试时间待定，确认具体时刻后才能安排提醒` : '近两周无待提醒考试' }

  try {
    if (plugin) {
      const perm = await plugin.requestPermissions()
      if (!current()) return { count: 0, message: '账号已变化，旧提醒已撤销' }
      if (perm.display !== 'granted') return { count: 0, message: '未授予通知权限' }

      const presentation = await prepareReminderPresentation('exam')
      if (!current()) return { count: 0, message: '账号已变化，旧提醒已撤销' }
      if (presentation.channelState.channel?.importance === 0) throw new Error('考试通知渠道已关闭，请到系统通知设置开启')

      const items: Array<{ id: number; title: string; body: string; at: Date }> = []
      list.slice(0, 333).forEach((ex, i) => {
        const start = parseExamStart(ex.datetime)
        if (!start) return
        for (const { kind, at } of examReminderNodes(start, preferences)) {
          if (at.getTime() <= Date.now()) continue
          items.push({
            id: 51000 + i * 3 + (kind === 'evening' ? 0 : kind === 'lead' ? 1 : 2),
            at,
            title: at.getTime() === start.getTime() ? `开考 · ${ex.name}` : `考试提醒 · ${ex.name}`,
            body: `${ex.datetime}${ex.room ? ` · ${ex.room}` : ''}${ex.seat ? ` · 座${ex.seat}` : ''}`,
          })
        }
      })

      if (!items.length) return { count: 0, message: '考试提醒时间已过' }
      const applied = await schedule({
        notifications: items.map((it) => buildReminderNotification(presentation, { ...it, ownerUid: session.uid })),
      })
      if (!applied) return { count: 0, message: '账号已变化，旧提醒已撤销' }
      return { count: items.length, message: `已安排 ${items.length} 条考试提醒${unknownHint}` }
    }

    // H5：尽量申请通知；到点弹窗由 RemindHost 负责
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await Notification.requestPermission()
    }
    if (!current()) return { count: 0, message: '账号已变化，旧提醒已撤销' }
    return {
      count: list.length,
      message:
        typeof Notification !== 'undefined' && Notification.permission === 'granted'
          ? `已记录 ${list.length} 场近期考试（打开 App 时会弹窗提醒）${unknownHint}`
          : `请允许通知，或保持 App 打开以收到考试弹窗${unknownHint}`,
    }
  } catch (e) {
    return { count: 0, message: (e as Error).message || '考试提醒安排失败' }
  }
  })
}
