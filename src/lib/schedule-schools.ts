/** Public school entry points. Only JOU uses the existing in-app timetable adapter. */
import { captureQbankSession } from './qbank'
export type ScheduleSchool = {
  id: string
  name: string
  mode: 'integrated' | 'official'
  summary: string
  access: string
  steps: string[]
  links: { label: string; href: string }[]
  help: string
  sourceUrls: string[]
  /** Shown before collecting any credentials when no school adapter exists. */
  syncUnavailableReason?: string
  queryHint?: string
  queryOptions?: { label: string; linkIndex: number; hint: string }[]
}

export const SCHEDULE_SCHOOLS: readonly ScheduleSchool[] = [
  {
    id: 'jou', name: '江苏海洋大学', mode: 'integrated',
    summary: '绑定教务账号，同步课表、成绩与考试安排',
    access: '沿用现有教务同步方式',
    steps: [], links: [], help: '', sourceUrls: [],
  },
  {
    id: 'nmukd', name: '南京医科大学康达学院', mode: 'official',
    syncUnavailableReason: '本校需要经过学校统一认证，目前还不能在哦狐内登录并同步个人课表。',
    summary: '通过学校门户进入教学综合信息服务平台',
    access: '校外先打开学校 WebVPN；校内可从学院主页进入。',
    queryOptions: [{ label: '校外', linkIndex: 0, hint: '先登录学校 VPN，再进入教务平台。' }, { label: '校内', linkIndex: 1, hint: '连接校园网，从网上办事大厅进入。' }],
    steps: [
      '校内从学院官网进入网上办事大厅；校外先使用学校提供的 VPN 入口。',
      '使用本校账号登录，进入“教学综合信息服务平台”。',
      '在“信息查询”中寻找“个人课表查询”，选择当前学年、学期。',
    ],
    links: [{ label: '校外：打开学校 WebVPN', href: 'https://webvpn.nmukd.edu.cn/' }, { label: '校内：打开学院主页', href: 'https://kdc.njmu.edu.cn/' }, { label: '查看教务课表下载专区', href: 'https://kdjw.njmu.edu.cn/6683/list.htm' }],
    help: '若 VPN 无法打开，从学院官网查找网络服务或联系学校信息中心。教务处发布的课表附件可作为补充，个人课表以平台为准。',
    sourceUrls: ['https://kdjw.njmu.edu.cn/2025/0930/c6683a307207/page.htm'],
  },
  {
    id: 'lygsf', name: '连云港师范学院', mode: 'official',
    syncUnavailableReason: '本校教务平台尚未接入，目前还不能在哦狐内登录并同步个人课表。',
    summary: '校内使用教务系统，校外查看学校“喜鹊儿”指引',
    access: '学校公开通知区分校园内网教务平台与外网“喜鹊儿”App，请按所在网络选择入口。',
    queryOptions: [{ label: '校外', linkIndex: 1, hint: '按学校指引，通过“喜鹊儿”查询。' }, { label: '校内', linkIndex: 0, hint: '连接校园网后进入学校教务系统。' }],
    steps: [
      '在校内连接校园网，打开“高校智慧校园教学管理服务平台”，使用本校账号登录。',
      '在教学服务中查找个人课表，选择学年、学期；具体菜单以平台为准。',
      '校外按学校指引使用“喜鹊儿”App，选择本校并登录后查找课表；入口或账号问题可查看教务处说明。',
    ],
    links: [{ label: '校内：打开教务系统', href: 'https://jwxt.lygsf.edu.cn/' }, { label: '校外：查看学校 App 指引', href: 'https://jiaowu.lygsf.cn/lyg/xsfw/xsxk/2026/0324/1063.html' }, { label: '打开教务处', href: 'https://jiaowu.lygsf.cn/' }],
    help: '校外网页打不开时，按学校公开指引使用“喜鹊儿”。具体课表菜单及账号要求仍以本校当前系统为准；仍有问题请联系院系或教务处。',
    sourceUrls: ['https://jiaowu.lygsf.cn/lyg/xsfw/xsxk/2026/0324/1063.html', 'https://www.lygsf.edu.cn/'],
  },
  {
    id: 'lygtc', name: '连云港职业技术学院', mode: 'official',
    syncUnavailableReason: '本校树维教务平台尚未接入，目前还不能在哦狐内登录并同步个人课表。',
    summary: '使用树维教务系统，或官方“我的连职院”',
    access: '部分教务服务有校园网络要求；校外打不开时，先核对学校指定的校园网或远程访问方式。',
    queryHint: '校外打不开时，请连接学校指定网络。',
    steps: [
      '先连接学校要求的校园网络，再打开树维教务系统。',
      '使用学校教务账号登录；学校通知说明账号与“我的连职院”一致。',
      '在教学服务或信息查询中寻找个人课表，选择当前学期；也可在官方“我的连职院”中查找课表功能。',
    ],
    links: [{ label: '打开树维教务系统', href: 'http://jw.lygtc.edu.cn/eams/sso/login.action' }, { label: '查看学校访问说明', href: 'https://www.lygtc.edu.cn/jwc/info/1115/1585.htm' }, { label: '打开学校官网', href: 'https://www.lygtc.edu.cn/' }],
    help: '教务地址来自学校公开通知，校外是否可用取决于学校网络。官方 App 请从学校发布渠道获取；打不开时先核对校园网，不要把校内 IP 当成校外入口。',
    sourceUrls: ['https://www.lygtc.edu.cn/jwc/info/1115/1585.htm', 'https://www.lygtc.edu.cn/info/1014/8576.htm'],
  },
  {
    id: 'jscfa', name: '江苏财会职业学院', mode: 'official',
    syncUnavailableReason: '本校需要经过学校统一认证，目前还不能在哦狐内登录并同步个人课表。',
    summary: '通过统一身份认证登录树维教务系统',
    access: '教务入口会跳转学校统一身份认证；访问要求以学校系统提示为准。',
    queryHint: '使用学校统一身份账号登录。',
    steps: [
      '打开学校树维教务系统，进入统一身份认证页面。',
      '使用本人的学号与当前学校账号密码登录。',
      '在系统中查找“个人课表”或“课表查询”，选择学年、学期；具体菜单以当前系统为准。',
    ],
    links: [{ label: '打开树维教务系统', href: 'https://jw.jscfa.edu.cn/eams/sso/login.action' }, { label: '打开学校官网', href: 'https://www.jscfa.edu.cn/' }],
    help: '账号与密码以学校当前通知为准。首次登录或忘记密码时，可按认证页面的找回入口处理，或联系学校教务处。',
    sourceUrls: ['https://www.jscfa.edu.cn/zhxyzx/2023/0211/c1222a25734/page.htm', 'https://jw.jscfa.edu.cn/eams/sso/login.action'],
  },
]

