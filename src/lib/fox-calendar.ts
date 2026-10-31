/** Shared natural-day boundary for campus activity; device UTC offsets cannot shift midnight. */
export function foxLocalDay(now = Date.now(), timezone = 'Asia/Shanghai'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = (name: string) => parts.find(item => item.type === name)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
