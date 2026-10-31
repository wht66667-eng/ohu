/**
 * 大学生学业 · 考证与官方入口（海大常用）
 * 校园网址唯一数据源见 lib/campus-links；本文件只保留考证目录与时间节点文案。
 */
import { CAMPUS_LINKS, type CampusLink } from '../lib/campus-links'

export type StudyLink = {
  id: string
  title: string
  desc: string
  href: string
  tag: string
}

export type CertItem = {
  id: string
  name: string
  short: string
  /** 近年常见节点（非精确，以官网为准） */
  season: string
  tip: string
  queryUrl: string
  enrollUrl?: string
  tint: string
}

export type ExamMilestone = {
  id: string
  title: string
  when: string
  note: string
  kind: 'cet' | 'pth' | 'ncre' | 'ntce' | 'other'
}

/** 学校入口：转发自统一注册表，避免两处 URL 不一致 */
export const campusPortals: StudyLink[] = CAMPUS_LINKS.map((l: CampusLink) => ({
  id: l.id,
  title: l.title,
  desc: l.desc,
  href: l.href,
  tag: l.tag,
}))

/** 全国性大学生考证 */
export const certCatalog: CertItem[] = [
  {
    id: 'cet4',
    name: '英语四级 CET-4',
    short: '四六级',
    season: '通常 6 月、12 月笔试',
    tip: '在校生由学校统一报名；成绩约考后 2 个月可查。口语另报。',
    queryUrl: 'https://cjcx.neea.edu.cn',
    enrollUrl: 'https://cet-bm.neea.edu.cn',
    tint: '#e6efff',
  },
  {
    id: 'cet6',
    name: '英语六级 CET-6',
    short: '四六级',
    season: '通常 6 月、12 月笔试',
    tip: '一般需先过四级（以当年政策为准）。准考证号与姓名查分。',
    queryUrl: 'https://cjcx.neea.edu.cn',
    enrollUrl: 'https://cet-bm.neea.edu.cn',
    tint: '#dcebff',
  },
  {
    id: 'pth',
    name: '普通话水平测试',
    short: '普通话',
    season: '校内考点按批次开考',
    tip: '关注校内语委 / 教务或文学院通知报名；证书全国通用。',
    queryUrl: 'https://www.cltt.org',
    enrollUrl: 'https://www.cltt.org',
    tint: '#fff3e2',
  },
  {
    id: 'ncre',
    name: '全国计算机等级考试',
    short: '计算机',
    season: '通常 3 月、9 月',
    tip: '二级最常见（Office / Python / C 等）；报名走 NEEA 或考点。',
    queryUrl: 'https://cjcx.neea.edu.cn',
    enrollUrl: 'https://ncre.neea.edu.cn',
    tint: '#e8f6d8',
  },
  {
    id: 'ntce',
    name: '中小学教师资格考试',
    short: '教资',
    season: '笔试通常上、下半年各一次',
    tip: '在校生可提前考；面试另报。官方：ntce.neea.edu.cn',
    queryUrl: 'https://ntce.neea.edu.cn',
    enrollUrl: 'https://ntce.neea.edu.cn',
    tint: '#f0e8fb',
  },
  {
    id: 'ky',
    name: '全国硕士研究生招生考试',
    short: '考研',
    season: '初试一般 12 月下旬',
    tip: '研招网报名（约 10 月）；关注目标院校招生简章与海大保研通知。',
    queryUrl: 'https://yz.chsi.com.cn',
    enrollUrl: 'https://yz.chsi.com.cn',
    tint: '#fde7ec',
  },
  {
    id: 'gk',
    name: '国家公务员考试',
    short: '国考',
    season: '报名约 10 月，笔试约 11–12 月',
    tip: '以国家公务员局公告为准；省考另看江苏省考时间。',
    queryUrl: 'http://www.scs.gov.cn',
    enrollUrl: 'http://www.scs.gov.cn',
    tint: '#dff2f6',
  },
  {
    id: 'jl',
    name: '大学英语四六级口语',
    short: '口语',
    season: '笔试后约一个月口试',
    tip: '需单独报名口语；与笔试成绩分开发布。',
    queryUrl: 'https://cet-bm.neea.edu.cn',
    enrollUrl: 'https://cet-bm.neea.edu.cn',
    tint: '#e1eefb',
  },
]

/** 近学期常见学业节点（2026 参考，以官方最终通知为准） */
export const studyMilestones: ExamMilestone[] = [
  {
    id: 'm1',
    title: '英语四六级 · 下半年笔试',
    when: '约 2026-12',
    note: '报名一般在考前 1–2 个月由学校统一组织，留意教务/学院群通知。',
    kind: 'cet',
  },
  {
    id: 'm2',
    title: '四六级成绩查询窗口',
    when: '考后约 2 个月',
    note: '中国教育考试网查分；也可关注学校转发的查分通道。',
    kind: 'cet',
  },
  {
    id: 'm3',
    title: '普通话水平测试 · 校内批次',
    when: '按校内通知',
    note: '名额有限，建议提前关注文学院 / 语委报名表。',
    kind: 'pth',
  },
  {
    id: 'm4',
    title: '计算机等级考试 NCRE',
    when: '约 2026-09 / 2027-03',
    note: '考点报名截止通常早于开考日，别卡点。',
    kind: 'ncre',
  },
  {
    id: 'm5',
    title: '教师资格证笔试',
    when: '上半年 / 下半年',
    note: '笔试通过后再约面试；材料审核留足时间。',
    kind: 'ntce',
  },
  {
    id: 'm6',
    title: '期末考试周',
    when: '学期末 2 周',
    note: '在教务「考试安排」或课表备注查看；可同步到本机待办。',
    kind: 'other',
  },
  {
    id: 'm7',
    title: '补考 / 重修报名',
    when: '新学期初',
    note: '以教务处通知为准，逾期可能无法报名。',
    kind: 'other',
  },
]

export const studyTips: string[] = [
  '成绩、学籍证明以正方教务为准；本 App 成绩本仅作个人备忘。',
  '校外查成绩 / 课表：先登 WebVPN，再进正方教务。',
  '四六级准考证号务必保存好，查分与口语报名都要用。',
  '普通话证书打印、补办走官方普通话培训测试信息网。',
  '毕业审核前核对培养方案学分、公选课与创新学分是否齐。',
]
