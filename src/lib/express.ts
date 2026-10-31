/**
 * 快递单号识别与跳转模块（合规版）
 *
 * 设计原则：
 *  - 只做「单号 → 平台」识别 + 跳转到官方 App / H5，不爬取、不注入 JS、不读取取件码。
 *  - 跳转前必须用户确认（由调用方弹 ConfirmSheet）。
 *  - 先尝试 URL Scheme 唤起官方 App，失败（未安装 / 浏览器拦截）自动降级到官方 H5。
 *
 * 学校场景适配：
 *  - 菜鸟取件在「淘宝 App 里的菜鸟驿站」→ 通用快递 / 菜鸟单号优先跳淘宝 App
 *  - 顺丰走「微信小程序顺丰」→ SF 单号优先唤起微信，提示在微信里搜顺丰小程序
 *  - 京东走京东 App
 *
 * 适用环境：H5 浏览器 + Capacitor 套壳 App 通用。
 */
import { openExternalUrl } from './campus-links'

/** 平台类型 */
export type ExpressPlatform = 'jd' | 'taobao' | 'cainiao' | 'wechat' | 'generic'

/**
 * 从剪贴板/任意文本中提取快递单号。
 *
 * 策略：
 *  1. 优先匹配已知前缀（JD/SF/YT/ZTO/YUNDA/STO/EMS/JT/DPK…）+ 数字
 *  2. 其次匹配合法的纯数字单号（10~20 位，排除手机号/身份证）
 *  3. 取第一个命中的
 *
 * 返回 null 表示未识别到。
 */
export function extractTrackingNumber(text: string): string | null {
  const raw = (text || '').trim()
  if (!raw) return null

  // 1) 已知前缀 + 数字（如 JD1234567890、SF1234567890123）
  const prefixRe = /\b(JD|SF|YT|ZTO|YUNDA|STO|EMS|JT|DPK|HTKY|KY|YZPY|SF\d?)\d{6,20}\b/i
  const m1 = raw.match(prefixRe)
  if (m1) return m1[0].toUpperCase()

  // 2) 纯数字单号（10~20 位），排除 11 位手机号和 18 位身份证
  const numRe = /\b(\d{10,20})\b/g
  let m2: RegExpExecArray | null
  while ((m2 = numRe.exec(raw)) !== null) {
    const n = m2[1]
    if (/^1[3-9]\d{9}$/.test(n)) continue // 手机号跳过
    if (/^\d{17}[\dXx]$/.test(n)) continue // 身份证跳过
    return n
  }
  return null
}

/** 单号识别规则（可扩展：往后追加前缀即可） */
export interface ExpressRule {
  /** 前缀（大写匹配，输入会先 trim+toUpperCase 再 startsWith） */
  prefix: string[]
  platform: ExpressPlatform
  displayName: string
}

/**
 * 可配置的前缀规则表。
 * - JD 开头 → 京东
 * - SF → 顺丰（微信小程序）
 * - 圆通/中通/韵达/申通/EMS/极兔/德邦 等 → 淘宝菜鸟驿站（通用）
 * - 其余未命中 → 菜鸟通用兜底（见 identifyExpress）
 */
export const EXPRESS_RULES: ExpressRule[] = [
  // 京东：学校里京东快递也走菜鸟驿站取件，统一走淘宝菜鸟
  { prefix: ['JD'], platform: 'taobao', displayName: '京东' },
  // 顺丰：统一走菜鸟驿站查件（学校场景）
  { prefix: ['SF'], platform: 'taobao', displayName: '顺丰' },
  { prefix: ['YT'], platform: 'taobao', displayName: '圆通' },
  { prefix: ['ZTO'], platform: 'taobao', displayName: '中通' },
  { prefix: ['YUNDA'], platform: 'taobao', displayName: '韵达' },
  { prefix: ['STO'], platform: 'taobao', displayName: '申通' },
  { prefix: ['EMS'], platform: 'taobao', displayName: 'EMS' },
  { prefix: ['JT'], platform: 'taobao', displayName: '极兔' },
  { prefix: ['DPK'], platform: 'taobao', displayName: '德邦' },
  { prefix: ['HT'], platform: 'taobao', displayName: '百世' },
  { prefix: ['KY'], platform: 'taobao', displayName: '跨越' },
]

/** 跳转目标 */
export interface ExpressTarget {
  platform: ExpressPlatform
  displayName: string
  /** 官方 App URL Scheme（为空表示无 App 可唤，直接走 H5） */
  appScheme: string
  /** H5 降级 URL（用户未装 App 时打开） */
  h5Url: string
  /** 是否需要提示用户登录对应账号 */
  needLoginHint: boolean
  /** 平台特定提示 */
  note?: string
  /** 跳转前写入剪贴板的文本（如快递单号），方便用户到目标 App 直接粘贴 */
  clipboardText?: string
}

/**
 * 返回某目标 App 是否已安装（套壳内原生检测，H5 恒 false）。
 * 用于按钮文案：已装显示「打开 XX App」，未装显示「用浏览器查」。
 */
