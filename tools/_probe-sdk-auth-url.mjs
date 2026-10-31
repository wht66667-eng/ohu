/**
 * 在 Node 里跑 @cloudbase/js-sdk，拦截 fetch，抓出用户信息请求的真实 URL / 头部。
 * 不做任何登录：只调用 getUserInfo，观察 SDK 拼出来的地址。
 */
const seen = []
const origFetch = globalThis.fetch
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url
  const headers = {}
  const h = init.headers
  if (h) {
    if (typeof h.forEach === 'function' && !Array.isArray(h)) h.forEach((v, k) => { headers[k] = v })
    else Object.assign(headers, h)
  }
  const safeHeaders = {}
  for (const [k, v] of Object.entries(headers)) {
    safeHeaders[k] = /authorization|token|secret/i.test(k) ? String(v).slice(0, 14) + '***' : v
  }
  seen.push({ url, method: (init.method || 'GET'), headers: safeHeaders })
  // 伪造一个通过校验的响应，只为观察 SDK 的解析，不做任何真实鉴权
  return new Response(JSON.stringify({ sub: 'probe-uid-0001', uid: 'probe-uid-0001' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function main() {
  const mod = await import('@cloudbase/js-sdk')
  const cloudbase = mod.default || mod
  const app = cloudbase.init({ env: 'jou-d4gq7a3cqf51e6caa', region: 'ap-shanghai' })
  const auth = app.auth()
  try {
    const info = await auth.getUserInfo()
    console.log('getUserInfo ->', JSON.stringify(info).slice(0, 200))
  } catch (e) {
    console.log('getUserInfo threw:', e && e.message ? e.message.slice(0, 120) : String(e).slice(0, 120))
  }
  console.log('--- captured requests ---')
  for (const r of seen) console.log(r.method, r.url, JSON.stringify(r.headers))
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
void origFetch
