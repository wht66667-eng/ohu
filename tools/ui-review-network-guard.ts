/** NON-PRODUCTION: fail closed even if a future preview dependency bypasses an API fixture. */
const blocked = () => new Error('本地 UI 预览禁止未模拟的网络请求')
globalThis.fetch = async () => { throw blocked() }
XMLHttpRequest.prototype.open = function () { throw blocked() }
// Vite's local development socket is needed only for refreshing source edits.
const NativeSocket = globalThis.WebSocket
globalThis.WebSocket = class extends NativeSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    const parsed = new URL(String(url), location.href)
    if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.port !== '43127') throw blocked()
    super(url, protocols)
  }
}
if (typeof EventSource !== 'undefined') globalThis.EventSource = class extends EventSource {
  constructor() { throw blocked(); super('') }
}
if (navigator.sendBeacon) navigator.sendBeacon = () => false
// Accidental use of the web notification fallback must not ask for permission or post a notice.
if (typeof Notification !== 'undefined') Object.defineProperty(globalThis, 'Notification', {
  configurable: true,
  value: class {
    static permission = 'denied'
    static requestPermission = async () => 'denied'
    constructor() { throw new Error('本地 UI 预览禁止系统通知') }
  },
})

export {}
