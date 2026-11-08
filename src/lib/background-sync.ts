/**
 * 门禁通过后的后台同步：不阻塞进入 App，逐项失败互不影响。
 * 只同步教务 / 校园档案 / 学习通 / 公选；体测和 PU 是独立账号，
 * 由「体测成绩」「PU 成绩」页各自的登录与更新按钮负责。
 */
import {
  runChaoxingSsoSync,
  runPublicElectiveSync,
  runQualitySync,
  runSchoolSync,
} from './one-click'

export type GateCredentials = {
  studentId: string
  vpnPassword: string
  casPassword: string
}

let running = false
let paused = false

export function pauseBackgroundSync() { paused = true }
export function resumeBackgroundSync() { paused = false }

export function isBackgroundSyncRunning(): boolean {
  return running
}

/**
 * 体测/PU 等页面级同步开始前调用：等后台教务同步跑完，避免两个流程抢同一个内置 WebView。
 * 后台同步被暂停或超时也会返回，页面同步随后自己开始。
 */
export function waitForBackgroundSync(timeoutMs = 90_000): Promise<void> {
  if (!running) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => {
      window.removeEventListener('ohu-background-sync-done', finish)
      window.clearTimeout(timer)
      resolve()
    }
    const timer = window.setTimeout(finish, timeoutMs)
    window.addEventListener('ohu-background-sync-done', finish)
  })
}

export async function startBackgroundSync(input: GateCredentials): Promise<void> {
  if (running) return
  running = true
  const base = { studentId: input.studentId, vpnPassword: input.vpnPassword, casPassword: input.casPassword }
  const noop = () => {}
  const stopped = () => paused
  try {
    if (stopped()) return
    await runSchoolSync({ ...base, report: noop }).catch(noop)
    if (stopped()) return
    await runQualitySync({ ...base, report: noop }).catch(noop)
    if (stopped()) return
    await runChaoxingSsoSync({ ...base, report: noop }).catch(noop)
    if (stopped()) return
    await runPublicElectiveSync({ ...base, report: noop }).catch(noop)
  } finally {
    running = false
    window.dispatchEvent(new Event('ohu-background-sync-done'))
  }
}
