/**
 * 本机敏感串的存储封装（教务密码 / WebVPN 密码）；本文件不包含实际凭据。
 *
 * 以前 schedule-credentials.ts 和 campus-account.ts 各写了一份「硬编码 SALT + 可逆 XOR」，
 * SALT 是打进包里的常量，拿到包加一条 localStorage 记录就能离线还原明文，等于没加密。
 * 这里收敛成一处：密钥每台机器随机生成（crypto.getRandomValues，32 字节），
 * 每次写入随机 16 字节 nonce（同一密码两次落盘密文不同），
 * localStorage 读写统一 try/catch 兜住（无痕模式 / 存储被禁会直接抛）。
 *
 * 需要说明的是：密钥和密文都在同一个 localStorage 里，能读存储的人理论上仍能还原，
 * 这是纯前端的固有上限，真要防护只能不存密码。本模块只是抬高门槛 ——
 * 光拿到某条记录、或光看源码，都解不开。调用方仍应保持「默认只记学号」。
 */

const LS_KEY = 'sc.localSecret.v1'
const KEY_LEN = 32
const NONCE_LEN = 16
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

/** 写入：返回 `v2.<nonce>.<密文>`，失败返回空串（调用方据此决定是否提示用户） */
export function sealSecret(plain: string): string {
  if (!plain) return ''
  const key = localKey()
  if (!key) return ''
  try {
    const nonce = new Uint8Array(NONCE_LEN)
    crypto.getRandomValues(nonce)
    const text = new TextEncoder().encode(plain)
    const data = new Uint8Array(text.length + 1)
    data[0] = MAGIC
    data.set(text, 1)
    return `v2.${bytesToB64(nonce)}.${bytesToB64(xorWithKeystream(data, key, nonce))}`
  } catch {
    return ''
  }
}

/** 读取：格式不符 / 密钥丢失 / 解密失败一律返回空串 */
export function openSecret(blob: string | null | undefined): string {
  if (!blob) return ''
  const parts = String(blob).split('.')
  if (parts.length !== 3 || parts[0] !== 'v2') return ''
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
