/**
 * 待办闹钟：与上课 / 考试 / 考证提醒完全同一套机制（Capacitor 本地通知 + 精确闹钟），
 * 但三处独立，互不干扰：
 *   - 独立开关与提前分钟数（localStorage）
 *   - 独立 channel：todo-remind-v1（系统通知设置里可单独关）
 *   - 独立 id 段：60000–60079（课表 41000–49999、一键提醒 53000+）
 * 关掉 App 也由系统 AlarmManager 到点弹出并震动；App 前台则由 RemindHost 弹层 + 震动 + 语音。
 */
import { IS_NATIVE } from './platform'
import { buildReminderNotification, prepareReminderPresentation } from './reminder-presentation'
import { captureQbankSession, isQbankSessionCurrent } from './qbank'
import { runPersonalReminder } from './personal-reminders'
import { fetchTodoReminderCandidates } from './todo'
import { getTodoDataRevision, TODO_DATA_CHANGED_EVENT } from './todo-data-events'

const LS_ENABLED = 'todo.remind.enabled'
const LS_MINUTES = 'todo.remind.minutes'
// Keep the old unowned v1 key untouched; never import it into another person's account.
const cacheKey = (uid: string) => `todo.remind.cache.v2:uid:${encodeURIComponent(uid)}`
const ID_BASE = 60000
/** 一次排未来这么多天；待办比课表更动态，7 天足够 */
const HORIZON_DAYS = 7
const MAX_ITEMS = 40

export interface TodoRemindItem {
  id: number
  title: string
  due_at: string
}

export function isTodoRemindEnabled(): boolean {
  return localStorage.getItem(LS_ENABLED) !== '0'
}

export function setTodoRemindEnabled(on: boolean) {
  localStorage.setItem(LS_ENABLED, on ? '1' : '0')
}

/** 提前多少分钟提醒，默认 15（与上课提醒一致），范围 5–120 */
export function getTodoLeadMinutes(): number {
  const n = parseInt(localStorage.getItem(LS_MINUTES) || '15', 10)
  return Number.isFinite(n) ? Math.min(120, Math.max(5, n)) : 15
}

export function setTodoLeadMinutes(m: number) {
  localStorage.setItem(LS_MINUTES, String(Math.min(120, Math.max(5, m))))
}

/**
 * 待办页每次拉到数据就同步一份轻量镜像。
 * 闹钟排程与到点判定都只读这份缓存，避免 RemindHost 每 45 秒打一次网络。
 * 只留「未完成 + 有到期时间 + 未过期超过 1 天」的条目。
 */
export function syncTodoRemindCache(
  rows: Array<{ id: number; title: string; due_at: string | null; done: boolean }>,
  session = captureQbankSession(),
) {
  if (!session.uid || !isQbankSessionCurrent(session)) return false
  try {
    const now = Date.now()
    const keep: TodoRemindItem[] = rows
      .filter((r) => !r.done && r.due_at)
      .filter((r) => new Date(r.due_at as string).getTime() > now - 86400_000)
      .slice(0, MAX_ITEMS)
      .map((r) => ({ id: r.id, title: r.title, due_at: r.due_at as string }))
    const key = cacheKey(session.uid), encoded = JSON.stringify({ ownerUid: session.uid, rows: keep })
    localStorage.setItem(key, encoded)
    return localStorage.getItem(key) === encoded
  } catch {
    return false
  }
}

export function loadTodoRemindCache(): TodoRemindItem[] {
  const { uid } = captureQbankSession()
  if (!uid) return []
  try {
    const raw = JSON.parse(localStorage.getItem(cacheKey(uid)) || 'null')
    return raw?.ownerUid === uid && Array.isArray(raw.rows) ? raw.rows.filter((row: TodoRemindItem) => Number.isFinite(row?.id) && typeof row.title === 'string' && typeof row.due_at === 'string') : []
  } catch {
    return []
  }
}

/** 某条待办是否已被排了闹钟（供列表画小铃铛） */
export function hasTodoRemind(id: number): boolean {
  if (!isTodoRemindEnabled()) return false
  const now = Date.now()
  return loadTodoRemindCache().some((r) => r.id === id && new Date(r.due_at).getTime() + 60_000 > now)
}

function fmtWhen(ms: number): string {
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const d0 = new Date()
  d0.setHours(0, 0, 0, 0)
  const day = Math.floor((ms - d0.getTime()) / 86400_000)
  const dayText = day === 0 ? '今天' : day === 1 ? '明天' : `${d.getMonth() + 1}/${d.getDate()}`
  return `${dayText} ${hh}:${mm}`
}

type ScheduledItem = {
  id: number
  todoId: number
  at: Date
  title: string
  body: string
}

