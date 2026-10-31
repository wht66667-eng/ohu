#!/usr/bin/env node
/** Publish an already prepared release. No building or hidden credential logging. */
import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { PROJECT_ROOT, assertOutputPath, clearOutput, copyImmutableFile, isMain, parseOptions, readReleaseIdentity, sha256File } from './release-common.mjs'
import { runExternal } from './ota-upload-cos.mjs'
import { prepareApkUpload, releaseNotes } from './prepare-release.mjs'

export function main({ root = PROJECT_ROOT, argv = process.argv.slice(2), env = process.env, run = runExternal } = {}) {
  const options = parseOptions(argv, [], ['--plan', '--no-web'])
  const releaseRoot = join(root, '.release-out')
  const packet = JSON.parse(readFileSync(join(releaseRoot, 'release-packet.json'), 'utf8'))
  const identity = readReleaseIdentity(root)
  for (const key of ['version', 'webBuild', 'nativeVersion', 'nativeBuild']) if (packet[key] !== identity[key]) throw new Error('Source version changed. Prepare a fresh release before publishing.')
  const envId = readFileSync(join(root, 'src/lib/cb.ts'), 'utf8').match(/CB_ENV_ID\s*=\s*'([^']+)'/)?.[1]
  if (!envId) throw new Error('Cannot resolve the existing CloudBase environment')
  const web = options['--no-web'] ? null : assertOutputPath(root, releaseRoot, join(root, packet.web))
  if (web && !existsSync(join(web, 'index.html'))) throw new Error('Prepared website is missing')
  const phases = []
  // Revalidation must preserve the notes that were reviewed during preparation.
  const preparedApkManifest = assertOutputPath(root, releaseRoot, join(root, packet.apkManifest, 'update.json'))
  const preparedNotes = releaseNotes(JSON.parse(readFileSync(preparedApkManifest, 'utf8')).notes)
  if (packet.notes && JSON.stringify(releaseNotes(packet.notes)) !== JSON.stringify(preparedNotes)) throw new Error('Prepared APK release notes changed')
  const apk = prepareApkUpload(root, { notes: preparedNotes }) // Revalidate APK bytes before any upload.
  phases.push(apk.assets)
  const manifests = []
  if (packet.ota?.length !== 2) throw new Error('Both shell OTA bundles must be prepared')
  for (const shell of ['user', 'admin']) {
    const item = packet.ota.find(value => value.shell === shell)
    if (!item || item.manifest.shell !== shell || item.manifest.version !== identity.version || item.manifest.build !== identity.webBuild) throw new Error(`Invalid OTA release for ${shell}`)
    if (packet.minNativeBuild !== undefined && item.manifest.minNativeBuild !== packet.minNativeBuild) throw new Error('Prepared OTA minimum APK build changed')
    if (packet.notes && JSON.stringify(item.manifest.notes) !== JSON.stringify([preparedNotes.join('\n')])) throw new Error('Prepared OTA release notes changed')
    const bundleRoot = join(root, '.ota-out')
    const bundle = assertOutputPath(root, bundleRoot, join(root, item.bundle))
    if (sha256File(bundle) !== item.manifest.checksum) throw new Error(`OTA checksum changed for ${shell}`)
    const bytesDirectory = join(releaseRoot, `publish-ota-${shell}`), manifestDirectory = join(releaseRoot, `publish-manifest-${shell}`)
    for (const directory of [bytesDirectory, manifestDirectory]) clearOutput(root, releaseRoot, directory)
    const name = item.bundle.replaceAll('\\', '/').split('/').at(-1)
    copyImmutableFile(root, releaseRoot, bundle, join(bytesDirectory, 'ota', shell, 'bundles', name))
    const preparedManifest = join(root, '.ota-out/prepared', shell, `${identity.version}-${identity.webBuild}`, 'manifest.json')
    const same = JSON.parse(readFileSync(preparedManifest, 'utf8'))
    if (JSON.stringify(same) !== JSON.stringify(item.manifest)) throw new Error('Prepared OTA manifest changed')
    copyImmutableFile(root, releaseRoot, preparedManifest, join(manifestDirectory, 'ota', shell, 'manifest.json'))
    if (shell === 'user') copyImmutableFile(root, releaseRoot, preparedManifest, join(manifestDirectory, 'ota/manifest.json'))
    phases.push(bytesDirectory); manifests.push(manifestDirectory)
  }
  // All APK/ZIP bytes first; website next; discovery manifests last.
  if (web) phases.push(web)
  phases.push(apk.manifestDirectory, ...manifests)
  const plan = { envId, version: identity.version, includeWeb: Boolean(web), uploadOrder: phases.map(path => relative(root, path)), publish: false }
  if (options['--plan']) { console.log(JSON.stringify(plan, null, 2)); return plan }
  const deployEnv = { ...env, HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', http_proxy: '', https_proxy: '', all_proxy: '', NO_PROXY: '*', NODE_USE_ENV_PROXY: '0' }
  for (const directory of phases) run('tcb', ['hosting', 'deploy', directory, '--env-id', envId, '--concurrency', '1', '--retry-count', '5'], { root, env: deployEnv })
  console.log(`[release] Published ${identity.version}; verify both APK downloads and OTA manifests${web ? ' and /admin' : '; existing website unchanged'}.`)
}
if (isMain(import.meta.url)) { try { main() } catch (error) { console.error(`[release] ${error.message}`); process.exitCode = 1 } }
