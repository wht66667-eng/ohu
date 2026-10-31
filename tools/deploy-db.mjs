#!/usr/bin/env node
/**
 * 把 docs/release/*.sql 落到 CloudBase Postgres。
 *   npm run deploy:db
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REGION = process.env.CLOUDBASE_REGION || 'ap-shanghai'
const ENV_ID = (() => {
  const src = readFileSync(join(ROOT, 'src/lib/cb.ts'), 'utf8')
  const m = src.match(/CB_ENV_ID\s*=\s*'([^']+)'/)
  if (!m) {
    console.error('[deploy:db] 无法解析 CB_ENV_ID')
    process.exit(1)
  }
  return m[1]
})()

/**
 * 登记原则（改这个文件前务必读）：
 *
 * 1. 只登记「幂等且可安全重放」的功能迁移。回滚脚本（*-rollback.sql）、
 *    一次性安全提权脚本（security-*、super-admin-*）**不要登记**——
 *    前者会删东西，后者须运维单独审阅。
 * 2. 顺序即语义：同名函数后建的覆盖先建的。
 *    ⚠️ chat-media.sql 与 college-groups.sql 都定义了 chat_send /
 *    chat_messages_page，而 college-groups.sql 是**修复版**（修掉学院群的
 *    NULL 三值逻辑越权）。chat-media.sql 一旦排在它后面，重放就会把
 *    修复覆盖回带漏洞的旧版。故 chat-media.sql 暂不登记；若确需登记，
 *    必须排在 college-groups.sql **之前**并注释说明。
 * 3. docs/release 里其余未登记的脚本，其对应对象经核查均已在生产库存在
 *    （2026-10-11 核），属"历史手工执行过但没登记"，不必为补功能而重跑。
 */
const FILES = [
  join(ROOT, 'docs/release/client_prefs.sql'),
  join(ROOT, 'docs/release/character_assets.sql'),
  join(ROOT, 'docs/release/campus_links.sql'),
  join(ROOT, 'docs/release/plaza.sql'),
  join(ROOT, 'docs/release/plaza-sanctions.sql'),
  join(ROOT, 'docs/release/news-broadcast.sql'),
  join(ROOT, 'docs/release/qbank.sql'),
  join(ROOT, 'docs/release/reports_target_type.sql'),
  join(ROOT, 'docs/release/plaza-avatar.sql'),
  join(ROOT, 'docs/release/plaza-post-stats.sql'),
  join(ROOT, 'docs/release/plaza-post-fk.sql'),
  join(ROOT, 'docs/release/plaza-post-media.sql'),
  join(ROOT, 'docs/release/college-groups.sql'),
  join(ROOT, 'docs/release/function-rate-limit.sql'),
  join(ROOT, 'docs/release/ugc-images.sql'),
]

function hasBin(bin) {
  return spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' }).status === 0
}

function quote(arg) {
  return /[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg
}

function stripComments(sql) {
  return sql
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--')
      if (i === -1) return line
      return line.slice(0, i)
    })
    .join('\n')
}

function splitStatements(sql) {
  // 支持用 --SPLIT-- 作为块分隔符：含 $function$ dollar-quote 的文件，
  // 函数体内的 ; 会导致按 ; 切分出错，故用显式分隔符分块。
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
  // -r 必填：tcb db execute 不带 region 会直接报错
  const args = viaNpx
    ? ['--yes', '@cloudbase/cli', 'db', 'execute', '-e', ENV_ID, '-r', REGION, '--sql', flat]
    : ['db', 'execute', '-e', ENV_ID, '-r', REGION, '--sql', flat]
  if (apiKey) args.push('--cloudbase-api-key', apiKey)

  const line = [command, ...args].map(quote).join(' ')
  const run = spawnSync(line, {
    shell: true,
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  })
  if (run.status !== 0) {
    console.error(`[deploy:db] 失败 #${index}`)
    console.error(run.stdout || '')
    console.error(run.stderr || '')
    console.error('--- SQL preview ---')
    console.error(flat.slice(0, 500))
    process.exit(run.status ?? 1)
  }
  const tail = String(run.stdout || '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(-2)
    .join(' | ')
  console.log(`  ok #${index}${tail ? `: ${tail}` : ''}`)
}

function preflightFiles() {
  const missing = FILES.filter((file) => !existsSync(file))
  if (missing.length) {
    console.error(`[deploy:db] ${missing.length} 个登记迁移文件缺失：`)
    for (const file of missing) console.error(`  - ${file.slice(ROOT.length + 1)}`)
    console.error('[deploy:db] 尚未提交任何 SQL；请先恢复并核对全部权威迁移源。')
    return null
  }

  const prepared = FILES.map((file) => {
    const sql = readFileSync(file, 'utf8')
    const statements = splitStatements(sql)
    return { file, statements }
  })
  const empty = prepared.filter((item) => item.statements.length === 0)
  if (empty.length) {
    console.error('[deploy:db] 以下登记迁移没有可执行语句：')
    for (const item of empty) console.error(`  - ${item.file.slice(ROOT.length + 1)}`)
    console.error('[deploy:db] 尚未提交任何 SQL；请先检查迁移文件内容。')
    return null
  }
  return prepared
}

function main() {
  const prepared = preflightFiles()
  if (!prepared) process.exit(1)

  if (process.argv.includes('--check')) {
    console.log(`[check:db-migrations] 本地登记文件检查通过：${prepared.length} 个文件`)
    for (const item of prepared) {
      console.log(`  ${item.file.slice(ROOT.length + 1)} → ${item.statements.length} 条`)
    }
    console.log('[check:db-migrations] 未连接数据库，未执行 SQL。')
    return
  }

  console.log(`[deploy:db] 环境 ${ENV_ID}${hasBin('tcb') ? '' : '（npx @cloudbase/cli）'}`)
  for (const item of prepared) {
    const rel = item.file.slice(ROOT.length + 1)
    console.log(`[deploy:db] ${rel} → ${item.statements.length} 条`)
    item.statements.forEach((stmt, i) => runOne(stmt, i + 1))
  }

  const check =
    'tcb db execute -e ' +
    ENV_ID +
    ' --sql ' +
    quote('select count(*)::int as n from public.character_assets;')
  const verify = spawnSync(check, { shell: true, cwd: ROOT, encoding: 'utf8', windowsHide: true })
  console.log('[deploy:db] 校验 character_assets:')
  console.log((verify.stdout || verify.stderr || '').trim() || '(no output)')
  console.log('[deploy:db] 完成')
}

main()

