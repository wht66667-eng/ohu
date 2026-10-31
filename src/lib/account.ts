/**
 * 账号资料：头像上传
 *
 * 头像文件与其它 UGC 图片共用 `images` 桶（同一条公开读链路），
 * 上传只负责拿到公开 URL，写入账号资料由 `AuthProvider` 统一处理。
 */
import { cbAuth, cbStorage } from './cb'
import { uploadErrorText, uploadGuardError } from './upload-error'

const ALLOWED_IMG = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp'])

/** 头像体积上限：2MB（桶对单文件有硬限制，前端先拦一道，避免白等一次上传） */
const MAX_AVATAR_BYTES = 2 * 1024 * 1024

export interface UploadRes {
  url: string | null
  error: string | null
}

export async function uploadAvatar(file: File): Promise<UploadRes> {
  if (!file.type.startsWith('image/')) return { url: null, error: '请选择图片文件' }
  if (file.size > MAX_AVATAR_BYTES) return { url: null, error: '头像不能超过 2MB' }
  // 游客 / 未登录在服务端必被拒（Storage RLS 要求 authenticated），先本地拦一道
  const guard = uploadGuardError(() => (cbAuth() as { currentUser?: unknown })?.currentUser)
  if (guard) {
    console.warn('[头像上传被守卫拦截]', guard)
    return { url: null, error: guard }
  }
  try {
    const bucket = cbStorage().from('images')
    const raw = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const ext = ALLOWED_IMG.has(raw) ? raw : 'jpg'
    const path = `avatars/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`
    const res = await bucket.upload(path, file)
    if (res.error) {
      console.warn('[头像上传失败]', path, res.error)
      return { url: null, error: uploadErrorText(res.error, '头像上传失败，请稍后重试') }
    }
    const pub = bucket.getPublicUrl(path)
    const url = pub?.data?.publicUrl
    if (!url) return { url: null, error: '头像上传失败，请稍后重试' }
    return { url, error: null }
  } catch (e) {
    console.warn('[头像上传异常]', e)
    return { url: null, error: uploadErrorText(e, '头像上传失败，请稍后重试') }
  }
}
