/**
 * 探测校园门户是否可达（浏览器侧，仅作连通提示，不能代替登录）
 */
export type PortalProbe = {
  ok: boolean
  status?: number
  ms: number
  message: string
}

export async function probePortal(url: string, timeoutMs = 8000): Promise<PortalProbe> {
  const t0 = performance.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    // no-cors：很多校内站无 CORS，只能判断「网络层是否有响应」
    await fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: ctrl.signal,
    })
    const ms = Math.round(performance.now() - t0)
    return {
      ok: true,
      ms,
      message: `已收到响应（约 ${ms}ms）。因跨域限制无法确认登录页内容，请点「打开」人工登录。`,
    }
  } catch (e) {
    const ms = Math.round(performance.now() - t0)
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    return {
      ok: false,
      ms,
      message: aborted
        ? `超时（>${timeoutMs}ms）。校外请先连 WebVPN，或换备用端口 / 校园网。`
        : `无法连接：${(e as Error).message || '网络错误'}。可试 VPN 或稍后重试。`,
    }
  } finally {
    clearTimeout(timer)
  }
}
