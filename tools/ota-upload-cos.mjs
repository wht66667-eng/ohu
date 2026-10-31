#!/usr/bin/env node
/** Prepare separate OTA bundles for student/admin; publish bytes before switching manifests. */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pruneUnusedDraco } from './prune-draco-assets.mjs'
import {
  PROJECT_ROOT, assertOutputPath, clearOutput, copyImmutableFile, isMain, isWithin,
  parseOptions, positiveInteger, readReleaseIdentity, selectShells, sha256File, validateVersion,
} from './release-common.mjs'

const require = createRequire(import.meta.url)
const ENV_ID = 'jou-d4gq7a3cqf51e6caa'
const DEFAULT_HOST = `https://${ENV_ID}-1394316826.tcloudbaseapp.com`

export function otaPlan(root, argv = [], env = process.env) {
  const options = parseOptions(argv, ['--version', '--build', '--shell', '--notes', '--min-native-build'],
    ['--skip-build', '--prepare-only', '--skip-recompress', '--plan', '--help'])
  const identity = readReleaseIdentity(root)
  const version = validateVersion(options['--version'] || identity.version)
  const build = positiveInteger(options['--build'] || identity.webBuild, 'OTA build')
  if (version !== identity.version || build !== identity.webBuild) throw new Error('OTA version/build must match package.json and src/lib/app-version.ts; update source metadata first')
  const minNativeBuild = positiveInteger(options['--min-native-build'] || identity.nativeBuild, 'minNativeBuild')
  const shells = selectShells(options['--shell'] || env.OTA_SHELL || 'user')
  const outDir = resolve(root, env.OTA_OUT || '.ota-out')
  const outputRoot = isWithin(join(root, '.ota-out'), outDir)
    ? join(root, '.ota-out') : join(root, '.release-out/ota')
  assertOutputPath(root, outputRoot, outDir)
  const host = new URL(env.OTA_CDN_HOST || DEFAULT_HOST)
  if (host.protocol !== 'https:' || host.username || host.password || host.search || host.hash) throw new Error('OTA_CDN_HOST must be a plain HTTPS URL')
  const dist = Object.fromEntries(shells.map(shell => {
    const path = resolve(root, env[`OTA_DIST_${shell.toUpperCase()}`] || env.OTA_DIST || 'dist-app')
    if (!isWithin(root, path, false) || isWithin(outputRoot, path) || isWithin(path, outDir)) throw new Error(`Unsafe OTA input directory: ${path}`)
    if (!options['--skip-build'] && path !== join(root, 'dist-app')) throw new Error('Custom OTA_DIST requires --skip-build')
    return [shell, path]
  }))
  return { version, build, minNativeBuild, shells, options, outDir, outputRoot, dist,
    host: host.href.replace(/\/$/, ''), notes: options['--notes'] || `界面热更新 ${version}` }
}

export function assertWebBundle(dist, shell, version, build) {
  if (!existsSync(join(dist, 'index.html'))) throw new Error(`Missing ${dist}/index.html`)
  function inspect(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (lstatSync(path).isSymbolicLink()) throw new Error(`Web bundle must not contain symlinks: ${path}`)
      if (/^(?:\.env(?:\.|$)|\.capgo(?:-|$)|\.git$|node_modules$)/i.test(entry.name) ||
          /\.(?:apk|aab|jks|keystore|p12|pfx)$/i.test(entry.name)) {
        throw new Error(`Release/credential file must not be included in OTA Web assets: ${path}`)
      }
      if (entry.isDirectory()) inspect(path)
    }
  }
  inspect(dist)
  const marker = join(dist, 'release-target.json')
  if (!existsSync(marker)) throw new Error(`Missing ${marker}; rebuild with the current build:app tool before --skip-build`)
  const target = JSON.parse(readFileSync(marker, 'utf8'))
  if (target.target !== 'app' || target.shell !== shell || target.version !== version || (build !== undefined && target.webBuild !== build)) {
    throw new Error(`OTA input does not match shell/version ${shell} ${version}: ${marker}`)
  }
  return target
}