export async function isAppInstalled(target: ExpressTarget): Promise<boolean> {
  if (!target.appScheme) return false
  const { canOpenScheme } = await import('./express-app-probe')
  return canOpenScheme(target.appScheme)
}

/** 空目标（输入为空时用） */
export const EMPTY_EXPRESS_TARGET: ExpressTarget = {
  platform: 'cainiao',
  displayName: '待识别',
  appScheme: '',
  h5Url: '',
  needLoginHint: false,
  clipboardText: '',
}

/**
 * 根据单号识别平台并构造跳转目标。
 *
 * 规则：
 *  - JD 开头 → 京东 App
 *  - SF 开头 → 微信（顺丰小程序）
 *  - 命中通用快递前缀 → 淘宝 App（菜鸟驿站取件在淘宝里）
 *  - 未命中 → 菜鸟通用兜底（淘宝 App / 菜鸟 H5）
 */
export function identifyExpress(rawNo: string): ExpressTarget {
  const no = (rawNo || '').trim()
  if (!no) return EMPTY_EXPRESS_TARGET

  const upper = no.toUpperCase()
  const hit = EXPRESS_RULES.find((r) => r.prefix.some((p) => upper.startsWith(p)))
  const carrier = hit?.displayName || ''
  const mailNo = encodeURIComponent(no)

  // 京东：JD 开头
  if (hit?.platform === 'jd') {
    const params = encodeURIComponent(
      JSON.stringify({ category: 'jump', des: 'logisticsDetail', orderId: no }),
    )
    return {
      platform: 'jd',
      displayName: '京东',
      appScheme: `openapp.jdmobile://virtual?params=${params}`,
      h5Url: 'https://m.jd.com/',
      needLoginHint: true,
      note: '京东 App 可直达物流详情；H5 需登录京东账号查看。',
    }
  }

  // 顺丰：SF 开头 → 微信小程序「驿收发」（顺丰官方小程序）
  if (hit?.platform === 'wechat') {
    return {
      platform: 'wechat',
      displayName: '顺丰',
      // 唤起微信 App；微信小程序需 ticket 才能直达，唤起微信后由用户搜「驿收发」小程序
      appScheme: 'weixin://',
      h5Url: `https://www.sf-express.com/sf-service-owf-web/service/routing/quickRoute?routeId=${mailNo}&language=sc`,
      needLoginHint: false,
      clipboardText: no,
      note: '打开微信，搜索「驿收发」小程序，单号已复制可直接粘贴；H5 为顺丰官网。',
    }
  }

  // 淘宝菜鸟驿站：通用快递 + 未识别单号（学校取件在淘宝里）
  // 用淘宝短链直达「菜鸟驿站」频道；频道页不支持 URL 带单号参数，
  // 所以同时把单号写入剪贴板，用户到淘宝后直接粘贴查询。
  const isKnownGeneric = !!hit
  const cainiaoTrackUrl = `https://track.cainiao.com/?mailNo=${mailNo}`
  return {
    platform: 'taobao',
    displayName: isKnownGeneric ? `${carrier}（淘宝菜鸟）` : '菜鸟',
    appScheme: 'taobao://m.tb.cn/h.8ytvIVh',
    h5Url: cainiaoTrackUrl,
    needLoginHint: true,
    clipboardText: no,
    note: isKnownGeneric
      ? '打开淘宝菜鸟驿站，单号已复制可直接粘贴查询；未装淘宝走菜鸟 H5。'
      : '单号未命中已知前缀，默认走淘宝菜鸟 / 菜鸟 H5，单号已复制。',
  }
}

/**
 * 复制文本到剪贴板。
 * 优先用 Web Clipboard API（套壳 WebView 支持）；失败时降级到 execCommand。
 */
async function copyToClipboard(text: string): Promise<void> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  } catch {
    /* ignore */
  }
}

/**
 * 唤起官方 App，失败自动降级到 H5。
 *
 * 套壳内：用原生 launchScheme（startActivity / UIApplication.open），
 *   WebView 的 iframe 对 custom scheme 无效，必须走原生；
 *   失败（App 未安装）返回 false，自动降级 H5。
 * H5 浏览器：打开一次平台网页，不使用无法可靠检测的 iframe 唤起。
 *
 * 注意：本函数只做「打开官方页面」这一件事，不读取、不抓取任何页面内容。
 */
export async function launchExpress(target: ExpressTarget): Promise<void> {
  // 跳转前把单号写入剪贴板，方便用户到目标 App 直接粘贴
  if (target.clipboardText) {
    await copyToClipboard(target.clipboardText)
  }

  const scheme = target.appScheme
  const h5 = target.h5Url
  if (!scheme) {
    if (h5) openExternalUrl(h5)
    return
  }

  // 套壳内：原生 startActivity 唤起，失败降级 H5
  const { launchScheme } = await import('./express-app-probe')
  const ok = await launchScheme(scheme)
  if (!ok && h5) {
    openExternalUrl(h5)
  }
}
