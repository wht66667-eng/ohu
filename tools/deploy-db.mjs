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
 * 4. 2026-11-12 重建登记：原 15 项登记文件全部缺失，已按生产 schema 快照
 *    （docs/audit/cloud-schema-readonly-2026-10-15.json）+ 前端调用契约重建，
 *    并补登记 5 个原缺失的基线迁移（profiles-base / todos-base / friends-base /
 *    energy-goals / notifications-rpc）与 meet-invitations.sql。全部文件头部
 *    带「重建基线」说明；标注●推断处执行前须与生产 schema 复核。
 * 5. 全新空库重建顺序：先按 docs/sql/REBUILD-PLAYBOOK.md 执行历史基线
 *    （docs/sql/*.sql），再按本数组顺序重放 docs/release/*.sql。
 */
const FILES = [
  join(ROOT, 'docs/release/client_prefs.sql'),
  join(ROOT, 'docs/release/character_assets.sql'),
  join(ROOT, 'docs/release/campus_links.sql'),
  // profiles-base 提供 current_is_anon / is_admin_user / is_super_admin_user，
  // 下方 plaza / news-broadcast / college-groups 的 RLS 策略引用它们，必须在前。
  join(ROOT, 'docs/release/profiles-base.sql'),
  // todo_remind_scan（notifications-rpc.sql）扫描 todos 表，todos-base 必须在前。
  join(ROOT, 'docs/release/todos-base.sql'),
  // friends-authorization-131.sql（docs/sql，历史基线）的触发器/函数依赖这两张表。
  join(ROOT, 'docs/release/friends-base.sql'),
  join(ROOT, 'docs/release/energy-goals.sql'),
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
  // todo_remind_scan 依赖 todos 表（上方 todos-base）。
  join(ROOT, 'docs/release/notifications-rpc.sql'),
  join(ROOT, 'docs/release/meet-invitations.sql'),
  join(ROOT, 'docs/release/function-rate-limit.sql'),
  join(ROOT, 'docs/release/ugc-images.sql'),
  // 社工端邀请码 + 课表互享（2026-11-13 窗口 A）。social_session_uid/is_admin_user
  // 守卫依赖上方 profiles-base.sql；含 $fn$ 函数体，文件内用 --SPLIT-- 分块。
  join(ROOT, 'docs/sql/social-invites-166.sql'),
]
// --files <逗号分隔路径>：只执行指定迁移（相对 ROOT），用于授权范围内的精准部署。
// 事故整改配套：不再需要为部署单个文件而重放全量 FILES。
let scoped = null
{
  const filesArg = process.argv.find((arg) => arg.startsWith('--files='))
  if (filesArg) {
    scoped = filesArg.split('=')[1].split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => (s.startsWith('/') || /^[a-zA-Z]:/.test(s) ? s : join(ROOT, s)))
  }
}


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
  const list = scoped || FILES
  const missing = list.filter((file) => !existsSync(file))
  if (missing.length) {
    console.error(`[deploy:db] ${missing.length} 个登记迁移文件缺失：`)
    for (const file of missing) console.error(`  - ${file.slice(ROOT.length + 1)}`)
    console.error('[deploy:db] 尚未提交任何 SQL；请先恢复并核对全部权威迁移源。')
    return null
  }

  const prepared = list.map((file) => {
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


// 主模块守卫（2026-11-14 事故整改）：此前顶层裸调用 main()，任何 import（哪怕只为复用
// splitStatements 做验证）都会直接对生产库重放登记迁移。现在仅当本文件被作为
// 入口脚本执行时才运行；复用函数请 import 具名导出并自行走 --check 只读路径。
import { pathToFileURL } from 'node:url'
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
