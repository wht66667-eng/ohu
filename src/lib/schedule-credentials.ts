/**
 * 教务凭据仅归属当前真实 App 账号。游客不回填、不保存；历史全局凭据保留，
 * 不自动认领给首位登录者。密码仍使用本机随机密钥混淆；默认只记住学号。
 */
import { openSecret, sealSecret } from './local-secret'
import {
  credentialSession, currentCredentialSession, readCampusCredentials,
  updateCampusCredentials, type CredentialSession,
} from './campus-credential-store'

export { hasUnboundCampusCredentials } from './campus-credential-store'

export function loadSavedStuid(session = credentialSession()): string {
  const value = readCampusCredentials(session).stuid
  return typeof value === 'string' ? value : ''
}

export function isRememberPasswordEnabled(session = credentialSession()): boolean {
  return readCampusCredentials(session).rememberPassword === true
}

export function loadSavedPassword(session = credentialSession()): string {
  const saved = readCampusCredentials(session)
  return saved.rememberPassword === true && typeof saved.passwordBlob === 'string'
    ? openSecret(saved.passwordBlob) : ''
}

export function saveTimetableCredentials(opts: {
  stuid: string
  password: string
  rememberStuid: boolean
  rememberPassword: boolean
}, session: CredentialSession = credentialSession()): boolean {
  if (!currentCredentialSession(session)) return false
  const passwordBlob = opts.rememberPassword && opts.password ? sealSecret(opts.password) : ''
  if (opts.rememberPassword && opts.password && !passwordBlob) return false
  return updateCampusCredentials(old => ({
    ...old,
    stuid: opts.rememberStuid ? opts.stuid.trim() : undefined,
    rememberPassword: !!passwordBlob,
    passwordBlob: passwordBlob || undefined,
  }), session)
}

export function clearSavedPassword(session: CredentialSession = credentialSession()): boolean {
  return updateCampusCredentials(old => ({ ...old, rememberPassword: false, passwordBlob: undefined }), session)
}
