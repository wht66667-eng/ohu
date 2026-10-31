#!/usr/bin/env node
/**
 * 把 dist/ 发布到 CloudBase 静态托管（线上域：<envId>-<appId>.tcloudbaseapp.com）。
 *
 * 用法：
 *   npm run build && npm run deploy:hosting
 *   CLOUDBASE_API_KEY=<key> npm run deploy:hosting     # 无 tcb 登录态的机器 / CI
 *
 * 约定：
 * - 环境 ID 从 `src/lib/cb.ts` 读取，避免脚本与前端常量漂移；
 * - 上传走官方 CLI `tcb hosting deploy`，本机未装 tcb 时自动改用 npx 拉取；
 * - 托管侧的 SPA 回退（ErrorDocument + 404 重写到 index.html）与 Web 安全域名白名单
 *   属于环境级配置，不是本脚本的职责，脚本在结尾打印这两项的核对方式。
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertOutputPath, clearOutput, isMain, readReleaseIdentity } from './release-common.mjs'
import { prepareStudentDownload } from './student-download.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')

/** 从 src/lib/cb.ts 解析线上环境 ID，保证与前端连的后端一致 */
function readEnvId() {
  const src = readFileSync(join(ROOT, 'src/lib/cb.ts'), 'utf8')
  const matched = src.match(/CB_ENV_ID\s*=\s*'([^']+)'/)
  if (!matched) {
    console.error('[deploy] 无法从 src/lib/cb.ts 解析 CB_ENV_ID，请检查该文件。')
    process.exit(1)
  }
  return matched[1]
}

/** 上线前检查：产物存在、样式脚本齐全、index.html 引用的是域根绝对路径 */
function assertBuild() {
  const indexPath = join(DIST, 'index.html')
  if (!existsSync(indexPath)) {
    console.error('[deploy] 找不到 dist/index.html，请先执行 npm run build。')
    process.exit(1)
  }
  const assetsDir = join(DIST, 'assets')
  const assetCount = existsSync(assetsDir) ? readdirSync(assetsDir).length : 0
  if (assetCount === 0) {
    console.error('[deploy] dist/assets 为空，产物不完整，请重新执行 npm run build。')
    process.exit(1)
  }
  const html = readFileSync(indexPath, 'utf8')
  if (!html.includes('src="/assets/')) {
    console.error('[deploy] dist/index.html 未使用 "/assets/..." 绝对路径，站点部署在域根会 404，请检查 vite 的 base 配置。')
    process.exit(1)
  }
  const atlasDir = join(DIST, 'pets', 'atlases')
  const atlasCount = existsSync(atlasDir) ? readdirSync(atlasDir).filter((n) => n.endsWith('.png')).length : 0
  if (atlasCount < 1) {
    console.warn('[deploy] 警告：dist/pets/atlases 无 PNG。角色帧动画可能 404，请确认 public/pets/atlases 已生成（npm run gen:atlas）。')
  } else {
    console.log(`[deploy] 角色图集：pets/atlases ${atlasCount} 张。`)
  }
  console.log(`[deploy] 产物检查通过：assets ${assetCount} 个文件，index.html 引用域根绝对路径。`)
}

function hasBin(bin) {
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' })
  return probe.status === 0
}

function quote(arg) {
  if (/["%&|<>^!\r\n]/.test(arg)) throw new Error('Unsupported shell character in deployment argument')
  return `"${arg}"`
}

/** Website deployments must never overwrite the independently published APK/OTA manifests. */
export function prepareWebUpload(root = ROOT) {
  const source = join(root, 'dist')
  if (!existsSync(join(source, 'index.html'))) throw new Error('Build the website first')
  const output = assertOutputPath(root, join(root, '.release-out'), join(root, '.release-out/web-upload'))
  clearOutput(root, join(root, '.release-out'), output)
  cpSync(source, output, { recursive: true, filter: (path) => {
    const rel = relative(source, path).replaceAll('\\', '/')
    return !['update.json', 'downloads', 'ota'].some(item => rel === item || rel.startsWith(item + '/'))
  } })
  if (existsSync(join(source, 'download/student.html'))) {
    const manifestPath = join(root, '.release-out/apk-upload-manifest/update.json')
    if (!existsSync(manifestPath)) throw new Error('Prepare verified APK downloads before publishing the website')
    prepareStudentDownload(root, output, JSON.parse(readFileSync(manifestPath, 'utf8')), readReleaseIdentity(root))
  }
  return output
}

function main() {
  const envId = readEnvId()
  assertBuild()
  prepareWebUpload()

  const apiKey = process.env.CLOUDBASE_API_KEY
  const viaNpx = !hasBin('tcb')
  const command = viaNpx ? 'npx' : 'tcb'
  const args = viaNpx
    ? ['--yes', '@cloudbase/cli', 'hosting', 'deploy', './.release-out/web-upload', '--env-id', envId, '--yes']
    : ['hosting', 'deploy', './.release-out/web-upload', '--env-id', envId, '--yes']
  if (apiKey) args.push('--cloudbase-api-key', apiKey)

  const line = [command, ...args].map(quote).join(' ')
  console.log(`[deploy] 目标环境 ${envId}${apiKey ? '（使用 CLOUDBASE_API_KEY）' : '（使用 tcb 登录态）'}`)
  if (viaNpx) console.log('[deploy] 未检测到 tcb，改用 npx @cloudbase/cli。')
  console.log('[deploy] 上传电脑网页；APK 和 OTA 的清单保持独立。')

  const run = spawnSync(line, { shell: true, stdio: 'inherit', cwd: ROOT })
  if (run.status !== 0) {
    console.error('\n[deploy] 上传失败。常见原因：')
    console.error('  · 未登录：先执行 tcb login，或设置 CLOUDBASE_API_KEY 后重试；')
    console.error('  · 环境 ID 无权限：确认账号对该环境有访问权。')
    process.exit(run.status ?? 1)
  }

  const site = `https://${envId}-1394316826.tcloudbaseapp.com`
  console.log(`\n[deploy] 上传完成，站点：${site}`)
  console.log('[deploy] 自检（应全部返回 200，且子路由返回 index.html 内容）：')
  for (const p of ['/', '/admin', '/admin/content', '/admin/news']) console.log(`  ${site}${p}`)
  console.log('[deploy] 环境级配置核对（一次性，改配置时才需要）：')
  console.log('  · SPA 回退：ErrorDocument = index.html，404 重写到 index.html；')
  console.log('  · Web 安全域名：托管域需在「环境 - 安全配置 - Web 安全域名」白名单内，否则匿名登录与读库会被跨域拦截。')
}

if (isMain(import.meta.url)) main()
