#!/usr/bin/env node
/**
 * 上传港城游戏馆内容包（与 APK 分离）
 *   npm run games:upload
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACK = join(ROOT, 'lyg-game-pack')
const STAGE = join(ROOT, '.tmp-lyg-games')
const ENV_ID = 'jou-d4gq7a3cqf51e6caa'
const HOST = `https://${ENV_ID}-1394316826.tcloudbaseapp.com`

if (!existsSync(PACK)) {
  console.error('[lyg-games] missing', PACK)
  process.exit(1)
}

const files = readdirSync(PACK).filter((f) => !f.startsWith('_') && !f.startsWith('.'))
console.log('[lyg-games] upload', files.join(', '))

rmSync(STAGE, { recursive: true, force: true })
mkdirSync(join(STAGE, 'lyg-games'), { recursive: true })
for (const f of files) cpSync(join(PACK, f), join(STAGE, 'lyg-games', f))

const deployEnv = { ...process.env, NO_PROXY: '*' }
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy']) {
  delete deployEnv[k]
}

const r = spawnSync(
  'tcb',
  ['hosting', 'deploy', STAGE, '--env-id', ENV_ID, '--yes', '--concurrency', '1', '--retry-count', '5'],
  { stdio: 'inherit', shell: true, cwd: ROOT, env: deployEnv },
)
rmSync(STAGE, { recursive: true, force: true })
if (r.status !== 0) process.exit(r.status || 1)

console.log('[lyg-games] done')
console.log(`  manifest: ${HOST}/lyg-games/manifest.json`)
