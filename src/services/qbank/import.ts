/**
 * 题目导入（1.2.34 · OP-C 一期 + OP-D 通用管线）
 * 粘贴 AI 出题 / 手动录入 / 私有 docx 文本 / 真题词汇，共用这一套入库 + 去重逻辑。
 */
import {
  addQuestionsLocal,
  existingHashesLocal,
  pushQuestionsCloud,
  type QRow,
} from '../../lib/qbank'
import { contentHash } from './hash'

export interface ImportRow {
  subject: string
  sourceType?: string
  sourceRef?: string
  qtype: QRow['qtype']
  stem: string
  options: QRow['options']
  answer: string
  explanation?: string
  difficulty?: number
  tags?: string[]
  contentHash?: string
}

export interface ImportResult {
  created: number
  dup: number
  failed: number
}

/** 入库：按 contentHash 剔除本地已存在；返回新增数。 */
export async function createQuestionsFromImport(rows: ImportRow[], defaultSourceType = 'paste'): Promise<ImportResult> {
  const hashes = existingHashesLocal()
  const fresh: Omit<QRow, 'id' | 'createdAt'>[] = []
  let dup = 0
  let failed = 0

  for (const r of rows) {
    const stem = (r.stem || '').trim()
    if (!stem) {
      failed++
      continue
    }
    const hash = r.contentHash || contentHash(stem, r.answer, r.qtype)
    if (hashes.has(hash)) {
      dup++
      continue
    }
    hashes.add(hash)
    fresh.push({
      subject: r.subject || '未分类',
      sourceType: r.sourceType || defaultSourceType,
      sourceRef: r.sourceRef,
      qtype: r.qtype,
      stem,
      options: r.options || [],
      answer: r.answer,
      explanation: (r.explanation || '').slice(0, 80),
      difficulty: clampDiff(r.difficulty),
      tags: (r.tags || []).slice(0, 6),
      contentHash: hash,
    })
  }

  if (fresh.length) {
    const saved = addQuestionsLocal(fresh)
    void pushQuestionsCloud(saved)
  }
  return { created: fresh.length, dup, failed }
}

function clampDiff(d: unknown): number {
  const n = Number(d)
  if (!Number.isInteger(n)) return 3
  return Math.min(5, Math.max(1, n))
}
