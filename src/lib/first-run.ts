/**
 * 首次启动：免责声明 / 用户协议确认 + 权限引导。
 * 在启动屏淡出后弹出；未完成前不进入校园门禁 / 工作端登录。
 */
import { getAppShell, type AppShell } from './app-shell'

const LS_LEGAL = 'sc.firstRun.legal.v1'
const LS_PERMS = 'sc.firstRun.perms.v1'
const LS_GUIDE = 'sc.firstRun.campusGuide.v1'

/** Existing installs keep their consent state; only a fresh student install sees the tour. */
export function needsStudentGuide(shell: AppShell = getAppShell()): boolean {
  if (shell !== 'user' || hasAcceptedLegal(shell) || hasFinishedPerms(shell)) return false
  try { return localStorage.getItem(`${LS_GUIDE}:${shell}`) !== '1' } catch { return true }
}

export function markStudentGuideFinished(shell: AppShell = getAppShell()) {
  try { localStorage.setItem(`${LS_GUIDE}:${shell}`, '1') } catch { /* local storage may be unavailable */ }
}

export function hasAcceptedLegal(shell: AppShell = getAppShell()): boolean {
  try {
    return localStorage.getItem(`${LS_LEGAL}:${shell}`) === '1'
  } catch {
    return false
  }
}

export function markLegalAccepted(shell: AppShell = getAppShell()) {
  try {
    localStorage.setItem(`${LS_LEGAL}:${shell}`, '1')
  } catch {
    /* ignore */
  }
}

export function hasFinishedPerms(shell: AppShell = getAppShell()): boolean {
  try {
    return localStorage.getItem(`${LS_PERMS}:${shell}`) === '1'
  } catch {
    return false
  }
}

export function markPermsFinished(shell: AppShell = getAppShell()) {
  try {
    localStorage.setItem(`${LS_PERMS}:${shell}`, '1')
  } catch {
    /* ignore */
  }
}

/** 免责声明 + 权限两步都完成 */
export function isFirstRunComplete(shell: AppShell = getAppShell()): boolean {
  return hasAcceptedLegal(shell) && hasFinishedPerms(shell)
}
