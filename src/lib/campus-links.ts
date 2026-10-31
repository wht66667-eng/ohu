/**
 * 校园 / 学业网址统一注册表（唯一数据源）
 *
 * - 所有「提到过的」官方入口集中在此，UI 只读本表
 * - 一键打开：自动保存本机账号 → 按站点类型复制对应密码 → 外链跳转
 * - 浏览器同源策略禁止替学校站点自动点登录，故采用「复制密码 + 打开」
 *
 * 可达性于 2026-10-14 用 curl 从校外实测校准过一次：
 *   ✅ zfxk（正方教务）/ portal / webvpn:58888 / www / jwc / xuesc / lib / job 均 200；
 *   ❌ cas.jou.edu.cn 校外整域 404（根路径与 /authserver/login 都是 0 字节），
 *      practice.jou.edu.cn 校外不可达，https://webvpn 超时（:58888 正常）。
 *   故 CAS 与实践两条统一改走 WebVPN，并在 desc 里写明，避免用户点进死链。
 */
import { copyText, loadCampusAccount, saveCampusAccount, type CampusAccount } from './campus-account'
import { IS_NATIVE } from './platform'
import { captureQbankSession, isQbankSessionCurrent } from './qbank'

export type CampusCredKind = 'none' | 'vpn' | 'jw' | 'cas'

export type CampusLink = {
  id: string
  title: string
  desc: string
  href: string
  tag: string
  /** 打开时复制哪种密码 */
  cred: CampusCredKind
  group: 'campus' | 'cert'
}

/** 学校与教务相关公开入口（含 VPN / CAS / 教务 / 门户等） */
export const CAMPUS_LINKS: CampusLink[] = [
  {
    id: 'vpn',
    title: '校园 WebVPN（推荐）',
    desc: '实测更稳：登录后进教务 / 门户',
    href: 'http://webvpn.jou.edu.cn:58888',
    tag: 'VPN',
    cred: 'vpn',
    group: 'campus',
  },
  {
    id: 'vpn-https',
    title: 'WebVPN（HTTPS）',
    desc: '部分运营商可开；超时改用推荐口',
    href: 'https://webvpn.jou.edu.cn',
    tag: 'VPN',
    cred: 'vpn',
    group: 'campus',
  },
  {
    id: 'cas',
    title: '统一身份认证（校外走 WebVPN）',
    desc: 'CAS 校外直连已下线，先登 WebVPN 再进门户 / 实践 / 教务',
    href: 'http://webvpn.jou.edu.cn:58888',
    tag: '认证',
    cred: 'cas',
    group: 'campus',
  },
  {
    id: 'jw',
    title: '正方教务',
    desc: '课表 · 成绩 · 考试 · 选课（校外先 VPN）',
    href: 'https://zfxk.jou.edu.cn',
    tag: '教务',
    cred: 'jw',
    group: 'campus',
  },
  {
    id: 'portal',
    title: '信息门户',
    desc: '校内应用入口聚合',
    href: 'http://portal.jou.edu.cn',
    tag: '门户',
    cred: 'cas',
    group: 'campus',
  },
  {
    id: 'practice',
    title: '实践教学系统',
    desc: '实习实践（仅校内 / WebVPN 可达，校外直连不通）',
    href: 'http://practice.jou.edu.cn',
    tag: '实践',
    cred: 'cas',
    group: 'campus',
  },
  {
    id: 'jou',
    title: '江苏海洋大学官网',
    desc: '通知公告 · 校历 · 学院动态',
    href: 'https://www.jou.edu.cn',
    tag: '官网',
    cred: 'none',
    group: 'campus',
  },
  {
    id: 'jwgl-notice',
    title: '教务处通知',
    desc: '补考、重修、毕业审核等',
    href: 'https://jwc.jou.edu.cn',
    tag: '教务处',
    cred: 'none',
    group: 'campus',
  },
  {
    id: 'xuesc',
    title: '学生工作处',
    desc: '综测办法 · 评奖评优 · 学工通知',
    href: 'https://xuesc.jou.edu.cn',
    tag: '学工',
    cred: 'none',
    group: 'campus',
  },
  {
    id: 'lib',
    title: '图书馆',
    desc: '馆藏检索 · 座位 · 电子资源',
    href: 'https://lib.jou.edu.cn',
    tag: '图书',
    cred: 'none',
    group: 'campus',
  },
  {
    id: 'job',
    title: '就业信息网',
    desc: '招聘会 · 实习 · 就业指导',
    href: 'https://job.jou.edu.cn',
    tag: '就业',
    cred: 'none',
    group: 'campus',
  },
]

