/**
 * 课表节次时间偏好：海大官方作息（夏/秋）+ 用户自定义覆盖
 * 官方来源：教务处 https://jwc.jou.edu.cn/jsfz1/zxsj.htm
 * - 5/1–9/30 夏令作息；10/1–次年4/30 秋冬作息（下午/晚上更早）
 * - localStorage 即时生效；PG schedule_prefs 按账号持久化
 */
import { cbRdb, cbAuth } from './cb'
import { captureQbankSession, isQbankSessionCurrent } from './qbank'

type Any = any

/** 夏令：5 月 1 日 — 9 月 30 日 */
export const JOU_SUMMER_TM: ReadonlyArray<readonly [string, string]> = [
  ['08:00', '08:45'],
  ['08:55', '09:40'],
  ['10:00', '10:45'],
  ['10:55', '11:40'],
  ['14:30', '15:15'],
  ['15:25', '16:10'],
  ['16:20', '17:05'],
  ['17:15', '18:00'],
  ['18:10', '18:55'],
  ['19:30', '20:15'],
  ['20:25', '21:10'],
]

/** 秋冬：10 月 1 日 — 次年 4 月 30 日（官网第六节写作 14.55，按 14:55） */
export const JOU_WINTER_TM: ReadonlyArray<readonly [string, string]> = [
  ['08:00', '08:45'],
  ['08:55', '09:40'],
  ['10:00', '10:45'],
  ['10:55', '11:40'],
  ['14:00', '14:45'],
  ['14:55', '15:40'],
  ['15:50', '16:35'],
  ['16:45', '17:30'],
  ['17:40', '18:25'],
  ['19:00', '19:45'],
  ['19:55', '20:40'],
]

/** 兼容旧引用：与当前日期对应的官方表同形 */
export const DEFAULT_TM = JOU_SUMMER_TM

export type PeriodPair = [string, string]
export type PeriodSeason = 'summer' | 'winter'

const LEGACY_LS_KEY = 'schedule.periodTimes'
const LEGACY_LS_CUSTOM = 'schedule.periodTimes.custom'
const LS_PREFIX = 'schedule.periodTimes.v2'
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** 旧版内置默认（用于迁移：若本地仍是旧默认则改用官网表） */
const LEGACY_DEFAULT_TM: ReadonlyArray<readonly [string, string]> = [
  ['08:05', '08:55'],
  ['08:55', '09:45'],
  ['10:00', '10:45'],
  ['10:55', '11:40'],
  ['14:30', '15:15'],
  ['15:25', '16:10'],
  ['16:20', '17:05'],
  ['17:15', '18:00'],
  ['18:10', '18:55'],
  ['19:30', '20:15'],
  ['20:25', '21:10'],
]

function errText(e: unknown): string {
  if (!e) return '操作失败，请稍后重试'
  const a = e as { message?: unknown; msg?: unknown }
  const m = typeof a.message === 'string' ? a.message : typeof a.msg === 'string' ? a.msg : ''
  return m || '操作失败，请稍后重试'
}

function readError(e: unknown): string | null {
  if (!e) return null
  if (typeof e === 'string') return e
  const msg = (e as { message?: string }).message
  return msg || null
}

/** "08:05" → 485（分钟） */
export function toMin(t: string): number {
  return Number(t.slice(0, 2)) * 60 + Number(t.slice(3))
}

function cloneTm(tm: ReadonlyArray<readonly [string, string]>): PeriodPair[] {
  return tm.map((p) => [p[0], p[1]] as PeriodPair)
}

function sameTm(a: ReadonlyArray<readonly [string, string]>, b: ReadonlyArray<readonly [string, string]>): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false
  }
  return true
}

/** 按日期取夏令 / 秋冬作息 */
export function getPeriodSeason(d: Date = new Date()): PeriodSeason {
  const m = d.getMonth() + 1
  const day = d.getDate()
  // 5/1–9/30 夏令；10/1–4/30 秋冬
  if (m > 5 && m < 10) return 'summer'
  if (m === 5 && day >= 1) return 'summer'
  if (m === 9 && day <= 30) return 'summer'
  return 'winter'
}

export function getOfficialPeriods(d: Date = new Date()): PeriodPair[] {
  return cloneTm(getPeriodSeason(d) === 'summer' ? JOU_SUMMER_TM : JOU_WINTER_TM)
}

