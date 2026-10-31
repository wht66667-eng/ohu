/**
 * 登录连击 / 缺勤变脸（学生端）
 *
 * - 产品约定：进门 / 登录 = 今日打卡，无显眼打卡条
 * - 本地：localStorage；云端尽力写 checkins / user_engagement
 * - 图标：按连击或离开天数切 launcher
 */
import { cbRdb } from './cb'
import { getAppShell, type AppShell } from './app-shell'
import { activityDay, syncLauncherMood, type IconStateKey } from './app-icon'
import { FOX_LABELS } from './fox-labels'
import { foxLocalDay } from './fox-calendar'

export type { IconStateKey }

export type Engagement = {
  uid: string
  shell: AppShell
  streakCurrent: number
  streakBest: number
  lastCheckinDate: string | null
  lastActiveAt: string | null
  iconState: IconStateKey
  checkedInToday: boolean
  awayDays: number
  labelZh: string
}

const LS_KEY = 'sc.engagement.v1'

type Store = {
  byKey: Record<
    string,
    {
      streakCurrent: number
      streakBest: number
      lastCheckinDate: string | null
      lastActiveAt: string | null
    }
  >
}

/** 表情变更广播：App 内所有狐狸位订阅此事件，实现「一处变脸，全同步步」 */
export const FOX_EVENT = 'fox-state-change'
export const AWAY_SNAPSHOT_EVENT = 'away-login-snapshot'

export function dispatchFoxState(eng: Engagement): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<Engagement>(FOX_EVENT, { detail: eng }))
}

type Any = any

/** 方案 B：在线用 streak 档；离线用 away 档（与抠图 manifest 对齐） */
const STREAK_THRESHOLDS: { day: number; key: IconStateKey; label: string }[] = [
  { day: 30, key: 'streak_14', label: FOX_LABELS.streak_14 },
  { day: 7, key: 'streak_7', label: FOX_LABELS.streak_7 },
  { day: 3, key: 'streak_3', label: FOX_LABELS.streak_3 },
  { day: 1, key: 'streak_1', label: FOX_LABELS.streak_1 },
]

const AWAY_THRESHOLDS: { day: number; key: IconStateKey; label: string }[] = [
  { day: 30, key: 'away_30', label: FOX_LABELS.away_30 },
  { day: 15, key: 'away_15', label: FOX_LABELS.away_15 },
  { day: 7, key: 'away_12', label: FOX_LABELS.away_12 },
  { day: 3, key: 'away_8', label: FOX_LABELS.away_8 },
  { day: 2, key: 'away_5', label: FOX_LABELS.away_5 },
  { day: 1, key: 'away_2', label: FOX_LABELS.away_2 },
]

function todayStr(d = new Date()): string {
  return foxLocalDay(d.getTime())
}