/** 考证 / 考试官网（查分与报名） */
export const CERT_LINKS: CampusLink[] = [
  {
    id: 'cet-query',
    title: '四六级成绩查询',
    desc: '中国教育考试网查分',
    href: 'https://cjcx.neea.edu.cn',
    tag: '四六级',
    cred: 'none',
    group: 'cert',
  },
  {
    id: 'cet-enroll',
    title: '四六级报名 / 口语',
    desc: '笔试由学校组织；口语另报',
    href: 'https://cet-bm.neea.edu.cn',
    tag: '四六级',
    cred: 'none',
    group: 'cert',
  },
  {
    id: 'pth',
    title: '普通话水平测试官网',
    desc: '证书查询 / 培训测试信息',
    href: 'https://www.cltt.org',
    tag: '普通话',
    cred: 'none',
    group: 'cert',
  },
  {
    id: 'ncre',
    title: '计算机等级考试 NCRE',
    desc: '报名与考点信息',
    href: 'https://ncre.neea.edu.cn',
    tag: '计算机',
    cred: 'none',
    group: 'cert',
  },
  {
    id: 'ntce',
    title: '中小学教师资格考试',
    desc: '笔试 / 面试报名与查分',
    href: 'https://ntce.neea.edu.cn',
    tag: '教资',
    cred: 'none',
    group: 'cert',
  },
  {
    id: 'ky',
    title: '研招网（考研）',
    desc: '报名、准考证、调剂',
    href: 'https://yz.chsi.com.cn',
    tag: '考研',
    cred: 'none',
    group: 'cert',
  },
  {
    id: 'gk',
    title: '国家公务员考试',
    desc: '以国家公务员局公告为准',
    href: 'http://www.scs.gov.cn',
    tag: '国考',
    cred: 'none',
    group: 'cert',
  },
]

export const ALL_CAMPUS_LINKS: CampusLink[] = [...CAMPUS_LINKS, ...CERT_LINKS]

export const VPN_URL = CAMPUS_LINKS.find((l) => l.id === 'vpn')!.href
export const JW_URL = CAMPUS_LINKS.find((l) => l.id === 'jw')!.href
/** 统一身份认证入口：CAS 校外不可达，故指向 WebVPN；校内网络下可直接用 cas.jou.edu.cn */
export const CAS_URL = CAMPUS_LINKS.find((l) => l.id === 'cas')!.href

export function getCampusLink(id: string): CampusLink | undefined {
  return ALL_CAMPUS_LINKS.find((l) => l.id === id)
}

export function openExternalUrl(url: string) {
  window.open(url, '_blank', IS_NATIVE ? undefined : 'noopener,noreferrer')
}

function pickPassword(acc: CampusAccount, kind: CampusCredKind): string {
  if (kind === 'jw') return acc.jwPassword
  if (kind === 'vpn' || kind === 'cas') return acc.vpnPassword || acc.jwPassword
  return ''
}

export type OpenCampusResult = {
  ok: boolean
  message: string
  saved: boolean
  copied: boolean
}

/**
 * 一键：保存本机账号（若有填写）→ 复制对应密码 → 打开网址 → 写入校园入口数据库
 */
export async function openCampusLink(
  link: CampusLink | string,
  accOverride?: Partial<CampusAccount>,
): Promise<OpenCampusResult> {
  const session = captureQbankSession()
  const item = typeof link === 'string' ? getCampusLink(link) : link
  if (!item) return { ok: false, message: '未知入口', saved: false, copied: false }
  if (!session.uid && (item.cred !== 'none' || accOverride)) {
    return { ok: false, message: '请先用手机号登录哦狐，再使用学校账号。', saved: false, copied: false }
  }

  const base = loadCampusAccount()
  const acc: CampusAccount = {
    stuid: (accOverride?.stuid ?? base.stuid).trim(),
    jwPassword: accOverride?.jwPassword ?? base.jwPassword,
    vpnPassword: accOverride?.vpnPassword ?? base.vpnPassword,
    remember: accOverride?.remember ?? base.remember,
  }

  let saved = false
  if (acc.stuid || acc.jwPassword || acc.vpnPassword) {
    saved = saveCampusAccount({
      ...acc,
      vpnPassword: acc.vpnPassword || acc.jwPassword,
    }, session)
  }

  let copied = false
  let result: OpenCampusResult

  if (item.cred !== 'none') {
    const needPwd = pickPassword(acc, item.cred)
    if (!acc.stuid || !needPwd) {
      openExternalUrl(item.href)
      result = {
        ok: false,
        saved,
        copied: false,
        message: `已打开「${item.title}」。请先在上方填好学号与密码并保存，下次可自动复制。`,
      }
    } else {
      copied = await copyText(needPwd)
      if (!isQbankSessionCurrent(session)) return { ok: false, saved, copied: false, message: '账号已切换，请在当前账号重新打开学校入口。' }
      openExternalUrl(item.href)
      const which =
        item.cred === 'jw' ? '教务密码' : item.cred === 'cas' ? '统一身份密码' : 'VPN 密码'
      result = {
        ok: true,
        saved,
        copied,
        message: copied
          ? `已打开「${item.title}」。学号 ${acc.stuid}，${which}已复制，粘贴即可（需验证码的站点请手输）。${saved ? '' : '账号信息未保存。'}`
          : `已打开「${item.title}」。请手动输入学号 ${acc.stuid} 与密码。${saved ? '' : '账号信息未保存。'}`,
      }
    }
  } else {
    openExternalUrl(item.href)
    result = {
      ok: true,
      saved,
      copied: false,
      message: saved ? `已保存账号并打开「${item.title}」` : `已打开「${item.title}」`,
    }
  }

  void import('./campus-db')
    .then((m) => {
      if (!isQbankSessionCurrent(session)) return
      return m.recordCampusOpen({
        link: item,
        stuid: acc.stuid,
        copied: result.copied,
      })
    })
    .catch(() => undefined)

  return result
}

/** 兼容旧调用：按 id 打开 */
export async function openCampusById(
  id: string,
  accOverride?: Partial<CampusAccount>,
): Promise<OpenCampusResult> {
  return openCampusLink(id, accOverride)
}
