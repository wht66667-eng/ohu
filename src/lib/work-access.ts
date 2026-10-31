/**
 * 工作端准入：手机号账号 + 管理员权限才进管理端。
 * 学生端不走这里。2026-10 功能缩减：骑手 / 小店 / 档口壳已下线，仅剩管理端。
 */
import type { AppShell } from './app-shell'

export function isAdminShell(shell: AppShell): boolean {
  return shell === 'admin'
}

/** 当前壳是否已获准进入业务页 */
export function hasWorkAccess(opts: {
  shell: AppShell
  isSigned: boolean
  isAdmin: boolean
  isSuperAdmin?: boolean
}): boolean {
  if (!opts.isSigned) return false
  return isAdminShell(opts.shell) ? !!(opts.isAdmin || opts.isSuperAdmin) : true
}
