'use strict'
/**
 * 【模块】验证码获取（doCaptcha）
 *
 * 来源：原 index.js「验证码」一节的 doCaptcha（原第 1493-1562 行），代码逐行搬运。
 * （同节的 cropCaptcha / captchaDataUrl 是纯字节处理，已移到 ./captcha-image；
 *   zfLoginHint / vpnSiteHint / vpnLoginHint 是纯 URL 拼接，已移到 ./hints。）
 *
 * 与登录的耦合点只有一处：zfnet 形态下要把「登录现场」（RSA 公钥 / 隐藏域 / action）
 * 连同 Cookie 一起缓存进会话，因为验证码图带的 SafeKey 只在同一次会话里有效。
 *
 * 依赖：../config、./http、./webvpn、./sessions、./captcha-image、./login
 */

const { CONF } = require('./config')
const { request, reqText } = require('./http')
const { vpnEnabled, VPN_WALL_MSG } = require('./webvpn')
const { createSession } = require('./sessions')
const { cropCaptcha, captchaDataUrl } = require('./captcha-image')
const { seedCookie } = require('./cookies')
const { tryZfnetCaptcha } = require('./login')

/**
 * 取验证码。
 * vpnCookie = 用户在浏览器登录 WebVPN 后的会话 Cookie 请求头原文（配置 JW_WEBVPN_URL 时为必填）。
 * WebVPN 是反向代理，WebVPN 会话与教务 Cookie 同域同 jar，后续 /query、/sync 全程复用。
 */
async function doCaptcha(vpnCookie) {
  if (!CONF.base) return { ok: false, error: '教务系统尚未接入（未配置 JW_BASE_URL），请先完成配置' }
  const jar = seedCookie(new Map(), vpnCookie)

  // 形态① zfnet：首页即登录表单（含 SafeKey 验证码）。验证码与 RSA/表单状态同会话缓存。
  if (CONF.mode !== 'legacy') {
    const z = await tryZfnetCaptcha(jar)
    if (z && z.info) {
      return {
        sid: createSession(jar, {
          profile: 'zfnet',
          loginUrl: z.loginUrl,
          state: z.info.state,
          key: z.info.key,
          role: z.info.role,
          postAction: z.info.action || '',
        }),
        image: captchaDataUrl(z.ct, z.buf),
      }
    }
    // 未登录墙：请求被 WebVPN 打回它自己的登录页（会话缺失/过期），不是教务故障
    if (z && z.wall) return { ok: false, vpnWall: true, error: VPN_WALL_MSG }
    if (CONF.mode === 'zfnet') {
      // 「有没有带会话」只能看调用方传没传，不能用 jar 是否为空来判断：
      // WebVPN 即使拒绝未登录请求，也会先把 ticket Cookie 下发下来，jar 必然非空。
      const noSession = vpnEnabled() && !String(vpnCookie || '').trim()
      console.log('[captcha] zfnet 未取到验证码 noSession=%s', noSession)
      return {
        ok: false,
        error: noSession
          ? '未携带 WebVPN 会话：本校教务需经 WebVPN 访问，请先登录 WebVPN 并粘贴会话 Cookie 后再获取验证码'
          : '验证码获取失败：教务系统可能不可达或登录方式已变更，请稍后再试',
      }
    }
  }

  // 形态② jwglxt / ③ legacy：依次探测验证码 URL（部分系统从登录页可解析出 img src）
  const candidates = []
  if (CONF.mode === 'legacy') {
    candidates.push('/CheckCode.aspx', '/checkCode.aspx', '/sys/ValidateCode.aspx')
  } else {
    candidates.push('/jwglxt/xtgl/code.png', '/jwglxt/xtgl/validatecode', '/CheckCode.aspx', '/sys/ValidateCode.aspx')
  }
  const ctx = { stepMs: 3000, deadline: Date.now() + 3000 }
  try {
    const page = await reqText(ctx, `${CONF.base}/jwglxt/xtgl/login_slogin.html`, jar)
    if (page.status === 200) {
      const m = /<img[^>]+src=["']([^"']+code[^"']*)["']/i.exec(page.text)
      if (m) candidates.unshift(new URL(m[1], CONF.base).toString())
    }
  } catch (_) {}
  for (const c of candidates) {
    try {
      const r = await request(ctx, new URL(c, CONF.base).toString(), { jar })
      if (r.status !== 200) continue
      const img = cropCaptcha(r.buf)
      if (!img) continue
      return {
        sid: createSession(jar),
        image: captchaDataUrl(r.headers.get('content-type') || '', img),
      }
    } catch (_) {}
  }
  return { ok: false, error: '验证码获取失败，请稍后再试（教务系统可能暂时不可达）' }
}

module.exports = { doCaptcha }
