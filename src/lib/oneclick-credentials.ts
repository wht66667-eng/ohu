/**
 * 一键获取的凭据：学号 / VPN 密码 / 统一认证密码 / 体测密码。
 *
 * 默认只记学号；勾选「记住密码」才用 `sealSecret` 加密落盘（密钥每机随机，
 * 与教务密码同一套机制），并且按哦狐账号隔离。页面关闭后内存里的明文即丢弃。
 */
import { captureQbankSession, isQbankSessionCurrent } from './qbank'
import { openSecret, sealSecret } from './credential-storage'
import { loadCampusAccount } from './campus-account'

const PREFIX = 'ohu.oneclick.v1:uid:'
const storageKey = (uid: string) => `${PREFIX}${encodeURIComponent(uid)}`

type StoredOneClick = {
  stuid?: string
  vpnBlob?: string
  casBlob?: string
  ticeBlob?: string
  remember?: boolean
}

export type OneClickCredentials = {
  stuid: string
  vpnPassword: string
  casPassword: string
  ticePassword: string
  remember: boolean
}

function readStored(): StoredOneClick {
  try {
    const uid = captureQbankSession().uid
    if (!uid) return {}
    const raw: unknown = JSON.parse(localStorage.getItem(storageKey(uid)) || '{}')
    return raw && typeof raw === 'object' ? (raw as StoredOneClick) : {}
  } catch {
    return {}
  }
}

export function readOneClickCredentials(): OneClickCredentials {
  const stored = readStored()
  const campus = loadCampusAccount()
  return {
    stuid: typeof stored.stuid === 'string' && stored.stuid ? stored.stuid : campus.stuid,
    vpnPassword: openSecret(stored.vpnBlob) || campus.vpnPassword,
    casPassword: openSecret(stored.casBlob),
    ticePassword: openSecret(stored.ticeBlob),
    remember: stored.remember === true,
  }
}

/** 返回是否完整落盘；未勾选记住时只清空密文，学号仍保留。 */
export function saveOneClickCredentials(input: OneClickCredentials): boolean {
  const session = captureQbankSession()
  if (!session.uid) return false
  try {
    const value: StoredOneClick = {
      stuid: input.stuid.trim(),
      remember: input.remember,
      ...(input.remember && input.vpnPassword ? { vpnBlob: sealSecret(input.vpnPassword) } : {}),
      ...(input.remember && input.casPassword ? { casBlob: sealSecret(input.casPassword) } : {}),
      ...(input.remember && input.ticePassword ? { ticeBlob: sealSecret(input.ticePassword) } : {}),
    }
    localStorage.setItem(storageKey(session.uid), JSON.stringify(value))
    return isQbankSessionCurrent(session)
  } catch {
    return false
  }
}

export function clearOneClickSecrets(): boolean {
  const session = captureQbankSession()
  if (!session.uid) return false
  try {
    const stored = readStored()
    localStorage.setItem(storageKey(session.uid), JSON.stringify({ stuid: stored.stuid, remember: false }))
    return true
  } catch {
    return false
  }
}
