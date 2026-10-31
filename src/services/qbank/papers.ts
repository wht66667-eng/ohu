/**
 * 组卷（1.2.34 · OP-C 一期）
 * 手动选题 / 随机抽题，写入 papers + paper_questions。
 */
import {
  addPaperLocal,
  listPapersLocal,
  pushPaperCloud,
  type PaperRow,
} from '../../lib/qbank'

export interface PaperRule {
  title: string
  questionIds?: string[]
  randomCount?: number
}

export function createPaper(rule: PaperRule): PaperRow {
  let qids: string[] = []
  if (rule.questionIds?.length) {
    qids = [...rule.questionIds]
  } else if (rule.randomCount && rule.randomCount > 0) {
    // 随机抽题入口暂不实现（需要题目池参数），保证不误用
    qids = []
  }
  const p = addPaperLocal(rule.title, qids)
  void pushPaperCloud(p)
  return p
}

export function listPapers(): PaperRow[] {
  return listPapersLocal()
}
