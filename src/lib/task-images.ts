import { uploadUgcImage } from './ugc-image'

export const TASK_IMAGE_LIMIT = 3

/** Older text-only tasks may omit images; never render arbitrary URL schemes. */
export function taskImageUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const urls: string[] = []
  for (const value of raw) {
    if (typeof value !== 'string') continue
    const text = value.trim()
    if (!text || text.length > 1024 || urls.includes(text)) continue
    try {
      const url = new URL(text)
      if (url.protocol !== 'https:' || url.username || url.password) continue
      urls.push(text)
    } catch { continue }
    if (urls.length === TASK_IMAGE_LIMIT) break
  }
  return urls
}

/** The caller owns cancellation: a finished upload must still belong to this form/account. */
export async function uploadTaskImage(file: File, uid: string, stillCurrent: () => boolean = () => true): Promise<{ url: string | null; error: string | null }> {
  // 空白 uid 也要拦：否则会往桶里写出 tasks/   / 这种带空格的目录
  const owner = String(uid || '').trim()
  if (!owner) return { url: null, error: '请先登录后添加图片' }
  if (!stillCurrent()) return { url: null, error: null }
  try {
    const result = await uploadUgcImage(file, owner, 'tasks')
    if (!stillCurrent()) return { url: null, error: null }
    if (result.error) return { url: null, error: result.error }
    const url = taskImageUrls([result.url])[0]
    return url ? { url, error: null } : { url: null, error: '图片上传失败，请重试' }
  } catch {
    return stillCurrent() ? { url: null, error: '图片上传失败，请重试' } : { url: null, error: null }
  }
}
