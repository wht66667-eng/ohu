export type JournalKind = 'journal' | 'diary'

export interface JournalPhoto {
  id: string
  file: File
}

export interface JournalEntry {
  owner: string
  id: string
  day: string
  kind: JournalKind
  title: string
  body: string
  mood: string
  photos: JournalPhoto[]
  pinned: boolean
  updatedAt: number
  createdAt?: number
  timeZone?: string
  draftOf?: string
}

type StoredJournalEntry = Omit<JournalEntry, 'kind' | 'title' | 'photos' | 'pinned'> &
  Partial<Pick<JournalEntry, 'kind' | 'title' | 'photos' | 'pinned'>> & { photo?: File }

export const MAX_JOURNAL_PHOTOS = 9

export function journalId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
}

function readEntry(entry: StoredJournalEntry): JournalEntry {
  const { photo, ...data } = entry
  return {
    ...data,
    kind: data.kind === 'diary' ? 'diary' : 'journal',
    title: data.title ?? '',
    photos: Array.isArray(data.photos) ? data.photos : photo ? [{ id: data.id + '-photo', file: photo }] : [],
    pinned: data.pinned === true,
  }
}

export function sortJournal(entries: JournalEntry[]) {
  return [...entries].sort((a, b) => Number(b.pinned) - Number(a.pinned) ||
    b.day.localeCompare(a.day) || b.updatedAt - a.updatedAt)
}

function openJournal(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ohu-campus-journal', 1)
    let blocked = false
    request.onupgradeneeded = () => {
      const entries = request.result.createObjectStore('entries', { keyPath: ['owner', 'id'] })
      entries.createIndex('owner', 'owner')
    }
    request.onsuccess = () => {
      if (blocked) request.result.close()
      else resolve(request.result)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => {
      blocked = true
      reject(new Error('请关闭其他哦狐页面后重试'))
    }
  })
}

async function journalRequest<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openJournal()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('entries', mode)
      const request = operation(transaction.objectStore('entries'))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error ?? request.error)
    })
  } finally { db.close() }
}


type Vault = { owner: string; id: string; type: 'vault'; salt: Uint8Array<ArrayBuffer>; iv: Uint8Array<ArrayBuffer>; publicKey: JsonWebKey; privateData: ArrayBuffer }
type Sealed = { owner: string; id: string; type: 'sealed'; iv: Uint8Array<ArrayBuffer>; wrapped: ArrayBuffer; data: ArrayBuffer }
type Row = StoredJournalEntry | Vault | Sealed
const vaultId = '__diary_vault__'
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const rsa = { name: 'RSA-OAEP', hash: 'SHA-256' }
const ivBytes = () => crypto.getRandomValues(new Uint8Array(12))
const isVault = (row: Row): row is Vault => 'type' in row && row.type === 'vault'
const isSealed = (row: Row): row is Sealed => 'type' in row && row.type === 'sealed'

async function passwordKey(password: string, salt: Uint8Array<ArrayBuffer>) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600_000 }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

function context(owner: string, id: string, purpose: string) {
  return encoder.encode(JSON.stringify([1, owner, id, purpose]))
}

function encodePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.readAsDataURL(file)
  })
}

async function seal(entry: JournalEntry, vault: Vault): Promise<Sealed> {
  const publicKey = await crypto.subtle.importKey('jwk', vault.publicKey, rsa, false, ['wrapKey'])
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt'])
  const iv = ivBytes()
  const photos = await Promise.all(entry.photos.map(async ({ id, file }) => ({
    id, name: file.name, mime: file.type, bytes: await encodePhoto(file),
  })))
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: context(entry.owner, entry.id, 'entry') },
    key, encoder.encode(JSON.stringify({ ...entry, photos })))
  const wrapped = await crypto.subtle.wrapKey('raw', key, publicKey, 'RSA-OAEP')
  return { owner: entry.owner, id: entry.id, type: 'sealed', iv, wrapped, data }
}

async function unseal(row: Sealed, privateKey: CryptoKey): Promise<JournalEntry> {
  const key = await crypto.subtle.unwrapKey('raw', row.wrapped, privateKey, 'RSA-OAEP', 'AES-GCM', false, ['decrypt'])
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: row.iv, additionalData: context(row.owner, row.id, 'entry') }, key, row.data)
  const entry = JSON.parse(decoder.decode(clear)) as Omit<JournalEntry, 'photos'> & {
    photos: { id: string; name: string; mime: string; bytes: string }[]
  }
  return { ...entry, photos: entry.photos.map(photo => ({
    id: photo.id, file: new File([Uint8Array.from(atob(photo.bytes), c => c.charCodeAt(0))], photo.name, { type: photo.mime }),
  })) }
}

async function journalRows(owner: string) {
  return await journalRequest('readonly', store => store.index('owner').getAll(owner)) as Row[]
}

export async function journalVaultExists(owner: string) {
  return !!await journalRequest('readonly', store => store.getKey([owner, vaultId]))
}

async function decryptPrivateKey(vault: Vault, password: string) {
  try {
    const key = await passwordKey(password, vault.salt)
    return await crypto.subtle.decrypt({
      name: 'AES-GCM', iv: vault.iv, additionalData: context(vault.owner, vaultId, 'private-key'),
    }, key, vault.privateData)
  } catch { throw new Error('密码不正确，或日记锁数据无法读取。') }
}

