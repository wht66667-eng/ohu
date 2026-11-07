import { Capacitor } from '@capacitor/core'

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
