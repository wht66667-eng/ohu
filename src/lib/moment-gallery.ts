import { Capacitor } from '@capacitor/core'
import type { Photo } from '@capacitor/camera'

const CAMERA_PENDING_KEY = 'ohu.campus-camera.pending'
const MAX_RESTORE_AGE = 15 * 60 * 1000
let restored: { owner: string; file: File } | null = null

export function takeRestoredCampusPhoto(owner: string) {
  const result = restored?.owner === owner ? restored.file : null
  restored = null
  return result
}

async function cameraFile(photo: Pick<Photo, 'webPath' | 'format'>) {
  if (!photo.webPath) throw new Error('未取得照片')
  const response = await fetch(photo.webPath)
  if (!response.ok) throw new Error('无法读取照片')
  const blob = await response.blob()
  return new File([blob], 'campus-photo.' + photo.format, { type: blob.type || 'image/' + photo.format })
}

export async function listenForCampusCameraRestore(owner: string, onRestore: () => void, isCurrent: () => boolean) {
  if (!Capacitor.isNativePlatform()) return undefined
  const { App } = await import('@capacitor/app')
  if (!isCurrent()) return undefined
  return App.addListener('appRestoredResult', event => {
    if (!isCurrent() || event.pluginId !== 'Camera' || event.methodName !== 'getPhoto') return
    let pending: { owner: string; time: number }
    try {
      const value = localStorage.getItem(CAMERA_PENDING_KEY)
      localStorage.removeItem(CAMERA_PENDING_KEY)
      if (!value) return
      pending = JSON.parse(value)
    } catch { return }
    if (!event.success || pending?.owner !== owner || !Number.isFinite(pending.time) || Date.now() - pending.time > MAX_RESTORE_AGE || Date.now() < pending.time) return
    void cameraFile(event.data).then(file => {
      if (isCurrent()) { restored = { owner, file }; onRestore() }
    }).catch(() => {})
  })
}

/** 仅请求用户选中的照片。旧原生包没有相册插件时返回null，由网页文件选择接管。 */
export async function pickMomentGallery(limit: number): Promise<File[] | null> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('Camera')) return null
  const { Camera } = await import('@capacitor/camera')
  let selected
  try { selected = await Camera.pickImages({ limit: Math.max(1, Math.min(9, limit)), quality: 95, width: 1600, height: 1600, correctOrientation: true }) }
  catch (reason) {
    const message = String((reason as { message?: string })?.message || '')
    if (/cancel|取消|no images/i.test(message)) return []
    throw new Error('无法打开系统相册，请检查相册授权，或使用“从文件选图”。')
  }
  const files: File[] = []
  for (const [index, photo] of selected.photos.slice(0, limit).entries()) {
    if (!photo.webPath) throw new Error('相册未返回可读取的图片，请重新选择。')
    const response = await fetch(photo.webPath)
    if (!response.ok) throw new Error('读取所选照片失败，请重试。')
    const blob = await response.blob()
    files.push(new File([blob], `gallery-${index}.${photo.format || 'jpeg'}`, { type: blob.type || `image/${photo.format || 'jpeg'}` }))
  }
  return files
}

/** 系统拍照通过原生插件完成，旧安装包与网页使用文件控件。 */
export async function captureMomentPhoto(owner: string, fallback: () => void): Promise<File | null> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('Camera')) {
    fallback()
    return null
  }
  const { Camera, CameraSource, CameraResultType } = await import('@capacitor/camera')
  const marker = JSON.stringify({ owner, time: Date.now() })
  try { localStorage.setItem(CAMERA_PENDING_KEY, marker) } catch { /* 当前会话仍可正常拍摄 */ }
  try {
    const photo = await Camera.getPhoto({ source: CameraSource.Camera, resultType: CameraResultType.Uri, quality: 95, width: 1600, height: 1600, correctOrientation: true, saveToGallery: false })
    return await cameraFile(photo)
  } catch (reason) {
    const message = String((reason as { message?: string })?.message || '')
    if (/cancel|取消/i.test(message)) return null
    throw new Error('无法完成拍照。请检查相机授权，或从相册选图。')
  } finally {
    try {
      if (localStorage.getItem(CAMERA_PENDING_KEY) === marker) localStorage.removeItem(CAMERA_PENDING_KEY)
    } catch { /* 不影响已返回的图片 */ }
  }
}
