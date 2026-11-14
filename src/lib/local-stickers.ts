import type { LifeRecordPhoto } from './life-records.ts'

export interface LocalSticker extends LifeRecordPhoto {
  owner: string
  savedAt: number
  updatedAt: number
}

export const LOCAL_STICKERS_CHANGED_EVENT = 'ohu-local-stickers-changed'

function openLocalStickers(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ohu-local-stickers', 1)
    let blocked = false
    request.onupgradeneeded = () => {
      const stickers = request.result.createObjectStore('stickers', { keyPath: ['owner', 'id'] })
      stickers.createIndex('owner', 'owner')
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

export async function saveLocalSticker(owner: string, photo: LifeRecordPhoto): Promise<LocalSticker> {
  const snapshot: LifeRecordPhoto = {
    id: photo.id,
    original: photo.original,
    sticker: photo.sticker,
    preset: photo.preset,
    edge: photo.edge,
  }
  const db = await openLocalStickers()
  try {
    const saved = await new Promise<LocalSticker>((resolve, reject) => {
      const transaction = db.transaction('stickers', 'readwrite')
      const store = transaction.objectStore('stickers')
      const request = store.get([owner, snapshot.id])
      let next: LocalSticker
      request.onsuccess = () => {
        const previous = request.result as LocalSticker | undefined
        const now = Date.now()
        next = { ...snapshot, owner, savedAt: previous?.savedAt ?? now, updatedAt: now }
        store.put(next)
      }
      transaction.oncomplete = () => resolve(next)
      transaction.onabort = () => reject(transaction.error ?? new Error('本机贴纸保存失败'))
    })
    window.dispatchEvent(new CustomEvent(LOCAL_STICKERS_CHANGED_EVENT, { detail: { owner } }))
    return saved
  } finally { db.close() }
}

export async function listLocalStickers(owner: string): Promise<LocalSticker[]> {
  const db = await openLocalStickers()
  try {
    const rows = await new Promise<LocalSticker[]>((resolve, reject) => {
      const transaction = db.transaction('stickers', 'readonly')
      const request = transaction.objectStore('stickers').index('owner').getAll(owner)
      transaction.oncomplete = () => resolve(request.result as LocalSticker[])
      transaction.onabort = () => reject(transaction.error ?? new Error('本机贴纸读取失败'))
    })
    return rows.sort((a, b) => b.updatedAt - a.updatedAt)
  } finally { db.close() }
}

export async function deleteLocalSticker(owner: string, id: string): Promise<void> {
  const db = await openLocalStickers()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('stickers', 'readwrite')
      transaction.objectStore('stickers').delete([owner, id])
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error ?? new Error('本机贴纸删除失败'))
    })
    window.dispatchEvent(new CustomEvent(LOCAL_STICKERS_CHANGED_EVENT, { detail: { owner } }))
  } finally { db.close() }
}
