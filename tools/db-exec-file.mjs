#!/usr/bin/env node
/**
 * 执行单个 SQL 文件（幂等迁移 / 回滚）。
 *   node tools/db-exec-file.mjs docs/release/energy-plan.sql
 *
 * 与 deploy-db.mjs 同一套切分规则：文件里出现 --SPLIT-- 就按块执行（含
 * $function$ dollar-quote 的函数必须走这条），否则按 ; 切。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENV_ID = (() => {
  const src = readFileSync(join(ROOT, 'src/lib/cb.ts'), 'utf8')
  const m = src.match(/CB_ENV_ID\s*=\s*'([^']+)'/)
  if (!m) {
    console.error('[db:file] 无法解析 CB_ENV_ID')
    process.exit(1)
  }
  return m[1]
})()

const file = process.argv[2]
if (!file) {
  console.error('[db:file] 用法：node tools/db-exec-file.mjs <sql 文件>')
  process.exit(1)
}
const abs = resolve(process.cwd(), file)
if (!existsSync(abs)) {
  console.error(`[db:file] 找不到 ${abs}`)
  process.exit(1)
}

function hasBin(bin) {
  return spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' }).status === 0
}

function quote(arg) {
  return /[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg
}

/** 去掉 -- 行注释与 /* *\/ 块注释（文件头说明常写成块注释，不剥会被当 SQL 执行） */
function stripComments(sql) {
  const noBlock = sql.replace(/\/\*[\s\S]*?\*\//g, '')
  return noBlock
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--')
      if (i === -1) return line
      return line.slice(0, i)
    })
    .join('\n')
}

function splitStatements(sql) {
  if (sql.includes('--SPLIT--')) {
    return sql
      .split('--SPLIT--')
      .map((s) => stripComments(s).trim())
      .filter((s) => s.length > 0)
  }
  return stripComments(sql)
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => `${s};`)
}

function runOne(stmt, index) {
  const apiKey = process.env.CLOUDBASE_API_KEY
  const viaNpx = !hasBin('tcb')
  const command = viaNpx ? 'npx' : 'tcb'
  // Windows cmd 对多行 --sql 不友好：压成单行
  const flat = stmt.replace(/\s+/g, ' ').trim()
  const args = viaNpx
    ? ['--yes', '@cloudbase/cli', 'db', 'execute', '-e', ENV_ID, '--sql', flat]
    : ['db', 'execute', '-e', ENV_ID, '--sql', flat]
  if (apiKey) args.push('--cloudbase-api-key', apiKey)

  const line = [command, ...args].map(quote).join(' ')
  // 云 API 走代理，偶发隧道失败（status 非 0 且无输出）：重试 3 次再判定失败
  let run = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    run = spawnSync(line, {
      shell: true,
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      windowsHide: true,
    })
    if (run.status === 0) break
    if (attempt < 3) {
      console.log(`  retry #${index}（第 ${attempt} 次失败，2s 后重试）`)
      spawnSync('sleep', ['2'], { stdio: 'ignore' })
    }
  }
  if (!run || run.status !== 0) {
    console.error(`[db:file] 失败 #${index}`)
    console.error(run?.stdout || '')
    console.error(run?.stderr || '')
    console.error(run?.error ? `spawn error: ${run.error.message}` : '')
    console.error('--- SQL preview ---')
    console.error(flat.slice(0, 500))
    process.exit(run?.status ?? 1)
  }
  const out = String(run.stdout || '').trim()
  const tail = out.split('\n').filter(Boolean).slice(-1).join('')
  console.log(`  ok #${index}${tail ? `: ${tail}` : ''}`)
}

const stmts = splitStatements(readFileSync(abs, 'utf8'))
console.log(`[db:file] ${file} → ${stmts.length} 条（环境 ${ENV_ID}）`)
stmts.forEach((stmt, i) => runOne(stmt, i + 1))
console.log('[db:file] 完成')
