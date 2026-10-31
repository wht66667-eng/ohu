/**
 * 小狐狸浮岛（FoxPresenceHost）显示偏好。
 *
 * - on：页面右下角显示狐狸浮岛气泡（默认）
 * - off：收起浮岛，右上角 × 与设置页关闭共用同一偏好键
 *
 * 存 localStorage，改动后派发自定义事件，浮岛组件实时响应。
 */

const LS_KEY = 'fox.dock.closed.v1'
const EVENT = 'sc:fox-dock-toggle'

export function isFoxDockOn(): boolean {
  try {
    return localStorage.getItem(LS_KEY) !== '1'
  } catch {
    return true
  }
}

export function setFoxDockOn(v: boolean): void {
  try {
    if (v) localStorage.removeItem(LS_KEY)
    else localStorage.setItem(LS_KEY, '1')
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<boolean>(EVENT, { detail: v }))
  }
}

/** 订阅偏好变化；返回取消函数 */
export function onFoxDockToggle(cb: (on: boolean) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<boolean>).detail ?? true)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
