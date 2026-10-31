import type { QRow } from '../lib/qbank'

/** Only admit questions that can be answered by the two supported quiz controls. */
export function prepareQuickQuizQuestion(question: QRow): QRow | null {
  if (!question || typeof question.stem !== 'string' || !question.stem.trim() || typeof question.answer !== 'string') return null
  if (question.qtype === 'judge') {
    const answer = question.answer.trim().toLowerCase()
    if (answer !== 'true' && answer !== 'false') return null
    return { ...question, answer, options: [{ key: 'true', text: '正确' }, { key: 'false', text: '错误' }] }
  }
  if (question.qtype !== 'single_choice' || !Array.isArray(question.options)) return null
  const keys = new Set<string>()
  const options = question.options.filter(option => {
    if (!option || typeof option.key !== 'string' || typeof option.text !== 'string' || !option.key.trim() || !option.text.trim()) return false
    if (keys.has(option.key)) return false
    keys.add(option.key)
    return true
  })
  const answer = question.answer.trim()
  return options.length >= 2 && options.some(option => option.key === answer) ? { ...question, answer, options } : null
}
