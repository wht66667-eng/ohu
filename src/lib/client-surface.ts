/** Presentation routes do not grant administrator permissions. */
export function isAdminWorkspacePath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/')
}

export function shouldOpenDesktopAdmin(options: {
  native: boolean
  pathname: string
  width: number
  studentPreview?: boolean
}): boolean {
  return !options.native && options.pathname === '/' && options.width >= 900 && !options.studentPreview
}

/** Keep shared message/detail screens inside the web administration workspace. */
export function adminScopedPath(target: string, pathname: string, native: boolean): string {
  if (native || !isAdminWorkspacePath(pathname) || !target.startsWith('/') || target.startsWith('//')) return target
  if (isAdminWorkspacePath(target.split(/[?#]/)[0])) return target
  if (target === '/' || target.startsWith('/?') || target.startsWith('/#')) return '/admin/content' + target.slice(1)
  return '/admin' + target
}
