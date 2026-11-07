/** Real existing routes and actions; this directory contains no business rows. */
export type ServiceCategory = 'study' | 'life' | 'mutual'
export type ServiceAccess = 'ohu' | 'official-guide' | 'external' | 'local-data'
export interface CampusService {
  id: string
  title: string
  artwork: string
  desc: string
  category: ServiceCategory
  to: string
  action?: 'express' | 'external'
  externalUrl?: string
  official?: boolean
  /** How this service obtains data or hands the user off; never implies an unverified school integration. */
  access?: ServiceAccess
}

export const SERVICE_ACCESS_COPY: Readonly<Record<ServiceAccess, string>> = {
  ohu: '哦狐功能',
  'official-guide': '官方服务指引',
  external: '外部服务',
  'local-data': '哦狐地点／时刻数据',
}
export const SERVICE_CATEGORIES = [
  ['study', '学习与安排'], ['life', '校园生活'], ['mutual', '同学互助'],
] as const
/** 目录视觉分组只影响呈现，不改变原有服务分类与权限。 */
export const SERVICE_GROUPS = [
  { id: 'coursework', title: '课业安排', category: 'study', ids: ['oneclick', 'schedule', 'calendar', 'academics', 'zhongce', 'todo', 'focus'] },
  { id: 'english', title: '英语学习', category: 'study', ids: ['english', 'study'] },
  { id: 'campus-life', title: '校园生活', category: 'life', ids: ['express', 'sports'] },
  { id: 'map-checkin', title: '地图与打卡', category: 'life', ids: ['map'] },
  { id: 'peer-help', title: '同学互助', category: 'mutual', ids: ['meet', 'tasks', 'market', 'lost', 'teamup', 'activities', 'plaza'] },
] as const
export const SERVICE_CATALOG: CampusService[] = [
  { id: 'academics', title: '学业中心', artwork: '学业中心', desc: '成绩 · 考试 · 公选 · 体测 · PU · 学习通', category: 'study', to: '/grades' },
  { id: 'oneclick', title: '一键获取', artwork: '成绩查询', desc: '学号 + 校园网 + 统一认证，设备内读取课表/成绩/考试', category: 'study', to: '/study/oneclick' },
  { id: 'schedule', title: '课表', artwork: '课表查询', desc: '查看本周课程、时间与教室', category: 'study', to: '/schedule' },
  { id: 'calendar', title: '校历', artwork: '考试安排', desc: '按月查看教学周、课程和个人调课', category: 'study', to: '/calendar' },
  { id: 'grades', title: '成绩', artwork: '成绩查询', desc: '校内成绩与加权均分', category: 'study', to: '/study?tab=grades' },
  { id: 'exams', title: '考试', artwork: '考试安排', desc: '考试时间、教室与提醒', category: 'study', to: '/study?tab=exams' },
  { id: 'english', title: '英语', artwork: '英语学习', desc: '背单词、练题和继续学习', category: 'study', to: '/english' },
  { id: 'zhongce', title: '综测', artwork: '综测加分', desc: '学院细则与加分材料', category: 'study', to: '/zhongce' },
  { id: 'pu', title: 'PU 二课', artwork: '综测加分', desc: '口袋校园第二课堂学分与分类明细', category: 'study', to: '/study/pu', access: 'external' },
  { id: 'focus', title: '番茄专注', artwork: '番茄专注', desc: '计时、休息与专注记录', category: 'study', to: '/study/focus' },
  { id: 'todo', title: '待办', artwork: '我的待办', desc: '整理今天要做的事', category: 'study', to: '/todo' },
  { id: 'study', title: '官方查分与考证', artwork: '学业中心', desc: '选择四六级、普通话等官方查分平台', category: 'study', to: '/study', official: true, access: 'official-guide' },
  { id: 'ai', title: 'AI 问答', artwork: 'AI问答', desc: '校园问答与学习助手', category: 'study', to: '/chat' },
  { id: 'study-plan', title: '学习计划', artwork: '学习计划', desc: '管理学习目标与计划', category: 'study', to: '/study/plan' },
  { id: 'learning-platform', title: '学习通', artwork: '学习通', desc: '官方 App 入口、课程与作业只读同步状态', category: 'study', to: '/study/chaoxing', access: 'external' },
  { id: 'express', title: '快递查询', artwork: '查物流', desc: '取件身份码、待取包裹与单号查物流', category: 'life', to: 'express', action: 'express', official: true, access: 'external' },
  { id: 'map', title: '地图打卡', artwork: '目标墙', desc: '连云港美食、好玩与我的地点', category: 'life', to: '/campus-map', access: 'local-data' },
  { id: 'sports', title: '运动健康', artwork: '运动中心', desc: '步数、目标、周记录与阳光跑小队', category: 'life', to: '/sports' },
  { id: 'sports-results', title: '体测成绩查询', artwork: '运动中心', desc: '体测查询渠道、同步状态与本机成绩趋势', category: 'life', to: '/sports/results', access: 'official-guide' },
  { id: 'tasks', title: '跑腿任务', artwork: '生活互助', desc: '发布需求，找同学顺路帮忙', category: 'mutual', to: '/tasks' },
  { id: 'meet', title: '碰个空', artwork: '结伴出行', desc: '找同校搭子，约时间一起活动', category: 'mutual', to: '/meet' },
  { id: 'market', title: '二手交易', artwork: '二手交易', desc: '教材、数码与生活闲置', category: 'mutual', to: '/market' },
  { id: 'lost', title: '失物招领', artwork: '校园信息站', desc: '寻物、拾获与归还', category: 'mutual', to: '/info?filter=失物招领' },
  { id: 'teamup', title: '结伴出行', artwork: '校园信息站', desc: '看看真实组队活动与出行报名', category: 'mutual', to: '/info?filter=活动&category=teamup' },
  { id: 'activities', title: '校园活动', artwork: '校园信息站', desc: '讲座、社团、比赛与活动报名', category: 'mutual', to: '/info?filter=活动' },
  { id: 'plaza', title: '校园广场', artwork: '校园广场', desc: '校园帖子、聊天与同学交流', category: 'mutual', to: '/plaza' },
]

export function findCampusService(to: string): CampusService | undefined {
  return SERVICE_CATALOG.find((item) => item.to === to)
}
