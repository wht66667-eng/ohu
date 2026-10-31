#!/usr/bin/env node
/** H5 uses /assets; App bundles use relative paths. --no-sync prepares Web-only OTA assets. */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pruneUnusedDraco } from './prune-draco-assets.mjs'
import { stageVerifiedIosDownload } from './ios-download-release.mjs'
import {
  PROJECT_ROOT, assertOutputPath, clearOutput, isMain, parseOptions, readReleaseIdentity, selectShells,
} from './release-common.mjs'

export function existingPlatforms(root = PROJECT_ROOT) {
  return ['android', 'ios'].filter(platform => existsSync(join(root, platform)))
}

/** Keep student-only downloads and appearance packs out of the management distribution. */
export function trimShellPublicAssets(root, output, shell) {
  if (shell !== 'admin') return
  assertOutputPath(root, output)
  for (const name of ['download', 'launcher-icon-previews', 'theme-packs', 'last-snapshot.json']) {
    clearOutput(root, output, join(output, name))
  }
}

/** Source IPAs are never copied into application/web bundles; distribute only through a verified release channel. */
export function removeBundledIpaArtifacts(root, output) {
  assertOutputPath(root, output)
  const download = join(output, 'download')
  if (!existsSync(download)) return
  for (const entry of readdirSync(download, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.ipa')) {
      clearOutput(root, output, join(download, entry.name))
    }
  }
}

export function buildPlan(root, argv = [], env = process.env) {
  const target = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'all'
  const options = parseOptions(argv[0] === target ? argv.slice(1) : argv, ['--shell'], ['--no-sync', '--plan', '--help'])
  if (!['h5', 'app', 'all'].includes(target)) throw new Error('Target must be h5, app, or all')
  const shell = options['--shell'] || env.VITE_APP_SHELL || 'user'
  if (selectShells(shell).length !== 1) throw new Error('A Web bundle must target one shell')
  return {
    target, shell, options,
    outputs: target === 'all' ? ['dist', 'dist-app'] : [target === 'h5' ? 'dist' : 'dist-app'],
    platforms: target === 'h5' || options['--no-sync'] ? [] : existingPlatforms(root),
  }
}

export function main({ root = PROJECT_ROOT, argv = process.argv.slice(2), env = process.env, execute } = {}) {
  const plan = buildPlan(root, argv, env)
  if (plan.options['--help']) {
    console.log('node tools/build-multiplatform.mjs [h5|app|all] [--shell user|admin] [--no-sync] [--plan]')
    return plan
  }
  if (plan.options['--plan']) {
    console.log(JSON.stringify(plan, null, 2))
    return plan
  }
  const run = execute || ((label, args, extraEnv = {}) => {
    console.log(`[build] ${label}`)
    const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...env, ...extraEnv } })
    if (result.error || result.status !== 0) throw new Error(`${label} failed (${result.error?.message || result.status})`)
  })
  const identity = readReleaseIdentity(root)
  // Both OTA and APK entry points pass here. Keep existing outputs intact if types fail.
  run('TypeScript check', [join(root, 'node_modules/typescript/bin/tsc'), '-b'])
  for (const output of plan.outputs) {
    const base = output === 'dist' ? '/' : './'
    const destination = assertOutputPath(root, join(root, output))
    clearOutput(root, destination)
    run(`Web ${output} (${plan.shell})`, [
      join(root, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', output,
      '--base', base, '--emptyOutDir', 'false',
    ], {
      VITE_BASE: base, VITE_APP_SHELL: plan.shell,
      VITE_CAPGO_APP_ID: env.VITE_CAPGO_APP_ID || 'com.sunshinecampus.app',
    })
    pruneUnusedDraco(destination)
    trimShellPublicAssets(root, destination, plan.shell)
    removeBundledIpaArtifacts(root, destination)
    const iosArtifact = output === 'dist' && plan.shell === 'user'
      ? stageVerifiedIosDownload(root, destination, identity)
      : null
    if (plan.shell === 'user') {
      const downloadDirectory = join(destination, 'download')
      mkdirSync(downloadDirectory, { recursive: true })
      writeFileSync(join(downloadDirectory, 'source-identity.json'), JSON.stringify({
        nativeVersion: identity.nativeVersion, nativeBuild: identity.nativeBuild,
        iosDownloadAvailable: Boolean(iosArtifact),
      }, null, 2))
    }
    mkdirSync(destination, { recursive: true })
    writeFileSync(join(destination, 'release-target.json'), JSON.stringify({
      target: output === 'dist' ? 'h5' : 'app', shell: plan.shell,
      entry: plan.shell === 'admin' ? 'admin' : output === 'dist' ? 'shared-web' : 'student',
      version: identity.version, webBuild: identity.webBuild, nativeBuild: identity.nativeBuild,
    }, null, 2))
  }
  for (const platform of plan.platforms) {
    const generated = platform === 'android'
      ? ['android/app/src/main/assets/public', 'android/capacitor-cordova-android-plugins']
      : ['ios/App/App/public', 'ios/capacitor-cordova-ios-plugins']
    for (const output of generated) clearOutput(root, join(root, output))
    run(`Capacitor sync ${platform}`, [join(root, 'node_modules/@capacitor/cli/bin/capacitor'), 'sync', platform])
  }
  console.log('[build] done')
  return plan
}

if (isMain(import.meta.url)) {
  try { main() } catch (error) { console.error(`[build] ${error.message}`); process.exitCode = 1 }
}

