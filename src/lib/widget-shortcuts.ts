import { Capacitor } from '@capacitor/core'

export const WIDGET_SHORTCUT_OPTIONS = [
  { route: '/schedule', label: '课表' },
  { route: '/todo', label: '待办' },
  { route: '/grades', label: '成绩' },
  { route: '/services', label: '服务' },
  { route: '/study/focus', label: '专注' },
  { route: '/calendar', label: '校历' },
] as const

export type WidgetShortcut = typeof WIDGET_SHORTCUT_OPTIONS[number]['route']
const KEY = 'ohu.widget.shortcuts.v1'
export const WIDGET_SHORTCUTS_CHANGED_EVENT = 'ohu-widget-shortcuts-changed'
export const DEFAULT_WIDGET_SHORTCUTS: readonly WidgetShortcut[] = ['/schedule', '/todo', '/grades', '/services']

export function isWidgetShortcut(value: unknown): value is WidgetShortcut {
  return WIDGET_SHORTCUT_OPTIONS.some(({ route }) => route === value)
}

export function readWidgetShortcuts(): WidgetShortcut[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (Array.isArray(saved) && saved.length === 4 && saved.every(isWidgetShortcut) && new Set(saved).size === 4) {
      return saved
    }
  } catch { /* Use the defaults if device storage is unavailable. */ }
  return [...DEFAULT_WIDGET_SHORTCUTS]
}

export function writeWidgetShortcuts(routes: readonly WidgetShortcut[]): void {
  localStorage.setItem(KEY, JSON.stringify(routes))
  window.dispatchEvent(new Event(WIDGET_SHORTCUTS_CHANGED_EVENT))
}

export function isAndroidWidgetPlatform() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}
