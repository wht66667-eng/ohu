import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname, basename, resolve } from 'node:path'
import { assertOutputPath, clearOutput, RELEASE_SIGNER_SHA256, sha256File } from './release-common.mjs'
import { buildPlan, main as buildMultiplatform } from './build-multiplatform.mjs'
import { releasePlan, verifyApkMetadata } from './release-android.mjs'
import { otaPlan, bundleFileName, main as prepareOta, windowsCloudbaseInvocation } from './ota-upload-cos.mjs'
import { prepareWebUpload } from './deploy-hosting.mjs'
import { prepareApkUpload, preparationPlan } from './prepare-release.mjs'
import { main as publishRelease } from './publish-release.mjs'

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'ohhu-release-test-'))
  try {
    mkdirSync(join(root, 'src/lib'), { recursive: true })
    mkdirSync(join(root, 'android/app'), { recursive: true })
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.2.122' }))
    writeFileSync(join(root, 'src/lib/app-version.ts'), "export const WEB_VERSION = '1.2.122'\nexport const WEB_BUILD = 122")
    writeFileSync(join(root, 'android/app/build.gradle'), 'versionName "1.2.122"\nversionCode 122')
    return Promise.resolve(run(root)).finally(() => {
      if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('ohhu-release-test-')) throw Error('Unsafe test cleanup')
      rmSync(root, { recursive: true, force: true })
    })
  } catch (error) {
    if (dirname(resolve(root)) === resolve(tmpdir()) && basename(root).startsWith('ohhu-release-test-')) rmSync(root, { recursive: true, force: true })
    throw error
  }
}
test('cleanup refuses the source root and escapes, but clears explicitly generated output', () => fixture(root => {
  assert.throws(() => assertOutputPath(root, root), /Unsafe/)
  assert.throws(() => clearOutput(root, join(root, 'dist'), root), /Unsafe/)
  const output = join(root, 'dist')
  mkdirSync(output); writeFileSync(join(output, 'generated'), 'yes')
  clearOutput(root, output)
  assert.equal(existsSync(output), false)
  assert.equal(existsSync(join(root, 'package.json')), true)
}))
test('Web-only OTA builds never synchronize iOS or Android; APK builds only sync installed platforms', () => fixture(root => {
  assert.deepEqual(buildPlan(root, ['app', '--no-sync']).platforms, [])
  assert.deepEqual(buildPlan(root, ['app']).platforms, ['android'])
  assert.deepEqual(buildPlan(root, ['h5']).platforms, [])
}))
test('type errors stop app builds before clearing previous Web or native assets', () => fixture(root => {
  const previousWeb = join(root, 'dist-app/previous.html')
  const previousNative = join(root, 'android/app/src/main/assets/public/previous.html')
  for (const path of [previousWeb, previousNative]) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, 'previous valid build') }
  const calls = []
  assert.throws(() => buildMultiplatform({ root, argv: ['app'], execute: (label, args) => {
    calls.push({ label, args }); throw Error('fixture type error')
  } }), /fixture type error/)
  assert.deepEqual(calls, [{ label: 'TypeScript check', args: [join(root, 'node_modules/typescript/bin/tsc'), '-b'] }])
  for (const path of [previousWeb, previousNative]) assert.equal(readFileSync(path, 'utf8'), 'previous valid build')
}))
test('app build checks types before Vite, while plan does not execute or clear output', () => fixture(root => {
  const output = join(root, 'dist-app')
  mkdirSync(output); writeFileSync(join(output, 'previous.html'), 'previous valid build')
  const plan = buildMultiplatform({ root, argv: ['app', '--plan'], execute: () => { throw Error('plan must not execute') } })
  assert.equal(plan.target, 'app')
  assert.equal(readFileSync(join(output, 'previous.html'), 'utf8'), 'previous valid build')
  const calls = []
  buildMultiplatform({ root, argv: ['app', '--no-sync'], execute: (label, args) => {
    calls.push({ label, args })
    if (label.startsWith('Web ')) { mkdirSync(output, { recursive: true }); writeFileSync(join(output, 'index.html'), 'new build') }
  } })
  assert.equal(calls.length, 2)
  assert.equal(calls[0].label, 'TypeScript check')
  assert.deepEqual(calls[0].args, [join(root, 'node_modules/typescript/bin/tsc'), '-b'])
  assert.match(calls[1].label, /^Web dist-app/)
  assert.equal(existsSync(join(output, 'previous.html')), false)
  assert.equal(JSON.parse(readFileSync(join(output, 'release-target.json'), 'utf8')).target, 'app')
}))
test('APK and OTA plans derive build numbers from current source metadata', () => fixture(root => {
  assert.equal(releasePlan(root, ['--plan']).nativeBuild, 122)
  const plan = otaPlan(root, ['--shell', 'both', '--prepare-only'], {})
  assert.equal(plan.build, 122)
  assert.equal(plan.minNativeBuild, 122)
  assert.deepEqual(plan.shells, ['user', 'admin'])
  assert.throws(() => otaPlan(root, ['--build', '26'], {}), /must match/)
}))

