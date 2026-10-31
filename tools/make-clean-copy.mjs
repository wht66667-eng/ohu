/**
 * 把主工程复制一份「干净副本」到桌面文件夹。
 *
 * 为什么不是整拷：主工程 2.9GB / 6.9 万个文件，其中
 *   android/app/build 1.94GB、node_modules 564MB、android/.gradle 61MB、
 *   android/_stale* 100MB、根目录 .mumu-*.png 截图 ~30MB
 * 全是构建产物与临时物，跟源码无关，整拷会白白多搬 2.7GB。
 *
 * 安全取舍：.env.capgo / .env.development / .env.production / .capgo-credentials.json
 * 含真实凭据，**不复制**；需要的样例在 config-examples/ 与 .env.capgo.example。
 *
 * 用法：node tools/make-clean-copy.mjs <目标目录> [--apply]   （不带 --apply 只统计）
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const dest = process.argv[2]
const APPLY = process.argv.includes('--apply')

if (!dest) {
  console.error('usage: node tools/make-clean-copy.mjs <目标目录> [--apply]')
  process.exit(1)
}

/** 复制这些顶层项 */
const TOP_DIRS = [
  'src', 'public', 'tools', 'docs', 'ios', 'android',
  'cloudfunctions', 'design', 'design-system', 'design-refs',
  'patches', 'config-examples', 'harbor-world-pack',
]
const TOP_FILES = [
  'index.html', 'package.json', 'package-lock.json',
  'vite.config.ts', 'vite.ui-review.config.ts',
  'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json',
  'capacitor.config.ts', 'cloudbaserc.json', '.oxlintrc.json', '.gitignore',
  '.env.capgo.example',
  'README.md', 'SETUP.md', 'SECURITY_CHECKLIST.md', 'CODEBUDDY_DEPLOY.md', 'ASSET_REPORT.md',
  'capgo-mcp.cmd',
]

/** 任意层级都跳过的目录名 */
const SKIP_DIR_NAMES = new Set(['node_modules', '.git', '.gradle', 'build', '__pycache__', '.kotlin', 'Pods', '.cache'])
/** 任意层级都跳过的目录名前缀 */
const SKIP_DIR_PREFIXES = ['dist', '.ota-out', '_stale', '.codetmp', '.tmp', '_build_check', '_verify_', '_grid', '_backup-pets']
/** 跳过的文件：前缀 */
const SKIP_FILE_PREFIXES = ['.mumu-', 'sc-', '.tmp']
/** 跳过的文件：后缀 */
const SKIP_FILE_SUFFIXES = ['.log']
/** 跳过的文件：精确名（凭据 / 临时物） */
const SKIP_FILE_NAMES = new Set([
  '.env.capgo', '.env.development', '.env.production', '.capgo-credentials.json', '.capgo',
  'ui.xml', 'reminder-preview.html', 'ui-review-preview.html', '_capgo_probe_cfg.ts',
  'phone', 'dev-server.log', 'dev.err.log', 'dev.log', 'vite-out.log', 'vite-err.log', 'vite.log',
])

function skipDir(name) {
  if (SKIP_DIR_NAMES.has(name)) return true
  return SKIP_DIR_PREFIXES.some((p) => name.startsWith(p))
}
function skipFile(name) {
  if (SKIP_FILE_NAMES.has(name)) return true
  if (SKIP_FILE_PREFIXES.some((p) => name.startsWith(p))) return true
  if (SKIP_FILE_SUFFIXES.some((p) => name.endsWith(p))) return true
  return false
}

let copied = 0
let bytes = 0
let skippedDirs = 0
const missing = []

function walk(srcRel) {
  const abs = join(ROOT, srcRel)
  const ents = readdirSync(abs, { withFileTypes: true })
  for (const ent of ents) {
    const rel = srcRel ? join(srcRel, ent.name) : ent.name
    if (ent.isDirectory()) {
      if (skipDir(ent.name)) { skippedDirs += 1; continue }
      walk(rel)
      continue
    }
    if (skipFile(ent.name)) continue
    const st = statSync(join(ROOT, rel))
    bytes += st.size
    copied += 1
    if (APPLY) {
      const to = join(dest, rel)
      mkdirSync(to.slice(0, to.lastIndexOf('\\')), { recursive: true })
      cpSync(join(ROOT, rel), to)
    }
  }
}

for (const d of TOP_DIRS) {
  if (existsSync(join(ROOT, d))) walk(d)
  else missing.push(d)
}
for (const f of TOP_FILES) {
  const p = join(ROOT, f)
  if (!existsSync(p)) { missing.push(f); continue }
  const st = statSync(p)
  bytes += st.size
  copied += 1
  if (APPLY) {
    const to = join(dest, f)
    mkdirSync(to.slice(0, to.lastIndexOf('\\')), { recursive: true })
    cpSync(p, to)
  }
}

const mb = (b) => (b / 1048576).toFixed(1)
console.log(`${APPLY ? '已复制' : '预计复制'}：${copied} 个文件，${mb(bytes)} MB`)
console.log(`跳过 ${skippedDirs} 个目录（build / node_modules / dist* / _stale* 等）`)
if (missing.length) console.log(`源工程里不存在：${missing.join(', ')}`)
console.log(`\n刻意不复制（含凭据）：.env.capgo / .env.development / .env.production / .capgo-credentials.json`)
