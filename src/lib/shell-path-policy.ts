import type { AppShell } from './app-shell'

export interface ShellPathAccess {
  /** 仅由已登录账号的服务端 profile 提供；未加载时保持 false。 */
  isAdmin?: boolean
  isSuperAdmin?: boolean
}

const USER_ONLY_PREFIXES = [
  '/schedule', '/study', '/zhongce', '/plaza', '/words', '/english', '/todo',
  '/services', '/tasks', '/market', '/info', '/item/', '/task/', '/contact',
]

const SHELL_PREFIX: Record<AppShell, string[]> = {
  user: [],
  admin: ['/admin/', '/messages', '/chats', '/im/', '/notify', '/profile', '/settings', '/chat'],
}

function matchPrefix(path: string, prefix: string): boolean {
  if (prefix.endsWith('/')) return path === prefix.slice(0, -1) || path.startsWith(prefix)
  return path === prefix || path.startsWith(prefix + '/')
}

/** 壳限制只控制入口；每个管理员接口仍必须由服务端授权。默认不开放管理页。 */
export function isPathAllowedForShell(shell: AppShell, pathname: string, access: ShellPathAccess = {}): boolean {
  const path = pathname || '/'
  if (path === '/') return true
  if (shell === 'user') {
    if (matchPrefix(path, '/admin/')) return !!(access.isAdmin || access.isSuperAdmin)
    return true
  }
  if (USER_ONLY_PREFIXES.some((prefix) => matchPrefix(path, prefix))) return false
  return SHELL_PREFIX[shell].some((prefix) => matchPrefix(path, prefix))
}
