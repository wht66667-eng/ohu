/** Account-owned local credentials. Unowned pre-131 keys are deliberately never claimed. */
import { captureQbankSession, isQbankSessionCurrent } from './qbank'

export type CredentialSession = ReturnType<typeof captureQbankSession>
export type StoredCampusCredentials = {
  stuid?: string
  passwordBlob?: string
  rememberPassword?: boolean
  vpnPasswordBlob?: string
  rememberAll?: boolean
}

const PREFIX = 'campus.credentials.v3:uid:'

export function credentialSession() { return captureQbankSession() }
export function currentCredentialSession(session: CredentialSession): boolean {
  return !!session.uid && isQbankSessionCurrent(session)
}

function key(session: CredentialSession): string { return PREFIX + encodeURIComponent(session.uid) }

export function readCampusCredentials(session = credentialSession()): StoredCampusCredentials {
  if (!currentCredentialSession(session)) return {}
  try {
    const value = JSON.parse(localStorage.getItem(key(session)) || '{}') as StoredCampusCredentials
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch { return {} }
}

/** One write commits the whole preference; failures leave the prior record intact. */
export function updateCampusCredentials(
  update: (old: StoredCampusCredentials) => StoredCampusCredentials,
  session = credentialSession(),
): boolean {
  if (!currentCredentialSession(session)) return false
  try {
    const value = JSON.stringify(update(readCampusCredentials(session)))
    if (!currentCredentialSession(session)) return false
    localStorage.setItem(key(session), value)
    return true
  } catch { return false }
}

/** Only a presence hint is exposed; the historical account and secrets stay untouched. */
export function hasUnboundCampusCredentials(): boolean {
  try {
    return ['schedule.lastStuid', 'schedule.pwdBlob.v2', 'schedule.pwdBlob.v1',
      'campus.vpnPwdBlob.v2', 'campus.vpnPwdBlob.v1'].some(k => !!localStorage.getItem(k))
  } catch { return false }
}
