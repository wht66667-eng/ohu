/**
 * App 壳角色（多 APK 共用同一套 Web UI）
 *
 * 2026-10 功能缩减（ICP 备案口径）：交易链（食堂点餐 / 小店 / 档口 / 骑手）整体下线，
 * 只保留学生端与管理端两个壳。
 */
import { Capacitor } from '@capacitor/core'
import { IS_NATIVE } from './platform'

export type AppShell = 'user' | 'admin'

export const APP_SHELLS: AppShell[] = ['user', 'admin']

/** 与 android productFlavors / applicationId 对齐 */
export const SHELL_APP_ID: Record<AppShell, string> = {
  user: 'com.sunshinecampus.app',
  admin: 'com.sunshinecampus.admin',
}

export const SHELL_META: Record<
  AppShell,
  { label: string; home: string; apkName: (ver: string) => string }
> = {
  user: {
    label: '哦狐',
    home: '/',
    apkName: (v) => `SunshineCampus-User-${v}.apk`,
  },
  admin: {
    label: '哦狐·管理',
    home: '/admin/content',
    apkName: (v) => `SunshineCampus-Admin-${v}.apk`,
  },
}

const ID_TO_SHELL: Record<string, AppShell> = Object.fromEntries(
  (Object.keys(SHELL_APP_ID) as AppShell[]).map((s) => [SHELL_APP_ID[s], s]),
) as Record<string, AppShell>

declare global {
  interface Window {
    __SC_SHELL__?: string
  }
}

function parseShell(raw: unknown): AppShell | null {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
  if ((APP_SHELLS as string[]).includes(s)) return s as AppShell
  return null
}

let cached: AppShell | null = null

/** 同步读取（优先原生注入 / 构建时 VITE_APP_SHELL） */
export function getAppShell(): AppShell {
  // Web administration is a presentation surface, with the same server-side
  // account permissions as the mobile administrator app.
  if (!IS_NATIVE && typeof window !== 'undefined' && /^\/admin(?:\/|$)/.test(window.location.pathname)) return 'admin'
  if (cached) return cached
  const fromWin = parseShell(typeof window !== 'undefined' ? window.__SC_SHELL__ : '')
  if (fromWin) {
    cached = fromWin
    return fromWin
  }
  const fromEnv = parseShell(import.meta.env.VITE_APP_SHELL)
  if (fromEnv) {
    cached = fromEnv
    return fromEnv
  }
  return 'user'
}

/** 原生壳用 applicationId 校准（异步，启动时调一次） */
export async function initAppShell(): Promise<AppShell> {
  if (!IS_NATIVE || !Capacitor.isPluginAvailable('App')) {
    return getAppShell()
  }
  try {
    const { App } = await import('@capacitor/app')
    const info = await App.getInfo()
    const byId = ID_TO_SHELL[info.id]
    if (byId) {
      cached = byId
      if (typeof window !== 'undefined') window.__SC_SHELL__ = byId
      return byId
    }
  } catch {
    /* ignore */
  }
  return getAppShell()
}

export function isWorkShell(shell: AppShell = getAppShell()): boolean {
  return shell === 'admin'
}

export function shellHomePath(shell: AppShell = getAppShell()): string {
  return SHELL_META[shell].home
}
