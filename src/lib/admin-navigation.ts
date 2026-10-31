/** The browser workspace and the management APK share business pages and permissions. */
export type AdminNavigationIcon = 'content' | 'news' | 'reports' | 'members' | 'messages' | 'settings'

export interface AdminNavigationItem {
  path: string
  label: string
  description: string
  icon: AdminNavigationIcon
  group: 'operations' | 'account'
}

export const ADMIN_NAVIGATION: readonly AdminNavigationItem[] = [
  { path: '/admin/content', label: '内容管理', description: '闲置、评论、任务与广场', icon: 'content', group: 'operations' },
  { path: '/admin/news', label: '校园公告', description: '草稿、发布与学生通知', icon: 'news', group: 'operations' },
  { path: '/admin/reports', label: '举报处理', description: '核查举报与违规处置', icon: 'reports', group: 'operations' },
  { path: '/admin/members', label: '成员与权限', description: '管理员名单与用户治理', icon: 'members', group: 'operations' },
  { path: '/admin/messages', label: '管理消息', description: '会话、通知与工作消息', icon: 'messages', group: 'account' },
  { path: '/admin/settings', label: '账号与设置', description: '账号安全与应用偏好', icon: 'settings', group: 'account' },
]

/** Match path boundaries so similarly named routes cannot select the wrong item. */
export function activeAdminNavigation(pathname: string): AdminNavigationItem | undefined {
  const path = pathname.replace(/\/+$/, '') || '/'
  const direct = ADMIN_NAVIGATION.find((item) => path === item.path || path.startsWith(`${item.path}/`))
  if (direct) return direct
  const sharedPath = path.startsWith('/admin/') ? path.slice('/admin'.length) : path
  if (['/messages', '/chats', '/notify', '/chat', '/im', '/contacts'].some((prefix) => sharedPath === prefix || sharedPath.startsWith(`${prefix}/`))) {
    return ADMIN_NAVIGATION.find((item) => item.icon === 'messages')
  }
  if (path === '/settings' || path.startsWith('/settings/')) return ADMIN_NAVIGATION.find((item) => item.icon === 'settings')
  return undefined
}
