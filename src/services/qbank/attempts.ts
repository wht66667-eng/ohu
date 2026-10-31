/**
 * 交卷判分（1.2.34 · OP-C 一期）
 * 判分 → 写 paper_attempts → 返回逐题结果。
 */
import {
  paperByIdLocal,
  questionByIdLocal,
  submitAttemptLocal,
  pushAttemptCloud,
} from '../../lib/qbank'

export interface PerQuestion {
  correct: boolean
  chosen: string
  answer: string
}

export interface AttemptResult {
  ok: boolean
  score: number
  correctCount: number
  totalCount: number
  perQuestion: Record<string, PerQuestion>
  error?: string
}

export function submitPaperAttempt(paperId: string, answers: Record<string, string>): AttemptResult {
  const paper = paperByIdLocal(paperId)
  if (!paper) return { ok: false, score: 0, correctCount: 0, totalCount: 0, perQuestion: {}, error: '试卷不存在' }

  const perQuestion: Record<string, PerQuestion> = {}
  let correctCount = 0
  let totalCount = 0

  for (const qid of paper.qids) {
    const q = questionByIdLocal(qid)
    if (!q) continue
    totalCount++
    const chosen = answers[qid] ?? ''
    const correct = chosen === q.answer
    if (correct) correctCount++
    perQuestion[qid] = { correct, chosen, answer: q.answer }
  }

  const score = totalCount ? Math.round((correctCount / totalCount) * 100) : 0
  const attempt = submitAttemptLocal(paperId, answers, score, correctCount, totalCount)
  if (attempt) void pushAttemptCloud(paperId, attempt)

  return { ok: true, score, correctCount, totalCount, perQuestion }
}