test('release preparation accepts reviewed notes and an older compatible APK baseline', () => fixture(root => {
  const plan = preparationPlan(root, ['--notes', '快递入口；课程铃声与震动权限', '--min-native-build', '120'])
  assert.deepEqual(plan.notes, ['快递入口；课程铃声与震动权限'])
  assert.equal(plan.minNativeBuild, 120)
  assert.equal(preparationPlan(root).minNativeBuild, 122)
  assert.throws(() => preparationPlan(root, ['--min-native-build', '123']), /cannot exceed/)
  assert.throws(() => preparationPlan(root, ['--min-native-build', '0']), /positive integer/)
  assert.throws(() => preparationPlan(root, ['--notes', '  ']), /non-empty/)
}))
test('same-version repair packages have immutable distinct URLs', () => {
  const a = bundleFileName('1.2.122', 123, 'a'.repeat(64))
  const b = bundleFileName('1.2.122', 124, 'b'.repeat(64))
  assert.notEqual(a, b)
  assert.throws(() => bundleFileName('../escape', 123, 'a'.repeat(64)))
})
test('website upload cannot roll APK or OTA manifests back to bundled fallback versions', () => fixture(root => {
  const dist = join(root, 'dist'); mkdirSync(dist)
  writeFileSync(join(dist, 'index.html'), '<h1>website</h1>')
  writeFileSync(join(dist, 'update.json'), '{"latestBuild":116}')
  for (const dir of ['downloads', 'ota']) { mkdirSync(join(dist, dir)); writeFileSync(join(dist, dir, 'old'), 'old') }
  const upload = prepareWebUpload(root)
  assert.equal(existsSync(join(upload, 'index.html')), true)
  for (const item of ['update.json', 'downloads', 'ota']) assert.equal(existsSync(join(upload, item)), false)
  assert.equal(existsSync(join(dist, 'update.json')), true)
}))
test('prepare-only both completes both shells without uploading', () => fixture(async root => {
  const env = {}
  for (const shell of ['user', 'admin']) {
    const dist = join(root, `web-${shell}`)
    mkdirSync(dist); writeFileSync(join(dist, 'index.html'), '<h1>fixture</h1>')
    writeFileSync(join(dist, 'release-target.json'), JSON.stringify({ target: 'app', shell, version: '1.2.122', webBuild: 122 }))
    env[`OTA_DIST_${shell.toUpperCase()}`] = dist
  }
  // The archive dependency remains supplied by this real project's package installation.
  const prepared = await prepareOta({ root, env, argv: ['--shell', 'both', '--skip-build', '--skip-recompress', '--prepare-only', '--notes', '快递与提醒', '--min-native-build', '120'], run: () => { throw Error('Unexpected upload/build') } })
  assert.deepEqual(prepared.map(item => item.shell), ['user', 'admin'])
  for (const item of prepared) { assert.equal(item.manifest.minNativeBuild, 120); assert.deepEqual(item.manifest.notes, ['快递与提醒']); assert.equal(existsSync(item.bundlePath), true) }
}))
test('APK verification rejects a wrong shell or changed release certificate', () => {
  const signing = 'Verifies\nVerified using v2 scheme (APK Signature Scheme v2): true\nSigner #1 certificate SHA-256 digest: ' + 'a'.repeat(64)
  const badging = "package: name='com.sunshinecampus.app' versionCode='122' versionName='1.2.122'\nnative-code: 'arm64-v8a'"
  assert.equal(verifyApkMetadata({ signing, badging, shell: 'user', version: '1.2.122', build: 122, expectedSigner: 'a'.repeat(64) }).build, 122)
  assert.throws(() => verifyApkMetadata({ signing, badging, shell: 'admin', version: '1.2.122', build: 122 }), /mismatch/)
  assert.throws(() => verifyApkMetadata({ signing, badging, shell: 'user', version: '1.2.122', build: 122 }), /certificate/)
})

