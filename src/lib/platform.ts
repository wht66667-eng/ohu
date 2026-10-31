/**
 * 运行端探测与能力表
 *
 * 同一份 Web 产物同时跑在浏览器（H5）与 Capacitor 套壳 App 里。Capacitor 是
 * WebView，window / document / localStorage / history 全部可用，因此页面与组件
 * 不需要做子集裁剪；真正需要按端分派的只有两件事：
 *   1. 路由模式（H5 用 BrowserRouter，套壳用 HashRouter，见 src/App.tsx）；
 *   2. 后续支付调起方式（见 src/lib/native-pay.ts）。
 *
 * 探测顺序（从最可信到兜底）：
 *   1. Capacitor 运行时注入的 window.Capacitor.isNativePlatform()——这里不 import
 *      @capacitor/core，未接入套壳时也能安全求值；
 *   2. iOS 套壳的 `capacitor://` 自定义 scheme；
 *   3. Android 套壳默认走 `https://localhost`（无端口）。本地 `vite preview` 同样是
 *      localhost，但带 43123 端口，故必须同时要求「非 DEV + 无端口」才不会误判。
 */

export type RunTarget = 'h5' | 'capacitor'

/** Capacitor 运行时注入到 window 上的桥接对象（只声明本模块用到的字段） */
interface CapacitorBridge {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
}

function readCapacitor(): CapacitorBridge | null {
  if (typeof window === 'undefined') return null
  return (window as Window & { Capacitor?: CapacitorBridge }).Capacitor ?? null
}

/** 当前宿主：套壳 App 返回 'capacitor'，其余（含 SSR 与本地 dev / preview）返回 'h5' */
export function detectTarget(): RunTarget {
  if (typeof window === 'undefined') return 'h5'
  if (readCapacitor()?.isNativePlatform?.()) return 'capacitor'

  const { protocol, hostname, port } = window.location
  if (protocol === 'capacitor:') return 'capacitor'
  if (!import.meta.env.DEV && !port && (hostname === 'localhost' || hostname === '127.0.0.1')) {
    return 'capacitor'
  }
  return 'h5'
}

export interface PlatformInfo {
  target: RunTarget
  /** 是否运行在原生套壳内：原生体验、支付调起均以此判断 */
  native: boolean
  /** Capacitor 上报的平台名（ios / android）；H5 与未接入套壳时为 'web' */
  os: string
}

function resolvePlatform(): PlatformInfo {
  const target = detectTarget()
  const isNative = target === 'capacitor'
  return {
    target,
    native: isNative,
    os: isNative ? (readCapacitor()?.getPlatform?.() ?? 'web') : 'web',
  }
}

/** 宿主在进程存活期内不会变化，启动时探测一次并缓存 */
export const PLATFORM: PlatformInfo = resolvePlatform()

/** 语义化快捷判断，避免各处重复比较字符串 */
export const IS_NATIVE = PLATFORM.native
