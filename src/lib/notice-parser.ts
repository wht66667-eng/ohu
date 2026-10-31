/** 本地通知识别：结果只在调用方内存中，保存须由用户另行确认。 */
export type NoticeDate = { date: string; time: string; label: string }
export type NoticeCandidate = { title: string; dates: NoticeDate[]; links: string[]; warnings: string[] }
export type NoticeParseResult = { candidates: NoticeCandidate[]; warnings: string[] }

const NUMBER = '0-9零〇一二两三四五六七八九十'
const YEAR_DIGITS: Record<string, string> = { 零: '0', 〇: '0', 一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9' }
const DATE_PATTERN = new RegExp(`(([0-9零〇一二三四五六七八九]{4})\\s*(?:年|[-/.]))?([${NUMBER}]{1,3})(?:月|[-/.])([${NUMBER}]{1,3})(?:日|号)?`, 'g')
const RELATIVE_PATTERN = /今天|明天|后天|今晚|今夜|明早|明晚|(?:本周|这周|下周)(?:周|星期)?[一二三四五六日天]|(?:周|星期)[一二三四五六日天]/g
const URL_PATTERN = /https?:\/\/[^\s<>"'，。；！）】》]+/gi

function numberOf(value: string): number {
  if (/^\d+$/.test(value)) return Number(value)
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  if (value === '十') return 10
  if (value.includes('十')) { const [a, b] = value.split('十'); return (a ? digits[a] ?? NaN : 1) * 10 + (b ? digits[b] ?? NaN : 0) }
  return value.length === 1 ? digits[value] ?? NaN : NaN
}
function yearOf(value: string): number {
  return /^\d{4}$/.test(value) ? Number(value) : Number([...value].map(char => YEAR_DIGITS[char] ?? '').join(''))
}
function beijingDay(now: Date): Date {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now)
  const part = (type: string) => Number(p.find(x => x.type === type)?.value)
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day')))
}
function asDate(y: number, m: number, d: number): string | null {
  const value = new Date(Date.UTC(y, m - 1, d))
  if (y < 1000 || y > 9999 || value.getUTCFullYear() !== y || value.getUTCMonth() !== m - 1 || value.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
function nextMatchingDate(year: number, month: number, day: number): string | null {
  for (let candidateYear = year + 1; candidateYear <= Math.min(9999, year + 8); candidateYear++) {
    const date = asDate(candidateYear, month, day)
    if (date) return date
  }
  return null
}
function timeAfter(text: string, defaultPeriod = ''): { value: string; invalid: boolean } {
  const tail = text.slice(0, 48).replace(/^\s*(?:[（(]\s*(?:(?:周|星期)[一二三四五六日天])\s*[）)]|(?:(?:周|星期)[一二三四五六日天]))?\s*[,，、；;:]?\s*/, '')
  const m = tail.match(/^\s*(?:的\s*)?(上午|下午|晚上|中午|早上|凌晨)?\s*([0-9一二两三四五六七八九十]{1,3})\s*(?:[:：]\s*([0-9]{1,2})|点(?:\s*(半|一刻|三刻|[0-9一二三四五六七八九十]{1,3})\s*分?)?|时(?:\s*(\d{1,2})\s*分?)?)/)
  if (!m) return { value: '', invalid: false }
  let hour = numberOf(m[2]); const minute = m[3] ? Number(m[3]) : m[4] === '半' ? 30 : m[4] === '一刻' ? 15 : m[4] === '三刻' ? 45 : m[4] ? numberOf(m[4]) : m[5] ? Number(m[5]) : 0
  const period = m[1] || defaultPeriod
  if ((period === '下午' || period === '晚上') && hour < 12) hour += 12
  if (period === '中午' && hour < 11) hour += 12
  if (period === '凌晨' && hour === 12) hour = 0
  if (!Number.isInteger(hour) || hour > 23 || hour < 0 || !Number.isInteger(minute) || minute > 59 || minute < 0) return { value: '', invalid: true }
  return { value: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, invalid: false }
}
function collect(segment: string, today: Date): NoticeCandidate {
  const warnings: string[] = []
  const links: string[] = []
  const scrubbed = segment.replace(URL_PATTERN, raw => {
    const trimmed = raw.replace(/[.,;!?)，。；！？）】》]+$/, '')
    try { const parsed = new URL(trimmed); if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password) { if (!links.includes(parsed.href)) links.push(parsed.href) } else warnings.push('链接包含账号信息或格式不受支持，请手动检查。') } catch { warnings.push('有无法识别的链接，请手动检查。') }
    return ' '.repeat(raw.length)
  })
  const hits: Array<NoticeDate & { start: number; end: number; priority: boolean }> = []
  for (const m of scrubbed.matchAll(DATE_PATTERN)) {
    const explicitYear = m[2], y = explicitYear ? yearOf(explicitYear) : today.getUTCFullYear(), month = numberOf(m[3]), day = numberOf(m[4])
    const date = asDate(y, month, day), start = m.index, end = start + m[0].length
    if (!date) { warnings.push(`日期“${m[0]}”无效，请手动确认。`); continue }
    if (!explicitYear) warnings.push(`日期“${m[0]}”未写年份，请确认年份。`)
    const time = timeAfter(scrubbed.slice(end)); if (time.invalid) warnings.push('时间无效，请手动确认。')
    const priority = /截止|截至|最晚|交作业|提交/.test(scrubbed.slice(Math.max(0, start - 12), start))
    if (!explicitYear && date < today.toISOString().slice(0, 10)) {
      const nextDate = nextMatchingDate(y, month, day)
      if (nextDate) hits.push({ date: nextDate, time: time.value, label: `${m[0]}（${nextDate.slice(0, 4)}年）`, start, end, priority })
      hits.push({ date, time: time.value, label: `${m[0]}（今年）`, start, end, priority })
    } else hits.push({ date, time: time.value, label: m[0], start, end, priority })
  }
  for (const m of scrubbed.matchAll(RELATIVE_PATTERN)) {
    const start = m.index, end = start + m[0].length
    const target = new Date(today)
    if (m[0] === '明天' || m[0] === '后天' || m[0] === '明早' || m[0] === '明晚') target.setUTCDate(target.getUTCDate() + (m[0] === '后天' ? 2 : 1))
    else if (m[0] !== '今天') {
      const weekdays: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 }
      const mondayIndex = (today.getUTCDay() + 6) % 7
      target.setUTCDate(target.getUTCDate() - mondayIndex + ((weekdays[m[0].slice(-1)] + 6) % 7) + (m[0].startsWith('下周') ? 7 : 0))
    }
    const defaultPeriod = /^(?:今晚|今夜|明晚)$/.test(m[0]) ? '晚上' : m[0] === '明早' ? '早上' : ''
    const time = timeAfter(scrubbed.slice(end), defaultPeriod); if (time.invalid) warnings.push('时间无效，请手动确认。')
    if (!time.value && /^(?:今晚|今夜|明早|明晚)$/.test(m[0])) warnings.push(`“${m[0]}”未写具体时刻，请填写时间，或确认此待办不设置截止时间。`)
    const priority = /截止|截至|最晚|提交/.test(scrubbed.slice(Math.max(0, start - 12), start))
    hits.push({ date: target.toISOString().slice(0, 10), time: time.value, label: m[0], start, end, priority })
    if (/^(?:周|星期)/.test(m[0])) {
      warnings.push('星期未写明本周还是下周，请选择正确日期。')
      target.setUTCDate(target.getUTCDate() + 7)
      hits.push({ date: target.toISOString().slice(0, 10), time: time.value, label: `下${m[0]}`, start, end, priority })
    }
  }
  hits.sort((a, b) => Number(b.priority) - Number(a.priority) || a.start - b.start)
  const unique = new Map<string, NoticeDate>()
  for (const hit of hits) unique.set(`${hit.date}|${hit.time}`, { date: hit.date, time: hit.time, label: hit.label })
  const dates = [...unique.values()]
  const yearChoiceOnly = dates.length > 1
    && dates.every(item => /（(?:今年|\d{4}年)）$/.test(item.label))
    && new Set(dates.map(item => item.label.replace(/（(?:今年|\d{4}年)）$/, ''))).size === 1
  if (dates.length > 1 && !yearChoiceOnly) warnings.push('发现多个日期，请选择真正的截止时间。')
  if (dates.some(item => !item.time)) warnings.push('通知未写具体时间，请确认后填写。')
  if (dates.length && dates.every(item => item.date < today.toISOString().slice(0, 10))) warnings.push('识别到的日期已过，请检查年份或日期。')
  if (links.length > 1) warnings.push('发现多个链接，请选择作业入口。')
  const first = scrubbed.split(/[\n。；;]/).find(x => x.trim()) || ''
  const title = first.replace(/^\s*(?:\d+[.、)）]|[一二三四五六七八九十]+[、.])\s*/, '').trim().slice(0, 60)
  if (!title) warnings.push('未识别出标题，请手动填写。')
  return { title, dates, links, warnings: [...new Set(warnings)] }
}

