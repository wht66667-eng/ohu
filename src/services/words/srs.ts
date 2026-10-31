/**
 * 简化 SM-2：间隔重复（本地存储）；支持多词库计划。
 */
import type { WordBankId } from '../../data/words/banks'
import { getWordBank, wordsOfBank } from '../../data/words/banks'
import { getActivePlan } from './plans'
import { readWordStudy, updateWordStudy } from './study-storage'

export interface SrsCard {
  wordId: string
  ease: number
  interval: number
  repetitions: number
  dueAt: number
}

function ensureCard(wordId: string, map: Record<string, SrsCard>, now = Date.now()): SrsCard {
  if (map[wordId]) return map[wordId]
  const card: SrsCard = {
    wordId,
    ease: 2.5,
    interval: 0,
    repetitions: 0,
    dueAt: now,
  }
  map[wordId] = card
  return card
}

function bankList(banks: WordBankId[]) {
  const selected = new Set(banks)
  return getWordBank().filter(word => selected.has(word.bank))
}

/** Queue and counters share one instant, including every unreviewed word. */
export function reviewStateForBanks(banks: WordBankId[], limit = 12) {
  const map = { ...readWordStudy().cards }
  const now = Date.now()
  const list = bankList(banks).map((w) => ensureCard(w.id, map, now))
  // Unreviewed words need no stored card; large optional packs stay in IndexedDB.
  // Persist a card only on review or when migrating a previously learned word.
  const due = list.filter(card => card.dueAt <= now)
  let nextDueAt: number | null = null
  for (const card of list) {
    if (card.dueAt > now && (nextDueAt === null || card.dueAt < nextDueAt)) nextDueAt = card.dueAt
  }
  return {
    cards: limit > 0 ? due.sort((a, b) => a.dueAt - b.dueAt).slice(0, limit) : [],
    stats: { total: list.length, due: due.length, learned: list.filter(card => card.repetitions > 0).length, waiting: list.length - due.length, nextDueAt },
  }
}

export function dueCardsForBanks(banks: WordBankId[], limit = 12): SrsCard[] {
  return reviewStateForBanks(banks, limit).cards
}

export function dueCards(bank: WordBankId, limit = 12): SrsCard[] {
  return dueCardsForBanks([bank], limit)
}

/** 按当前激活计划抽到期卡 */
export function dueCardsForActivePlan(limit?: number): SrsCard[] {
  const plan = getActivePlan()
  return dueCardsForBanks(plan.bankIds, limit ?? plan.dailyGoal)
}

/** grade: 0 忘了 / 1 犹豫 / 2 记得 / 3 很熟 */
export function reviewCard(wordId: string, grade: 0 | 1 | 2 | 3): SrsCard {
  return updateWordStudy((bundle) => {
    const card = ensureCard(wordId, bundle.cards)
    if (grade < 2) {
      card.repetitions = 0
      card.interval = 0
      card.dueAt = Date.now() + 10 * 60 * 1000
    } else {
      if (card.repetitions === 0) card.interval = 1
      else if (card.repetitions === 1) card.interval = 3
      else card.interval = Math.round(card.interval * card.ease)
      card.repetitions += 1
      card.ease = Math.max(1.3, card.ease + (0.1 - (3 - grade) * (0.08 + (3 - grade) * 0.02)))
      card.dueAt = Date.now() + card.interval * 24 * 60 * 60 * 1000
    }
    bundle.cards[wordId] = card
    return card
  })
}

export function randomDuelWords(bank: WordBankId, n = 8) {
  const pool = [...wordsOfBank(bank)]
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, Math.min(n, pool.length))
}

export function distractors(correctId: string, bank: WordBankId, count = 3): string[] {
  const others = getWordBank().filter((w) => w.bank === bank && w.id !== correctId).map((w) => w.meaning)
  for (let i = others.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[others[i], others[j]] = [others[j], others[i]]
  }
  // 词库不够时从全库补
  if (others.length < count) {
    const more = getWordBank().filter((w) => w.id !== correctId).map((w) => w.meaning)
    for (const m of more) {
      if (!others.includes(m)) others.push(m)
      if (others.length >= count) break
    }
  }
  return others.slice(0, count)
}

export function srsStatsForBanks(banks: WordBankId[]) {
  return reviewStateForBanks(banks, 0).stats
}

export function srsStats(bank: WordBankId) {
  return srsStatsForBanks([bank])
}
