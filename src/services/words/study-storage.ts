import { captureQbankSession, isQbankSessionCurrent, subscribeQbank } from '../../lib/qbank'
import type { WordBankId, WordEntry } from '../../data/words/banks'
import type { StudyPlan } from './plans'
import type { SrsCard } from './srs'

export const WORD_STUDY_STORAGE_KEY = 'words.study.v2'
type DailyEntry = { bank: WordBankId; kind: 'new' | 'review' }
export type WordStudyBundle = {
  plans: StudyPlan[]
  activePlan: string
  cards: Record<string, SrsCard>
  daily: Record<string, Record<string, DailyEntry>>
  customWords: WordEntry[]
}
type Envelope = { version: 2; accounts: Record<string, WordStudyBundle>; legacyOwner?: string }
const banks = new Set(['cet4', 'cet6', 'kaoyan', 'ielts', 'custom'])
const legacyKeys = ['petdex.words.plans.v1', 'petdex.words.activePlan.v1', 'petdex.words.srs.v1', 'xm_custom_words', 'ohhu-personal-vocab-progress']
const emptyBundle = (): WordStudyBundle => ({ plans: [], activePlan: 'sys-cet4', cards: {}, daily: {}, customWords: [] })
const emptyEnvelope = (): Envelope => ({ version: 2, accounts: {} })
const accountKey = () => { const { uid } = captureQbankSession(); return uid ? `uid:${encodeURIComponent(uid)}` : 'guest' }
export function getWordStudyScope(): string { const session = captureQbankSession(); return `${session.revision}:${session.uid ? `uid:${encodeURIComponent(session.uid)}` : 'guest'}` }
const listeners = new Set<() => void>()
let revision = 0, scope = '', dirty = true, bound = false, error = ''
let cached: Envelope | null = null, currentBundle = emptyBundle()
const changed = () => { revision++; listeners.forEach(listener => listener()) }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const validCard = (value: unknown): value is SrsCard => record(value) && typeof value.wordId === 'string' && finite(value.ease) && value.ease >= 1.3 && finite(value.interval) && value.interval >= 0 && Number.isInteger(value.repetitions) && Number(value.repetitions) >= 0 && finite(value.dueAt)
const validPlan = (value: unknown): value is StudyPlan => record(value) && typeof value.id === 'string' && !!value.id && typeof value.name === 'string' && Array.isArray(value.bankIds) && value.bankIds.length > 0 && value.bankIds.every(bank => banks.has(bank)) && Number.isInteger(value.dailyGoal) && Number(value.dailyGoal) >= 5 && Number(value.dailyGoal) <= 50 && finite(value.createdAt)
const validWord = (value: unknown): value is WordEntry => record(value) && typeof value.id === 'string' && !!value.id && typeof value.word === 'string' && !!value.word.trim() && typeof value.meaning === 'string' && !!value.meaning.trim() && typeof value.phonetic === 'string' && value.bank === 'custom' && Number.isInteger(value.difficulty) && Number(value.difficulty) >= 1 && Number(value.difficulty) <= 5

