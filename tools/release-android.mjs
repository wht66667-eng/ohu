#!/usr/bin/env node
/** Build and verify existing-signature APKs; prepare local artifacts without publishing. */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  PROJECT_ROOT, RELEASE_SIGNER_SHA256, assertOutputPath, copyImmutableFile,
  isMain, parseOptions, readReleaseIdentity, selectShells, sha256File,
} from './release-common.mjs'

export function releasePlan(root, argv = []) {
  const options = parseOptions(argv, ['--shell', '--download-base-url', '--notes'], ['--plan', '--help'])
  const identity = readReleaseIdentity(root)
  if (identity.version !== identity.nativeVersion) throw new Error('package.json and Android versionName must match before an APK release')
  if (identity.webBuild !== identity.nativeBuild) throw new Error('WEB_BUILD and Android versionCode must match before an APK release')
  const shellArg = options['--shell'] || 'both'
  const shells = selectShells(shellArg)
  const outputRoot = join(root, '.release-out', 'apk')
  const output = assertOutputPath(root, outputRoot, join(outputRoot, `${identity.version}-${identity.nativeBuild}`))
  let downloadBase
  if (options['--download-base-url']) {
    const url = new URL(options['--download-base-url'])
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('--download-base-url must be a plain HTTPS directory URL')
    if (shells.length !== 2) throw new Error('A complete update.json requires --shell both')
    downloadBase = url.href.replace(/\/$/, '')
  }
  return { ...identity, options, shellArg, shells, outputRoot, output, downloadBase }
}

