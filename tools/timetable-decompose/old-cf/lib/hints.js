'use strict'
/**
 * 【模块】登录入口提示（给前端「去教务登录 / 打开 WebVPN」用）
 *
 * 来源：原 index.js 验证码一节末尾的三个 hint 函数（原第 1564-1581 行），代码逐行搬运。
 * 这些是纯「按形态拼一个 URL」的展示逻辑，与抓取链路无关，故从验证码模块里分出来。
 *
 * 依赖：./config、./webvpn
 */

const { CONF } = require('./config')
const { vpnWrap } = require('./webvpn')

/** 供前端“去教务系统登录”跳转：按形态给出可直开的登录页地址（未配置则空串） */
function zfLoginHint() {
  if (!CONF.base) return ''
  if (CONF.mode === 'legacy') return `${CONF.base}/default.aspx`
  if (CONF.mode === 'jwglxt') return `${CONF.base}/jwglxt/xtgl/login_slogin.html`
  return `${CONF.base}/default2.aspx`
}

/** WebVPN 入口（未配置则空串），供前端「打开 WebVPN 登录」跳转 */
function vpnSiteHint() {
  return CONF.vpnBase || ''
}

/** 经 WebVPN 中转的教务登录页（需已在浏览器登录 WebVPN，否则会落到 WebVPN 自己的登录页） */
function vpnLoginHint() {
  const hint = zfLoginHint()
  return hint ? vpnWrap(hint) : ''
}

module.exports = { zfLoginHint, vpnSiteHint, vpnLoginHint }
