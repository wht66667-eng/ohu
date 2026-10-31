/**
 * 校园账号本机库：学号 + WebVPN 密码 + 教务密码
 * 仅 localStorage 混淆存储，不上传。无法替你在学校网页里自动点「登录」
 *（浏览器同源策略禁止），但可自动回填本 App 表单，并一键复制密码后打开门户。
 *
 * 学号、教务密码、VPN 密码按真实 App 账号保存。旧版全局无归属凭据保留，
 * 但不会交给下一位登录用户；游客不回填或保存。
 */
import {
  isRememberPasswordEnabled,
  loadSavedPassword,
  loadSavedStuid,
} from './schedule-credentials'
import { openSecret, sealSecret } from './local-secret'
import {
  credentialSession, currentCredentialSession, readCampusCredentials,
  updateCampusCredentials, type CredentialSession,
} from './campus-credential-store'

export type CampusAccount = {
  stuid: string
  jwPassword: string
  vpnPassword: string
  remember: boolean
}

export function loadCampusAccount(session = credentialSession()): CampusAccount {
  const saved = readCampusCredentials(session)
  const remember = saved.rememberAll === true || isRememberPasswordEnabled(session)
  const stuid = loadSavedStuid(session)
  const jwPassword = remember ? loadSavedPassword(session) : ''
  let vpnPassword = ''
  if (remember) {
    vpnPassword = typeof saved.vpnPasswordBlob === 'string' ? openSecret(saved.vpnPasswordBlob) : ''
    // 若未单独存 VPN 密码，默认与教务相同（很多同学两套一样）
    if (!vpnPassword && jwPassword) vpnPassword = jwPassword
  }
  return { stuid, jwPassword, vpnPassword, remember }
}

export function saveCampusAccount(acc: CampusAccount, session: CredentialSession = credentialSession()): boolean {
  if (!currentCredentialSession(session)) return false
  const remember = !!acc.remember
  const passwordBlob = remember && acc.jwPassword ? sealSecret(acc.jwPassword) : ''
  const vpnPasswordBlob = remember && acc.vpnPassword ? sealSecret(acc.vpnPassword) : ''
  if (remember && ((acc.jwPassword && !passwordBlob) || (acc.vpnPassword && !vpnPasswordBlob))) return false
  return updateCampusCredentials(() => ({
    stuid: acc.stuid.trim(), rememberAll: remember, rememberPassword: !!passwordBlob,
    passwordBlob: passwordBlob || undefined, vpnPasswordBlob: vpnPasswordBlob || undefined,
  }), session)
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fallthrough */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
