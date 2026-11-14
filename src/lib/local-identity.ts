/**
 * 学号本机身份：不注册手机号，也能用「学号」隔离本机的课表 / 成绩 / 体测 / PU 数据。
 *
 * uid 形如 `local:zhd-2023000000`。云端手机账号登录后仍以云端 uid 为准；
 * 未登录云端时，`qbank.effectiveQbankUid()` 会退回到这里。
 */
import { captureQbankSession, setQbankUid } from './qbank'

const KEY = 'ohu.local-identity.v1'

/** 本机身份写入/清除后广播的事件名；auth 层订阅它把游客态即时刷新，门禁通过后不再要求二次登录。 */
export const LOCAL_IDENTITY_EVENT = 'ohu.local-identity.v1'

function announceIdentityChange() {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(LOCAL_IDENTITY_EVENT))
  } catch { /* 非 DOM 环境（node 测试）忽略 */ }
}

export type LocalIdentity = {
  studentId: string
  uid: string
}

function normalize(value: string): string {
  return value.trim().normalize('NFKC').replace(/[^\w-]/g, '').slice(0, 32)
}

export function loadLocalIdentity(): LocalIdentity | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!raw || typeof raw !== 'object') return null
    const record = raw as { studentId?: unknown; uid?: unknown }
    const studentId = typeof record.studentId === 'string' ? normalize(record.studentId) : ''
    const uid = typeof record.uid === 'string' && record.uid.startsWith('local:') ? record.uid : ''
    if (!studentId || uid !== `local:zhd-${studentId}`) return null
    return { studentId, uid }
  } catch {
    return null
  }
}

/** 保存并立即切换当前本机身份；已有云端登录时只保存、不覆盖云端 uid。 */
export function ensureLocalIdentity(studentId: string): LocalIdentity | null {
  const normalized = normalize(studentId)
  if (!normalized) return null
  const identity: LocalIdentity = { studentId: normalized, uid: `local:zhd-${normalized}` }
  try {
    localStorage.setItem(KEY, JSON.stringify(identity))
  } catch {
    return null
  }
  const session = captureQbankSession()
  if (!session.uid || session.uid.startsWith('local:')) setQbankUid(identity.uid)
  announceIdentityChange()
  return identity
}

/** 启动时恢复本机身份（云端登录会随后覆盖）。 */
export function applyStoredLocalIdentity(): void {
  const identity = loadLocalIdentity()
  if (!identity) return
  const session = captureQbankSession()
  if (!session.uid || session.uid.startsWith('local:')) setQbankUid(identity.uid)
}

export function clearLocalIdentity(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* 存储不可用时无需处理 */
  }
  const session = captureQbankSession()
  if (session.uid.startsWith('local:')) setQbankUid(null)
  announceIdentityChange()
}