function stageFixtureApks(root, notes) {
  const directory = join(root, '.release-out/apk/1.2.122-122')
  mkdirSync(directory, { recursive: true }); mkdirSync(join(root, 'public'))
  mkdirSync(join(root, 'public/download'))
  writeFileSync(join(root, 'public/download/student.html'), readFileSync(new URL('../public/download/student.html', import.meta.url), 'utf8'))
  writeFileSync(join(root, 'public/update.json'), JSON.stringify({ downloadUrl: 'https://example.test/downloads/' }))
  const artifacts = ['user', 'admin'].map(shell => {
    const file = `SunshineCampus-${shell === 'user' ? 'User' : 'Admin'}-1.2.122.apk`, path = join(directory, file), body = `verified-fixture-${shell}`
    writeFileSync(path, body)
    return { shell, file, applicationId: `com.sunshinecampus.${shell === 'user' ? 'app' : 'admin'}`, version: '1.2.122', build: 122, signingCertificateSha256: RELEASE_SIGNER_SHA256, sha256: sha256File(path), bytes: Buffer.byteLength(body) }
  })
  writeFileSync(join(directory, 'release-both.json'), JSON.stringify({ version: '1.2.122', build: 122, artifacts }))
  return prepareApkUpload(root, notes ? { notes } : {})
}

test('APK staging preserves flavor URLs and rejects changed bytes before replacing discovery metadata', () => fixture(root => {
  const result = stageFixtureApks(root, ['快递与提醒'])
  assert.equal(result.manifest.flavors.admin.androidArm64.url, 'https://example.test/downloads/SunshineCampus-Admin-1.2.122.apk')
  assert.equal(result.manifest.flavors.user.androidArm64.url, 'https://example.test/downloads/SunshineCampus-User-1.2.122.apk')
  const landing = JSON.parse(readFileSync(join(result.manifestDirectory, 'download/student-latest.json'), 'utf8'))
  assert.equal(landing.url, result.manifest.flavors.user.androidArm64.url)
  assert.equal(landing.sha256, result.manifest.flavors.user.androidArm64.sha256)
  assert.equal(landing.nativeBuild, 122)
  assert.deepEqual(result.manifest.notes, ['快递与提醒'])
  writeFileSync(join(result.directory, 'SunshineCampus-User-1.2.122.apk'), 'tampered')
  assert.throws(() => prepareApkUpload(root), /changed since verification/)
  assert.equal(existsSync(join(result.manifestDirectory, 'update.json')), true)
}))

function stageFixturePacket(root, { includeWeb = true } = {}) {
  const notes = ['快递与提醒']
  const apk = stageFixtureApks(root, notes)
  writeFileSync(join(root, 'src/lib/cb.ts'), "export const CB_ENV_ID = 'existing-test-environment'")
  const web = '.release-out/web-upload'
  if (includeWeb) { mkdirSync(join(root, web), { recursive: true }); writeFileSync(join(root, web, 'index.html'), '<h1>existing website</h1>') }
  const ota = ['user', 'admin'].map(shell => {
    const bundle = `.ota-out/bundles/${shell}/fixture.zip`, path = join(root, bundle)
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `fixture-bundle-${shell}`)
    const manifest = { shell, version: '1.2.122', build: 122, minNativeBuild: 120, checksum: sha256File(path), notes }
    const manifestPath = join(root, '.ota-out/prepared', shell, '1.2.122-122', 'manifest.json')
    mkdirSync(dirname(manifestPath), { recursive: true }); writeFileSync(manifestPath, JSON.stringify(manifest))
    return { shell, bundle, manifest }
  })
  const packet = { version: '1.2.122', webBuild: 122, nativeVersion: '1.2.122', nativeBuild: 122, notes, minNativeBuild: 120, web, apkManifest: '.release-out/apk-upload-manifest', ota }
  writeFileSync(join(root, '.release-out/release-packet.json'), JSON.stringify(packet))
  return { packet, apk }
}

