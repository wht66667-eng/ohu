'use strict'
/**
 * 【模块】HTTP 客户端（手动 Cookie + 重定向 + 超时）
 *
 * 来源：原 index.js「HTTP 客户端」一节（原第 275-358 行），代码逐行搬运。
 * 这是整个函数**唯一**的发请求出口：WebVPN 包裹只在这里发生，
 * 因此上层所有判断（finalUrl 是否为 zdy.htm / xs_main.aspx 等）都与「是否配置了 WebVPN」无关。
 *
 * 依赖：./config、./webvpn、./cookies
 */

const { UA } = require('./config')
const { vpnWrap, vpnNormalize, isVpnSelfUrl } = require('./webvpn')
const { absorbCookies, cookieHeader } = require('./cookies')

function makeAbort(ms, deadline) {
  const ctl = new AbortController()
  const budget = deadline ? Math.min(ms, Math.max(0, deadline - Date.now())) : ms
  const timer = setTimeout(() => ctl.abort(), budget || 1)
  return { ctl, timer }
}

/** 发起单次请求（内部跟随重定向并回写 cookie）。成功返回 { status, headers, buf }，失败抛错。 */
async function request(ctx, url, opts = {}) {
  const { jar, method = 'GET', form, json, headers = {} } = opts
  const { ctl, timer } = makeAbort(ctx.stepMs, ctx.deadline)
  const h = { 'User-Agent': UA, Accept: '*/*', ...headers }
  let body
  if (form) {
    body = new URLSearchParams(form).toString()
    h['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'
  } else if (json) {
    body = JSON.stringify(json)
    h['Content-Type'] = 'application/json; charset=UTF-8'
  }
  if (jar && jar.size) h.Cookie = cookieHeader(jar)

  // target 始终是「教务本体地址」；仅在真正发请求时按需包裹成 WebVPN 地址。
  // 这样所有上层判断（finalUrl 是否为 zdy.htm / xs_main.aspx 等）都保持同一语义，
  // 配置 WebVPN 与否行为一致。
  let target = url
  // WebVPN 会话缺失时，代理会先把请求 302 到它自己的登录页（/login），并顺手下发它自己的
  // ticket Cookie。这条跳转本身就是「未登录墙」的确证，比「跟到最后再看正文」更可靠——
  // 只要出现过就必须记下来：后续那一跳即便失败（数据中心 IP 被拒、连接被复位）或陷入
  // 重定向循环，上层仍然能给出 2004，而不是含糊的「教务不可达」。
  let wallHint = false
  try {
    for (let hop = 0; hop < 6; hop++) {
      const m = hop === 0 ? method : 'GET'
      const res = await fetch(vpnWrap(target), {
        method: m,
        headers: h,
        body: m === 'GET' || m === 'HEAD' ? undefined : body,
        redirect: 'manual',
        signal: ctl.signal,
      })
      absorbCookies(jar, res.headers)
      const loc = res.headers.get('location')
      if (loc && [301, 302, 303, 307, 308].includes(res.status)) {
        // 相对跳转按本体地址解析；绝对跳转可能是 WebVPN 重写过的包裹地址，一并还原为本体地址
        const next = vpnNormalize(new URL(loc, target).toString())
        if (isVpnSelfUrl(next)) wallHint = true
        target = next
        continue
      }
      const buf = Buffer.from(await res.arrayBuffer())
      return { status: res.status, headers: res.headers, buf, finalUrl: target, wallHint }
    }
    throw { kind: 'net', msg: '重定向次数过多', wallHint }
  } catch (e) {
    if (e && e.name === 'AbortError') throw { kind: 'timeout', msg: '教务系统响应超时', wallHint }
    if (e && e.kind) throw e
    throw { kind: 'net', msg: '教务系统网络不可达', wallHint }
  } finally {
    clearTimeout(timer)
  }
}

async function reqText(ctx, url, jar, opts = {}) {
  const r = await request(ctx, url, { jar, ...opts })
  const ctype = r.headers.get('content-type') || ''
  const text = /charset=gb/i.test(ctype) ? decodeGBK(r.buf) : r.buf.toString('utf8')
  return { status: r.status, headers: r.headers, text, finalUrl: r.finalUrl, wallHint: r.wallHint }
}

/** 零依赖 GBK 转码：教务老页面多为 GBK/GB2312。只做有效字节映射，其余保 UTF-8。 */
function decodeGBK(buf) {
  try {
    return new TextDecoder('gbk', { fatal: false }).decode(buf)
  } catch (_) {
    return buf.toString('utf8')
  }
}

function ctypeIs(headers, name) {
  return (headers.get('content-type') || '').toLowerCase().includes(name)
}

module.exports = { makeAbort, request, reqText, decodeGBK, ctypeIs }
