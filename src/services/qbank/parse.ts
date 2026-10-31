/**
 * AI 出题 JSON 解析与校验（1.2.34 · OP-C 一期）
 * 契约：模型只输出 JSON，前端强制校验，脏数据绝不入库。
 */
import type { QType } from '../../lib/qbank'
import { contentHash } from './hash'

/** 模型返回的原始题目 */
export interface RawAIQuestion {
  question_type?: string
  stem?: string
  options?: { key: string; text: string }[] | string[]
  answer?: string | number
  explanation?: string
  difficulty?: number
  tags?: string[]
}

/** 校验后的题目草稿（对齐 lib/qbank QRow，但无 id/uid） */
export interface ParsedQuestion {
  qtype: QType
  stem: string
  options: { key: string; text: string }[]
  answer: string
  explanation: string
  difficulty: number
  tags: string[]
  contentHash: string
}

export interface ParseResult {
  ok: boolean
  questions: ParsedQuestion[]
  issues: string[]
}

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F']

function normalizeOptions(o: RawAIQuestion['options']): { key: string; text: string }[] {
  if (!Array.isArray(o)) return []
  return o
    .map((it, i) => {
      if (typeof it === 'string') return { key: OPTION_KEYS[i] || String(i), text: it.trim() }
      const key = typeof it?.key === 'string' ? it.key.trim().toUpperCase() : OPTION_KEYS[i] || String(i)
      const text = typeof it?.text === 'string' ? it.text.trim() : ''
      return { key, text }
    })
    .filter((it) => it.text)
}

/** 从模型回复里抠出 JSON（容忍 ```json 围栏、前后废话） */
export function extractJson(reply: string): unknown {
  if (!reply) return null
  let s = reply.trim().replace(/```json/gi, '').replace(/```/g, '')
  const lo = s.indexOf('[')
  const hi = s.lastIndexOf(']')
  if (lo < 0 || hi <= lo) {
    // 兜底：可能返回的是 {questions:[...]}
    const a = s.indexOf('{')
    const b = s.lastIndexOf('}')
    if (a < 0 || b <= a) return null
    try {
      return JSON.parse(s.slice(a, b + 1))
    } catch {
      return null
    }
  }
  try {
    return JSON.parse(s.slice(lo, hi + 1))
  } catch {
    return null
  }
}

export function parseAIQuestionsJson(raw: string): ParseResult {
  const issues: string[] = []
  const out: ParsedQuestion[] = []

  const data = extractJson(raw)
  if (data == null) {
    return { ok: false, questions: [], issues: ['JSON 解析失败'] }
  }

  // 兼容两种形状：数组 或 {questions:[...]}
  const arr: RawAIQuestion[] = Array.isArray(data)
    ? data
    : Array.isArray((data as { questions?: RawAIQuestion[] }).questions)
      ? (data as { questions: RawAIQuestion[] }).questions
      : []

  for (let i = 0; i < arr.length; i++) {
    const it = arr[i] || {}
    const stem = typeof it.stem === 'string' ? it.stem.trim() : ''
    if (!stem) {
      issues.push(`#${i + 1} 缺题干，已跳过`)
      continue
    }

    // 题型归一：只认 single_choice / judge
    const rawType = String(it.question_type || '').toLowerCase()
    const qtype: QType = rawType.includes('judge') || rawType.includes('判断') ? 'judge' : 'single_choice'

    if (qtype === 'judge') {
      const ans = String(it.answer ?? '').toLowerCase()
      const answer = ans === 'true' || ans === '对' || ans === '1' || ans === 'a' ? 'true' : 'false'
      out.push({
        qtype,
        stem,
        options: [],
        answer,
        explanation: String(it.explanation || '').slice(0, 80),
        difficulty: clampDiff(it.difficulty),
        tags: cleanTags(it.tags),
        contentHash: contentHash(stem, answer, qtype),
      })
      continue
    }

    // 单选
    const options = normalizeOptions(it.options)
    if (options.length < 2) {
      issues.push(`#${i + 1} 选项不足，已跳过`)
      continue
    }
    const keys = options.map((o) => o.key)
    let ans = String(it.answer ?? '').trim().toUpperCase()
    if (!keys.includes(ans)) {
      // 数字下标兜底
      const n = Number(it.answer)
      if (Number.isInteger(n) && n >= 0 && n < options.length) ans = options[n].key
    }
    if (!keys.includes(ans)) {
      issues.push(`#${i + 1} 答案不在选项内，已跳过`)
      continue
    }
    out.push({
      qtype,
      stem,
      options,
      answer: ans,
      explanation: String(it.explanation || '').slice(0, 80),
      difficulty: clampDiff(it.difficulty),
      tags: cleanTags(it.tags),
      contentHash: contentHash(stem, ans, qtype),
    })
  }

  return { ok: out.length > 0, questions: out, issues }
}

function clampDiff(d: unknown): number {
  const n = Number(d)
  if (!Number.isInteger(n)) return 3
  return Math.min(5, Math.max(1, n))
}

function cleanTags(t: unknown): string[] {
  if (!Array.isArray(t)) return []
  return t
    .map((x) => String(x).trim())
    .filter((x) => x && x.length <= 12)
    .slice(0, 6)
}
