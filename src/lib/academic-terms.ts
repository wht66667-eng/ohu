import type { GradeRowRemote } from './academic-cache'

/** Teaching year begins in August; the second term runs February through July. */
export function academicTermForDate(date: Date): string {
  const month = date.getMonth() + 1
  const year = date.getFullYear()
  const start = month >= 8 ? year : year - 1
  return `${start}-${start + 1}-${month >= 8 || month === 1 ? 1 : 2}`
}

/** Keep unlabelled records out of a named term; they remain available under all grades. */
export function gradeTermKey(grade: Pick<GradeRowRemote, 'year' | 'term'>): string | null {
  const year = /^\s*(20\d{2})(?:\s*[-–—/]\s*(?:20\d{2}|\d{2}))?\s*$/.exec(grade.year)?.[1]
  if (!year) return null
  const term = grade.term.trim()
  const number = /^(?:第\s*)?([12一二])\s*(?:学期)?$/.exec(term)?.[1]
  const half = number === '1' || number === '一' || /^(?:上学期|秋季?|秋学期)$/.test(term) ? 1
    : number === '2' || number === '二' || /^(?:下学期|春季?|春学期)$/.test(term) ? 2 : null
  return half ? `${year}-${Number(year) + 1}-${half}` : null
}

export function academicTermLabel(key: string): string {
  const match = /^(20\d{2})-(20\d{2})-([12])$/.exec(key)
  return match ? `${match[1]}—${match[2]} 学年 · 第 ${match[3]} 学期` : key
}

export function availableGradeTerms(grades: GradeRowRemote[], currentTerm: string): string[] {
  return [...new Set(grades.map(gradeTermKey).filter((term): term is string => !!term && term !== currentTerm))].sort().reverse()
}

export function gradesForScope(grades: GradeRowRemote[], scope: string, currentTerm: string): GradeRowRemote[] {
  if (scope === 'all') return grades
  const wanted = scope === 'current' ? currentTerm : scope
  return grades.filter((grade) => gradeTermKey(grade) === wanted)
}
