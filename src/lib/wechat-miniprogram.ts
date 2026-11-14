import { IS_NATIVE } from './platform'
import { launchScheme } from './express-app-probe'

/**
 * 微信小程序 URL Scheme 直达（目前仅图书馆选座）。
 * Scheme 只能由小程序所有者（学校/traceint）在其后台开启「明文 Scheme 拉起」后提供；
 * 配置放在官网托管 wechat-schemes.json，拿到标识符后上传即可启用，无需新 APK 或热更新
 * （原生 launchUrl 自 APK 160 起存在）。未配置、未安装微信或拉起失败时，
 * 由调用方回落到既有「分享进微信→点链接」流程。电费是公众号 H5，不适用本机制。
 */
const SCHEMES_URL = 'https://jou-d4gq7a3cqf51e6caa-1394316826.tcloudbaseapp.com/wechat-schemes.json'
const FETCH_TIMEOUT_MS = 2500
const BACKGROUND_TIMEOUT_MS = 3000
const MAX_SCHEME_LENGTH = 2048
const SCHEME_PREFIX = 'weixin://dl/business/'

export function isWeChatBusinessScheme(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > SCHEME_PREFIX.length
    && value.length <= MAX_SCHEME_LENGTH
    && value.startsWith(SCHEME_PREFIX)
    // eslint-disable-next-line no-control-regex -- 边界校验：显式拒绝控制字符
    && !/[\s\x00-\x1F\x7F]/.test(value)
}

export function parseWeChatSchemes(data: unknown): { librarySeat: string | null } {
  if (!data || typeof data !== 'object') return { librarySeat: null }
  const value = (data as Record<string, unknown>).librarySeat
  return { librarySeat: isWeChatBusinessScheme(value) ? value : null }
}

type VisibilityTarget = {
  visibilityState: string
  addEventListener: (type: 'visibilitychange', listener: () => void) => void
  removeEventListener: (type: 'visibilitychange', listener: () => void) => void
}

/**
 * 拉起其他 App 后观察本页面是否转入后台：hidden=已离开（视为拉起成功）；
 * 超时仍可见=拉起失败。用户提前返回不会误判（只在 hidden 时判成功）。
 */
export function watchAppBackground(target: VisibilityTarget, timeoutMs: number): { promise: Promise<boolean>; cancel: () => void } {
  let settle!: (value: boolean) => void
  const promise = new Promise<boolean>(resolve => { settle = resolve })
  let timer: ReturnType<typeof setTimeout> | undefined
  function cleanup() {
    if (timer !== undefined) clearTimeout(timer)
    target.removeEventListener('visibilitychange', onVisibility)
  }
  function done(value: boolean) { cleanup(); settle(value) }
  function onVisibility() { if (target.visibilityState === 'hidden') done(true) }
  if (target.visibilityState === 'hidden') {
    settle(true)
    return { promise, cancel: () => {} }
  }
  target.addEventListener('visibilitychange', onVisibility)
  timer = setTimeout(() => done(false), timeoutMs)
  return { promise, cancel: () => done(false) }
}

let cachedScheme: string | null = null

export async function getLibrarySeatScheme(): Promise<string | null> {
  if (!IS_NATIVE) return null
  if (cachedScheme) return cachedScheme
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(SCHEMES_URL, { signal: ctrl.signal, cache: 'no-store' })
    if (!res.ok) return null
    const scheme = parseWeChatSchemes(await res.json()).librarySeat
    if (scheme) cachedScheme = scheme
    return scheme
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 尝试一键直达「我去图书馆」小程序。
 * true=已拉起微信且本 App 转入后台；false=未配置/未安装/拉起失败，调用方走兜底。
 * 微信内若提示「无法打开该小程序」（如学校未开启明文 Scheme），本端无法感知。
 */
export async function tryOpenLibraryMiniProgram(): Promise<boolean> {
  const scheme = await getLibrarySeatScheme()
  if (!scheme) return false
  const watch = watchAppBackground(document, BACKGROUND_TIMEOUT_MS)
  if (!await launchScheme(scheme)) {
    watch.cancel()
    return false
  }
  return watch.promise
}