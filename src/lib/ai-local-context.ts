import { loadExamsCache, loadGradesCache } from './academic-cache'
import { getNextClass, getScheduleRowsForDate, loadScheduleCache } from './schedule-cache'
import { getDayStatus } from './schedule-calendar'
import { listPhysicalTestResults } from './physical-test-results'
import { readPocketUni } from './pocketuni-store'
import { readPublicElectives } from './public-elective'

function weekday(day: number): string {
  return ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'][day] ?? `周${day}`
}

/**
 * 只读本机缓存，生成给 AI 的上下文。
 * 不包含姓名、学号、密码、cookie，只含课程、考试、假期和学业汇总。
 */
export function buildLocalAiContext(): string {
  const now = new Date()
  const lines: string[] = []
  lines.push(`当前时间：${now.toLocaleString('zh-CN', { hour12: false })}`)

  const rows = loadScheduleCache().rows
  const next = getNextClass(rows)
  let nextText = ''
  if (next.name) {
    nextText = `${next.timeLabel || ''} ${next.name}${next.teacher ? `（${next.teacher}）` : ''}${next.room ? ` ${next.room}` : ''}`.trim()
  } else {
    for (let index = 1; index <= 7; index += 1) {
      const date = new Date()
      date.setDate(date.getDate() + index)
      const items = getScheduleRowsForDate(date, rows)
      if (items.length) {
        const row = items[0]
        const label = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()]
        nextText = `${label} ${row.sections[0]}-${row.sections[row.sections.length - 1]}节 ${row.name}${row.teacher ? `（${row.teacher}）` : ''}${row.room ? ` ${row.room}` : ''}`
        break
      }
    }
  }
  lines.push(`今天是 ${now.toLocaleDateString('zh-CN', { weekday: 'long' })}。${nextText ? `按当前时间，下节课是：${nextText}` : '本机课表暂时没有下一节课'}`)
  const seen = new Set<string>()
  const courses: string[] = []
  for (const row of rows) {
    const key = `${row.day}-${row.sections.join(',')}-${row.name}`
    if (seen.has(key)) continue
    seen.add(key)
    const section = row.sections.length > 1 ? `${row.sections[0]}-${row.sections[row.sections.length - 1]}节` : `${row.sections[0]}节`
    courses.push(`${weekday(row.day)} ${section} ${row.name}${row.teacher ? `（${row.teacher}）` : ''}${row.room ? ` ${row.room}` : ''}`)
    if (courses.length >= 35) break
  }
  lines.push(courses.length ? `【我的课表】\n${courses.join('\n')}` : '【我的课表】尚未同步')

  const days: string[] = []
  for (let index = 0; index < 21; index += 1) {
    const date = new Date()
    date.setDate(date.getDate() + index)
    const status = getDayStatus(date)
    if (status.kind === 'normal' && status.source === 'none') continue
    days.push(`${status.date} ${status.label}${status.kind === 'off' ? ' 放假' : status.kind === 'makeup' ? ' 调休上课' : ''}${status.source === 'gov' ? '（国家节假日）' : status.source === 'user' ? '（本人校历）' : ''}`)
  }
  const rules = days.length ? `【近期假期/调休】\n${days.slice(0, 12).join('\n')}` : '【近期假期/调休】本机没有额外校历规则'

  const exams = loadExamsCache()
    .filter((exam) => Date.parse(exam.datetime.replace(' ', 'T')) >= Date.now())
    .sort((a, b) => Date.parse(a.datetime.replace(' ', 'T')) - Date.parse(b.datetime.replace(' ', 'T')))
    .slice(0, 6)
    .map((exam) => `${exam.datetime.slice(0, 16)} ${exam.name}${exam.room ? ` ${exam.room}` : ''}`)
  const examText = exams.length ? `【近期考试】\n${exams.join('\n')}` : '【近期考试】本机暂无'

  const grades = loadGradesCache()
  const scored = grades.filter((row) => Number.isFinite(Number.parseFloat(row.score)))
  const average = scored.length ? scored.reduce((sum, row) => sum + Number.parseFloat(row.score), 0) / scored.length : null
  const credits = grades.reduce((sum, row) => sum + (Number.parseFloat(row.credit) || 0), 0)
  const publicElective = readPublicElectives()
  const pu = readPocketUni()
  const tice = listPhysicalTestResults()
  const summary = [
    `成绩：${grades.length} 门${average === null ? '' : `，平均分 ${average.toFixed(1)}`}，总学分 ${credits.toFixed(1)}`,
    `公选目录：${publicElective.length} 门`,
    pu ? `PU 学分：${pu.totalCredit ?? '—'}` : 'PU：未同步',
    tice[0] ? `体测最近一次：${tice[0].totalScore ?? '—'} 分` : '体测：未同步',
  ]

  return [
    ...lines,
    rules,
    examText,
    `【学业汇总】\n${summary.join('\n')}`,
    '以上数据来自本机缓存；若与用户描述不一致，以用户为准并说明可能未同步。',
  ].join('\n\n')
}
