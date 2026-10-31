#!/usr/bin/env node
/**
 * 静态托管冒烟：部署后检查关键路径是否 200。
 *
 *   node tools/smoke-hosting.mjs
 *   SMOKE_BASE=https://xxx.tcloudbaseapp.com node tools/smoke-hosting.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function readEnvId() {
  const src = readFileSync(join(ROOT, 'src/lib/cb.ts'), 'utf8')
  const matched = src.match(/CB_ENV_ID\s*=\s*'([^']+)'/)
  if (!matched) throw new Error('无法解析 CB_ENV_ID')
  return matched[1]
}

const envId = readEnvId()
const BASE = (process.env.SMOKE_BASE || `https://${envId}-1394316826.tcloudbaseapp.com`).replace(/\/$/, '')

const PATHS = ['/', '/pet', '/todo', '/services?q=%E4%BA%8C%E6%89%8B', '/market?q=test', '/info', '/chat', '/profile']

async function check(path) {
  const url = `${BASE}${path}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal })
    const text = await res.text()
    const spa = text.includes('<div id="root"') || text.includes('id="root"')
    const ok = res.status === 200 && (path === '/' || spa || text.length > 0)
    return { url, status: res.status, spa, ok }
  } catch (e) {
    return { url, status: 0, spa: false, ok: false, error: String(e?.message || e) }
  } finally {
    clearTimeout(timer)
  }
}

const results = []
for (const p of PATHS) results.push(await check(p))

let fail = 0
console.log(`[smoke] base ${BASE}`)
for (const r of results) {
  const mark = r.ok ? 'OK ' : 'FAIL'
  if (!r.ok) fail += 1
  console.log(`  ${mark}  ${r.status}  ${r.url}${r.error ? `  (${r.error})` : r.spa ? '  [spa]' : ''}`)
}

if (fail) {
  console.error(`\n[smoke] ${fail}/${results.length} 失败`)
  process.exit(1)
}
console.log(`\n[smoke] 全部通过 ${results.length}/${results.length}`)
