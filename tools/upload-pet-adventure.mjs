#!/usr/bin/env node
/**
 * 上传精灵冒险包到 CDN（与 APK / 主 OTA 分离）
 *
 *   npm run adventure:upload
 *
 * 产物：
 *   /pet-adventure/manifest.json
 *   /pet-adventure/lyg-spawns.json
 *   …
 */
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PACK = join(ROOT, 'pet-adventure-pack')
const STAGE = join(ROOT, '.tmp-pet-adventure')
const ENV_ID = 'jou-d4gq7a3cqf51e6caa'
const HOST = `https://${ENV_ID}-1394316826.tcloudbaseapp.com`

if (!existsSync(PACK)) {
  console.error('[pet-adventure] missing', PACK)
  process.exit(1)
}

const files = readdirSync(PACK).filter((f) => !f.startsWith('_') && !f.startsWith('.'))
console.log('[pet-adventure] upload', files.join(', '))

rmSync(STAGE, { recursive: true, force: true })
mkdirSync(join(STAGE, 'pet-adventure'), { recursive: true })
for (const f of files) {
  cpSync(join(PACK, f), join(STAGE, 'pet-adventure', f))
}

const deployEnv = { ...process.env, NO_PROXY: '*' }
for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy']) {
  delete deployEnv[k]
}

const r = spawnSync(
  'tcb',
  [
    'hosting',
    'deploy',
    STAGE,
    '--env-id',
    ENV_ID,
    '--yes',
    '--concurrency',
    '1',
    '--retry-count',
    '5',
  ],
  { stdio: 'inherit', shell: true, cwd: ROOT, env: deployEnv },
)
rmSync(STAGE, { recursive: true, force: true })
if (r.status !== 0) process.exit(r.status || 1)

console.log('[pet-adventure] done')
console.log(`  manifest: ${HOST}/pet-adventure/manifest.json`)
console.log('  App 内需用户手动点击「下载冒险包」才会拉取到本机')
