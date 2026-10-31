export type ScheduleAiKind = 'off' | 'makeup' | 'add' | 'cancel' | 'replace'
export type ScheduleAiChange = {
  id: string
  kind: ScheduleAiKind
  date: string
  treatAsDay: number | null
  courseName: string
  sections: number[]
  room: string
  teacher: string
  targetName: string
  targetSections: number[]
  summary: string
  confidence: 'high' | 'medium' | 'low'
  selected: boolean
}
export type ScheduleAiPreview = { changes: ScheduleAiChange[]; notes: string[] }

function validDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return Number.isFinite(date.getTime()) && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

function shortText(value: unknown, fallback: string, max = 120): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback
}

function parseSections(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const parsed = value.map((item) => {
    if (typeof item === 'number' && Number.isInteger(item)) return item
    if (typeof item === 'string' && /^\d{1,2}$/.test(item.trim())) return Number(item.trim())
    return Number.NaN
  })
  return [...new Set(parsed.filter((section) => Number.isInteger(section) && section >= 1 && section <= 11))]
    .sort((a, b) => a - b)
}

/** Parse an AI proposal as data only; never execute model text as a command. */
export function parseScheduleAiPreview(raw: string): ScheduleAiPreview {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('AI 返回格式无法识别，请重新分析；课表没有修改。') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('AI 返回内容不完整，请重新分析；课表没有修改。')
  const result = value as Record<string, unknown>
  if (!Array.isArray(result.changes) || !Array.isArray(result.notes)) throw new Error('AI 返回内容缺少变更或核对说明，请重新分析；课表没有修改。')
  if (result.changes.length > 12) throw new Error('通知包含超过 12 项课表变化，无法安全预览完整内容；请分段分析，课表没有修改。')
  const notes = result.notes.filter((item): item is string => typeof item === 'string' && !!item.trim()).slice(0, 12).map((item) => item.trim().slice(0, 240))
  const changes: ScheduleAiChange[] = []
  const conflictingItems = new Set<string>()
  const conflictingDayDates = new Set<string>()
  const reviewNotes: string[] = []
  for (const [index, item] of result.changes.slice(0, 12).entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      reviewNotes.push(`第 ${index + 1} 项不是可识别的调整对象，已跳过。`)
      continue
    }
    const row = item as Record<string, unknown>
    const kind = row.kind
    const date = typeof row.date === 'string' ? row.date : ''
    const treatAsDay = row.treatAsDay
    const courseName = shortText(row.courseName, '', 120)
    const targetName = shortText(row.targetName, '', 120)
    const sections = parseSections(row.sections)
    const targetSections = parseSections(row.targetSections)
    const validKind = kind === 'off' || kind === 'makeup' || kind === 'add' || kind === 'cancel' || kind === 'replace'
    const invalidSectionShape = (Object.prototype.hasOwnProperty.call(row, 'sections') && !Array.isArray(row.sections))
      || (Object.prototype.hasOwnProperty.call(row, 'targetSections') && !Array.isArray(row.targetSections))
    const reasons: string[] = []
    if (!validKind) reasons.push('调整类型无法识别')
    if (!validDate(date)) reasons.push(date.trim() ? '日期格式或日期值无效' : '缺少明确日期')
    if (invalidSectionShape) reasons.push('节次字段格式无效，应为数字列表')
    if (kind === 'makeup' && (typeof treatAsDay !== 'number' || !Number.isInteger(treatAsDay) || treatAsDay < 1 || treatAsDay > 7)) reasons.push('缺少有效的补课星期')
    if ((kind === 'add' || kind === 'replace') && !courseName) reasons.push('缺少新课程名称')
    if ((kind === 'add' || kind === 'replace') && !sections.length) reasons.push('缺少有效的新课程节次')
    if ((kind === 'cancel' || kind === 'replace') && !targetName) reasons.push('缺少要匹配的原课程名称')
    if (Array.isArray(row.sections) && sections.length !== row.sections.length) reasons.push('新课程节次包含重复、无法识别或超范围的值')
    if (Array.isArray(row.targetSections) && targetSections.length !== row.targetSections.length) reasons.push('原课程节次包含重复、无法识别或超范围的值')
    if (reasons.length) {
      reviewNotes.push(`第 ${index + 1} 项：${reasons.join('；')}，未加入可应用列表。`)
      continue
    }
    if (kind === 'off' || kind === 'makeup') {
      const priorDay = changes.findIndex((change) => change.date === date && (change.kind === 'off' || change.kind === 'makeup'))
      if (conflictingDayDates.has(date)) {
        reviewNotes.push(`${date} 同一天只能有一条整日停课／补课规则；第 ${index + 1} 项已跳过。`)
        continue
      }
      if (priorDay >= 0) {
        changes.splice(priorDay, 1)
        conflictingDayDates.add(date)
        reviewNotes.push(`${date} 同时识别到多条整日停课／补课规则；相关候选均未加入，请核对通知。`)
        continue
      }
    }
    const identity = `${date}:${kind}:${targetName || courseName}:${targetSections.join(',')}:${sections.join(',')}`
    if (conflictingItems.has(identity)) {
      reviewNotes.push(`${date} 存在重复的「${targetName || courseName}」调整候选；第 ${index + 1} 项已跳过。`)
      continue
    }
    conflictingItems.add(identity)
    const confidence = row.confidence === 'high' || row.confidence === 'medium' ? row.confidence : 'low'
    const fallbackSummary: Record<ScheduleAiKind, string> = {
      off: '整日停课', makeup: '按指定星期课表补课', add: '新增单次课程', cancel: '取消单次课程', replace: '调整单次课程',
    }
    changes.push({
      id: `schedule-change-${index}-${date}`,
      kind: kind as ScheduleAiKind,
      date: date as string,
      treatAsDay: kind === 'makeup' ? Number(treatAsDay) : null,
      courseName,
      sections,
      room: shortText(row.room, '', 120),
      teacher: shortText(row.teacher, '', 120),
      targetName,
      targetSections,
      summary: shortText(row.summary, fallbackSummary[kind as ScheduleAiKind]),
      confidence,
      selected: confidence === 'high',
    })
  }
  const reviewSummary = reviewNotes.length > 8 ? [`另有 ${reviewNotes.length - 8} 项格式或冲突问题未展开，请分段重新分析。`] : []
  return { changes, notes: [...reviewNotes.slice(0, 8), ...reviewSummary, ...notes].slice(0, 12) }
}
