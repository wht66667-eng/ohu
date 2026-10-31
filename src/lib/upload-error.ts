/**
 * 图片上传错误的统一文案。
 *
 * 单独成一个零依赖模块：market.ts / account.ts / chat-image.ts 都要用，
 * 而 tools/*.test.mjs 加载这些模块时只 mock 了 ./cb。放在 chat-image.ts 里的话，
 * market.ts 会经它间接引入 ./cb，测试隔离就没了。所以这里不 import 任何东西。
 */
/**
 * SDK 错误形态不统一（字符串 / {message} / {msg} / StorageApiError），先抽原始文案。
 */
function msgOf(e: unknown, fallback: string): string {
  if (typeof e === 'string' && e) return e
  if (e && typeof e === 'object') {
    const anyE = e as { message?: unknown; msg?: unknown }
    if (typeof anyE.message === 'string' && anyE.message) return anyE.message
    if (typeof anyE.msg === 'string' && anyE.msg) return anyE.msg
  }
  return fallback
}

/**
 * 把存储错误翻成人看得懂的话。
 *
 * 之前所有失败都被压成一句「图片上传失败，请稍后重试」，排查时完全看不出原因。
 * 实测（2026-10-10）最常见的是 **403 STORAGE_ACCESS_DENIED**：
 * images 桶的 RLS 只有 `authenticated_upload`（INSERT 限 authenticated 角色），
 * 而项目在「无会话」时会静默走 `signInAnonymously()` 当游客——游客发图必然 403。
 * 这一类单独给「请重新登录」，别让用户对着「稍后重试」干等。
 */
export function uploadErrorText(e: unknown, fallback: string): string {
  const anyE = (e || {}) as { status?: unknown; statusCode?: unknown; code?: unknown }
  const code = String(anyE.statusCode ?? anyE.code ?? '').toUpperCase()
  const status = Number(anyE.status ?? 0)
  if (status === 403 || code.includes('ACCESS_DENIED') || code.includes('FORBIDDEN')) {
    return '没有上传权限：请先登录（游客不能发图）'
  }
  if (status === 401 || code.includes('UNAUTHORIZED')) {
    return '登录状态已失效，请重新登录后再试'
  }
  if (status === 413 || code.includes('TOO_LARGE') || code.includes('LIMIT')) {
    return '图片太大了，请压缩到 2MB 以内'
  }
  return msgOf(e, fallback)
}

/**
 * 上传前的会话守卫：把注定失败的请求挡在本地，别让用户白等一次网络往返。
 *
 * images 桶所在的 storage.objects，其 INSERT 策略要求 auth.role() = 'authenticated'，
 * 游客和未登录一律被 RLS 拒绝。而 App 会话丢失时会静默 signInAnonymously()
 * （见 auth.tsx 的 bootstrap），界面看着一切正常，唯独发图必失败。
 *
 * @param getCurrentUser 取登录态的 getter。用 getter 是为了保持本模块零依赖
 *   （tools/*.test.mjs 的 load() 有依赖白名单），取值失败返回 null，交给服务端裁决。
 * @returns 阻断原因文案；null 表示可以上传。
 */
export function uploadGuardError(getCurrentUser: () => unknown): string | null {
  let u: unknown
  try {
    u = getCurrentUser?.()
  } catch {
    return null // 取不到登录态时不自作主张拦人
  }
  if (!u) return '登录状态已失效，请重新登录后再发图'
  const anyU = u as { isAnonymous?: unknown; is_anonymous?: unknown }
  if (anyU.isAnonymous || anyU.is_anonymous) {
    return '当前是游客状态，不能发图。请退出后重新登录再试'
  }
  return null
}
