import { cbAuth } from './cb'
import { API_BASE } from './gateway'

const KEY = 'ohu.cloud-identity.v1'

/** 云端只认不可逆身份码 uid（stu_ + 32 位编码）；历史明文 student_<学号> 一律作废。 */
function isEncodedUid(uid: unknown): uid is string {
  return typeof uid === 'string' && /^stu_[0-9a-f]{32}$/.test(uid)
}

/**
 * 用学号换 CloudBase 自定义登录 ticket。学号仅用于换取身份码，云端签发的是
 * 带服务端密钥的不可逆编码 uid；本机业务数据不上云，云会话只作门禁与社交身份。
 */
export async function ensureCloudIdentity(studentId: string): Promise<boolean> {
  if (!/^\d{8,12}$/.test(studentId)) return false
  try {
    const response = await fetch(`${API_BASE}/api/campus-auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId }),
    })
    const body = await response.json().catch(() => null) as { ok?: boolean; ticket?: unknown; uid?: unknown; message?: unknown } | null
    if (!response.ok || body?.ok !== true || typeof body.ticket !== 'string') return false
    if (!isEncodedUid(body.uid)) return false
    const auth = cbAuth() as unknown as {
      signInWithCustomTicket?: (getter: () => Promise<string>) => Promise<{ error?: { message?: string } }>
    }
    if (!auth.signInWithCustomTicket) return false
    const result = await auth.signInWithCustomTicket(() => Promise.resolve(body.ticket as string))
    if (result?.error) return false
    localStorage.setItem(KEY, JSON.stringify({ studentId, uid: body.uid, at: Date.now() }))
    return true
  } catch {
    return false
  }
}

function readIdentity(): { uid: string } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null') as { uid?: unknown } | null
    return raw && isEncodedUid(raw.uid) ? { uid: raw.uid } : null
  } catch {
    return null
  }
}

export function hasCloudIdentity(): boolean {
  return !!readIdentity()
}

/** 当前 CloudBase 自定义登录 uid（不可逆身份码），写入 RLS 表时使用。 */
export function cloudIdentityUid(): string {
  return readIdentity()?.uid || ''
}

/** 本机记录里这份云身份对应的学号，用于账号切换时作废旧身份。 */
export function cloudIdentityStudentId(): string {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null') as { studentId?: unknown } | null
    return raw && typeof raw.studentId === 'string' ? raw.studentId : ''
  } catch {
    return ''
  }
}

export function clearCloudIdentity(): void {
  try { localStorage.removeItem(KEY) } catch { /* 无痕模式等场景忽略 */ }
}