export function verifyApkMetadata({ badging, signing, shell, version, build, expectedSigner = RELEASE_SIGNER_SHA256 }) {
  const packageId = shell === 'admin' ? 'com.sunshinecampus.admin' : 'com.sunshinecampus.app'
  const actual = badging.match(/^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m)
  if (!actual || actual[1] !== packageId || Number(actual[2]) !== build || actual[3] !== version) {
    throw new Error(`APK package/version mismatch for ${shell}; expected ${packageId} ${version}/${build}`)
  }
  const signers = [...signing.matchAll(/Signer #\d+ certificate SHA-256 digest:\s*([a-f\d]+)/gi)].map(match => match[1].toLowerCase())
  if (!/^Verifies\s*$/m.test(signing) || signers.length !== 1 || signers[0] !== expectedSigner) {
    throw new Error(`APK signing certificate differs from the installed release for ${shell}`)
  }
  if (!/^Verified using v2 scheme .*: true\s*$/m.test(signing)) throw new Error('APK must have a verified v2 signature')
  const abis = [...(badging.match(/^native-code:\s*(.+)$/m)?.[1] || '').matchAll(/'([^']+)'/g)].map(match => match[1])
  if (abis.length !== 1 || abis[0] !== 'arm64-v8a') throw new Error('Expected the Android arm64 release variant')
  return { applicationId: packageId, version, build, shell, abis, signingCertificateSha256: signers[0] }
}

function androidTools(env) {
  const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || (env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Android/Sdk'))
  if (!sdk || !existsSync(join(sdk, 'build-tools'))) throw new Error('Android SDK build-tools are required (set ANDROID_HOME)')
  const dirs = readdirSync(join(sdk, 'build-tools')).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  const tools = dirs.map(dir => join(sdk, 'build-tools', dir)).find(dir =>
    existsSync(join(dir, process.platform === 'win32' ? 'aapt.exe' : 'aapt')) && existsSync(join(dir, 'lib/apksigner.jar')))
  if (!tools) throw new Error('Android aapt and apksigner.jar are required')
  const defaultJdk = 'C:/Program Files/Microsoft/jdk-17.0.20.8-hotspot'
  const javaHome = env.JAVA_HOME || (process.platform === 'win32' && existsSync(defaultJdk) ? defaultJdk : undefined)
  return {
    sdk, tools, javaHome,
    java: javaHome ? join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java',
    aapt: join(tools, process.platform === 'win32' ? 'aapt.exe' : 'aapt'),
    signer: join(tools, 'lib/apksigner.jar'),
  }
}

export function main({ root = PROJECT_ROOT, argv = process.argv.slice(2), env = process.env } = {}) {
  if (argv.includes('--help')) {
    console.log('node tools/release-android.mjs [--shell user|admin|both] [--plan] [--download-base-url https://host/downloads] [--notes text]')
    return
  }
  const plan = releasePlan(root, argv)
  if (plan.options['--plan']) {
    console.log(JSON.stringify({ version: plan.version, build: plan.nativeBuild, shells: plan.shells, output: plan.output }, null, 2))
    return plan
  }
  // Optional local configuration lives beside the existing keystore and is
  // ignored by Git. Explicit process environment always takes precedence.
  env = { ...env }
  const signingFile = join(root, 'android/keystore/release-signing.properties')
  if (existsSync(signingFile)) {
    for (const line of readFileSync(signingFile, 'utf8').split(/\r?\n/)) {
      const match = /^(SUNSHINE_STORE_PASSWORD|SUNSHINE_KEY_PASSWORD)=(.*)$/.exec(line)
      if (match && !env[match[1]]) env[match[1]] = match[2]
    }
  }
  const keystore = join(root, 'android/keystore/sunshine-release.jks')
  if (!existsSync(keystore)) throw new Error('Existing release keystore is missing. Restore the original key; this tool never generates or replaces it.')
  if (!env.SUNSHINE_STORE_PASSWORD || !env.SUNSHINE_KEY_PASSWORD) {
    throw new Error('Set SUNSHINE_STORE_PASSWORD and SUNSHINE_KEY_PASSWORD in the process environment before releasing. Values are never logged.')
  }
  const tools = androidTools(env)
  const childEnv = { ...env, ANDROID_HOME: tools.sdk, ANDROID_SDK_ROOT: tools.sdk, ...(tools.javaHome ? { JAVA_HOME: tools.javaHome } : {}) }
  function run(command, args, { cwd = root, capture = false } = {}) {
    const result = spawnSync(command, args, { cwd, env: childEnv, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' })
    if (result.error || result.status !== 0) throw new Error(`Release command failed: ${result.error?.message || command} (${result.status})`)
    return result.stdout || ''
  }
  const verified = []
  for (const shell of plan.shells) {
    // Each flavor gets its own Web bundle before assembly; no desktop folder is touched.
    run(process.execPath, [join(root, 'tools/build-multiplatform.mjs'), 'app', '--no-sync', '--shell', shell])
    run(process.execPath, [join(root, 'node_modules/@capacitor/cli/bin/capacitor'), 'sync', 'android'])
    run(process.execPath, [join(root, 'tools/patch-android-java17.mjs')])
    const task = shell === 'admin' ? 'assembleAdminRelease' : 'assembleUserRelease'
    if (process.platform === 'win32') {
      // A fixed Gradle task runs in one cmd shell. File operations never run through cmd.
      run(env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `gradlew.bat ${task} --no-daemon -Pandroid.overridePathCheck=true`], { cwd: join(root, 'android') })
    } else run(join(root, 'android/gradlew'), [task, '--no-daemon'], { cwd: join(root, 'android') })
    const apk = join(root, `android/app/build/outputs/apk/${shell}/release/app-${shell}-release.apk`)
    if (!existsSync(apk)) throw new Error(`APK not produced: ${apk}`)
    // Windows aapt still misreads Unicode APK path arguments. Verify an
    // identical temporary copy under the OS temporary directory instead.
    const tempParent = resolve(tmpdir())
    const verificationDir = mkdtempSync(join(tempParent, 'ohhu-apk-verify-'))
    if (dirname(resolve(verificationDir)) !== tempParent || !basename(verificationDir).startsWith('ohhu-apk-verify-')) throw new Error('Unsafe temporary verification directory')
    let metadata
    try {
      const verificationApk = join(verificationDir, 'release.apk')
      copyFileSync(apk, verificationApk)
      metadata = verifyApkMetadata({
        badging: run(tools.aapt, ['dump', 'badging', verificationApk], { capture: true }),
        signing: run(tools.java, ['-jar', tools.signer, 'verify', '--verbose', '--print-certs', verificationApk], { capture: true }),
        shell, version: plan.version, build: plan.nativeBuild,
      })
    } finally {
      rmSync(verificationDir, { recursive: true, force: true })
    }
    verified.push({ ...metadata, source: apk, bytes: statSync(apk).size, sha256: sha256File(apk) })
  }
  // Validate every requested APK before creating a release descriptor or update manifest.
  const artifacts = verified.map(({ source, ...artifact }) => {
    const name = `SunshineCampus-${artifact.shell === 'admin' ? 'Admin' : 'User'}-${artifact.version}.apk`
    const path = copyImmutableFile(root, plan.outputRoot, source, join(plan.output, name))
    return { ...artifact, file: relative(plan.output, path).replaceAll('\\', '/'), ...(plan.downloadBase ? { url: `${plan.downloadBase}/${name}` } : {}) }
  })
  mkdirSync(plan.output, { recursive: true })
  const descriptor = { version: plan.version, build: plan.nativeBuild, artifacts }
  writeFileSync(assertOutputPath(root, plan.outputRoot, join(plan.output, `release-${plan.shellArg}.json`)), JSON.stringify(descriptor, null, 2))
  if (plan.downloadBase) {
    const flavors = Object.fromEntries(artifacts.map(artifact => [artifact.shell, { androidArm64: { url: artifact.url, sha256: artifact.sha256, size: artifact.bytes } }]))
    const update = {
      latestVersion: plan.version, latestBuild: plan.nativeBuild, title: `哦狐 ${plan.version}`,
      notes: [plan.options['--notes'] || `安装包更新 ${plan.version}`], force: false,
      assets: { androidArm64: flavors.user.androidArm64 }, flavors,
    }
    writeFileSync(assertOutputPath(root, plan.outputRoot, join(plan.output, 'update.json')), JSON.stringify(update, null, 2))
  }
  console.log(`[release] Verified artifacts prepared in ${resolve(plan.output)}; nothing has been published.`)
  return descriptor
}

if (isMain(import.meta.url)) {
  try { main() } catch (error) { console.error(`[release] ${error.message}`); process.exitCode = 1 }
}
