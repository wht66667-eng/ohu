export type UserServiceLink = { id: string; title: string; url: string }

export const USER_SERVICE_LINKS_EVENT = 'ohu-user-service-links-change'
const PREFIX = 'ohu.user-service-links.v1:'
const MAX_LINKS = 12

export const userServiceLinksKey = (uid: string) => `${PREFIX}${encodeURIComponent(uid || 'guest')}`

export function normalizeUserServiceUrl(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || url.username || url.password) return null
    const host = url.hostname.toLowerCase()
    if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return null
    return url.href
  } catch { return null }
}

export function readUserServiceLinks(uid: string): UserServiceLink[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(userServiceLinksKey(uid)) || '[]')
    if (!Array.isArray(value)) return []
    return value.flatMap((item): UserServiceLink[] => {
      if (!item || typeof item !== 'object') return []
      const row = item as Partial<UserServiceLink>
      if (typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.url !== 'string') return []
      const title = row.title.trim().slice(0, 24)
      const url = normalizeUserServiceUrl(row.url)
      return title && url ? [{ id: row.id.slice(0, 80), title, url }] : []
    }).slice(0, MAX_LINKS)
  } catch { return [] }
}

export function addUserServiceLink(uid: string, title: string, rawUrl: string): UserServiceLink[] {
  const cleanTitle = title.trim().slice(0, 24)
  const url = normalizeUserServiceUrl(rawUrl)
  if (!cleanTitle) throw new Error('请填写入口名称')
  if (!url) throw new Error('请填写有效的 HTTPS 网页地址')
  const current = readUserServiceLinks(uid)
  if (current.length >= MAX_LINKS) throw new Error(`最多添加 ${MAX_LINKS} 个入口`)
  if (current.some((item) => item.url === url)) throw new Error('这个网页入口已经添加过了')
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const next = [...current, { id, title: cleanTitle, url }]
  localStorage.setItem(userServiceLinksKey(uid), JSON.stringify(next))
  window.dispatchEvent(new CustomEvent(USER_SERVICE_LINKS_EVENT, { detail: uid || 'guest' }))
  return next
}

export function removeUserServiceLink(uid: string, id: string): UserServiceLink[] {
  const next = readUserServiceLinks(uid).filter((item) => item.id !== id)
  localStorage.setItem(userServiceLinksKey(uid), JSON.stringify(next))
  window.dispatchEvent(new CustomEvent(USER_SERVICE_LINKS_EVENT, { detail: uid || 'guest' }))
  return next
}
