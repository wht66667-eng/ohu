/** 外观主题：浅色 / 深色 / 跟随系统 */
import { syncNativeTheme } from './native'
const KEY = 'app.theme'

export type Theme = 'light' | 'dark' | 'system'

export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* ignore */
  }
  return 'system'
}

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

export function applyTheme(theme: Theme) {
  const resolved = resolveTheme(theme)
  document.documentElement.setAttribute('data-theme', resolved)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#16211a' : '#f5f8f5')
  void syncNativeTheme(resolved === 'dark')
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* ignore */
  }
}

export function watchSystemTheme(cb: (dark: boolean) => void) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = () => cb(mq.matches)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
