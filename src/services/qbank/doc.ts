/** Local vocabulary JSON import remains free. File AI generation lives in paid-file.ts. */
import { createQuestionsFromImport, type ImportRow } from './import'
import { contentHash } from './hash'

/* ---------------- 私有词汇文件导入（OP-E） ---------------- */

export interface VocabItem {
  zh: string
  en: string
}

/** 识别并导入「四级真题词汇 JSON」；返回导入结果 */
export async function importVocabularyFile(text: string): Promise<{ ok: boolean; created: number; error?: string }> {
  let data: { subject?: string; sourceType?: string; items?: VocabItem[] } | null = null
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, created: 0, error: '文件不是有效的 JSON' }
  }
  const items = data?.items
  if (!Array.isArray(items) || !items.length) {
    return { ok: false, created: 0, error: '文件里没有词汇条目' }
  }
  const subject = data?.subject || '未分类'
  const sourceType = data?.sourceType || 'cet4_2025_12'

  const rows: ImportRow[] = []
  const pickDistractors = (exclude: VocabItem, field: 'zh' | 'en', n: number): string[] => {
    const pool = items.filter((x) => x !== exclude && x[field])
    const out: string[] = []
    const copy = [...pool]
    while (out.length < n && copy.length) {
      out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0][field])
    }
    return out
  }

  for (const it of items) {
    if (!it?.zh || !it?.en) continue
    // 中 → 英
    const enOpts = shuffle([...pickDistractors(it, 'en', 3), it.en])
    rows.push({
      subject,
      sourceType,
      qtype: 'single_choice',
      stem: `「${it.zh}」的英文是？`,
      options: enOpts.map((t, i) => ({ key: String.fromCharCode(65 + i), text: t })),
      answer: enOpts.indexOf(it.en) >= 0 ? String.fromCharCode(65 + enOpts.indexOf(it.en)) : 'A',
      explanation: `${it.zh} = ${it.en}`,
      difficulty: 2,
      tags: ['四级', '词汇'],
      contentHash: contentHash(`「${it.zh}」的英文是？`, String.fromCharCode(65 + enOpts.indexOf(it.en)), 'single_choice'),
    })
    // 英 → 中
    const zhOpts = shuffle([...pickDistractors(it, 'zh', 3), it.zh])
    rows.push({
      subject,
      sourceType,
      qtype: 'single_choice',
      stem: `「${it.en}」的中文是？`,
      options: zhOpts.map((t, i) => ({ key: String.fromCharCode(65 + i), text: t })),
      answer: zhOpts.indexOf(it.zh) >= 0 ? String.fromCharCode(65 + zhOpts.indexOf(it.zh)) : 'A',
      explanation: `${it.en} = ${it.zh}`,
      difficulty: 2,
      tags: ['四级', '词汇'],
      contentHash: contentHash(`「${it.en}」的中文是？`, String.fromCharCode(65 + zhOpts.indexOf(it.zh)), 'single_choice'),
    })
  }

  const res = await createQuestionsFromImport(rows, sourceType)
  return { ok: res.created > 0, created: res.created, error: res.created ? '' : '这些题都已在题库里' }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
