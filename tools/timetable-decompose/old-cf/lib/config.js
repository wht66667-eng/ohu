'use strict'
/**
 * 【模块】配置与常量
 *
 * 来源：原 `cloudfunctions/getTimetable/index.js` 顶部「配置」一节（原第 58-77 行）。
 * 拆解原则：只搬不改 —— 这里不做任何逻辑判断，只把环境变量读进 CONF 并导出。
 *
 * 环境变量：
 *   JW_BASE_URL      必填（接入线上教务时）。学校正方系统根地址，如 https://zfxk.jou.edu.cn
 *   JW_MODE          可选 auto | jwglxt | legacy | zfnet。默认 auto 自动识别三种正方形态：
 *                    ① zfnet：首页即 ASP.NET 登录表单（txtUserName/CheckCode.aspx/RSA 隐藏域），如 zfxk.jou.edu.cn；
 *                    ② jwglxt：新版 /jwglxt/xtgl/login_slogin.html；
 *                    ③ legacy：旧版 default.aspx。
 *   JW_XN / JW_XQM   可选，学年(如 2026) / 学期(3=第1学期,12=第2学期)。缺省按日期推算。
 *   JW_DEADLINE_MS   可选，整次爬取总预算，默认 5000（保证超时也 ~5s 内降级返回）。
 *   JW_STEP_TIMEOUT  可选，单次请求超时，默认 3000。
 *   JW_RSA_ENFORCE   可选 '1'：强制要求 RSA 加密登录（部分新版正方必开）。
 *   JW_WEBVPN_URL    可选。学校要求校外经 WebVPN 访问教务时填 WebVPN 根地址（如
 *                    http://webvpn.jou.edu.cn:58888）。配置后所有发往教务的请求都会
 *                    改写成 WebVPN 的包裹地址，由 WebVPN 反向代理转发。
 *                    WebVPN 登录含滑块/短信/动态口令，服务端无法自动化登录，
 *                    故会话 Cookie 由用户在浏览器登录后随 /captcha 的 vpn 字段带入。
 *   JW_WEBVPN_MARKER 可选，网瑞达 WebVPN 路径魔数，默认 hex('wrdvpnisthebest!')，
 *                    一般无需修改。
 */

const CONF = {
  base: (process.env.JW_BASE_URL || '').trim().replace(/\/+$/, ''),
  mode: (process.env.JW_MODE || 'auto').trim().toLowerCase() || 'auto',
  deadlineMs: Number(process.env.JW_DEADLINE_MS || 5000),
  stepMs: Number(process.env.JW_STEP_TIMEOUT || 3000),
  xnm: (process.env.JW_XN || '').trim(),
  xqm: (process.env.JW_XQM || '').trim(),
  rsaEnforce: (process.env.JW_RSA_ENFORCE || '') === '1',
  // WebVPN 反向代理根地址（学校要求校外经 WebVPN 访问教务时配置；空 = 直连教务）
  vpnBase: (process.env.JW_WEBVPN_URL || '').trim().replace(/\/+$/, ''),
  // 网瑞达 WebVPN 路径魔数：hex('wrdvpnisthebest!')，一般无需修改
  vpnMarker: (process.env.JW_WEBVPN_MARKER || '77726476706e69737468656265737421').trim().toLowerCase(),
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

module.exports = { CONF, UA }