function ydayStr(): string {
  return new Date(Date.parse(`${todayStr()}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
}

function daysBetween(fromIsoDate: string | null, toIsoDate: string): number {
  /* 无记录 = 首次使用的新用户，不算「离开」 */
  if (!fromIsoDate) return 0
  const a = new Date(fromIsoDate + 'T00:00:00')
  const b = new Date(toIsoDate + 'T00:00:00')
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000))
}

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return { byKey: {} }
    const j = JSON.parse(raw) as Store
    return j?.byKey ? j : { byKey: {} }
  } catch {
    return { byKey: {} }
  }
}

function saveStore(s: Store) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

function keyOf(uid: string, shell: AppShell) {
  return `${shell}:${uid}`
}

/** 本机是否已有该用户的打卡记录（无记录 → 首次登录，应欢迎而非报缺勤） */
export function hasEngagementRecord(uid: string, shell: AppShell = getAppShell()): boolean {
  return !!loadStore().byKey[keyOf(uid, shell)]
}

export function resolveIconState(opts: {
  streakCurrent: number
  lastCheckinDate: string | null
  lastActiveAt: string | null
}): { iconState: IconStateKey; awayDays: number; labelZh: string; checkedInToday: boolean } {
  const today = todayStr()
  const checkedInToday = opts.lastCheckinDate === today
  const lastDay = activityDay(opts.lastActiveAt) || opts.lastCheckinDate
  const awayDays = checkedInToday ? 0 : daysBetween(lastDay, today)

  if (!lastDay) return { iconState: 'default', awayDays: 0, labelZh: FOX_LABELS.default, checkedInToday: false }
  if (checkedInToday || awayDays === 0) {
    const streak = Math.max(1, opts.streakCurrent || 1)
    for (const t of STREAK_THRESHOLDS) {
      if (streak >= t.day) return { iconState: t.key, awayDays, labelZh: t.label, checkedInToday }
    }
    return { iconState: 'streak_1', awayDays, labelZh: '继续加油！', checkedInToday }
  }

  for (const t of AWAY_THRESHOLDS) {
    if (awayDays >= t.day) return { iconState: t.key, awayDays, labelZh: t.label, checkedInToday }
  }
  return { iconState: 'away_2', awayDays, labelZh: '好久不见', checkedInToday }
}

function emptyEngagement(uid: string, shell: AppShell): Engagement {
  const r = resolveIconState({ streakCurrent: 0, lastCheckinDate: null, lastActiveAt: null })
  return {
    uid,
    shell,
    streakCurrent: 0,
    streakBest: 0,
    lastCheckinDate: null,
    lastActiveAt: null,
    ...r,
  }
}

async function cloudUpsert(eng: Engagement) {
  try {
    const uid = eng.uid
    if (!uid || uid.startsWith('local:')) return

    const body = {
      uid,
      shell: eng.shell,
      streak_current: eng.streakCurrent,
      streak_best: eng.streakBest,
      last_checkin_date: eng.lastCheckinDate,
      last_active_at: eng.lastActiveAt,
      icon_state: eng.iconState,
      updated_at: new Date().toISOString(),
    }

    const q: Any = cbRdb().from('user_engagement')
    const existing = await q.select('uid').eq('uid', uid).eq('shell', eng.shell).limit(1)
    const rows = Array.isArray(existing?.data) ? existing.data : []
    if (rows.length) {
      await (cbRdb().from('user_engagement') as Any)
        .update(body)
        .eq('uid', uid)
        .eq('shell', eng.shell)
    } else {
      await (cbRdb().from('user_engagement') as Any).insert(body)
    }
  } catch {
    /* 表未建 / 无权限：本地仍可用 */
  }
}

async function cloudInsertCheckin(uid: string, shell: AppShell, date: string) {
  if (!uid || uid.startsWith('local:')) return
  try {
    await (cbRdb().from('checkins') as Any).insert({
      uid,
      shell,
      date,
      source: 'login',
      created_at: new Date().toISOString(),
    })
  } catch {
    /* ignore duplicate / missing table */
  }
}

function readLocal(uid: string, shell: AppShell): Engagement {
  const store = loadStore()
  const row = store.byKey[keyOf(uid, shell)]
  if (!row) return emptyEngagement(uid, shell)
  const r = resolveIconState(row)
  return {
    uid,
    shell,
    streakCurrent: row.streakCurrent,
    streakBest: row.streakBest,
    lastCheckinDate: row.lastCheckinDate,
    lastActiveAt: row.lastActiveAt,
    ...r,
  }
}

function writeLocal(eng: Engagement) {
  const store = loadStore()
  store.byKey[keyOf(eng.uid, eng.shell)] = {
    streakCurrent: eng.streakCurrent,
    streakBest: eng.streakBest,
    lastCheckinDate: eng.lastCheckinDate,
    lastActiveAt: eng.lastActiveAt,
  }
  saveStore(store)
}

/** 解析打卡身份：优先云账号，否则本机学号门禁 */
export function resolveEngagementUid(opts: { cloudUid?: string | null; campusStuid?: string | null }): string {
  if (opts.cloudUid) return opts.cloudUid
  if (opts.campusStuid) return `local:${opts.campusStuid}`
  return 'local:anonymous'
}

/** 读取当前连击状态（同步，供 UI 首屏） */
export function getEngagementSync(uid: string, shell: AppShell = getAppShell()): Engagement {
  return readLocal(uid, shell)
}

/**
 * 记一次「今日已登录」：当天幂等；昨天连上则 +1，否则重置为 1。
 * 产品约定：登录 / 进门 = 打卡，无单独打卡按钮。
 */
export async function checkInToday(uid: string, shell: AppShell = getAppShell()): Promise<Engagement> {
  const today = todayStr()
  const prev = readLocal(uid, shell)
  let streak = prev.streakCurrent

  if (prev.lastCheckinDate === today) {
    /* 幂等：仍刷新活跃与图标 */
  } else if (prev.lastCheckinDate === ydayStr()) {
    streak = Math.max(1, prev.streakCurrent) + 1
  } else {
    streak = 1
  }

  const now = new Date().toISOString()
  const base = {
    streakCurrent: streak,
    streakBest: Math.max(prev.streakBest, streak),
    lastCheckinDate: today,
    lastActiveAt: now,
  }
  const r = resolveIconState(base)
  const eng: Engagement = { uid, shell, ...base, ...r }
  writeLocal(eng)
  dispatchFoxState(eng)
  await syncLauncherMood({
    lastActiveAt: eng.lastActiveAt,
    lastCheckinDate: eng.lastCheckinDate,
    streakCurrent: eng.streakCurrent,
    iconState: eng.iconState,
  })
  await cloudInsertCheckin(uid, shell, today)
  await cloudUpsert(eng)
  return eng
}

export type TouchActiveResult = Engagement & {
  /** 本次登录前已离开的天数（用于「多久没来」弹窗；登录后 awayDays 会清零） */
  previousAwayDays: number
  previousIconState: IconStateKey
  previousLabelZh: string
}

/**
 * 打开 App / 进门后调用。
 * 默认把本次登录记为今日打卡（autoCheckIn 默认 true）；传 false 则只刷新活跃与图标。
 */
export async function touchActive(
  uid: string,
  shell: AppShell = getAppShell(),
  opts?: { autoCheckIn?: boolean },
): Promise<TouchActiveResult> {
  const prev = readLocal(uid, shell)
  const firstVisit = !hasEngagementRecord(uid, shell)
  const prevIcon = resolveIconState(prev)
  const previousAwayDays = prevIcon.awayDays
  const previousIconState = prevIcon.iconState
  const previousLabelZh = prevIcon.labelZh

  /* 快照必须先于云请求写入；慢网时欢迎 / 回归提醒也能及时读取。 */
  try {
    sessionStorage.setItem(
      'sc.away.before.v2',
      JSON.stringify({ uid, first: firstVisit, days: previousAwayDays, icon: previousIconState, label: previousLabelZh, at: Date.now() }),
    )
    window.dispatchEvent(new Event(AWAY_SNAPSHOT_EVENT))
  } catch {
    /* ignore */
  }

  const eng =
    opts?.autoCheckIn !== false
      ? await checkInToday(uid, shell)
      : await (async () => {
          const now = new Date().toISOString()
          const base = {
            streakCurrent: prev.streakCurrent,
            streakBest: prev.streakBest,
            lastCheckinDate: prev.lastCheckinDate,
            lastActiveAt: now,
          }
          const r = resolveIconState(base)
          const next: Engagement = { uid, shell, ...base, ...r }
          writeLocal(next)
          dispatchFoxState(next)
          await syncLauncherMood({
            lastActiveAt: next.lastActiveAt,
            lastCheckinDate: next.lastCheckinDate,
            streakCurrent: next.streakCurrent,
            iconState: next.iconState,
          })
          await cloudUpsert(next)
          return next
        })()

  return { ...eng, previousAwayDays, previousIconState, previousLabelZh }
}
