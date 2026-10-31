import { Capacitor, registerPlugin } from '@capacitor/core'

/** Public entry addresses from chuhe0719/QuickJump; our bridge and UI are independent. */
export const QUICK_JUMP_SOURCE = 'https://github.com/chuhe0719/QuickJump'
export const QUICK_JUMP_SOURCE_COMMIT = 'df94cd7ab1cbca5171139259f63b44dc61cf8e9c'
export const CAN_NATIVE_EXPRESS_JUMP = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'

export type QuickJumpId = 'cainiao-code' | 'taobao-code' | 'pdd-code' | 'taobao-pending' | 'pdd-pending' | 'douyin-orders' | 'jd-orders'
export type QuickJumpEntry = {
  id: QuickJumpId
  title: string
  brand: string
  mark: string
  group: 'code' | 'orders'
  hint: string
  webUrl?: string
}

export const QUICK_JUMP_ENTRIES: readonly QuickJumpEntry[] = [
  { id: 'cainiao-code', title: '菜鸟身份码', brand: '菜鸟', mark: '菜', group: 'code', hint: '在菜鸟 App 内出示', webUrl: 'https://market.m.taobao.com/app/cn-yz/multi-activity/authCode.html?bizEntry=ALIPAY_GUOGUO' },
  { id: 'taobao-code', title: '淘宝身份码', brand: '淘宝', mark: '淘', group: 'code', hint: '在淘宝内出示', webUrl: 'https://pages-fast.m.taobao.com/wow/z/uniapp/1011717/last-mile-fe/end-collect-platform/identity-code?x-ssr=true' },
  { id: 'pdd-code', title: '拼多多身份码', brand: '拼多多', mark: '拼', group: 'code', hint: '在拼多多内出示', webUrl: 'https://m.pinduoduo.net/mdkd/package?entry_source=18&extra_params=from_wx_jump%3D1&p_channel=0' },
  { id: 'taobao-pending', title: '淘宝待取快递', brand: '淘宝', mark: '淘', group: 'orders', hint: '查看待取包裹', webUrl: 'https://pages-fast.m.taobao.com/wow/z/uniapp/1100333/last-mile-fe/m-end-school-tab/home' },
  { id: 'pdd-pending', title: '拼多多待取快递', brand: '拼多多', mark: '拼', group: 'orders', hint: '查看待取包裹', webUrl: 'https://m.pinduoduo.net/mdkd/package?entry_source=18&extra_params=from_wx_jump%3D1&p_channel=0' },
  { id: 'douyin-orders', title: '抖音订单', brand: '抖音', mark: '抖', group: 'orders', hint: '兼容抖音与极速版' },
  { id: 'jd-orders', title: '京东订单', brand: '京东', mark: '京', group: 'orders', hint: '在订单中查看物流', webUrl: 'https://order.jd.com/center/list.action' },
]

type NativeRoute = 'direct' | 'app' | 'web' | 'unavailable'
type NativeResult = { ok: boolean; route: NativeRoute; packageName?: string }
interface QuickJumpPlugin { openExpressEntry(options: { entryId: QuickJumpId }): Promise<NativeResult> }
const bridge = registerPlugin<QuickJumpPlugin>('AppProbe')
export type QuickJumpResult = { ok: boolean; route: NativeRoute | 'needs-update' | 'unsupported' | 'error'; message: string }

export function findQuickJumpEntry(id: string): QuickJumpEntry | undefined {
  return QUICK_JUMP_ENTRIES.find(entry => entry.id === id)
}

/** Only fixed entry IDs cross the bridge; no arbitrary Intent, URL or account data. */
export async function openQuickJumpEntry(id: string): Promise<QuickJumpResult> {
  const entry = findQuickJumpEntry(id)
  if (!entry) return { ok: false, route: 'unavailable', message: '没有找到这个快递入口。' }
  if (!CAN_NATIVE_EXPRESS_JUMP) return { ok: false, route: 'unsupported', message: '浏览器请使用平台网页；App 直达功能需要安卓版哦狐。' }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      bridge.openExpressEntry({ entryId: entry.id }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('jump-timeout')), 8000) }),
    ])
    if (!result || typeof result.ok !== 'boolean' || !['direct', 'app', 'web', 'unavailable'].includes(result.route)
      || result.ok !== (result.route !== 'unavailable') || (result.route === 'web' && !entry.webUrl)) {
      return { ok: false, route: 'error', message: '未能确认跳转结果，请在对应 App 内查看。' }
    }
    if (!result.ok) return { ok: false, route: 'unavailable', message: `未能打开${entry.brand}，请确认已安装该 App${entry.webUrl ? '，或使用下方平台网页' : '后重试'}。` }
    return {
      ok: true, route: result.route,
      message: result.route === 'app' ? `已请求打开${entry.brand}，请在 App 内查找取件或订单页面。`
        : result.route === 'web' ? '已请求打开平台网页，请按页面提示登录；部分功能需要手机 App。'
          : `已请求打开${entry.title}；如果停在首页，请在${entry.brand}内查看。`,
    }
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    if (code === 'UNIMPLEMENTED' || code === 'UNAVAILABLE') {
      return { ok: false, route: 'needs-update', message: `当前安装包还不支持此快捷入口，需要新版 APK。${entry.webUrl ? '可先使用下方平台网页。' : '请更新安装包后重试。'}` }
    }
    return { ok: false, route: 'error', message: '暂时无法确认跳转结果，请检查对应 App；如已打开，请直接在该 App 内查看。' }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