export function findScheduleSchool(id: string): ScheduleSchool | undefined {
  return SCHEDULE_SCHOOLS.find(school => school.id === id)
}
const SCHOOL_KEY = 'ohhu.schedule.school.v1'
const GUIDE_SCHOOL_KEY = 'ohhu.schedule.guide-school.v1'
function scopedGuideSchoolKey(uid: string): string {
  return `${GUIDE_SCHOOL_KEY}:${encodeURIComponent(uid || 'guest')}`
}
export function readScheduleSchool(): string {
  try { const id = localStorage.getItem(SCHOOL_KEY); return id && findScheduleSchool(id) ? id : 'jou' } catch { return 'jou' }
}
export function saveScheduleSchool(id: string): void {
  if (!findScheduleSchool(id)) throw new Error('未知的课表学校')
  try { localStorage.setItem(SCHOOL_KEY, id) } catch { /* Current selection still works when storage is unavailable. */ }
}
export function readScheduleGuideSchool(uid = captureQbankSession().uid): string {
  try {
    const id = localStorage.getItem(scopedGuideSchoolKey(uid))
    return id && findScheduleSchool(id) ? id : 'jou'
  } catch { return 'jou' }
}
export function saveScheduleGuideSchool(id: string, uid = captureQbankSession().uid): boolean {
  if (!findScheduleSchool(id)) throw new Error('未知的课表学校')
  try {
    const key = scopedGuideSchoolKey(uid)
    localStorage.setItem(key, id)
    return localStorage.getItem(key) === id
  } catch { return false }
}