export async function unlockJournal(owner: string, password: string) {
  const vault = await journalRequest('readonly', store => store.get([owner, vaultId])) as Vault | undefined
  if (!vault) throw new Error('日记锁状态已变化，请重新打开手账。')
  return crypto.subtle.importKey('pkcs8', await decryptPrivateKey(vault, password), rsa, false, ['unwrapKey'])
}

function sameIv(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((value, i) => value === right[i])
}

export async function updateJournalVault(owner: string, password: string, newPassword?: string) {
  const rows = await journalRows(owner)
  const vault = rows.find(isVault)
  if (!vault) throw new Error('日记锁状态已变化，请重新打开手账。')
  const raw = await decryptPrivateKey(vault, password)
  const sealed = rows.filter(isSealed)
  const clear: JournalEntry[] = []
  let next: Vault | undefined
  if (newPassword !== undefined) {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const iv = ivBytes()
    const key = await passwordKey(newPassword, salt)
    const privateData = await crypto.subtle.encrypt({
      name: 'AES-GCM', iv, additionalData: context(owner, vaultId, 'private-key'),
    }, key, raw)
    next = { ...vault, salt, iv, privateData }
  } else {
    const key = await crypto.subtle.importKey('pkcs8', raw, rsa, false, ['unwrapKey'])
    for (const row of sealed) clear.push(await unseal(row, key))
  }
  const db = await openJournal()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('entries', 'readwrite')
      const store = tx.objectStore('entries')
      const check = store.index('owner').getAll(owner)
      check.onsuccess = () => {
        const latest = (check.result as Row[])
        const activeVault = latest.find(isVault)
        const activeRows = latest.filter(isSealed)
        if (!activeVault || !sameIv(vault.iv, activeVault.iv) || (!next &&
          (activeRows.length !== sealed.length || activeRows.some((row, i) =>
            row.id !== sealed[i].id || !sameIv(row.iv, sealed[i].iv))))) {
          tx.abort()
          return
        }
        if (next) store.put(next)
        else {
          for (const entry of clear) store.put(entry)
          store.delete([owner, vaultId])
        }
      }
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error ?? new Error('日记刚刚发生变化，请关闭其他手账窗口后重试。'))
    })
  } finally { db.close() }
}

export async function enableJournalVault(owner: string, password: string) {
  const rows = await journalRows(owner)
  if (rows.some(isVault)) throw new Error('日记锁已启用，请重新打开手账。')
  const legacy = rows.filter((row): row is StoredJournalEntry => !isVault(row) && !isSealed(row) && row.kind === 'diary')
  const keys = await crypto.subtle.generateKey({
    ...rsa, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]),
  }, true, ['wrapKey', 'unwrapKey'])
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = ivBytes()
  const key = await passwordKey(password, salt)
  const privateData = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv, additionalData: context(owner, vaultId, 'private-key'),
  }, key, await crypto.subtle.exportKey('pkcs8', keys.privateKey))
  const vault: Vault = { owner, id: vaultId, type: 'vault', salt, iv, publicKey: await crypto.subtle.exportKey('jwk', keys.publicKey), privateData }
  const encrypted: Sealed[] = []
  for (const row of legacy) {
    const secured = await seal(readEntry(row), vault)
    await unseal(secured, keys.privateKey)
    encrypted.push(secured)
  }

  const db = await openJournal()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('entries', 'readwrite')
      const store = tx.objectStore('entries')
      const check = store.index('owner').getAll(owner)
      check.onsuccess = () => {
        const latest = (check.result as Row[]).filter(row => isVault(row) || isSealed(row) || row.kind === 'diary')
        if (latest.length !== legacy.length || latest.some((row, i) =>
          isVault(row) || isSealed(row) || row.id !== legacy[i].id || row.updatedAt !== legacy[i].updatedAt)) {
          tx.abort()
          return
        }
        store.put(vault)
        for (const row of encrypted) store.put(row)
      }
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error ?? new Error('日记刚刚发生变化，请关闭其他手账窗口后重试。'))
    })
  } finally { db.close() }
}

export async function listJournal(owner: string, privateKey?: CryptoKey) {
  const rows = await journalRows(owner)
  const vault = rows.some(isVault)
  const entries = await Promise.all(rows.map(row => {
    if (isVault(row)) return null
    if (isSealed(row)) return privateKey ? unseal(row, privateKey) : null
    return vault && row.kind === 'diary' && !privateKey ? null : readEntry(row)
  }))
  return sortJournal(entries.filter(entry => entry !== null))
}

export async function saveJournal(entry: JournalEntry, removeDraft?: string) {
  const vault = await journalRequest('readonly', store => store.get([entry.owner, vaultId])) as Vault | undefined
  const row = entry.kind === 'diary' && vault ? await seal(entry, vault) : entry
  const db = await openJournal()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('entries', 'readwrite')
      const store = tx.objectStore('entries')
      const check = store.get([entry.owner, vaultId])
      check.onsuccess = () => {
        const latest = check.result as Vault | undefined
        if (entry.kind === 'diary' && (!!latest !== !!vault || (latest && vault && latest.publicKey.n !== vault.publicKey.n))) {
          tx.abort()
          return
        }
        store.put(row)
        if (removeDraft) store.delete([entry.owner, removeDraft])
      }
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error ?? new Error('日记锁状态已变化，请重试。'))
    })
  } finally { db.close() }
}

export function deleteJournal(owner: string, id: string) {
  return journalRequest('readwrite', store => store.delete([owner, id]))
}
