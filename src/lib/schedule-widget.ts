import { registerPlugin } from '@capacitor/core'
import {
  getScheduleRowsForDate,
  getScheduleTermStart,
  loadScheduleCache,
  validateScheduleSnapshot,
} from './schedule-cache'
import { captureQbankSession, isQbankSessionCurrent } from './qbank'
import { loadLocalPeriods } from './schedule-prefs'
import { getDayStatus, toDateKey } from './schedule-calendar'
import { listLocalTodos } from './local-todos'
import { isAndroidWidgetPlatform, readWidgetShortcuts, type WidgetShortcut } from './widget-shortcuts'

type WidgetClass = { name: string; room: string; start: string; end: string }
type WidgetState = 'ready' | 'off' | 'empty' | 'unavailable'
type WidgetTodos = { titles: string[]; total: number; completed: number }
type ScheduleWidgetPlugin = {
  setIdentity(options: { uid: string; revision: number; instanceId: string; signed: boolean }): Promise<void>
  setData(options: { uid: string; revision: number; instanceId: string; date: string; dayLabel: string; state: WidgetState; classes: WidgetClass[]; todos: WidgetTodos }): Promise<void>
  setShortcuts(options: { routes: WidgetShortcut[] }): Promise<void>
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

/** 桌面只显示今天的已核验课表和本机待办标题，不读取备注或发起云端查询。 */
export async function refreshScheduleWidgets(signedUid: string): Promise<void> {
  if (!isAndroidWidgetPlatform()) return
  const session = captureQbankSession()
  const uid = signedUid && signedUid === session.uid ? session.uid : ''
  void widget.setShortcuts({ routes: readWidgetShortcuts() }).catch(() => undefined)
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

    const localTodos = listLocalTodos()
    const todayTodos = localTodos.filter((row) => {
      if (typeof row.title !== 'string' || !row.title.trim()) return false
      const due = Date.parse(row.due_at || '')
      const completed = Date.parse(row.done_at || '')
      if (row.done) return (Number.isFinite(completed) && toDateKey(new Date(completed)) === date)
        || (Number.isFinite(due) && toDateKey(new Date(due)) === date)
      return !Number.isFinite(due) || toDateKey(new Date(due)) <= date
    })
    const todos: WidgetTodos = {
      titles: todayTodos.filter((row) => !row.done).slice(0, 3).map((row) => row.title.trim().slice(0, 64)),
      total: todayTodos.length,
      completed: todayTodos.filter((row) => row.done).length,
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
      todos,
    })
  } catch {
    // Widget rendering is a secondary surface; it must not interrupt app startup or schedule use.
  }
}