/** 明确的逐行编号可拆分；不确定时只返回一条并交由用户核对。 */
export function parseNotice(text: string, now: Date = new Date()): NoticeParseResult {
  const input = String(text || '').trim()
  if (!input) return { candidates: [], warnings: ['请先粘贴通知。'] }
  if (input.length > 10000) return { candidates: [], warnings: ['通知超过 10000 字，请缩短后重试。'] }
  if (!Number.isFinite(now.getTime())) return { candidates: [], warnings: ['当前日期不可用，请检查设备时间。'] }
  const lines = input.split(/\r?\n/), starts = lines.map((line, index) => /^\s*(?:\d+[.、)）]|[一二三四五六七八九十]+[、.])\s*\S/.test(line) ? index : -1).filter(index => index >= 0)
  const split = starts.length > 1
  const parts = split ? starts.map((start, i) => lines.slice(start, starts[i + 1] ?? lines.length).join('\n').trim()) : [input]
  const warnings: string[] = []
  if (!split && /\n/.test(input)) warnings.push('未能可靠区分多个任务，请核对标题和截止时间。')
  if (split && starts[0] > 0 && lines.slice(0, starts[0]).some(line => /截止|截至|最晚|http/i.test(line))) warnings.push('编号前有截止信息或链接，请确认是否适用于每项任务。')
  return { candidates: parts.map(part => collect(part, beijingDay(now))), warnings }
}
