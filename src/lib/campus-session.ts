/**
 * 本次 App 运行期间保留的校园凭据（只在内存，不落盘）。
 *
 * 入口门禁只收「学号 + 校园网密码 + 统一认证密码」；体测、PU 是独立账号，
 * 各自在体测页 / PU 页的登录界面单独填写。体测页需要校园网密码才能进
 * WebVPN，这里把门禁刚用过的密码留在内存里，切到体测页就不用再输一遍；
 * 冷启动或网页版没有值时，由体测页的登录界面自己收集。
 */
export type CampusSessionCredentials = {
  studentId: string
  vpnPassword: string
  casPassword: string
}

let current: CampusSessionCredentials | null = null

export function rememberCampusSession(input: CampusSessionCredentials): void {
  const studentId = input.studentId.trim()
  if (!studentId) return
  current = { studentId, vpnPassword: input.vpnPassword, casPassword: input.casPassword }
}

export function readCampusSession(): CampusSessionCredentials | null {
  return current
}

export function clearCampusSession(): void {
  current = null
}