test('APK/OTA-only publication skips the website and uploads all bytes before discovery manifests', () => fixture(root => {
  const { apk } = stageFixturePacket(root, { includeWeb: false })
  const calls = []
  publishRelease({ root, argv: ['--no-web'], env: { HTTPS_PROXY: 'fixture-proxy' }, run: (command, args, options) => { calls.push({ command, args, env: options.env }) } })
  assert.equal(calls.length, 6)
  assert.deepEqual(calls.map(call => basename(call.args[2])), ['apk-upload-assets', 'publish-ota-user', 'publish-ota-admin', 'apk-upload-manifest', 'publish-manifest-user', 'publish-manifest-admin'])
  assert.ok(calls.every(call => call.command === 'tcb' && call.args.includes('existing-test-environment')))
  assert.ok(calls.every(call => call.env.HTTPS_PROXY === '' && call.env.NO_PROXY === '*'))
  assert.deepEqual(JSON.parse(readFileSync(join(apk.manifestDirectory, 'update.json'), 'utf8')).notes, ['快递与提醒'])
}))

test('publisher default still includes the website and plan/no-web never invokes a deploy command', () => fixture(root => {
  stageFixturePacket(root)
  const calls = []
  publishRelease({ root, run: (_command, args) => calls.push(basename(args[2])) })
  assert.deepEqual(calls, ['apk-upload-assets', 'publish-ota-user', 'publish-ota-admin', 'web-upload', 'apk-upload-manifest', 'publish-manifest-user', 'publish-manifest-admin'])
  const plan = publishRelease({ root, argv: ['--plan', '--no-web'], run: () => { throw Error('Unexpected deploy') } })
  assert.equal(plan.includeWeb, false)
  assert.equal(plan.publish, false)
  assert.equal(plan.uploadOrder.some(path => path.includes('web-upload')), false)
}))

test('publisher rejects changed release notes or compatibility metadata before uploading', () => fixture(root => {
  const { packet, apk } = stageFixturePacket(root)
  const noDeploy = () => { throw Error('Unexpected deploy') }
  const apkManifest = join(apk.manifestDirectory, 'update.json')
  const original = readFileSync(apkManifest, 'utf8')
  writeFileSync(apkManifest, JSON.stringify({ ...JSON.parse(original), notes: ['unreviewed changes'] }))
  assert.throws(() => publishRelease({ root, argv: ['--no-web'], run: noDeploy }), /release notes changed/)
  writeFileSync(apkManifest, original)
  packet.ota[0].manifest.minNativeBuild = 121
  writeFileSync(join(root, '.release-out/release-packet.json'), JSON.stringify(packet))
  assert.throws(() => publishRelease({ root, argv: ['--no-web'], run: noDeploy }), /minimum APK build changed/)
}))

test('older prepared packets preserve their existing APK notes when revalidated', () => fixture(root => {
  const { packet, apk } = stageFixturePacket(root)
  delete packet.notes
  delete packet.minNativeBuild
  writeFileSync(join(root, '.release-out/release-packet.json'), JSON.stringify(packet))
  publishRelease({ root, argv: ['--plan', '--no-web'], run: () => { throw Error('Unexpected deploy') } })
  assert.deepEqual(JSON.parse(readFileSync(join(apk.manifestDirectory, 'update.json'), 'utf8')).notes, ['快递与提醒'])
}))

test('Windows npm CLI invocation preserves Unicode paths and literal shell characters without cmd.exe', () => fixture(root => {
  const npmRoot = join(root, 'npm 中文 (测试)'), cli = join(npmRoot, 'tcb.cmd')
  const packageRoot = join(npmRoot, 'node_modules/@cloudbase/cli'), bin = join(packageRoot, 'bin/tcb')
  mkdirSync(dirname(bin), { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: '@cloudbase/cli', bin: { tcb: 'bin/tcb' } }))
  writeFileSync(bin, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))')
  const args = ['hosting', 'deploy', join(root, '发布 (129) & literal'), '--env-id', 'fixture']
  const invocation = windowsCloudbaseInvocation(cli, args)
  assert.equal(invocation.executable, process.execPath)
  assert.deepEqual(invocation.parameters, [bin, ...args])
  const result = spawnSync(invocation.executable, invocation.parameters, { encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.deepEqual(JSON.parse(result.stdout), args)
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: '@cloudbase/cli', bin: { tcb: '../../outside.js' } }))
  assert.throws(() => windowsCloudbaseInvocation(cli, args), /invalid Node entry point/)
  assert.deepEqual(windowsCloudbaseInvocation(join(npmRoot, 'tcb.exe'), args), { executable: join(npmRoot, 'tcb.exe'), parameters: args })
  assert.throws(() => windowsCloudbaseInvocation(join(root, 'other-cli/tcb.cmd'), ['unsafe&argument']), /Unsupported shell character/)
}))