/** Prefer the installed Node entry point: cmd.exe quoting breaks Unicode/space paths. */
export function windowsCloudbaseInvocation(cli, args, env = process.env) {
  if (!/\.cmd$/i.test(cli)) return { executable: cli, parameters: args }
  const packageRoot = join(dirname(cli), 'node_modules', '@cloudbase', 'cli')
  const metadata = join(packageRoot, 'package.json')
  if (existsSync(metadata)) {
    const pkg = JSON.parse(readFileSync(metadata, 'utf8'))
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.tcb
    const entry = typeof bin === 'string' ? resolve(packageRoot, bin) : ''
    if (pkg.name !== '@cloudbase/cli' || !entry || !isWithin(packageRoot, entry, false) || !existsSync(entry) || !statSync(entry).isFile()) throw new Error('Installed CloudBase CLI has an invalid Node entry point')
    return { executable: process.execPath, parameters: [entry, ...args] }
  }
  // Retain support for wrappers that do not use npm's adjacent package layout.
  const quote = value => {
    if (/["%!&|<>^\r\n]/.test(value)) throw new Error('Unsupported shell character in CloudBase CLI argument')
    return `"${value}"`
  }
  return { executable: env.ComSpec || 'cmd.exe', parameters: ['/d', '/s', '/c', `"${[cli, ...args].map(quote).join(' ')}"`] }
}

export function runExternal(command, args, { root, env }) {
  let executable = command
  let parameters = args
  if (process.platform === 'win32' && command === 'tcb') {
    const found = spawnSync('where.exe', ['tcb'], { encoding: 'utf8', env })
    const cli = found.status === 0 && found.stdout.split(/\r?\n/).find(line => /\.(?:cmd|exe)$/i.test(line.trim()))?.trim()
    if (!cli) throw new Error('CloudBase CLI not found. Install/login to tcb before publishing; --prepare-only does not need it.')
    const invocation = windowsCloudbaseInvocation(cli, args, env)
    executable = invocation.executable
    parameters = invocation.parameters
  }
  const result = spawnSync(executable, parameters, { cwd: root, env, stdio: 'inherit' })
  if (result.error || result.status !== 0) throw new Error(`OTA command failed: ${result.error?.message || command} (${result.status})`)
}

export function bundleFileName(version, build, checksum) {
  validateVersion(version)
  positiveInteger(build, 'OTA build')
  if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error('A complete SHA-256 checksum is required')
  return `${version}-${build}-${checksum}.zip`
}

function writeJson(root, outputRoot, path, value) {
  const target = assertOutputPath(root, outputRoot, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, JSON.stringify(value, null, 2), 'utf8')
}

async function prepareShell({ root, env, plan, shell, run }) {
  if (!plan.options['--skip-build']) {
    run(process.execPath, [join(root, 'tools/build-multiplatform.mjs'), 'app', '--no-sync', '--shell', shell], {
      root, env: { ...env, VITE_APP_SHELL: shell },
    })
  }
  const dist = plan.dist[shell]
  assertWebBundle(dist, shell, plan.version, plan.build)
  const work = assertOutputPath(root, plan.outputRoot, join(plan.outDir, `work-${shell}`))
  clearOutput(root, plan.outputRoot, work)
  const staging = join(work, 'staging')
  mkdirSync(work, { recursive: true })
  cpSync(dist, staging, { recursive: true })
  assertOutputPath(root, plan.outputRoot, staging)
  pruneUnusedDraco(staging)

  if (!plan.options['--skip-recompress']) {
    run('python', [join(root, 'tools/ota-recompress-staging.py'), staging], { root, env })
  }

  const packRoot = join(root, 'harbor-world-pack')
  const packManifest = join(packRoot, 'manifest.json')
  if (shell === 'user' && existsSync(packManifest)) {
    const pack = JSON.parse(readFileSync(packManifest, 'utf8'))
    const bundled = join(staging, 'harbor-world')
    mkdirSync(bundled, { recursive: true })
    for (const file of pack.files || []) {
      const from = resolve(packRoot, file)
      const to = resolve(bundled, file)
      if (!isWithin(packRoot, from, false) || !isWithin(bundled, to, false)) throw new Error('Content pack contains a path outside its directory')
      assertOutputPath(root, plan.outputRoot, to)
      mkdirSync(dirname(to), { recursive: true })
      cpSync(from, to)
    }
    cpSync(packManifest, join(bundled, 'manifest.json'))
  }
  // Check again after optional content-pack copies and before archiving.
  assertWebBundle(staging, shell, plan.version, plan.build)
  const AdmZip = require('adm-zip')
  const zip = new AdmZip()
  zip.addLocalFolder(staging)
  const pendingZip = assertOutputPath(root, plan.outputRoot, join(work, 'bundle.zip'))
  zip.writeZip(pendingZip)
  const checksum = sha256File(pendingZip)
  const fileName = bundleFileName(plan.version, plan.build, checksum)
  const bundlePath = copyImmutableFile(root, plan.outputRoot, pendingZip, join(plan.outDir, 'bundles', shell, fileName))
  const manifest = {
    version: plan.version, build: plan.build, shell, minNativeBuild: plan.minNativeBuild,
    url: `${plan.host}/ota/${shell}/bundles/${fileName}`,
    checksum, size: statSync(bundlePath).size, notes: [plan.notes],
    updatedAt: new Date().toISOString(), channel: 'production', provider: 'tcb-cos-cdn',
  }
  writeJson(root, plan.outputRoot, join(plan.outDir, `manifest-${shell}.json`), manifest)
  writeJson(root, plan.outputRoot, join(plan.outDir, 'prepared', shell, `${plan.version}-${plan.build}`, 'manifest.json'), manifest)
  console.log(`[ota] prepared ${shell} ${plan.version}/${plan.build}; minimum native build ${plan.minNativeBuild}`)
  return { shell, manifest, fileName, bundlePath }
}

function uploadDirectories(root, plan, prepared) {
  return prepared.map(item => {
    const bundleRoot = join(plan.outDir, `upload-bundle-only-${item.shell}`)
    const manifestRoot = join(plan.outDir, `upload-manifest-only-${item.shell}`)
    for (const dir of [bundleRoot, manifestRoot]) clearOutput(root, plan.outputRoot, dir)
    copyImmutableFile(root, plan.outputRoot, item.bundlePath, join(bundleRoot, 'ota', item.shell, 'bundles', item.fileName))
    writeJson(root, plan.outputRoot, join(manifestRoot, 'ota', item.shell, 'manifest.json'), item.manifest)
    if (item.shell === 'user') writeJson(root, plan.outputRoot, join(manifestRoot, 'ota/manifest.json'), item.manifest)
    return { bundleRoot, manifestRoot }
  })
}

export async function main({ root = PROJECT_ROOT, argv = process.argv.slice(2), env = process.env, run = runExternal } = {}) {
  if (argv.includes('--help')) {
    console.log('node tools/ota-upload-cos.mjs [--shell user|admin|both] [--version x.y.z] [--build n] [--min-native-build n] [--prepare-only] [--skip-build] [--skip-recompress] [--plan]')
    return []
  }
  const plan = otaPlan(root, argv, env)
  if (plan.options['--plan']) {
    console.log(JSON.stringify({ version: plan.version, build: plan.build, shells: plan.shells, minNativeBuild: plan.minNativeBuild, outDir: plan.outDir }, null, 2))
    return []
  }
  // Reject a wrong-shell --skip-build input before cleaning or preparing either output.
  if (plan.options['--skip-build']) for (const shell of plan.shells) assertWebBundle(plan.dist[shell], shell, plan.version, plan.build)
  const prepared = []
  for (const shell of plan.shells) prepared.push(await prepareShell({ root, env, plan, shell, run }))
  if (plan.options['--prepare-only']) {
    console.log(`[ota] ${prepared.length} shell bundle(s) prepared locally; production manifests unchanged.`)
    return prepared
  }
  const uploads = uploadDirectories(root, plan, prepared)
  const deployEnv = {
    ...env, HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', http_proxy: '', https_proxy: '',
    all_proxy: '', NO_PROXY: '*', NODE_USE_ENV_PROXY: '0',
  }
  const deploy = (directory, retries) => run('tcb', [
    'hosting', 'deploy', directory, '--env-id', ENV_ID, '--concurrency', '1', '--retry-count', String(retries),
  ], { root, env: deployEnv })
  // Prepare all shells first, upload every immutable bundle, then switch the manifests.
  for (const upload of uploads) deploy(upload.bundleRoot, 5)
  for (const upload of uploads) deploy(upload.manifestRoot, 8)
  console.log(`[ota] published ${prepared.length} shell bundle(s)`)
  return prepared
}

if (isMain(import.meta.url)) {
  main().catch(error => { console.error(`[ota] ${error.message}`); process.exitCode = 1 })
}

