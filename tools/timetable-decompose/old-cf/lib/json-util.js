'use strict'
/**
 * 【模块】JSON 通用工具
 *
 * 来源：原 index.js 的 findFirstArray（原第 821-838 行）。
 * 原文件把它放在「教务抓取」一节，但它同时被 JSON 课表接口（login.fetchJwglxtSchedule）
 * 和通用解析器（parsers.parseSchedule）使用，属于共用工具，故独立成模块以避免循环依赖。
 *
 * 依赖：无
 */

/** 在教务返回 JSON 里找第一个课表数组（兼容 kbList / kbxxList / 顶层数组 等命名差异） */
function findFirstArray(node, depth = 0) {
  if (depth > 4) return null
  if (Array.isArray(node)) return node
  if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      if (key.toLowerCase().includes('list') || key.toLowerCase().includes('kb')) {
        const hit = findFirstArray(node[key], depth + 1)
        if (hit) return hit
      }
    }
    for (const key of Object.keys(node)) {
      const hit = findFirstArray(node[key], depth + 1)
      if (hit) return hit
    }
  }
  return null
}

module.exports = { findFirstArray }
