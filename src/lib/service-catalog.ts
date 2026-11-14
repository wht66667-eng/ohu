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
  /** Common search aliases; they resolve to this same authoritative entry, never a second menu item. */
  keywords?: string
  /** TASK-A6: true = 学生端专属（教务同步/成绩/课表/考试/体测/PU/学习通等），社工 track 隐藏入口。 */
  studentOnly?: boolean
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
/** 目录视觉分组只影响呈现，不改变原有服务分类与权限；每个权威功能都有归属。 */
export const SERVICE_GROUPS = [
  { id: 'coursework', title: '课业安排', category: 'study', ids: ['oneclick', 'schedule', 'calendar', 'academics', 'grades', 'exams', 'pu', 'zhongce', 'todo', 'focus'] },
  { id: 'english', title: '英语学习', category: 'study', ids: ['english', 'study'] },
  { id: 'ai-tools', title: 'AI 与学习工具', category: 'study', ids: ['ai', 'study-plan', 'coach', 'learning-platform'] },
  { id: 'campus-life', title: '校园生活', category: 'life', ids: ['express', 'sports', 'sports-results', 'library', 'bus', 'campus-card', 'dorm-power', 'nearby-food'] },
  { id: 'map-checkin', title: '地图与打卡', category: 'life', ids: ['map'] },
  { id: 'peer-help', title: '同学互助', category: 'mutual', ids: ['meet', 'tasks', 'market', 'lost', 'teamup', 'activities', 'plaza'] },
] as const
export const SERVICE_CATALOG: CampusService[] = [
  { id: 'academics', studentOnly: true, title: '成绩中心', artwork: '学业中心', desc: '课程成绩 · 公选 · 体测 · PU 四分类', category: 'study', to: '/grades', keywords: '查分 分数 绩点 均分 gpa 成绩单' },
  { id: 'oneclick', studentOnly: true, title: '一键获取', artwork: '成绩查询', desc: '学号 + 校园网 + 统一认证，设备内读取课表/成绩/考试', category: 'study', to: '/study/oneclick', keywords: '更新 同步 校园数据更新 读取 重新登录' },
  { id: 'schedule', studentOnly: true, title: '课表', artwork: '课表查询', desc: '查看本周课程、时间与教室', category: 'study', to: '/schedule', keywords: '课程表 上课 教室 节次' },
  { id: 'calendar', studentOnly: true, title: '校历', artwork: '考试安排', desc: '按月查看教学周、课程和个人调课', category: 'study', to: '/calendar', keywords: '教学周 学期 放假' },
  { id: 'grades', studentOnly: true, title: '查分与成绩备忘', artwork: '成绩查询', desc: '教务查询成绩，手动备忘与等级折算', category: 'study', to: '/study?tab=grades', keywords: '备忘 手动记录 等级折算 教务查询' },
  { id: 'exams', studentOnly: true, title: '考试', artwork: '考试安排', desc: '考试时间、教室与提醒', category: 'study', to: '/study?tab=exams', keywords: '考试安排 考场 倒计时' },
  { id: 'english', title: '英语', artwork: '英语学习', desc: '背单词、练题和继续学习', category: 'study', to: '/english', keywords: '单词 背单词 四级 六级 四六级 练题' },
  { id: 'zhongce', studentOnly: true, title: '综测', artwork: '综测加分', desc: '学院细则与加分材料', category: 'study', to: '/zhongce', keywords: '综合测评 加分 细则 材料' },
  { id: 'pu', studentOnly: true, title: 'PU 二课', artwork: '综测加分', desc: '口袋校园第二课堂学分与分类明细', category: 'study', to: '/grades?tab=pu', access: 'external', keywords: '二课 口袋校园 第二课堂' },
  { id: 'focus', title: '番茄专注', artwork: '番茄专注', desc: '计时、休息与专注记录', category: 'study', to: '/study/focus', keywords: '番茄钟 计时 专注 休息' },
  { id: 'todo', title: '待办', artwork: '我的待办', desc: '整理今天要做的事', category: 'study', to: '/todo', keywords: '任务 清单 提醒 待办事项' },
  { id: 'study', title: '考证与官方查分', artwork: '学业中心', desc: '四六级、普通话等官方查分与报名平台', category: 'study', to: '/study?tab=certs', official: true, access: 'official-guide', keywords: '考证 四六级 普通话 教资 官方查分 报名' },
  { id: 'ai', title: 'AI 问答', artwork: 'AI问答', desc: '校园问答与学习助手', category: 'study', to: '/chat', keywords: '小助手 阿狐 助手 问答 人工智能 学习工具 今日天机 塔罗 星座 生肖 每日解读' },
  { id: 'coach', title: '阿狐学习教练', artwork: '学习计划', desc: '拆解学习目标、预览计划并保存本机待办', category: 'study', to: '/study/coach', keywords: '教练 复习 学习任务' },
  { id: 'study-plan', title: '学习计划', artwork: '学习计划', desc: '管理学习目标与计划', category: 'study', to: '/study/plan', keywords: '目标 规划 计划 打卡' },
  { id: 'learning-platform', studentOnly: true, title: '学习通', artwork: '学习通', desc: '官方 App 入口、课程与作业只读同步状态', category: 'study', to: '/study/chaoxing', access: 'external', keywords: '超星 chaoxing 课程 作业 网课' },
  { id: 'express', title: '快递查询', artwork: '查物流', desc: '取件身份码、待取包裹与单号查物流', category: 'life', to: 'express', action: 'express', official: true, access: 'external', keywords: '快递 包裹 物流 取件 菜鸟' },
  { id: 'map', title: '地图打卡', artwork: '目标墙', desc: '连云港美食、好玩与我的地点', category: 'life', to: '/campus-map', access: 'local-data', keywords: '地图 打卡 地点 导航 探索' },
  { id: 'sports', title: '运动健康', artwork: '运动中心', desc: '步数、目标、周记录与阳光跑小队', category: 'life', to: '/sports', keywords: '运动 跑步 步数 阳光跑 健康' },
  { id: 'sports-results', studentOnly: true, title: '体测成绩', artwork: '运动中心', desc: '体测查询渠道、同步状态与本机成绩趋势', category: 'life', to: '/grades?tab=tice', access: 'official-guide', keywords: '体测 体质测试 八百米 仰卧起坐' },
  { id: 'library', title: '图书馆座位', artwork: '图书馆座位', desc: '微信我去图书馆选座与官方预约指引', category: 'life', to: '/library', official: true, access: 'official-guide', keywords: '图书馆 座位 自习 借阅 预约 微信 我去图书馆' },
  { id: 'bus', title: '校园班车', artwork: '校园班车', desc: '官方时刻表、沿途站点与发车提醒', category: 'life', to: '/bus', access: 'local-data', keywords: '班车 校车 通勤 时刻表 发车' },
  { id: 'campus-card', title: '校园卡', artwork: '校园卡', desc: '完美校园付款码与官方卡服务指引', category: 'life', to: '/campus-card', official: true, access: 'official-guide', keywords: '校园卡 饭卡 完美校园 付款码 充值 挂失' },
  { id: 'dorm-power', title: '寝室电费', artwork: '寝室电费', desc: '电费余额查询与充值官方入口', category: 'life', to: '/dorm-power', official: true, access: 'official-guide', keywords: '电费 寝室 宿舍 充值 用电 余额 水电' },
  { id: 'nearby-food', title: '附近美食', artwork: '附近美食', desc: '已核验餐饮地点、距离排序与收藏', category: 'life', to: '/nearby-food', access: 'local-data', keywords: '美食 餐厅 吃饭 周边 食堂' },
  { id: 'tasks', title: '跑腿任务', artwork: '生活互助', desc: '发布需求，找同学顺路帮忙', category: 'mutual', to: '/tasks', keywords: '跑腿 代取 帮忙 兼职 任务大厅' },
  { id: 'meet', title: '碰个空', artwork: '结伴出行', desc: '找同校搭子，约时间一起活动', category: 'mutual', to: '/meet', keywords: '搭子 约时间 空档 结伴 局' },
  { id: 'market', title: '二手交易', artwork: '二手交易', desc: '教材、数码与生活闲置', category: 'mutual', to: '/market', keywords: '二手 闲置 买卖 教材 数码' },
  { id: 'lost', title: '失物招领', artwork: '校园信息站', desc: '寻物、拾获与归还', category: 'mutual', to: '/info?filter=失物招领', keywords: '失物 招领 寻物 丢失 捡到' },
  { id: 'teamup', title: '结伴出行', artwork: '校园信息站', desc: '看看真实组队活动与出行报名', category: 'mutual', to: '/info?filter=活动&category=teamup', keywords: '组队 出行 旅游 拼车' },
  { id: 'activities', title: '校园活动', artwork: '校园信息站', desc: '讲座、社团、比赛与活动报名', category: 'mutual', to: '/info?filter=活动', keywords: '活动 讲座 社团 比赛 报名' },
  { id: 'plaza', title: '校园生活', artwork: '校园广场', desc: '校园动态、便签墙与手账', category: 'mutual', to: '/campus-life', keywords: '广场 朋友圈 帖子 论坛 交流 热门 便签 手账 拍照' },
]

/** 旧入口落点对照：最近使用等本机记录仍存旧值，读取时归到同一权威项。 */
const LEGACY_SERVICE_TARGETS: Readonly<Record<string, string>> = {
  '/today-fortune': '/chat',
  '/study': '/study?tab=certs',
  '/sports/results': '/grades?tab=tice',
  '/study/pu': '/grades?tab=pu',
}

export function findCampusService(to: string): CampusService | undefined {
  const canonical = LEGACY_SERVICE_TARGETS[to] || to
  return SERVICE_CATALOG.find((item) => item.to === canonical)
}