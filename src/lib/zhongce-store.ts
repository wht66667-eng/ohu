import { captureQbankSession, isQbankSessionCurrent } from './qbank'

/** 综测材料自查清单与估算草稿：本机按哦狐账号隔离，不是学校官方成绩。 */
const STORAGE_PREFIX = 'ohu.zhongce.v2'
const LEGACY_CLAIM_KEY = 'ohu.zhongce.v1.claimed-by'
const LS_COLLEGE = 'zhongce.collegeId'
const LS_CHECKS = 'zhongce.checks.v1'
const LS_SCORES = 'zhongce.scores.v1'

export type ZhongceScoreDraft = {
  culture: string
  honesty: string
  daily: string
  expand: string
}
type ZhongceBundle = { collegeId: string; checks: Record<string, boolean>; scores: ZhongceScoreDraft }

const defaults = (): ZhongceBundle => ({
  collegeId: 'yingyong',
  checks: {},
  scores: { culture: '80', honesty: '100', daily: '100', expand: '0' },
})
const storageKey = (uid: string) => `${STORAGE_PREFIX}:${uid ? `uid:${encodeURIComponent(uid)}` : 'guest'}`

function readBundle(uid: string): ZhongceBundle {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(uid)) || 'null')
    if (!parsed || typeof parsed !== 'object') return defaults()
    const base = defaults()
    return {
      collegeId: typeof parsed.collegeId === 'string' ? parsed.collegeId : base.collegeId,
      checks: parsed.checks && typeof parsed.checks === 'object' && !Array.isArray(parsed.checks) ? parsed.checks : base.checks,
      scores: parsed.scores && typeof parsed.scores === 'object' ? { ...base.scores, ...parsed.scores } : base.scores,
    }
  } catch { return defaults() }
}

function writeBundle(update: (current: ZhongceBundle) => ZhongceBundle): boolean {
  const session = captureQbankSession()
  const key = storageKey(session.uid)
  try {
    const previous = localStorage.getItem(key)
    const encoded = JSON.stringify(update(readBundle(session.uid)))
    localStorage.setItem(key, encoded)
    if (localStorage.getItem(key) !== encoded || !isQbankSessionCurrent(session)) {
      if (previous === null) localStorage.removeItem(key)
      else localStorage.setItem(key, previous)
      return false
    }
    window.dispatchEvent(new CustomEvent('ohu-zhongce-change', { detail: { uid: session.uid } }))
    return true
  } catch { return false }
}

export function loadZhongceCollegeId(): string { return readBundle(captureQbankSession().uid).collegeId }
export function saveZhongceCollegeId(id: string): boolean { return writeBundle(bundle => ({ ...bundle, collegeId: id })) }
export function loadZhongceChecks(): Record<string, boolean> { return readBundle(captureQbankSession().uid).checks }
export function saveZhongceChecks(map: Record<string, boolean>): boolean { return writeBundle(bundle => ({ ...bundle, checks: map })) }
export function loadZhongceScores(): ZhongceScoreDraft { return readBundle(captureQbankSession().uid).scores }
export function saveZhongceScores(scores: ZhongceScoreDraft): boolean { return writeBundle(bundle => ({ ...bundle, scores })) }

function readLegacy(): Partial<ZhongceBundle> | null {
  try {
    const hasLegacy = [LS_COLLEGE, LS_CHECKS, LS_SCORES].some(key => localStorage.getItem(key) !== null)
    if (!hasLegacy) return null
    const base = defaults()
    const collegeId = localStorage.getItem(LS_COLLEGE)
    let checks = base.checks
    let scores = base.scores
    try {
      const value = JSON.parse(localStorage.getItem(LS_CHECKS) || '{}')
      if (value && typeof value === 'object' && !Array.isArray(value)) checks = value
    } catch { /* keep defaults for damaged legacy data */ }
    try {
      const value = JSON.parse(localStorage.getItem(LS_SCORES) || 'null')
      if (value && typeof value === 'object' && !Array.isArray(value)) scores = { ...base.scores, ...value }
    } catch { /* keep defaults for damaged legacy data */ }
    return { collegeId: collegeId || base.collegeId, checks, scores }
  } catch { return null }
}

export function hasRestorableLegacyZhongce(): boolean {
  const legacy = readLegacy()
  if (!legacy) return false
  try {
    const owner = localStorage.getItem(LEGACY_CLAIM_KEY)
    return owner === null
  } catch { return false }
}

/** Legacy data has no account owner; only a direct user action may claim it once. */
export function claimLegacyZhongce(): boolean {
  const session = captureQbankSession()
  const legacy = readLegacy()
  if (!legacy) return false
  let previous: string | null = null
  const key = storageKey(session.uid)
  let oldBundle: string | null = null
  let targetWriteStarted = false
  try {
    previous = localStorage.getItem(LEGACY_CLAIM_KEY)
    if (previous !== null && previous !== session.uid) return false
    oldBundle = localStorage.getItem(key)
    const current = readBundle(session.uid)
    const base = defaults()
    const legacyBundle: ZhongceBundle = {
      collegeId: oldBundle === null || current.collegeId === base.collegeId ? legacy.collegeId || current.collegeId : current.collegeId,
      checks: oldBundle === null ? legacy.checks || current.checks : { ...(legacy.checks || {}), ...current.checks },
      scores: oldBundle === null ? legacy.scores || current.scores : {
        culture: current.scores.culture === base.scores.culture ? legacy.scores?.culture ?? current.scores.culture : current.scores.culture,
        honesty: current.scores.honesty === base.scores.honesty ? legacy.scores?.honesty ?? current.scores.honesty : current.scores.honesty,
        daily: current.scores.daily === base.scores.daily ? legacy.scores?.daily ?? current.scores.daily : current.scores.daily,
        expand: current.scores.expand === base.scores.expand ? legacy.scores?.expand ?? current.scores.expand : current.scores.expand,
      },
    }
    const encoded = JSON.stringify(legacyBundle)
    targetWriteStarted = true
    localStorage.setItem(key, encoded)
    if (localStorage.getItem(key) !== encoded || !isQbankSessionCurrent(session)) throw new Error('session changed')
    localStorage.setItem(LEGACY_CLAIM_KEY, session.uid)
    if (localStorage.getItem(LEGACY_CLAIM_KEY) !== session.uid) throw new Error('claim marker unavailable')
    window.dispatchEvent(new CustomEvent('ohu-zhongce-change', { detail: { uid: session.uid } }))
    return true
  } catch {
    try {
      if (targetWriteStarted) {
        if (oldBundle === null) localStorage.removeItem(key)
        else localStorage.setItem(key, oldBundle)
      }
      if (previous === null) localStorage.removeItem(LEGACY_CLAIM_KEY)
      else localStorage.setItem(LEGACY_CLAIM_KEY, previous)
    } catch { /* preserve legacy source when rollback is unavailable */ }
    return false
  }
}
