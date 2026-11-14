/**
 * 本机校园密码封装。新记录使用 AES-256-GCM，修改过的密文会被拒绝。
 * Android 密钥在启动时由系统 Keystore 解封，浏览器端只能把密钥留在浏览器存储。
 * 旧 v2 记录仍可读取；启动时尽可能迁移到 v3，失败则保留原记录。
 */

import { Capacitor, registerPlugin } from '@capacitor/core'
import { gcm } from '@noble/ciphers/aes.js'

const LS_KEY = 'sc.localSecret.v1'
const LS_KEY_V3 = 'ohu.localAesKey.v3'
const KEY_LEN = 32
const NONCE_LEN = 16
const GCM_NONCE_LEN = 12
/** 明文前插一个魔法字节：解开后对不上就说明密钥变了，直接当没存过，绝不返回乱码 */
const MAGIC = 0xa5

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function lsSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* 存储不可用时无需处理 */
  }
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin)
}

function b64ToBytes(text: string): Uint8Array | null {
  try {
    const raw = atob(text)
    const out = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

let cachedKey: Uint8Array | null = null
let activeKey: Uint8Array | null = null
const nativeKey = registerPlugin<{ getKey(): Promise<{ key: string }> }>('CredentialKey')

/** 启动 React 之前装入本机密钥；安卓读取失败时绝不退回浏览器密钥。 */
export async function initCredentialProtection(): Promise<boolean> {
  if (activeKey) return true
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    try {
      const bytes = b64ToBytes((await nativeKey.getKey()).key)
      if (!bytes || bytes.length !== KEY_LEN) return false
      activeKey = bytes
    } catch { return false }
  } else {
    const stored = lsGet(LS_KEY_V3)
    const existing = stored ? b64ToBytes(stored) : null
    if (stored && (!existing || existing.length !== KEY_LEN)) return false
    if (existing && existing.length === KEY_LEN) activeKey = existing
    else {
      try {
        const fresh = crypto.getRandomValues(new Uint8Array(KEY_LEN))
        if (!lsSet(LS_KEY_V3, bytesToB64(fresh))) return false
        activeKey = fresh
      } catch { return false }
    }
  }
  migrateLegacyCredentialRecords()
  return true
}

/** 本机密钥：首次使用时随机生成并落盘，之后复用 */
function localKey(): Uint8Array | null {
  if (cachedKey) return cachedKey
  const stored = lsGet(LS_KEY)
  if (stored) {
    const bytes = b64ToBytes(stored)
    if (bytes && bytes.length === KEY_LEN) {
      cachedKey = bytes
      return cachedKey
    }
    return null
  }
  try {
    const fresh = new Uint8Array(KEY_LEN)
    crypto.getRandomValues(fresh)
    if (!lsSet(LS_KEY, bytesToB64(fresh))) return null
    cachedKey = fresh
    return cachedKey
  } catch {
    return null
  }
}

function xorWithKeystream(data: Uint8Array, key: Uint8Array, nonce: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) {
    // 工作密钥随 nonce 变化，密文再叠一层位置因子，避免同一明文落盘得到同一段密文
    const wk = key[i % key.length]! ^ nonce[i % nonce.length]!
    out[i] = data[i]! ^ wk ^ (i & 0xff)
  }
  return out
}

/** 写入：返回 `v3.<nonce>.<AES-GCM 密文与标签>`，失败返回空串。 */
export function sealSecret(plain: string): string {
  if (!plain) return ''
  const key = activeKey
  if (!key) return ''
  try {
    const nonce = new Uint8Array(GCM_NONCE_LEN)
    crypto.getRandomValues(nonce)
    const encrypted = gcm(key, nonce).encrypt(new TextEncoder().encode(plain))
    return `v3.${bytesToB64(nonce)}.${bytesToB64(encrypted)}`
  } catch {
    return ''
  }
}

/** 读取：格式不符 / 密钥丢失 / 解密失败一律返回空串 */
export function openSecret(blob: string | null | undefined): string {
  if (!blob) return ''
  const parts = String(blob).split('.')
  if (parts.length !== 3) return ''
  if (parts[0] === 'v3') {
    if (!activeKey) return ''
    const nonce = b64ToBytes(parts[1] || '')
    const data = b64ToBytes(parts[2] || '')
    if (!nonce || nonce.length !== GCM_NONCE_LEN || !data || data.length < 17) return ''
    try { return new TextDecoder().decode(gcm(activeKey, nonce).decrypt(data)) }
    catch { return '' }
  }
  if (parts[0] !== 'v2') return ''
  const key = localKey()
  if (!key) return ''
  const nonce = b64ToBytes(parts[1] || '')
  const data = b64ToBytes(parts[2] || '')
  if (!nonce || nonce.length !== NONCE_LEN || !data || data.length < 1) return ''
  try {
    const plain = xorWithKeystream(data, key, nonce)
    if (plain[0] !== MAGIC) return ''
    return new TextDecoder().decode(plain.subarray(1))
  } catch {
    return ''
  }
}

/** 仅迁移已知、按账号隔离的旧记录；任何一条失败都保留原文，供用户重新输入。 */
function migrateLegacyCredentialRecords(): void {
  if (!activeKey) return
  const prefixes = ['campus.credentials.v3:uid:', 'ohu.oneclick.v1:uid:', 'ohu.pocketuni-credentials.v1:uid:']
  const fields = ['passwordBlob', 'vpnPasswordBlob', 'vpnBlob', 'casBlob', 'ticeBlob']
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
    for (const key of keys) {
      if (!key || !prefixes.some(prefix => key.startsWith(prefix))) continue
      try {
        const raw = localStorage.getItem(key)
        if (!raw) continue
        const value: unknown = JSON.parse(raw)
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue
        const record = value as Record<string, unknown>
        let changed = false
        for (const field of fields) {
          const blob = record[field]
          if (typeof blob !== 'string' || !blob.startsWith('v2.')) continue
          const plain = openSecret(blob)
          if (!plain) continue
          const replacement = sealSecret(plain)
          if (!replacement) continue
          record[field] = replacement
          changed = true
        }
        if (changed) localStorage.setItem(key, JSON.stringify(record))
      } catch {
        // 单条损坏或写入失败时不影响其他账号的迁移。
      }
    }
  } catch { /* 无痕模式或存储不可用时保留原数据 */ }
}
