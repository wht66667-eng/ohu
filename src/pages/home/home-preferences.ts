import { isCampus, type Campus } from '../../lib/campus'

/** Homepage choices are stored on this device; they are not a cloud profile. */
export const HOME_SERVICE_OPTIONS = [
  { id: 'schedule', label: '课表', artwork: '课表查询', icon: 'cal', to: '/schedule' },
  { id: 'messages', label: '消息／好友', artwork: '消息', icon: 'chat', to: '/messages' },
  { id: 'grades', label: '成绩', artwork: '成绩查询', icon: 'flag', to: '/study?tab=grades' },
  { id: 'english', label: '英语学习', artwork: '英语学习', icon: 'book', to: '/english' },
  { id: 'tasks', label: '跑腿', artwork: '快捷代取', icon: 'bag', to: '/tasks' },
  { id: 'market', label: '二手', artwork: '二手交易', icon: 'shop', to: '/market' },
  { id: 'sports', label: '运动中心', artwork: '运动中心', icon: 'heart', to: '/sports' },
  { id: 'focus', label: '番茄专注', artwork: '番茄专注', icon: 'moon', to: '/study/focus' },
  { id: 'todo', label: '待办', artwork: '我的待办', icon: 'task', to: '/todo' },
  { id: 'exams', label: '考试', artwork: '考试安排', icon: 'cal', to: '/study?tab=exams' },
  { id: 'zhongce', label: '综测', artwork: '综测加分', icon: 'flag', to: '/zhongce' },
  { id: 'library', label: '图书馆', artwork: '图书馆座位', icon: 'book', to: '/library' },
  { id: 'bus', label: '校园班车', artwork: '校园班车', icon: 'bus', to: '/bus' },
  { id: 'campus-card', label: '校园卡', artwork: '校园卡', icon: 'card', to: '/campus-card' },
  { id: 'nearby-food', label: '附近美食', artwork: '附近美食', icon: 'food', to: '/nearby-food' },
  { id: 'map', label: '校园地图', artwork: '校园地图', icon: 'pin', to: '/campus-map' },
  { id: 'services', label: '更多服务', artwork: '更多服务', icon: 'grid', to: '/services' },
] as const

export type HomeServiceId = (typeof HOME_SERVICE_OPTIONS)[number]['id']
export const DEFAULT_HOME_SERVICE_IDS: readonly HomeServiceId[] = ['schedule', 'library', 'bus', 'campus-card', 'nearby-food', 'services']
export const HOME_CARD_OPTIONS = [
  { id: 'schedule', label: '今日安排' },
  { id: 'tasks', label: '今日任务' },
  { id: 'services', label: '常用功能' },
  { id: 'community', label: '校园动态与同学互助' },
] as const
export type HomeCardId = (typeof HOME_CARD_OPTIONS)[number]['id']
export const DEFAULT_HOME_CARD_IDS: readonly HomeCardId[] = HOME_CARD_OPTIONS.map((item) => item.id)
const LEGACY_DEFAULT_HOME_SERVICE_IDS = [
  ['schedule', 'messages', 'english'],
  ['schedule', 'grades', 'english', 'tasks', 'market', 'sports'],
  ['schedule', 'grades', 'english', 'tasks', 'market', 'food'],
] as const
const PREFERENCE_VERSION = 4
const allowed = new Set<string>(HOME_SERVICE_OPTIONS.map((item) => item.id))
const allowedCards = new Set<string>(HOME_CARD_OPTIONS.map((item) => item.id))

export function normalizeHomeServices(input: unknown): HomeServiceId[] {
  if (!Array.isArray(input)) return [...DEFAULT_HOME_SERVICE_IDS]
  const unique = [...new Set(input.filter((item): item is HomeServiceId => typeof item === 'string' && allowed.has(item)))].slice(0, 6)
  return unique.length > 0 ? unique : [...DEFAULT_HOME_SERVICE_IDS]
}

export function normalizeHomeCards(input: unknown): HomeCardId[] {
  if (!Array.isArray(input)) return [...DEFAULT_HOME_CARD_IDS]
  const unique = [...new Set(input.filter((item): item is HomeCardId => typeof item === 'string' && allowedCards.has(item))) ]
  return unique.length > 0 ? unique : [...DEFAULT_HOME_CARD_IDS]
}

export function homePreferenceKey(uid: string): string {
  return `ohhu.home.v1:${encodeURIComponent(uid || 'guest')}`
}

export type HomePreferences = { campus: Campus | ''; services: HomeServiceId[]; cards: HomeCardId[] }

export function loadHomePreferences(uid: string): HomePreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(homePreferenceKey(uid)) || 'null')
    // Only replace the old untouched default. A reordered or explicitly saved selection is a user's choice.
    const migrateDefault = (stored?.version == null || stored.version < PREFERENCE_VERSION) && Array.isArray(stored?.services)
      && LEGACY_DEFAULT_HOME_SERVICE_IDS.some((defaults) => stored.services.length === defaults.length
        && defaults.every((id, index) => stored.services[index] === id))
    return {
      campus: isCampus(stored?.campus) ? stored.campus : '',
      services: migrateDefault ? [...DEFAULT_HOME_SERVICE_IDS] : normalizeHomeServices(stored?.services),
      cards: normalizeHomeCards(stored?.cards),
    }
  } catch {
    return { campus: '', services: [...DEFAULT_HOME_SERVICE_IDS], cards: [...DEFAULT_HOME_CARD_IDS] }
  }
}

export function saveHomePreferences(uid: string, preferences: HomePreferences): boolean {
  try {
    localStorage.setItem(homePreferenceKey(uid), JSON.stringify({
      version: PREFERENCE_VERSION,
      campus: isCampus(preferences.campus) ? preferences.campus : '',
      services: normalizeHomeServices(preferences.services),
      cards: normalizeHomeCards(preferences.cards),
    }))
    return true
  } catch {
    return false
  }
}
