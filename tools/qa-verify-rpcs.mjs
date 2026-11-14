// RPC 存在性验证（QA 收尾用）：列出生产库 public schema 的目标 RPC
// 用法：node tools/qa-verify-rpcs.mjs
import { spawnSync } from 'node:child_process'

const ENV = 'jou-d4gq7a3cqf51e6caa'
const verify = `select proname from pg_proc p join pg_namespace n on pronamespace = n.oid where n.nspname = 'public' and (proname like 'social\\_%' or proname like 'admin\\_activity%' or proname like 'schedule\\_share%') order by proname`
const r = spawnSync('tcb db execute', ['-e', ENV, '-r', 'ap-shanghai', '--sql', `"${verify}"`],
  { shell: true, encoding: 'utf8', windowsHide: true, timeout: 120000 })
const out = ((r.stdout || '') + (r.stderr || '')).trim()
const names = [...new Set([...out.matchAll(/\|\s*([a-z_]+)\s*\|/g)].map(m => m[1]))]
console.log('生产 RPC:', names.length ? names.join(', ') : out.slice(0, 400))
