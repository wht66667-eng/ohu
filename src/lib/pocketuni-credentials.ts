/**
 * 口袋校园（PU）凭据：账号 + 密码按哦狐账号加密保存，用于自动续登。
 * 「断开连接」时由 PU 页同时清除这里的密文与口袋校园 SPA 的登录态。
 */
import { captureQbankSession, isQbankSessionCurrent } from './qbank'
import { openSecret, sealSecret } from './credential-storage'

const PREFIX = 'ohu.pocketuni-credentials.v1:uid:'
const keyFor = (uid: string) => `${PREFIX}${encodeURIComponent(uid)}`

type StoredPuCredentials = { account?: string; passwordBlob?: string; remember?: boolean }

export type PuCredentials = { account: string; password: string; remember: boolean }

export function readPuCredentials(): PuCredentials {
  try {
    const uid = captureQbankSession().uid
    if (!uid) return { account: '', password: '', remember: false }
    const raw: unknown = JSON.parse(localStorage.getItem(keyFor(uid)) || '{}')
    const value = raw && typeof raw === 'object' ? (raw as StoredPuCredentials) : {}
    return {
      account: typeof value.account === 'string' ? value.account : '',
      password: openSecret(value.passwordBlob) || '',
      remember: value.remember === true,
    }
  } catch {
    return { account: '', password: '', remember: false }
  }
}

/** 勾选「保持连接」才落盘；返回是否写入成功。 */
export function savePuCredentials(input: PuCredentials): boolean {
  const session = captureQbankSession()
  if (!session.uid) return false
  try {
    const value: StoredPuCredentials = {
      account: input.account.trim(),
      remember: input.remember,
      ...(input.remember && input.password ? { passwordBlob: sealSecret(input.password) } : {}),
    }
    localStorage.setItem(keyFor(session.uid), JSON.stringify(value))
    return isQbankSessionCurrent(session)
  } catch {
    return false
  }
}

export function clearPuCredentials(): boolean {
  const session = captureQbankSession()
  if (!session.uid) return false
  try {
    localStorage.removeItem(keyFor(session.uid))
    return true
  } catch {
    return false
  }
}
