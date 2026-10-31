#!/usr/bin/env node
/** Verify prepared release identity against public manifests and actual downloaded bytes. */
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { readReleaseIdentity } from './release-common.mjs'

const mode = process.argv[2]
if (!['before', 'after'].includes(mode)) throw Error('Use before or after [--require-ios]')
const identity = readReleaseIdentity()
const packet = JSON.parse(readFileSync('.release-out/release-packet.json', 'utf8'))
if (packet.version !== identity.version || packet.webBuild !== identity.webBuild) throw Error('Prepared release is not current')
const update = JSON.parse(readFileSync('.release-out/apk-upload-manifest/update.json', 'utf8'))
const base = new URL(update.downloadUrl).origin
const report = { mode, checkedAt: new Date().toISOString(), version: identity.version, build: identity.webBuild, manifests: {}, downloads: [], pages: [] }
async function response(path) {
  const url = new URL(path, base)
  if (url.origin !== base || url.protocol !== 'https:') throw Error('Release resource must use the configured HTTPS host')
  url.searchParams.set('release-check', String(Date.now()))
  const result = await fetch(url, { signal: AbortSignal.timeout(120000) })
  if (!result.ok) throw Error(`${path}: HTTP ${result.status}`)
  return result
}
async function verifyBytes(kind, path, sha256, size) {
  const result = await response(path)
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of result.body) { hash.update(chunk); bytes += chunk.length }
  const digest = hash.digest('hex')
  if (digest !== sha256 || bytes !== size) throw Error(`${kind} size/hash mismatch`)
  report.downloads.push({ kind, url: new URL(path, base).href, sha256: digest, bytes })
  console.log(`Verified ${kind}: ${bytes} bytes`)
}
for (const path of ['/update.json', '/ota/user/manifest.json', '/ota/admin/manifest.json', '/ota/manifest.json']) {
  const value = await (await response(path)).json()
  report.manifests[path] = value
  const build = value.build || value.latestBuild
  if (mode === 'before' && build > identity.webBuild) throw Error('A newer release is already published; do not downgrade')
  if (mode === 'after' && (build !== identity.webBuild || (value.version || value.latestVersion) !== identity.version)) throw Error(`Public identity mismatch: ${path}`)
}
if (mode === 'after') {
  for (const shell of ['user', 'admin']) {
    const apk = report.manifests['/update.json'].flavors[shell].androidArm64
    const expected = update.flavors[shell].androidArm64
    if (JSON.stringify(apk) !== JSON.stringify(expected)) throw Error(`APK manifest mismatch: ${shell}`)
    await verifyBytes(`${shell} APK`, apk.url, apk.sha256, apk.size)
    const ota = report.manifests[`/ota/${shell}/manifest.json`]
    const prepared = packet.ota.find(item => item.shell === shell).manifest
    if (JSON.stringify(ota) !== JSON.stringify(prepared)) throw Error(`OTA manifest mismatch: ${shell}`)
    await verifyBytes(`${shell} OTA`, ota.url, ota.checksum, ota.size)
  }
  for (const [path, marker] of [['/', 'id="root"'], ['/admin', 'id="root"'], ['/plugins', 'id="root"'], ['/download/', '哦狐插件'], ['/download/student.html', `安装包 ${identity.version}`], ['/download/admin.html', '官方管理端'], ['/download/ios-guide.html', 'iPhone 自签安装说明'], ['/download/pwa-guide.html', '添加到主屏幕']]) {
    const html = await (await response(path)).text()
    if (!html.includes(marker)) throw Error(`Expected page content missing: ${path}`)
    report.pages.push(path)
  }
  const ios = await (await response('/download/ios-latest.json')).json()
  const source = await (await response('/download/source-identity.json')).json()
  if (ios.status === 'available') {
    if (ios.version !== identity.nativeVersion || ios.build !== identity.nativeBuild || ios.signed !== false || source.iosDownloadAvailable !== true || source.nativeVersion !== ios.version || source.nativeBuild !== ios.build) throw Error('iOS source identity mismatch')
    await verifyBytes('iOS IPA', ios.url, ios.sha256, ios.size)
    report.ios = ios
  } else if (process.argv.includes('--require-ios')) throw Error('Current IPA is unavailable')
  const onlineIndex = await (await response('/')).text()
  if (onlineIndex !== readFileSync('.release-out/web-upload/index.html', 'utf8')) throw Error('Website entry differs from prepared release')
  if (!onlineIndex.includes('rel="manifest" href="/manifest.webmanifest"')) throw Error('Student web app metadata is missing')
  const webApp = await (await response('/manifest.webmanifest')).json()
  if (webApp.display !== 'standalone' || webApp.start_url !== '/?source=homescreen') throw Error('Web app launch configuration mismatch')
  for (const icon of webApp.icons) await response(icon.src)
}
writeFileSync(`.release-out/verification-${identity.webBuild}-${mode}.json`, JSON.stringify(report, null, 2) + '\n')
console.log(`Release ${identity.version} ${mode} verification passed`)