export function officialSeasonLabel(d: Date = new Date()): string {
  return getPeriodSeason(d) === 'summer' ? '海大夏令（5/1–9/30）' : '海大秋冬（10/1–4/30）'
}

function isUidSigned(): boolean {
  try {
    const u = (cbAuth() as Any).currentUser
    return !!u && !u.isAnonymous
  } catch {
    return false
  }
}

function currentUid(): string {
  try {
    const u = (cbAuth() as Any).currentUser
    return String(u?.uid || u?.id || '')
  } catch {
    return ''
  }
}

/**
 * 校验节次时间表：必须是 11 组合法 HH:MM 且开始早于结束。
 * 任何一项非法就整体回退默认（用户改错一格不至于毁掉整张课表时间轴）。
 */
export function sanitizePeriods(v: unknown): PeriodPair[] | null {
  if (!Array.isArray(v)) return null
  const out: PeriodPair[] = []
  for (let i = 0; i < JOU_SUMMER_TM.length; i++) {
    const p = v[i]
    if (!Array.isArray(p) || p.length < 2) return null
    const s = String(p[0])
    const e = String(p[1])
    if (!TIME_RE.test(s) || !TIME_RE.test(e) || toMin(s) >= toMin(e)) return null
    out.push([s, e])
  }
  return out
}

export function isCustomPeriods(): boolean {
  return localStorage.getItem(scopedKey('custom')) === '1'
}

function scopedUid(): string {
  const session = captureQbankSession()
  return isUidSigned() && session.uid && currentUid() === session.uid ? session.uid : ''
}

function scopedKey(kind: 'value' | 'custom', uid = scopedUid()): string {
  const owner = uid ? `uid:${encodeURIComponent(uid)}` : 'guest'
  return `${LS_PREFIX}:${owner}:${kind}`
}

function readLegacyCustomPeriods(): PeriodPair[] | null {
  try {
    const raw = localStorage.getItem(LEGACY_LS_KEY)
    const parsed = raw ? sanitizePeriods(JSON.parse(raw)) : null
    if (!parsed) return null
    const markedCustom = localStorage.getItem(LEGACY_LS_CUSTOM) === '1'
    const resemblesOldDefault = sameTm(parsed, LEGACY_DEFAULT_TM)
    const resemblesOfficial = sameTm(parsed, JOU_SUMMER_TM) || sameTm(parsed, JOU_WINTER_TM)
    return markedCustom || (!resemblesOldDefault && !resemblesOfficial) ? parsed : null
  } catch {
    return null
  }
}

/** Legacy global timing data has no owner; only offer it for explicit, signed-in recovery. */
export function getLegacyPeriodsImportStatus(): { count: number; alreadyImported: boolean } {
  try {
    const session = captureQbankSession()
    const legacy = readLegacyCustomPeriods()
    return {
      count: legacy?.length ?? 0,
      alreadyImported: !!session.uid && localStorage.getItem(`${LS_PREFIX}:legacy-claimed:${encodeURIComponent(session.uid)}`) === '1',
    }
  } catch {
    return { count: 0, alreadyImported: false }
  }
}

/** Copy old unowned timing data only after the signed-in user confirms it belongs to them. */
export function claimLegacyPeriodsForCurrentAccount(): { ok: boolean; periods: PeriodPair[] | null; error?: string } {
  const session = captureQbankSession()
  if (!session.uid || session.uid.startsWith('local:') || !isUidSigned() || currentUid() !== session.uid) {
    return { ok: false, periods: null, error: '请先登录哦狐账号，再恢复旧作息设置。' }
  }
  try {
    const status = getLegacyPeriodsImportStatus()
    if (status.alreadyImported) return { ok: true, periods: loadLocalPeriods() }
    const legacy = readLegacyCustomPeriods()
    if (!legacy) return { ok: false, periods: null, error: '没有找到可恢复的旧版自定义作息。' }
    saveLocalPeriods(legacy, true, session.uid)
    const key = `${LS_PREFIX}:legacy-claimed:${encodeURIComponent(session.uid)}`
    localStorage.setItem(key, '1')
    if (localStorage.getItem(key) !== '1' || !isQbankSessionCurrent(session) || currentUid() !== session.uid) {
      return { ok: false, periods: null, error: '旧作息尚未完成恢复，请在当前账号重试。' }
    }
    return { ok: true, periods: legacy }
  } catch {
    return { ok: false, periods: null, error: '旧作息没有复制成功，请检查设备存储空间后重试。' }
  }
}