function buildItems(rows: TodoRemindItem[], leadMin: number): ScheduledItem[] {
  const now = Date.now()
  const horizon = now + HORIZON_DAYS * 86400_000
  const out: ScheduledItem[] = []
  rows.slice(0, MAX_ITEMS).forEach((r, i) => {
    const at = new Date(r.due_at).getTime()
    if (!Number.isFinite(at)) return
    const leadAt = at - leadMin * 60_000
    // 提前提醒
    if (leadAt > now + 15_000 && leadAt < horizon) {
      out.push({
        id: ID_BASE + i * 2,
        todoId: r.id,
        at: new Date(leadAt),
        title: `待办提醒 · ${r.title}`,
        body: `${leadMin} 分钟后到期 · ${fmtWhen(at)}`,
      })
    }
    // 到点准时
    if (at > now + 15_000 && at < horizon) {
      out.push({
        id: ID_BASE + i * 2 + 1,
        todoId: r.id,
        at: new Date(at),
        title: `待办到期 · ${r.title}`,
        body: `现在到期 · ${fmtWhen(at)}，去勾掉它`,
      })
    }
  })
  return out
}

/** 重新排待办闹钟（增删改待办、改开关、改提前量后都要调一次） */
export function rescheduleTodoReminders(): Promise<{ count: number; message: string }> {
  return runPersonalReminder('todo', async ({ session, current, plugin, schedule }) => {
  if (!isTodoRemindEnabled()) {
    return { count: 0, message: '待办提醒已关闭' }
  }
  const rows = loadTodoRemindCache()
  if (!IS_NATIVE) {
    return { count: 0, message: '网页版关闭后无法准点响，请用 App 并允许通知' }
  }
  const items = buildItems(rows, getTodoLeadMinutes())
  if (!items.length) return { count: 0, message: '暂无待办闹钟' }
  const perm = await plugin!.requestPermissions()
  if (!current()) return { count: 0, message: '账号已变化，旧提醒已撤销' }
  if (perm.display !== 'granted') throw new Error('未授予通知权限')
  const presentation = await prepareReminderPresentation('todo')
  if (!current()) return { count: 0, message: '账号已变化，旧提醒已撤销' }
  if (presentation.channelState.channel?.importance === 0) throw new Error('待办通知渠道已关闭，请到系统通知设置开启')
  const applied = await schedule({ notifications: items.map((it) => {
    const notice = buildReminderNotification(presentation, { ...it, ownerUid: session.uid })
    return { ...notice, extra: { ...notice.extra, todoId: it.todoId } }
  }) })
  if (!applied) return { count: 0, message: '账号已变化，旧提醒已撤销' }
  return {
    count: items.length,
    message: items.length
      ? `已安排 ${items.length} 条待办提醒（${presentation.styleLabel}，提前 ${getTodoLeadMinutes()} 分钟）；声音与震动以系统通知渠道设置为准`
      : '暂无待办闹钟：给待办设个到期时间就会自动排',
  }
  })
}

/** Refresh the account-scoped mirror after a todo write from any screen, then replace its native plan. */
export async function refreshTodoReminderState(session = captureQbankSession()): Promise<{ count: number; message: string }> {
  if (!session.uid || !isQbankSessionCurrent(session)) return { count: 0, message: '账号已变化，未刷新待办提醒' }
  const revision = getTodoDataRevision()
  const candidates = await fetchTodoReminderCandidates()
  if (!isQbankSessionCurrent(session)) return { count: 0, message: '账号已变化，未刷新待办提醒' }
  if (revision !== getTodoDataRevision()) return { count: 0, message: '待办已再次变化，较新的提醒刷新正在处理' }
  if (candidates.error) throw new Error(candidates.error)
  if (!syncTodoRemindCache(candidates.rows, session)) throw new Error('待办提醒缓存保存失败')
  return rescheduleTodoReminders()
}

export { TODO_DATA_CHANGED_EVENT }

/** 关闭开关 / 清空时把已排的闹钟撤掉 */
export async function cancelTodoReminders(): Promise<void> {
  await runPersonalReminder('todo', async () => ({ count: 0, message: '待办提醒已撤销' }))
}

export interface TodoRemindTip {
  id: number
  title: string
  due_at: string
  status: 'due' | 'soon'
  hint: string
}

/**
 * App 打开时：待办到点 / 即将到点就返回弹窗内容。
 * 用 sessionStorage 去重 —— 同一条每次启动 App 只弹一次，不反复骚扰。
 */
export function checkInAppTodoPopup(): TodoRemindTip | null {
  if (!isTodoRemindEnabled()) return null
  const lead = getTodoLeadMinutes()
  const now = Date.now()
  for (const r of loadTodoRemindCache()) {
    const at = new Date(r.due_at).getTime()
    if (!Number.isFinite(at)) continue
    const diff = at - now
    let status: TodoRemindTip['status'] | null = null
    if (diff <= 0 && diff > -60_000) status = 'due'
    else if (diff > 0 && diff <= lead * 60_000) status = 'soon'
    if (!status) continue
    const key = `todo-pop:${encodeURIComponent(captureQbankSession().uid)}:${r.id}:${status}`
    if (sessionStorage.getItem(key) === '1') continue
    sessionStorage.setItem(key, '1')
    return {
      id: r.id,
      title: r.title,
      due_at: r.due_at,
      status,
      hint:
        status === 'due'
          ? `已到点 · ${fmtWhen(at)}`
          : `${Math.max(1, Math.round(diff / 60_000))} 分钟后到期 · ${fmtWhen(at)}`,
    }
  }
  return null
}
