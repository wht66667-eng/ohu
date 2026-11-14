export type FortuneChatIntent = 'tarot' | 'stars' | 'animals' | 'daily' | 'daily-stars' | 'daily-animals' | 'settings'
export type FortuneWorkbenchMode = Extract<FortuneChatIntent, 'tarot' | 'stars' | 'animals'>
export type FortunePreferences = { birthday: string; stars: boolean; animals: boolean }

const DEFAULT: FortunePreferences = { birthday: '', stars: false, animals: false }
const KEY = 'ohu.chat-fortune.v1:'
const STAR_STARTS = [321, 420, 521, 622, 723, 823, 923, 1024, 1123, 1222, 120, 219] as const

export function localDateKey(date = new Date()) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((part, index) =>
    String(part).padStart(index === 0 ? 4 : 2, '0')).join('-')
}

export function birthDateInfo(birthday: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday) || birthday > localDateKey()) return null
  const [year, month, day] = birthday.split('-').map(Number)
  const date = new Date(`${birthday}T12:00:00Z`)
  if (!year || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== birthday) return null
  const monthDay = month * 100 + day
  const starIndex = STAR_STARTS.reduce((latest, start, index) =>
    start <= monthDay && start > latest.start ? { start, index } : latest, { start: 0, index: 9 }).index
  let animalIndex: number | null = null
  try {
    const formatter = new Intl.DateTimeFormat('en-u-ca-chinese', { year: 'numeric', timeZone: 'Asia/Shanghai' })
    const relatedYear = formatter.formatToParts(date).find((part: { type: string }) => part.type === 'relatedYear')?.value
    const lunarYear = Number(relatedYear)
    if (relatedYear && Number.isInteger(lunarYear)) animalIndex = ((lunarYear - 4) % 12 + 12) % 12
  } catch { /* Retain the star reading on devices without the lunar calendar. */ }
  return { starIndex, animalIndex }
}

export function readFortunePreferences(owner: string): FortunePreferences {
  try {
    const value = JSON.parse(localStorage.getItem(KEY + owner) || 'null') as Partial<FortunePreferences> | null
    return {
      birthday: typeof value?.birthday === 'string' && birthDateInfo(value.birthday) ? value.birthday : '',
      stars: value?.stars === true,
      animals: value?.animals === true,
    }
  } catch { return DEFAULT }
}

export function saveFortunePreferences(owner: string, value: FortunePreferences): boolean {
  try {
    localStorage.setItem(KEY + owner, JSON.stringify(value))
    return true
  } catch { return false }
}

export function fortuneChatIntent(question: string): FortuneChatIntent | null {
  const text = question.trim()
  if (/(?:我的?|本人)(?:的)?(?:生日|出生日期|出生于)|(?:生日|出生日期).*(?:设置|修改|删除|清除|保存)|(?:设置|修改|删除|清除|保存).*?(?:生日|出生日期)|(?:开启|关闭|关掉|停用|隐藏|不要显示|不想看).*?(?:星座|生肖)|打开.*?(?:每日|解读设置)|(?:解读|提示).*?(?:设置|开关)/.test(text)) return 'settings'
  if (/(?:塔罗|tarot|抽牌|牌阵)/i.test(text) && !/^(?:别|不要|不想|不用|停止)/.test(text)) return 'tarot'
  const animals = /生肖|属相/.test(text)
  const stars = /星座|星图/.test(text)
  if (animals && stars || /今日天机|每日解读|今日解读/.test(text)) return 'daily'
  const personal = /(?:今日|今天|每日|每天|我的)|(?:运势|解读)/.test(text)
  if (animals) return personal ? 'daily-animals' : 'animals'
  if (stars) return personal ? 'daily-stars' : 'stars'
  return null
}
