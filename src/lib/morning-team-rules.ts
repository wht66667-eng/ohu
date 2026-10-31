/** Morning squads use the existing activity schema; no extra database columns. */
export const MORNING_TEAM_TAG = '阳光跑小队'
/** Legacy squads remain visible without rewriting live database rows. */
export const MORNING_TEAM_TAGS = [MORNING_TEAM_TAG, '晨跑小队'] as const
export const MORNING_TEAM_CATEGORY = 'teamup'

export interface MorningTeamFields {
  category?: string
  tag: string
  status: string
  start_at: string
  end_at: string
  seats: number
  signup_count: number
}

export function isMorningTeam(team: Pick<MorningTeamFields, 'category' | 'tag'>): boolean {
  return team.category === MORNING_TEAM_CATEGORY && (MORNING_TEAM_TAGS as readonly string[]).includes(team.tag)
}

/** Reject invalid calendar dates and local times normalized across a DST gap. */
export function parseLocalStart(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [year, month, day, hour, minute] = match.slice(1).map(Number)
  if (year < 2000 || year > 2100 || hour > 23 || minute > 59) return null
  const date = new Date(year, month - 1, day, hour, minute)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) return null
  return date
}

export function localStartText(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function nextMorningStart(now = new Date()): string {
  const date = new Date(now)
  date.setHours(7, 0, 0, 0)
  if (date.getTime() <= now.getTime()) date.setDate(date.getDate() + 1)
  return localStartText(date)
}

export function validateMorningDraft(input: { title: string; location: string; start: string; seats: string; duration: number }, now = Date.now()): string | null {
  if (!input.title.trim() || input.title.trim().length > 40) return '小队名称需要填写，最多 40 个字'
  if (!input.location.trim() || input.location.trim().length > 40) return '请填写集合点，最多 40 个字'
  const date = parseLocalStart(input.start)
  if (!date || date.getTime() <= now) return '请选择未来的出发时间'
  if (date.getHours() < 4 || date.getHours() >= 12) return '晨跑出发时间请选择 04:00–11:59'
  if (!/^\d+$/.test(input.seats) || Number(input.seats) < 1 || Number(input.seats) > 30) return '同行名额请填 1–30 人'
  if (![30, 45, 60, 90].includes(input.duration)) return '请选择有效的预计时长'
  return null
}

export function morningTeamState(team: MorningTeamFields, now = Date.now()): string {
  if (team.status === 'cancelled') return '已取消'
  if (team.status === 'closed') return '已结束'
  if (team.status !== 'open') return '暂不可报名'
  const start = Date.parse(team.start_at)
  const end = Date.parse(team.end_at)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return '时间待确认'
  if (now >= end) return '已结束'
  if (now >= start) return '已出发'
  if (team.seats > 0 && team.signup_count >= team.seats) return '名额已满'
  return '可加入'
}

export function formatMorningStart(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '时间待确认'
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}
