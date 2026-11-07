import { calendarDayIdx, toDateKey } from './schedule-calendar'

/** Local civil dates, Monday first. Never derive a displayed day from UTC. */
export function calendarMonthDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  first.setDate(first.getDate() - calendarDayIdx(first) + 1)
  return Array.from({ length: 42 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), first.getDate() + index))
}

export function parseCalendarMonth(value: string): Date | null {
  if (!/^(20\d{2})-(0[1-9]|1[0-2])$/.test(value)) return null
  const [year, month] = value.split('-').map(Number)
  return new Date(year, month - 1, 1)
}

export function calendarMonthKey(date: Date): string {
  return toDateKey(date).slice(0, 7)
}
