'use strict'
/**
 * 【模块】学期推算
 *
 * 来源：原 index.js「学期推算」一节（原第 360-378 行），代码逐行搬运。
 * 依赖：./config
 */

const { CONF } = require('./config')

function guessTerm() {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  let xnm, xqm
  if (m >= 8 || m <= 1) {
    xnm = m <= 1 ? y - 1 : y // 8-12月 / 1月 → 第一学期
    xqm = '3'
  } else {
    xnm = y - 1 // 2-7月 → 上一学年第二学期
    xqm = '12'
  }
  const xn = CONF.xnm || String(xnm)
  const xq = CONF.xqm || xqm
  const no = xq === '3' || xq === '1' ? 1 : 2
  return { xnm: xn, xqm: xq, label: `${Number(xn)}-${Number(xn) + 1} 学年第 ${no} 学期` }
}

module.exports = { guessTerm }
