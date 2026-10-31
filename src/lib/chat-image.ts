/**
 * 聊天图片上传：私信里发的图片统一存 `images` 桶的 `chats/{uid}/` 目录。
 *
 * 与 shop-image.ts / pet-image.ts 同构（同一套白名单、2MB 上限与错误文案收敛），
 * 差异只有分目录：按发送者 uid 归档，便于日后按人清理与审计。
 * 之所以不走 IM 原生图片消息，是为了不占 IM 的存储与流量额度——IM 只转发 URL。
 * 广场大厅发图复用同一套校验，只是目录换成 `plaza/`（见 uploadPlazaImage）。
 */
import { cbAuth, cbStorage } from './cb'

/** 扩展名与 MIME 命中其一即放行（部分 WebView 给出的 file.type 为空） */
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp'])
const ALLOWED_TYPE = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

/** 与桶的单文件上限一致（2MB）：前端先拦一道，避免白等一次注定失败的上传 */
const MAX_BYTES = 2 * 1024 * 1024

export interface ChatImageRes {
  url: string | null
  error: string | null
}

import { uploadErrorText, uploadGuardError } from './upload-error'
import { compressImage } from './image-compress'

export { uploadErrorText }

/** 兜底扩展名：file.type 缺失时按 MIME 推断，再不行按 jpg */
function extOf(file: File, raw: string): string {
  if (ALLOWED_EXT.has(raw)) return raw
  const byType: Record<string, string> = {
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/jpeg': 'jpg',
  }
  return byType[file.type] || 'jpg'
}

/** 上传一张图片到 images 桶的指定路径，返回公开 URL（调用方拿它发消息） */
export async function uploadChatImage(file: File, uid: string): Promise<ChatImageRes> {
  return uploadToBucket(file, `chats/${uid || 'guest'}/`)
}

/** 广场大厅发图：目录换成 plaza/{uid}/，与私信分开归档 */
export async function uploadPlazaImage(file: File, uid: string): Promise<ChatImageRes> {
  return uploadToBucket(file, `plaza/${uid || 'guest'}/`)
}

/**
 * 统一的图片上传底座：把文件传到 images 桶的指定目录，返回公开 URL。
 * 私信 / 广场走上面两个包装；任务图片走 src/lib/ugc-image.ts 的同名包装。
 */
export async function uploadToBucket(file: File, dir: string): Promise<ChatImageRes> {
  const raw = (file.name.split('.').pop() || '').toLowerCase()
  /**
   * 部分 Android ROM 的相册回传给的 File 既没有扩展名、type 也是空字符串，
   * 严格按白名单卡会把「明明是张正常照片」直接拒掉——同样表现为选了图发不出。
   * 选择器本身已用 accept="image/*" 限定，所以 MIME 明确是 image/* 就放行。
   */
  const isImageMime = file.type.startsWith('image/')
  if (!ALLOWED_EXT.has(raw) && !ALLOWED_TYPE.has(file.type) && !isImageMime) {
    return { url: null, error: '请选择 JPG / PNG / WebP / GIF 格式的图片' }
  }
  /**
   * 手机相册原图 3–8MB 是常态，直接卡 2MB 会变成「选了图、点了发送，却永远发不出去」，
   * 而且一次网络请求都没发出去——用户看到的只是「没图出现」。
   * 所以先在本地降采样重编码一次；压完仍超标才算真的太大（GIF 为保住动画不压）。
   */
  let out = file
  if (out.size > MAX_BYTES) {
    const r = await compressImage(out, MAX_BYTES)
    out = r.file
    if (r.compressed) {
      console.log(
        '[图片已压缩]',
        (file.size / 1024 / 1024).toFixed(2), 'MB ->', (out.size / 1024 / 1024).toFixed(2), 'MB',
      )
    }
  }
  const rawOut = (out.name.split('.').pop() || '').toLowerCase()
  if (out.size > MAX_BYTES) {
    return { url: null, error: '图片太大了，换一张小一点的试试' }
  }
  // 游客 / 未登录在服务端必被拒（Storage RLS 要求 authenticated），先本地拦一道
  const guard = uploadGuardError(() => (cbAuth() as { currentUser?: unknown })?.currentUser)
  if (guard) {
    console.warn('[上传被守卫拦截]', dir, guard)
    return { url: null, error: guard }
  }
  try {
    const bucket = cbStorage().from('images')
    const path = `${dir}${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extOf(out, rawOut)}`
    const res = await bucket.upload(path, out)
    if (res.error) {
      console.warn('[上传失败]', path, res.error)
      return { url: null, error: uploadErrorText(res.error, '图片上传失败，请稍后重试') }
    }
    const pub = bucket.getPublicUrl(path)
    const url = pub?.data?.publicUrl
    if (!url) return { url: null, error: '图片上传失败，请稍后重试' }
    return { url, error: null }
  } catch (e) {
    console.warn('[上传异常]', e)
    return { url: null, error: uploadErrorText(e, '图片上传失败，请稍后重试') }
  }
}
