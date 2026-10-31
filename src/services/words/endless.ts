/**
 * 无尽闯关：倒计时阶段递减 + 本地排行榜。
 * 前 10 题 10s，之后每 10 题减 1s，最低 1s；题库不限（全库）。
 */
import type { WordEntry } from '../../data/words/banks'
import { getWordBank, wordsForEndlessStage } from '../../data/words/banks'
import { captureQbankSession } from '../../lib/qbank'

const LB_LEGACY_KEY = 'petdex.words.endless.lb.v1'
const LB_LEGACY_OWNER_KEY = `${LB_LEGACY_KEY}:claimed-by`
const LB_LEGACY_IMPORTED_KEY = `${LB_LEGACY_KEY}:imported-by`
const LB_KEY_PREFIX = 'petdex.words.endless.lb.v2:'

export interface EndlessScore {
  id: string
  name: string
  correct: number
  /** 整局用时 ms */
  elapsedMs: number
  /** 最高连对 */
  bestStreak: number
  at: number
}

export type LegacyEndlessSummary = { count: number; bestScore: number }

function accountKey(uid = captureQbankSession().uid): string {
  return uid ? `uid:${encodeURIComponent(uid)}` : 'guest'
}
function leaderboardKey(uid = captureQbankSession().uid): string {
  return `${LB_KEY_PREFIX}${accountKey(uid)}`
}
function compareScores(a: EndlessScore, b: EndlessScore): number {
  if (b.correct !== a.correct) return b.correct - a.correct
  return a.elapsedMs - b.elapsedMs
}
function decodeScores(raw: string | null): EndlessScore[] | null {
  if (raw === null) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return null
    return value.map((item): EndlessScore | null => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const row = item as Record<string, unknown>
      const correct = Number(row.correct), elapsedMs = Number(row.elapsedMs), bestStreak = Number(row.bestStreak), at = Number(row.at)
      if (!String(row.id || '') || !Number.isFinite(correct) || correct < 0 || !Number.isFinite(elapsedMs) || elapsedMs < 0
        || !Number.isFinite(bestStreak) || bestStreak < 0 || !Number.isFinite(at)) return null
      return { id: String(row.id), name: String(row.name || '同学').slice(0, 16), correct: Math.floor(correct), elapsedMs, bestStreak: Math.floor(bestStreak), at }
    }).filter((row): row is EndlessScore => !!row && row.correct > 0)
      .sort(compareScores)
      .slice(0, 30)
  } catch { return null }
}
function readScores(key: string): EndlessScore[] {
  const scores = decodeScores(localStorage.getItem(key))
  if (!scores) throw new Error('排行榜数据无法读取，原记录已保留；请稍后重试。')
  return scores
}

/** 第 index 题（从 0）的倒计时秒数 */
export function endlessSecondsForIndex(index: number): number {
  const i = Math.max(0, Math.floor(index))
  return Math.max(1, 10 - Math.floor(i / 10))
}

/** 当前阶段文案：第几阶段、本阶段时限 */
export function endlessStageInfo(index: number): { stage: number; seconds: number; label: string } {
  const stage = Math.floor(Math.max(0, index) / 10) + 1
  const seconds = endlessSecondsForIndex(index)
  return { stage, seconds, label: `第 ${stage} 阶段 · ${seconds}s/题` }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 抽下一题：随阶段提高最低难度，全库循环不限量 */
export function pickEndlessWord(index: number, excludeIds: string[] = []): WordEntry {
  const stage = Math.floor(index / 10)
  let pool = wordsForEndlessStage(stage).filter((w) => !excludeIds.includes(w.id))
  if (!pool.length) pool = getWordBank().filter((w) => !excludeIds.includes(w.id))
  if (!pool.length) pool = getWordBank()
  return pool[Math.floor(Math.random() * pool.length)]
}

export function endlessDistractors(correct: WordEntry, count = 3): string[] {
  const others = shuffle(
    getWordBank().filter((w) => w.id !== correct.id && w.meaning !== correct.meaning).map((w) => w.meaning),
  )
  return others.slice(0, count)
}

export function loadEndlessLeaderboard(): EndlessScore[] {
  try { return readScores(leaderboardKey()) } catch { return [] }
}

export function submitEndlessScore(entry: Omit<EndlessScore, 'id' | 'at'>): EndlessScore[] {
  const row: EndlessScore = {
    ...entry,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    at: Date.now(),
  }
  const key = leaderboardKey()
  const list = readScores(key)
  list.push(row)
  list.sort(compareScores)
  const top = list.slice(0, 30)
  localStorage.setItem(key, JSON.stringify(top))
  return top
}

/** Unowned v1 scores stay hidden until a signed-in user explicitly claims them. */
export function getLegacyEndlessLeaderboardSummary(): LegacyEndlessSummary | null {
  const session = captureQbankSession()
  if (!session.uid) return null
  try {
    const owner = localStorage.getItem(LB_LEGACY_OWNER_KEY)
    const account = accountKey(session.uid)
    if (owner && owner !== account) return null
    if (localStorage.getItem(LB_LEGACY_IMPORTED_KEY) === account) return null
    const rows = decodeScores(localStorage.getItem(LB_LEGACY_KEY))
    if (!rows?.length) return null
    return { count: rows.length, bestScore: rows[0]!.correct }
  } catch { return null }
}

/** Claim legacy device-wide scores for this account only after an explicit user action. */
export function restoreLegacyEndlessLeaderboard(): { ok: boolean; error?: string; rows?: EndlessScore[] } {
  const session = captureQbankSession()
  if (!session.uid) return { ok: false, error: '请登录哦狐账号后再认领旧排行榜。' }
  const account = accountKey(session.uid)
  try {
    const owner = localStorage.getItem(LB_LEGACY_OWNER_KEY)
    if (owner && owner !== account) return { ok: false, error: '本机旧排行榜已归属另一个账号，不能再次导入。' }
    const legacy = decodeScores(localStorage.getItem(LB_LEGACY_KEY))
    if (!legacy?.length) return { ok: false, error: '没有可恢复的旧排行榜记录；原数据未删除。' }

    // Reserve ownership first. If the following write fails, the same account can retry,
    // while another account cannot claim scores whose original owner is unknown.
    if (!owner) localStorage.setItem(LB_LEGACY_OWNER_KEY, account)
    const key = leaderboardKey(session.uid)
    const existing = readScores(key)
    const merged = [...new Map([...legacy, ...existing].map(row => [row.id, row])).values()]
      .sort(compareScores).slice(0, 30)
    localStorage.setItem(key, JSON.stringify(merged))
    localStorage.setItem(LB_LEGACY_IMPORTED_KEY, account)
    return { ok: true, rows: merged }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '导入失败；旧排行榜仍保留。' }
  }
}

export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const r = s % 60
  return m > 0 ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`
}
