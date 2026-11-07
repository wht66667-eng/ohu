/**
 * 门禁通过后的后台同步：不阻塞进入 App，逐项失败互不影响。
 * 失败的项保留旧缓存，用户可在「设置 → 更新数据」或一键获取页重试。
 */
import {
  runChaoxingSsoSync,
  runPocketUniSync,
  runPublicElectiveSync,
  runQualitySync,
  runSchoolSync,
  runTiceSync,
} from './one-click'

export type GateCredentials = {
  studentId: string
  vpnPassword: string
  casPassword: string
  ticePassword: string
  puAccount: string
  puPassword: string
}

let running = false

export function isBackgroundSyncRunning(): boolean {
  return running
}

export async function startBackgroundSync(input: GateCredentials): Promise<void> {
  if (running) return
  running = true
  const base = { studentId: input.studentId, vpnPassword: input.vpnPassword, casPassword: input.casPassword }
  const noop = () => {}
  try {
    await runSchoolSync({ ...base, report: noop }).catch(noop)
    await runQualitySync({ ...base, report: noop }).catch(noop)
    await runChaoxingSsoSync({ ...base, report: noop }).catch(noop)
    if (input.ticePassword.trim()) {
      await runTiceSync({ ...base, ticePassword: input.ticePassword, report: noop }).catch(noop)
    }
    if (input.puAccount.trim() && input.puPassword) {
      await runPocketUniSync({ account: input.puAccount.trim(), password: input.puPassword, report: noop }).catch(noop)
    }
    await runPublicElectiveSync({ ...base, report: noop }).catch(noop)
  } finally {
    running = false
    window.dispatchEvent(new Event('ohu-background-sync-done'))
  }
}
