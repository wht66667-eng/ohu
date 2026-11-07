export const FOX_SAFETY_PLUGIN_ID = 'fox-safety-library'
export const MAX_SAFETY_IMPORT_BYTES = 1024 * 1024
export type SafetySource = 'all' | 'github' | 'imported'
export type SafetyQuestion = {
  id: string
  title: string
  answer: string
  answerKind: 'letters' | 'option_ids' | 'text'
  source: 'github' | 'imported'
  options: { key: string; text: string }[]
}
export const safetyImportKey = (uid: string) => `ohu.plugin.fox-safety.bank.v1:${encodeURIComponent(uid || 'guest')}`

export function parseSafetyImport(text: string): SafetyQuestion[] {
  if (new TextEncoder().encode(text).length > MAX_SAFETY_IMPORT_BYTES) throw new Error('题库文件最多 1 MB。')
  let value: unknown
  try { value = JSON.parse(text.replace(/^\uFEFF/, '')) } catch { throw new Error('请导入 JSON 题库文件，不能导入 APK、JavaScript 或 Python 文件。') }
  const input = value as { schemaVersion?: unknown; questions?: unknown }
  if (!input || input.schemaVersion !== 1 || !Array.isArray(input.questions) || !input.questions.length || input.questions.length > 2000) throw new Error('题库需要 schemaVersion: 1 和 1～2000 条 questions。')
  return input.questions.map((row: unknown, index: number) => {
    const item = row as { title?: unknown; answer?: unknown }
    if (!item || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 3000 || typeof item.answer !== 'string' || !item.answer.trim() || item.answer.length > 500) throw new Error(`第 ${index + 1} 条题目的 title 或 answer 无效，未替换原题库。`)
    // Imported answer letters are never matched to another source's option order.
    const answer = item.answer.trim()
    return { id: `imported-${index}`, title: item.title.trim(), answer, answerKind: /^[A-Z](?:[A-Z,，、\s]*[A-Z])?$/.test(answer) ? 'letters' : 'text', source: 'imported', options: [] }
  })
}

export function readSafetyImport(uid: string): { questions: SafetyQuestion[]; error: string } {
  try {
    const text = localStorage.getItem(safetyImportKey(uid))
    return { questions: text ? parseSafetyImport(text) : [], error: '' }
  } catch {
    return { questions: [], error: '本机导入题库暂时无法读取，内置题库仍可使用。可重新导入，或移除损坏的导入记录。' }
  }
}

export function saveSafetyImport(uid: string, text: string): SafetyQuestion[] {
  const questions = parseSafetyImport(text)
  const clean = JSON.stringify({ schemaVersion: 1, questions: questions.map(({ title, answer }) => ({ title, answer })) })
  try { localStorage.setItem(safetyImportKey(uid), clean) } catch { throw new Error('本机空间不足或存储被禁用，题库没有保存；原记录保持不变。') }
  return questions
}

export function removeSafetyImport(uid: string): void {
  try { localStorage.removeItem(safetyImportKey(uid)) } catch { throw new Error('本机存储不可用，暂时无法移除导入题库。') }
}

const searchable = (text: string) => text.normalize('NFKC').toLocaleLowerCase('zh-CN')
export function searchSafetyQuestions(rows: SafetyQuestion[], query: string, source: SafetySource, page = 0, pageSize = 20) {
  const terms = searchable(query.trim()).split(/\s+/u).filter(Boolean)
  const matched = rows.filter(row => (source === 'all' || row.source === source)
    && terms.every(term => searchable(`${row.title} ${row.options.map(option => option.text).join(' ')}`).includes(term)))
  const size = Math.max(1, Math.min(50, Math.floor(pageSize) || 20))
  const lastPage = Math.max(0, Math.ceil(matched.length / size) - 1)
  const current = Math.max(0, Math.min(lastPage, Math.floor(page) || 0))
  return { total: matched.length, items: matched.slice(current * size, (current + 1) * size), page: current, lastPage }
}