function validBundle(value: unknown): value is WordStudyBundle {
  return record(value) && Array.isArray(value.plans) && value.plans.every(validPlan) && typeof value.activePlan === 'string' && record(value.cards) && Object.entries(value.cards).every(([id, card]) => validCard(card) && card.wordId === id) && Array.isArray(value.customWords) && value.customWords.every(validWord) && record(value.daily) && Object.entries(value.daily).every(([date, entries]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && record(entries) && Object.values(entries).every(entry => record(entry) && banks.has(String(entry.bank)) && (entry.kind === 'new' || entry.kind === 'review')))
}

function readEnvelope(): Envelope {
  const raw = localStorage.getItem(WORD_STUDY_STORAGE_KEY)
  if (raw === null) return emptyEnvelope()
  const parsed: unknown = JSON.parse(raw)
  if (!record(parsed) || parsed.version !== 2 || !record(parsed.accounts) || !Object.values(parsed.accounts).every(validBundle) || (parsed.legacyOwner !== undefined && typeof parsed.legacyOwner !== 'string')) throw new Error('invalid word study data')
  return parsed as Envelope
}

function invalidate() { dirty = true; error = ''; changed() }
function bind() {
  if (bound) return
  bound = true
  subscribeQbank(() => {
    if (scope !== getWordStudyScope()) {
      scope = getWordStudyScope(); cached = null; currentBundle = emptyBundle(); dirty = true; error = ''; changed()
    }
  })
  if (typeof window !== 'undefined') window.addEventListener('storage', event => {
    if (event.key === null || event.key === WORD_STUDY_STORAGE_KEY || legacyKeys.includes(event.key)) invalidate()
  })
}

function ensureLoaded() {
  bind()
  const nextScope = getWordStudyScope()
  if (scope !== nextScope) { scope = nextScope; cached = null; currentBundle = emptyBundle(); dirty = true; error = '' }
  if (!dirty) return
  dirty = false
  try { cached = readEnvelope(); currentBundle = cached.accounts[accountKey()] || emptyBundle(); error = '' }
  catch { cached = null; error = '学习记录读取失败，原数据仍保留。请重试读取后再保存。' }
}

export function subscribeWordStudy(listener: () => void) { bind(); listeners.add(listener); return () => { listeners.delete(listener) } }
export function getWordStudyRevision(): number { ensureLoaded(); return revision }
export function getWordStudyError(): string { ensureLoaded(); return error }
export function retryWordStudy(): void { dirty = true; error = ''; ensureLoaded(); changed() }
/** Internal snapshot: callers must not mutate it. Reads reuse the parsed account bundle. */
export function readWordStudy(): WordStudyBundle { ensureLoaded(); return currentBundle }

function commit<T>(mutate: (bundle: WordStudyBundle, envelope: Envelope) => T): T {
  ensureLoaded()
  if (error) throw new Error(error)
  const session = captureQbankSession(), key = accountKey()
  let envelope: Envelope
  try { envelope = readEnvelope() }
  catch { error = '学习记录读取失败，原数据仍保留。请重试读取后再保存。'; changed(); throw new Error(error) }
  const bundle: WordStudyBundle = JSON.parse(JSON.stringify(envelope.accounts[key] || emptyBundle()))
  const result = mutate(bundle, envelope)
  if (!validBundle(bundle)) throw new Error('学习记录内容无效，未保存')
  if (!isQbankSessionCurrent(session)) throw new Error('账号已切换，请重新操作')
  envelope.accounts[key] = bundle
  try { localStorage.setItem(WORD_STUDY_STORAGE_KEY, JSON.stringify(envelope)) }
  catch { throw new Error('学习记录未能保存到本机，请释放一些空间后重试。') }
  if (!isQbankSessionCurrent(session)) { dirty = true; throw new Error('账号已切换，请在原账号查看保存结果') }
  cached = envelope; currentBundle = bundle; dirty = false; error = ''; changed()
  return result
}

export function updateWordStudy<T>(mutate: (bundle: WordStudyBundle) => T): T { return commit(bundle => mutate(bundle)) }

function legacyData() {
  const read = (key: string, fallback: unknown) => { const raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw) }
  const oldPlans = read(legacyKeys[0], []), cards = read(legacyKeys[2], {}), words = read(legacyKeys[3], [])
  if (!Array.isArray(oldPlans) || !record(cards) || !Array.isArray(words) || !Object.entries(cards).every(([id, card]) => validCard(card) && id === card.wordId)) throw new Error('旧学习记录格式损坏，原备份仍保留')
  const plans: StudyPlan[] = oldPlans.map(plan => {
    if (!record(plan) || !Array.isArray(plan.bankIds)) throw new Error('旧计划格式损坏')
    return { ...plan, name: String(plan.name || '我的计划'), dailyGoal: Math.round(Math.min(50, Math.max(5, Number(plan.dailyGoal) || 15))), createdAt: Number(plan.createdAt) || 0, system: false } as StudyPlan
  })
  const customWords: WordEntry[] = words.map(word => {
    if (!record(word)) throw new Error('旧单词格式损坏')
    return { ...word, phonetic: String(word.phonetic || ''), bank: 'custom', difficulty: Number(word.difficulty) || 2 } as WordEntry
  })
  if (!plans.every(validPlan) || !customWords.every(validWord)) throw new Error('旧学习记录格式损坏，原备份仍保留')
  const progress = read(legacyKeys[4], null)
  if (progress !== null && (!record(progress) || !Array.isArray(progress.learned) || !progress.learned.every(id => typeof id === 'string'))) throw new Error('旧词包进度格式损坏')
  const examBanks: Record<string, string> = { 'CET-4': 'cet4', 'CET-6': 'cet6', 'KAOYAN-1': 'kaoyan', 'KAOYAN-2': 'kaoyan', IELTS: 'ielts' }
  for (const legacyId of (progress?.learned || []) as string[]) {
    const separator = legacyId.indexOf(':'), bank = examBanks[legacyId.slice(0, separator)], word = legacyId.slice(separator + 1).trim().toLowerCase()
    if (!bank || separator < 1 || !word) continue
    const id = `${bank}:${word}`
    if (!Object.hasOwn(cards, id)) cards[id] = { wordId: id, ease: 2.5, interval: 1, repetitions: 1, dueAt: Date.now() + 86400000 }
  }
  return { plans, cards: cards as Record<string, SrsCard>, customWords, activePlan: localStorage.getItem(legacyKeys[1]) || 'sys-cet4' }
}

export function getLegacyWordStudySummary(): { cards: number; plans: number; customWords: number } | null {
  ensureLoaded()
  if (error || cached?.legacyOwner) return null
  try {
    const legacy = legacyData(), summary = { cards: Object.keys(legacy.cards).length, plans: legacy.plans.length, customWords: legacy.customWords.length }
    return summary.cards || summary.plans || summary.customWords ? summary : null
  } catch { return null }
}

/** Explicit recovery merges into one account and claims ownership in the same atomic write. */
export function restoreLegacyWordStudy(): { ok: boolean; error?: string } {
  if (!captureQbankSession().uid) return { ok: false, error: '请登录后确认恢复到本账号。' }
  try {
    const legacy = legacyData()
    if (!legacy.plans.length && !Object.keys(legacy.cards).length && !legacy.customWords.length) return { ok: false, error: '没有可恢复的旧学习记录。' }
    commit((bundle, envelope) => {
      if (envelope.legacyOwner) throw new Error('旧学习记录已恢复到确认过的账号，原备份仍保留。')
      const hadBundle = Object.hasOwn(envelope.accounts, accountKey())
      const existingPlans = new Set(bundle.plans.map(plan => plan.id)), existingWords = new Set(bundle.customWords.map(word => word.id))
      bundle.plans.push(...legacy.plans.filter(plan => !existingPlans.has(plan.id)))
      bundle.customWords.push(...legacy.customWords.filter(word => !existingWords.has(word.id)))
      bundle.cards = { ...legacy.cards, ...bundle.cards }
      if (!hadBundle) bundle.activePlan = legacy.activePlan
      envelope.legacyOwner = accountKey()
    })
    return { ok: true }
  } catch (cause) { return { ok: false, error: cause instanceof Error ? cause.message : '恢复失败，原备份仍保留。' } }
}
