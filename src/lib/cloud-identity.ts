import { cbAuth } from './cb'
import { API_BASE } from './gateway'

const KEY = 'ohu.cloud-identity.v1'

/** 用学号直接换 CloudBase 自定义登录 ticket；不校验 VPN 密码。 */
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

export function hasCloudIdentity(): boolean {
  try { return !!localStorage.getItem(KEY) } catch { return false }
}

/** 当前 CloudBase 自定义登录 uid（student_xxx），写入 RLS 表时使用。 */
export function cloudIdentityUid(): string {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null') as { uid?: unknown } | null
    return raw && typeof raw.uid === 'string' ? raw.uid : ''
  } catch {
    return ''
  }
}