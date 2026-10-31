import { compressImage } from './image-compress'

export const MAX_PIN_PHOTOS = 3
const MAX_BYTES = 1024 * 1024
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/bmp'])
export async function preparePinPhotos(files: File[]): Promise<File[]> {
  if (files.length > MAX_PIN_PHOTOS) throw new Error('每个地点最多添加 3 张照片')
  const result: File[] = []
  for (const file of files) {
    if (!PHOTO_TYPES.has(file.type)) throw new Error('请选择 JPG、PNG、WebP 或手机相册中的照片')
    const { file: photo } = await compressImage(file, MAX_BYTES)
    if (!photo.size || photo.size > MAX_BYTES) throw new Error('照片压缩后仍然太大，请换一张小一些的照片')
    result.push(photo)
  }
  return result
}
function openPhotos(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ohhu-campus-map-photos-v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('photos')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('无法打开本机照片存储，请检查设备存储空间'))
  })
}
const key = (uid: string, pinId: number) => `${encodeURIComponent(uid)}:${pinId}`
export async function savePinPhotos(uid: string, pinId: number, files: File[]): Promise<void> {
  if (!uid) throw new Error('请先登录')
  if (!files.length) return
  const db = await openPhotos()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('photos', 'readwrite')
      tx.objectStore('photos').put(files.map(f => ({ blob: f, name: f.name, type: f.type })), key(uid, pinId))
      tx.oncomplete = () => resolve()
      tx.onerror = tx.onabort = () => reject(new Error('照片保存失败，请检查设备剩余空间'))
    })
  } finally { db.close() }
}
export async function readPinPhotos(uid: string, pinId: number): Promise<File[]> {
  if (!uid) return []
  const db = await openPhotos()
  try {
    return await new Promise<File[]>((resolve, reject) => {
      const request = db.transaction('photos').objectStore('photos').get(key(uid, pinId))
      request.onsuccess = () => resolve((request.result || []).map((x: {blob: Blob; name: string; type: string}) => new File([x.blob], x.name, { type: x.type })))
      request.onerror = () => reject(new Error('本机照片读取失败，请稍后重试'))
    })
  } finally { db.close() }
}
