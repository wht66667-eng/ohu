'use strict'
/**
 * 【模块】网关响应与入参解析
 *
 * 来源：原 index.js「网关响应」一节（原第 1583-1620 行），代码逐行搬运。
 * 纯 I/O 适配层，与课表业务零耦合，便于日后换函数网关（云函数 HTTP 触发 / API 网关）时替换。
 *
 * 依赖：无
 */

function httpRes(statusCode, obj) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body: JSON.stringify(obj),
  }
}

function parseJsonBody(event) {
  let body = event.body
  if (body == null || body === '') return {}
  if (typeof body === 'object') return body
  let text = String(body)
  if (event.isBase64Encoded) {
    try {
      text = Buffer.from(text, 'base64').toString('utf8')
    } catch (_) {}
  }
  let val
  try {
    val = JSON.parse(text.trim())
  } catch (e) {
    throw new Error('bad json')
  }
  if (typeof val === 'string' && /^[ \t\r\n]*[[{]/.test(val)) {
    try {
      val = JSON.parse(val)
    } catch (_) {}
  }
  return val
}

module.exports = { httpRes, parseJsonBody }
