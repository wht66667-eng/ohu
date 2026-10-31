/**
 * 待办负荷系统（量力式「负荷条」）
 *
 * 设计要点：
 * - 每条待办带 1-5 档精力负荷（todos.load，默认 2），加待办时就先估一次「要花多少力气」，
 *   而不是无上限地往清单里塞。
 * - 今日负荷 = 未完成待办中「今天到期 / 已逾期 / 没设到期」的负荷之和；
 *   明确排到未来的（due_at 在明天及以后）不计入今天，否则进度条天天爆表。
 * - 每日上限存 client_prefs（pref_key=todo_load_cap），本地优先、登录后云端同步；
 *   表没建或没权限时静默回落 localStorage，不影响使用。
 */
import { cbRdb } from './cb'
import { captureQbankSession, isQbankSessionCurrent } from './qbank'

type Any = any

export type LoadValue = 1 | 2 | 3 | 4 | 5

export interface LoadLevel {
  value: LoadValue
  /** 档位名 */
  label: string
  /** 一句话解释，给新建弹层用 */
  desc: string
}

export const LOAD_LEVELS: LoadLevel[] = [
  { value: 1, label: '随手', desc: '几分钟，几乎不费神' },
  { value: 2, label: '一般', desc: '常规作业 / 事务' },
  { value: 3, label: '费神', desc: '要动脑，想一会儿' },
  { value: 4, label: '硬仗', desc: '成块时间，容易拖' },
  { value: 5, label: '大工程', desc: '要拆成几次才做得完' },
]

export const DEFAULT_LOAD: LoadValue = 2
export const DEFAULT_CAP = 10
export const CAP_MIN = 4
export const CAP_MAX = 30

const localKey = (uid: string) => `todo.load.cap.v1:${uid ? `uid:${encodeURIComponent(uid)}` : 'guest'}`
const PREF_KEY = 'todo_load_cap'

/** 任意输入收敛到 1-5；非法值回落默认档 */
export function normLoad(v: unknown): LoadValue {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return DEFAULT_LOAD
  if (n < 1) return 1
  if (n > 5) return 5
  return n as LoadValue
}

export function loadLabel(v: unknown): string {
  const n = normLoad(v)
  return LOAD_LEVELS.find((l) => l.value === n)?.label || String(n)
}

export function capClamp(v: unknown): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return DEFAULT_CAP
  return Math.min(CAP_MAX, Math.max(CAP_MIN, n))
}

function readLocalCap(uid = captureQbankSession().uid): number {
  try {
    const raw = Number(localStorage.getItem(localKey(uid)))
    return Number.isFinite(raw) && raw > 0 ? capClamp(raw) : DEFAULT_CAP
  } catch {
    return DEFAULT_CAP
  }
}

function writeLocalCap(cap: number, uid = captureQbankSession().uid) {
  try {
    localStorage.setItem(localKey(uid), String(cap))
  } catch {
    /* ignore */
  }
}

export function getLoadCap(): number {
  return readLocalCap()
}

export function setLoadCap(cap: number): number {
  const next = capClamp(cap)
  writeLocalCap(next)
  return next
}

/** 登录后拉云端上限；云端有值以云端为准并覆盖本地，云端空则把本地值回写 */
export async function pullLoadCap(uid: string): Promise<number> {
  const session = captureQbankSession()
  if (uid !== session.uid) return readLocalCap(uid)
  const local = readLocalCap(uid)
  if (!uid) return local
  try {
    const res: Any = await cbRdb()
      .from('client_prefs')
      .select('pref_value')
      .eq('uid', uid)
      .eq('pref_key', PREF_KEY)
      .limit(1)
    if (!isQbankSessionCurrent(session)) return local
    if (res?.error) return local
    const row = Array.isArray(res?.data) ? res.data[0] : res?.data
    const raw = Number(row?.pref_value?.cap)
    if (Number.isFinite(raw) && raw > 0) {
      const cap = capClamp(raw)
      writeLocalCap(cap, uid)
      return cap
    }
    void pushLoadCap(uid, local)
    return local
  } catch {
    return isQbankSessionCurrent(session) ? local : readLocalCap(uid)
  }
}

export async function pushLoadCap(uid: string, cap: number): Promise<void> {
  const next = capClamp(cap)
  const session = captureQbankSession()
  if (uid !== session.uid) return
  writeLocalCap(next, uid)
  if (!uid) return
  try {
    const body = {
      uid,
      pref_key: PREF_KEY,
      pref_value: { cap: next },
      updated_at: new Date().toISOString(),
    }
    const existing: Any = await cbRdb()
      .from('client_prefs')
      .select('uid')
      .eq('uid', uid)
      .eq('pref_key', PREF_KEY)
      .limit(1)
    if (!isQbankSessionCurrent(session) || existing?.error) return
    const has = Array.isArray(existing?.data) ? existing.data.length > 0 : !!existing?.data
    if (has) {
      await cbRdb()
        .from('client_prefs')
        .update({ pref_value: body.pref_value, updated_at: body.updated_at })
        .eq('uid', uid)
        .eq('pref_key', PREF_KEY)
    } else {
      await cbRdb().from('client_prefs').insert(body)
    }
  } catch {
    /* 表未建或无权限时忽略 */
  }
}

export interface LoadRowLike {
  done?: boolean
  due_at?: string | null
  load?: number | null
}

export interface LoadState {
  /** 今日已排负荷 */
  used: number
  cap: number
  /** 0-1+，超过 1 表示爆表，进度条按 1 封顶 */
  ratio: number
  over: boolean
  /** 达到上限 80% 起提醒 */
  warn: boolean
  /** 计入今日负荷的条数 */
  count: number
}

function endOfToday(now: number): number {
  const d = new Date(now)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

/** 该待办要不要算进「今日负荷」 */
export function countsToday(row: LoadRowLike, now = Date.now()): boolean {
  if (row.done) return false
  if (!row.due_at) return true
  const t = new Date(row.due_at).getTime()
  if (!Number.isFinite(t)) return true
  return t <= endOfToday(now)
}

export function computeLoad(rows: LoadRowLike[], cap = getLoadCap(), now = Date.now()): LoadState {
  const c = capClamp(cap)
  let used = 0
  let count = 0
  for (const r of rows) {
    if (!countsToday(r, now)) continue
    used += normLoad(r.load)
    count += 1
  }
  return {
    used,
    cap: c,
    ratio: c > 0 ? used / c : 0,
    over: used > c,
    warn: c > 0 && used > c * 0.8,
    count,
  }
}

/** 还要塞下这条待办，会不会爆表（新建 / 编辑弹层实时提示用） */
export function wouldExceed(rows: LoadRowLike[], draftLoad: unknown, cap = getLoadCap(), now = Date.now()): boolean {
  const base = computeLoad(rows, cap, now)
  return base.used + normLoad(draftLoad) > base.cap
}

/** 负荷条文案 */
export function loadHint(state: LoadState): string {
  if (state.count === 0) return '今天还没排事，先挑一件最要紧的'
  if (state.over) return `今天排了 ${state.used} 点，超过上限 ${state.cap} 点，挪几件到明天或放回成长池`
  if (state.warn) return `今天已排 ${state.used} / ${state.cap} 点，快到上限了，留点余量`
  return `今天已排 ${state.used} / ${state.cap} 点，还剩 ${state.cap - state.used} 点余量`
}
