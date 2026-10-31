import { registerPlugin } from '@capacitor/core'
import { IS_NATIVE } from './platform'

/**
 * App 安装探测插件（原生层实现，套壳内可用；H5 恒返回 false）
 *  - Android: AppProbePlugin.java，需 AndroidManifest <queries> 声明 scheme
 *  - iOS:     AppProbePlugin.swift，需 Info.plist LSApplicationQueriesSchemes 白名单
 */
export interface AppProbePlugin {
  canOpenUrl(options: { url: string }): Promise<{ value: boolean }>
  launchUrl(options: { url: string }): Promise<{ ok: boolean }>
  openPerfectCampus(): Promise<{ ok: boolean }>
}

const AppProbe = registerPlugin<AppProbePlugin>('AppProbe', {
  web: () =>
    Promise.resolve({
      canOpenUrl: () => Promise.resolve({ value: false }),
      launchUrl: () => Promise.resolve({ ok: false }),
      openPerfectCampus: () => Promise.resolve({ ok: false }),
    }),
})

/** Android can open the installed app by its fixed package; other platforms fall back. */
export async function openPerfectCampusApp(): Promise<boolean> {
  if (!IS_NATIVE) return false
  try { return !!(await AppProbe.openPerfectCampus()).ok } catch { return false }
}

/**
 * 检测本机是否安装了能响应某 URL Scheme 的 App。
 * - 套壳内：调用原生 canOpenUrl（Android queryIntentActivities / iOS canOpenURL）
 * - H5 浏览器：恒返回 false（浏览器安全限制，无法预检测）
 *
 * 注意：传入的是完整 scheme（如 'cainiao://' 或 'openapp.jdmobile://...?'），
 * 原生层用 Intent(ACTION_VIEW, Uri) / canOpenURL 判断是否有 App 能响应。
 */
export async function canOpenScheme(scheme: string): Promise<boolean> {
  if (!IS_NATIVE || !scheme) return false
  try {
    const res = await AppProbe.canOpenUrl({ url: scheme })
    return !!res.value
  } catch {
    return false
  }
}

/**
 * 套壳内原生唤起第三方 App（startActivity / UIApplication.open）。
 * WebView 里 iframe 触发 custom scheme 无效，必须走原生。
 * @returns true=成功打开；false=未安装/失败（前端降级 H5）
 */
export async function launchScheme(scheme: string): Promise<boolean> {
  if (!IS_NATIVE || !scheme) return false
  try {
    const res = await AppProbe.launchUrl({ url: scheme })
    return !!res.ok
  } catch {
    return false
  }
}
