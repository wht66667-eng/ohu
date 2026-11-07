/** 学生端的管理员快捷入口只负责导航，所有读写仍由既有服务端权限校验。 */
export type ContentManagementTab = 'goods' | 'comments' | 'posts' | 'plaza' | 'campus'
export interface StudentManagementAction { label: string; href: string }
const tabs: readonly string[] = ['goods', 'comments', 'posts', 'plaza', 'campus']

/** 只允许固定站内地址返回学生视图，拒绝外链、协议相对路径与任意后台跳转。 */
export function studentManagementReturn(value: string | null): string | null {
  if (!value || !/^\/(?:services|profile|plaza|market|tasks|info|campus-map|plugins|contacts|contact|item\/[1-9]\d*|task\/[1-9]\d*)$/.test(value)) return null
  return `${value}?view=student`
}
export function contentManagementSelection(params: URLSearchParams) {
  const requested = params.get('tab') || ''
  const tab: ContentManagementTab = tabs.includes(requested) ? requested as ContentManagementTab : 'goods'
  const feedback = tab === 'comments' && params.get('source') === 'feedbacks'
  return { tab, feedback, keyword: feedback && params.get('topic') === 'plugin' ? '插件' : '' }
}
/** 将内容入口定位到对应治理标签，插件提案沿用真实反馈审核链路。 */
export function studentManagementActions(pathname: string, allowed: boolean): StudentManagementAction[] {
  if (!allowed || !studentManagementReturn(pathname)) return []
  const from = pathname, actions: StudentManagementAction[] = []
  const link = (tab: ContentManagementTab, extra: Record<string, string> = {}) => `/admin/content?${new URLSearchParams({ view: 'student', from, tab, ...extra })}`
  if (pathname === '/plaza') actions.push({ label: '管理广场内容', href: link('plaza') })
  else if (pathname === '/campus-map') actions.push({ label: '审核地点与打卡', href: link('campus') })
  else if (pathname === '/info' || pathname === '/tasks' || pathname.startsWith('/task/')) actions.push({ label: '管理任务与求助', href: link('posts') })
  else if (pathname === '/market' || pathname.startsWith('/item/')) actions.push({ label: '管理闲置与留言', href: link('goods') })
  else if (pathname === '/plugins') actions.push({ label: '处理插件申请', href: link('comments', { source: 'feedbacks', topic: 'plugin' }) })
  else actions.push({ label: '内容管理', href: link('goods') })
  actions.push({ label: '申请与反馈', href: link('comments', { source: 'feedbacks' }) })
  actions.push({ label: '处理举报', href: `/admin/reports?${new URLSearchParams({view:'student',from})}` })
  return actions
}
