/** A QR shared outside the app must resolve to the public web route, never its local WebView. */
export type MeetShareLink = { url: string | null; reason: string }

const CODE = /^[A-Za-z0-9_-]{6,96}$/

/** One invitation keeps the same look when reopened, while different codes vary. */
export function meetInviteTheme(url: string): number {
  let hash = 2166136261
  for (const character of url) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return (hash >>> 0) % 4
}

function publicOrigin(raw: string): string | null {
  try {
    const value = new URL(raw)
    if (value.protocol !== 'https:' || value.username || value.password || value.search || value.hash || value.pathname !== '/') return null
    const hostname = value.hostname.toLowerCase().replace(/\.$/, '')
    if (!hostname.includes('.') || hostname.includes(':') || /(?:^|\.)(localhost|local|lan|home|internal|test|invalid)$/.test(hostname)) return null
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      const [a, b] = hostname.split('.').map(Number)
      if (a === 0 || a === 10 || a === 127 || a! >= 224 || a === 169 && b === 254
        || a === 172 && b! >= 16 && b! <= 31 || a === 192 && (b === 168 || b === 0)
        || a === 100 && b! >= 64 && b! <= 127 || a === 198 && (b === 18 || b === 19)) return null
    }
    return value.origin
  } catch {
    return null
  }
}

export function isPublicMeetUrl(raw: string): boolean {
  try {
    const value = new URL(raw)
    const origin = publicOrigin(value.origin)
    return !!origin && !value.username && !value.password && !value.hash && !value.search
      && /^\/meet\/[A-Za-z0-9_-]{6,96}$/.test(value.pathname)
  } catch {
    return false
  }
}

export function buildMeetShareUrl(
  code: string,
  currentOrigin = typeof window === 'undefined' ? '' : window.location.origin,
  configuredOrigin = import.meta.env.VITE_PUBLIC_SHARE_ORIGIN || '',
): MeetShareLink {
  if (!CODE.test(code)) return { url: null, reason: '邀请标识不完整，请重新打开活动后再分享。' }
  const configured = configuredOrigin.trim()
  const origin = publicOrigin(configured || currentOrigin)
  if (!origin) return {
    url: null,
    reason: configured
      ? '分享地址需要使用可公开访问的 HTTPS 站点，请检查分享地址配置。'
      : '当前是本地预览，手机无法通过微信访问本机地址。公开分享页上线后会自动生成二维码。',
  }
  return { url: `${origin}/meet/${encodeURIComponent(code)}`, reason: '' }
}
