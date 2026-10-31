#!/usr/bin/env node
/** Prepare a reviewable three-client release locally. This file never uploads. */
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { PROJECT_ROOT, RELEASE_SIGNER_SHA256, assertOutputPath, clearOutput, copyImmutableFile, isMain, parseOptions, positiveInteger, readReleaseIdentity, sha256File } from './release-common.mjs'
import { main as buildWeb } from './build-multiplatform.mjs'
import { main as buildApks } from './release-android.mjs'
import { main as prepareOta } from './ota-upload-cos.mjs'
import { prepareWebUpload } from './deploy-hosting.mjs'
import { prepareStudentDownload } from './student-download.mjs'

const DEFAULT_APK_NOTES = ['电脑管理后台与手机管理端共用现有账号和权限', '安装包版本与界面版本分离，完善学生端和管理端更新']

export function releaseNotes(value = DEFAULT_APK_NOTES) {
  const notes = typeof value === 'string' ? [value] : value
  if (!Array.isArray(notes) || !notes.length || notes.some(note => typeof note !== 'string' || !note.trim())) throw new Error('Release notes must contain non-empty text')
  return notes.map(note => note.trim())
}

export function preparationPlan(root, argv = []) {
  const options = parseOptions(argv, ['--notes', '--min-native-build'], ['--reuse-apk', '--help'])
  const identity = readReleaseIdentity(root)
  const minNativeBuild = positiveInteger(options['--min-native-build'] || identity.nativeBuild, 'minNativeBuild')
  if (minNativeBuild > identity.nativeBuild) throw new Error('minNativeBuild cannot exceed the prepared APK build')
  return { options, notes: releaseNotes(options['--notes']), minNativeBuild }
}

export function prepareApkUpload(root = PROJECT_ROOT, { notes = DEFAULT_APK_NOTES } = {}) {
  const checkedNotes = releaseNotes(notes)
  const identity = readReleaseIdentity(root)
  const releaseRoot = join(root, '.release-out')
  const directory = assertOutputPath(root, releaseRoot, join(releaseRoot, 'apk', `${identity.version}-${identity.nativeBuild}`))
  const descriptor = JSON.parse(readFileSync(join(directory, 'release-both.json'), 'utf8'))
  if (descriptor.version !== identity.version || descriptor.build !== identity.nativeBuild || descriptor.artifacts?.length !== 2) throw new Error('Prepare and verify both current APKs first')
  const base = new URL(JSON.parse(readFileSync(join(root, 'public/update.json'), 'utf8')).downloadUrl)
  if (base.protocol !== 'https:') throw new Error('APK downloads require an HTTPS hosting directory')
  const flavors = {}, files = []
  for (const shell of ['user', 'admin']) {
    const artifact = descriptor.artifacts.find(item => item.shell === shell)
    if (!artifact || artifact.applicationId !== (shell === 'user' ? 'com.sunshinecampus.app' : 'com.sunshinecampus.admin') || artifact.version !== identity.version || artifact.build !== identity.nativeBuild || artifact.signingCertificateSha256 !== RELEASE_SIGNER_SHA256 || basename(artifact.file) !== artifact.file) throw new Error(`Invalid verified APK descriptor for ${shell}`)
    const source = assertOutputPath(root, releaseRoot, join(directory, artifact.file))
    if (sha256File(source) !== artifact.sha256 || statSync(source).size !== artifact.bytes) throw new Error(`APK changed since verification: ${shell}`)
    files.push({ source, artifact })
    flavors[shell] = { androidArm64: { url: new URL(artifact.file, base.href.replace(/\/?$/, '/')).href, sha256: artifact.sha256, size: artifact.bytes } }
  }
  const assets = join(releaseRoot, 'apk-upload-assets'), manifestDirectory = join(releaseRoot, 'apk-upload-manifest')
  clearOutput(root, releaseRoot, assets)
  for (const { source, artifact } of files) copyImmutableFile(root, releaseRoot, source, join(assets, 'downloads', artifact.file))
  clearOutput(root, releaseRoot, manifestDirectory)
  const manifest = { latestVersion: identity.version, latestBuild: identity.nativeBuild, title: `哦狐 ${identity.version}`, notes: checkedNotes, force: false, downloadUrl: base.href, assets: flavors.user, flavors }
  // Create the manifest only after both verified APKs are staged successfully.
  const manifestPath = assertOutputPath(root, releaseRoot, join(manifestDirectory, 'update.json'))
  copyImmutableFile(root, releaseRoot, join(directory, 'release-both.json'), join(manifestDirectory, 'release-both.json'))
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  prepareStudentDownload(root, manifestDirectory, manifest, identity)
  return { directory, assets, manifestDirectory, manifest }
}

export async function main({ root = PROJECT_ROOT, argv = process.argv.slice(2) } = {}) {
  const { options, notes, minNativeBuild } = preparationPlan(root, argv)
  if (options['--help']) { console.log('node tools/prepare-release.mjs [--reuse-apk] [--notes text] [--min-native-build n] (local preparation only; never publishes)'); return }
  const checked = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-b'], { cwd: root, stdio: 'inherit' })
  if (checked.status !== 0) throw new Error('Type checking failed; release preparation stopped')
  buildWeb({ root, argv: ['h5'] })
  if (!options['--reuse-apk']) buildApks({ root, argv: ['--shell', 'both'] })
  const apk = prepareApkUpload(root, { notes })
  const ota = await prepareOta({ root, argv: ['--shell', 'both', '--prepare-only', '--skip-recompress', '--min-native-build', String(minNativeBuild), '--notes', notes.join('\n')] })
  const web = prepareWebUpload(root)
  const identity = readReleaseIdentity(root)
  const packet = { ...identity, notes, minNativeBuild, preparedAt: new Date().toISOString(), published: false,
    web: relative(root, web), apkAssets: relative(root, apk.assets), apkManifest: relative(root, apk.manifestDirectory),
    ota: ota.map(item => ({ shell: item.shell, bundle: relative(root, item.bundlePath), manifest: item.manifest })),
  }
  const packetPath = assertOutputPath(root, join(root, '.release-out'), join(root, '.release-out/release-packet.json'))
  writeFileSync(packetPath, JSON.stringify(packet, null, 2) + '\n')
  console.log(`[release] Three-client release prepared at ${packetPath}. Nothing has been published.`)
  return packet
}
if (isMain(import.meta.url)) main().catch(error => { console.error(`[release] ${error.message}`); process.exitCode = 1 })
