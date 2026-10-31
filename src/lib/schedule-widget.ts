import { Capacitor, registerPlugin } from '@capacitor/core'
import {
  getScheduleRowsForDate,
  getScheduleTermStart,
  loadScheduleCache,
  validateScheduleSnapshot,
} from './schedule-cache'
import { captureQbankSession, isQbankSessionCurrent } from './qbank'
import { loadLocalPeriods } from './schedule-prefs'
import { getDayStatus, toDateKey } from './schedule-calendar'

type WidgetClass = { name: string; room: string; start: string; end: string }
type WidgetState = 'ready' | 'off' | 'empty' | 'unavailable'
type ScheduleWidgetPlugin = {
  setIdentity(options: { uid: string; revision: number; instanceId: string; signed: boolean }): Promise<void>
  setData(options: { uid: string; revision: number; instanceId: string; date: string; dayLabel: string; state: WidgetState; classes: WidgetClass[] }): Promise<void>
}

const widget = registerPlugin<ScheduleWidgetPlugin>('ScheduleWidget')
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
const INSTANCE_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

function classTime(periods: ReturnType<typeof loadLocalPeriods>, sections: number[], edge: 'start' | 'end'): string {
  const safe = sections.map(Number).filter((value) => Number.isInteger(value) && value >= 1 && value <= 11)
  if (!safe.length) return ''
  const index = (edge === 'start' ? Math.min(...safe) : Math.max(...safe)) - 1
  const period = periods[index]
  return period ? period[edge === 'start' ? 0 : 1] : ''
}

/** Mirrors only today's validated, account-owned projection to Android home widgets. */
export async function refreshScheduleWidgets(signedUid: string): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return
  const session = captureQbankSession()
  const uid = signedUid && signedUid === session.uid ? session.uid : ''
  try {
    await widget.setIdentity({ uid, revision: session.revision, instanceId: INSTANCE_ID, signed: !!uid })
    if (!uid || !isQbankSessionCurrent(session)) return

    const snapshot = loadScheduleCache()
    const savedStudentId = typeof snapshot.meta?.stuid === 'string' ? snapshot.meta.stuid : ''
    const validated = validateScheduleSnapshot(snapshot, savedStudentId, new Date(), getScheduleTermStart(uid), uid)
    const now = new Date()
    const date = toDateKey(now)
    const day = ((now.getDay() + 6) % 7) + 1
    const dayStatus = getDayStatus(now)
    let state: WidgetState = validated.status === 'ready' ? dayStatus.off ? 'off' : 'empty' : 'unavailable'
    let classes: WidgetClass[] = []

    if (validated.status === 'ready' && !dayStatus.off) {
      const periods = loadLocalPeriods(now)
      classes = getScheduleRowsForDate(now, validated.rows, getScheduleTermStart(uid))
        .map((row) => ({
          name: String(row.name || '').trim().slice(0, 80),
          room: String(row.room || '').trim().slice(0, 80),
          start: classTime(periods, row.sections, 'start'),
          end: classTime(periods, row.sections, 'end'),
        }))
        .filter((item) => item.name && item.start && item.end)
        .sort((a, b) => a.start.localeCompare(b.start) || a.name.localeCompare(b.name))
        .map(({ name, room, start, end }) => ({ name, room, start, end }))
      state = classes.length ? 'ready' : 'empty'
    }

    if (!isQbankSessionCurrent(session)) return
    await widget.setData({
      uid,
      revision: session.revision,
      instanceId: INSTANCE_ID,
      date,
      dayLabel: DAYS[day - 1] || '',
      state,
      classes,
    })
  } catch {
    // Widget rendering is a secondary surface; it must not interrupt app startup or schedule use.
  }
}