/** 本地缓存的节次时间：有自定义用自定义，否则按今天取官方夏/秋冬 */
export function loadLocalPeriods(d: Date = new Date()): PeriodPair[] {
  try {
    const key = scopedKey('value')
    const customKey = scopedKey('custom')
    const raw = localStorage.getItem(key)
    if (!raw) return getOfficialPeriods(d)
    const parsed = sanitizePeriods(JSON.parse(raw))
    if (!parsed) return getOfficialPeriods(d)
    if (localStorage.getItem(customKey) === '1') return parsed
    // 旧默认未显式自定义 → 迁移到官网作息
    if (sameTm(parsed, LEGACY_DEFAULT_TM)) {
      const official = getOfficialPeriods(d)
      saveLocalPeriods(official, false)
      return official
    }
    // 已是官网表 → 按季节动态取（夏/秋冬自动切换）
    if (sameTm(parsed, JOU_SUMMER_TM) || sameTm(parsed, JOU_WINTER_TM)) {
      return getOfficialPeriods(d)
    }
    // 旧版已改过、尚无 custom 标记 → 保留并补标记
    saveLocalPeriods(parsed, true)
    return parsed
  } catch {
    return getOfficialPeriods(d)
  }
}

export function saveLocalPeriods(p: PeriodPair[], custom = true, uid = scopedUid()) {
  try {
    const key = scopedKey('value', uid)
    const customKey = scopedKey('custom', uid)
    localStorage.setItem(key, JSON.stringify(p))
    if (custom) localStorage.setItem(customKey, '1')
    else localStorage.removeItem(customKey)
  } catch {
    /* localStorage 被禁用等场景忽略 */
  }
}

/** 恢复海大官方（按当前季节），清除自定义标记 */
export function resetToOfficialPeriods(d: Date = new Date()): PeriodPair[] {
  const official = getOfficialPeriods(d)
  saveLocalPeriods(official, false)
  return official
}

/** 拉取云端节次时间（未登录 / 无记录 / 非法数据都返回 null，由调用方回退本地） */
export async function fetchRemotePeriods(): Promise<PeriodPair[] | null> {
  const session = captureQbankSession()
  if (!isUidSigned() || !session.uid || currentUid() !== session.uid) return null
  try {
    const res: Any = await (cbRdb().from('schedule_prefs') as Any).select('period_times')
    if (!isQbankSessionCurrent(session) || currentUid() !== session.uid || !isUidSigned()) return null
    const err = readError(res?.error)
    if (err) return null
    const row = Array.isArray(res?.data) ? res.data[0] : null
    if (!row) return null
    const p = sanitizePeriods(row.period_times)
    if (p) {
      // 与任一官方表一致则不算自定义（恢复官方后云端仍可能留着官方表）
      const asCustom = !(sameTm(p, JOU_SUMMER_TM) || sameTm(p, JOU_WINTER_TM))
      saveLocalPeriods(p, asCustom, session.uid)
    }
    return p
  } catch {
    return null
  }
}

/** 保存节次时间：本地立即生效，云端 upsert 按账号持久化 */
export async function savePeriods(
  p: PeriodPair[],
  opts: { custom?: boolean } = {},
): Promise<{ error: string | null }> {
  const session = captureQbankSession()
  const uid = currentUid()
  if (isUidSigned() && uid !== session.uid) return { error: '账号状态正在更新，请稍后重试' }
  const custom = opts.custom !== false
  saveLocalPeriods(p, custom, uid && isUidSigned() ? uid : '')
  if (!uid || !isUidSigned()) return { error: null }
  try {
    const res: Any = await (cbRdb().from('schedule_prefs') as Any).upsert(
      { uid, period_times: p },
      { onConflict: 'uid' },
    )
    if (!isQbankSessionCurrent(session) || currentUid() !== uid || !isUidSigned()) return { error: '账号已切换，请在当前账号重新保存' }
    return { error: readError(res?.error) ?? null }
  } catch (e) {
    if (!isQbankSessionCurrent(session) || currentUid() !== uid || !isUidSigned()) return { error: '账号已切换，请在当前账号重新保存' }
    return { error: errText(e) }
  }
}
