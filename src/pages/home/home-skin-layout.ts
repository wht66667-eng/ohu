import type { UiVariant } from '../../lib/ui-variant'
import { HOME_SERVICE_OPTIONS, homePreferenceKey, loadHomePreferences } from './home-preferences'

export const HOME_SHORTCUTS = [
  ...HOME_SERVICE_OPTIONS.map(item => item.id === 'grades' ? { ...item, to: '/grades' } : item),
  { id: 'calendar', label: '校历', icon: 'cal', to: '/calendar' },
  { id: 'oneclick', label: '更新校园数据', icon: 'update', to: '/study/oneclick' },
] as const

export const HOME_SECTIONS = [
  { id: 'shortcuts', label: '常用功能' },
  { id: 'schedule', label: '课表概览' },
  { id: 'focus', label: '今日重点' },
  { id: 'todo', label: '待办' },
  { id: 'exams', label: '最近考试' },
  { id: 'courses', label: '最近课程' },
  { id: 'meet', label: '碰个空' },
  { id: 'life', label: '今天生活' },
] as const

type Section = typeof HOME_SECTIONS[number]['id']
type Shortcut = typeof HOME_SHORTCUTS[number]['id']
export type HomeSkinLayout = { shortcuts: Shortcut[]; sections: Section[] }

const sectionOrders: Partial<Record<UiVariant, readonly Section[]>> = {
  companion: ['shortcuts', 'schedule', 'focus', 'todo', 'exams', 'courses', 'life', 'meet'],
  classic: ['schedule', 'focus', 'shortcuts', 'courses', 'exams', 'todo', 'life', 'meet'],
  handdrawn: ['todo', 'schedule', 'focus', 'shortcuts', 'courses', 'exams', 'life', 'meet'],
}
const shortcutDefaults: Partial<Record<UiVariant, readonly Shortcut[]>> = {
  classic: ['schedule', 'grades', 'exams', 'library', 'bus', 'campus-card'],
  handdrawn: ['todo', 'schedule', 'focus', 'calendar', 'english', 'services'],
}
const defaultShortcuts: readonly Shortcut[] = ['schedule', 'grades', 'exams', 'todo', 'calendar', 'oneclick']
const originalSections: readonly Section[] = ['schedule', 'focus', 'shortcuts', 'exams', 'courses', 'todo', 'life', 'meet']

export function defaultHomeSkinLayout(skin: UiVariant): HomeSkinLayout {
  return { shortcuts: [...(shortcutDefaults[skin] ?? defaultShortcuts)], sections: [...(sectionOrders[skin] ?? originalSections)] }
}

export function homeSkinLayoutKey(uid: string, skin: UiVariant): string {
  return `ohu.home.layout.v1:${encodeURIComponent(uid || 'guest')}:${skin}`
}

function validIds<T extends string>(input: unknown, options: readonly { id: T }[]): T[] {
  if (!Array.isArray(input)) return []
  const allowed = new Set<string>(options.map(option => option.id))
  return [...new Set(input.filter((id): id is T => typeof id === 'string' && allowed.has(id)))]
}

/** 保留可识别的旧偏好，新增区块跟在既有排列之后。 */
export function readHomeSkinLayout(uid: string, skin: UiVariant): HomeSkinLayout {
  const defaults = defaultHomeSkinLayout(skin)
  try {
    const raw = localStorage.getItem(homeSkinLayoutKey(uid, skin))
    if (raw) {
      const parsed = JSON.parse(raw)
      const shortcuts = validIds(parsed?.shortcuts, HOME_SHORTCUTS).slice(0, 6)
      const sections = validIds(parsed?.sections, HOME_SECTIONS)
      return {
        shortcuts: shortcuts.length ? shortcuts : defaults.shortcuts,
        sections: [...new Set([...sections, ...defaults.sections])],
      }
    }
    if (skin === 'companion') {
      const legacy = JSON.parse(localStorage.getItem(homePreferenceKey(uid)) || 'null')
      if (Array.isArray(legacy?.services)) {
        const previous = loadHomePreferences(uid)
        return { ...defaults, shortcuts: previous.services }
      }
    }
  } catch { /* 损坏记录或隐私模式回退到当前皮肤默认布局。 */ }
  return defaults
}

export function saveHomeSkinLayout(uid: string, skin: UiVariant, layout: HomeSkinLayout): boolean {
  try {
    localStorage.setItem(homeSkinLayoutKey(uid, skin), JSON.stringify(layout))
    return true
  } catch {
    return false
  }
}
