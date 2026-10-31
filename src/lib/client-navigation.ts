import { adminScopedPath } from './client-surface'
import { IS_NATIVE } from './platform'

export function clientPath(target: string): string {
  return adminScopedPath(target, typeof window === 'undefined' ? '/' : window.location.pathname, IS_NATIVE)
}
