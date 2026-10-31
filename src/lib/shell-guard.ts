import { getAppShell, shellHomePath, type AppShell } from './app-shell'
import { isPathAllowedForShell, type ShellPathAccess } from './shell-path-policy'

export { isPathAllowedForShell } from './shell-path-policy'

export function guardRedirect(
  pathname: string,
  shell: AppShell = getAppShell(),
  access: ShellPathAccess = {},
): string | null {
  return isPathAllowedForShell(shell, pathname, access) ? null : shellHomePath(shell)
}

export function showStudentRemindSettings(shell: AppShell = getAppShell()): boolean {
  return shell === 'user'
}

export function showStudentRoleApply(shell: AppShell = getAppShell()): boolean {
  return shell === 'user'
}
