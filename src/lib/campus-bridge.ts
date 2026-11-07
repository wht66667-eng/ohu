/**
 * 设备侧校园 WebView 桥（原生 `CampusBridge` 插件）的 TypeScript 封装。
 *
 * 只在 Android 套壳里可用；Web / iOS 返回 `available=false`，调用方应展示「请在手机 App 内使用」。
 * 桥本身只做加载 / 执行 JS / 读 URL，业务编排在 `one-click.ts`。
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

export interface CampusBridgePlugin {
  open(): Promise<void>
  load(options: { url: string; headers?: Record<string, string> }): Promise<void>
  eval(options: { js: string }): Promise<{ value: string }>
  show(): Promise<void>
  hide(): Promise<void>
  close(): Promise<void>
  currentUrl(): Promise<{ url: string; visible: boolean }>
  cookies(options: { url: string }): Promise<{ cookie: string }>
  setCookie(options: { url: string; cookie: string }): Promise<void>
  setCapture(options: { enabled: boolean }): Promise<void>
  requests(): Promise<{ requests: string[] }>
  clearData(): Promise<void>
  addListener(event: 'pageLoaded', listener: (data: { url: string }) => void): Promise<PluginListenerHandle>
  addListener(event: 'pageError', listener: (data: { url: string; code: number; description: string }) => void): Promise<PluginListenerHandle>
  addListener(event: 'closed', listener: () => void): Promise<PluginListenerHandle>
}

export const CampusBridge = registerPlugin<CampusBridgePlugin>('CampusBridge')

/** 原生桥只在 Android 套壳里有实现。 */
export const CAMPUS_BRIDGE_AVAILABLE = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'

/**
 * `evaluateJavascript` 返回的是 JSON 编码后的值：
 * `"submitted"` / `null` / `true` / `{"a":1}`。字符串要解一层引号。
 */
export function decodeEvalValue(raw: string): string {
  if (raw === null || raw === undefined) return ''
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'string') return parsed
    if (parsed === null) return ''
    if (typeof parsed === 'object') return JSON.stringify(parsed)
    return String(parsed)
  } catch {
    return raw
  }
}

export async function evalText(js: string): Promise<string> {
  const result = await CampusBridge.eval({ js })
  return decodeEvalValue(result.value)
}
