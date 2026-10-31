import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import vm from 'node:vm'
import { prepareStudentDownload, studentDownloadRelease } from './student-download.mjs'
import { sha256File } from './release-common.mjs'
const template = readFileSync(new URL('../public/download/student.html', import.meta.url), 'utf8')
const identity = { version: '1.2.131', webBuild: 131, nativeVersion: '1.2.131', nativeBuild: 131 }
const asset = { url: 'https://example.test/downloads/SunshineCampus-User-1.2.131.apk', size: 123456, sha256: 'a'.repeat(64) }
const manifest = { latestVersion: '1.2.131', latestBuild: 131, assets: { androidArm64: asset }, flavors: { user: { androidArm64: asset } } }
function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'ohhu-download-test-'))
  try {
    mkdirSync(join(root, 'public/download'), { recursive: true })
    writeFileSync(join(root, 'public/download/student.html'), template)
    return run(root)
  } finally {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('ohhu-download-test-')) throw Error('Unsafe test cleanup')
    rmSync(root, { recursive: true, force: true })
  }
}
function page(seed, response = manifest, fail = false) {
  const elements = Object.fromEntries(['download', 'release-meta', 'status', 'wechat-tip', 'ios-tip', 'download-release'].map(id => [id, { textContent: id === 'download-release' ? JSON.stringify(seed) : '', attrs: {}, removeAttribute(name) { delete this.attrs[name] }, hasAttribute(name) { return name === 'href' ? !!this.href : name in this.attrs }, addEventListener() {} }]))
  const script = template.match(/<script>([\s\S]*?)<\/script>/)[1]
  const urls = []
  vm.runInNewContext(script, { document: { getElementById: id => elements[id] }, navigator: { userAgent: 'test' }, location: { href: 'https://example.test/download/student.html', origin: 'https://example.test' }, URL, AbortController, Date,
    setTimeout: () => 1, clearTimeout: () => {}, fetch: async url => { urls.push(url); if (fail) throw Error('offline'); return { ok: true, json: async () => typeof response === 'function' ? response(url) : response } } })
  return { elements, urls }
}
test('the sharing page and legacy JSON are generated from the verified student APK together', () => fixture(root => {
  const output = join(root, '.release-out/landing')
  const result = prepareStudentDownload(root, output, manifest, identity)
  const json = JSON.parse(readFileSync(join(output, 'download/student-latest.json'), 'utf8'))
  const html = readFileSync(join(output, 'download/student.html'), 'utf8')
  assert.deepEqual(json, result); assert.equal(json.url, asset.url); assert.equal(json.nativeBuild, 131)
  assert.ok(html.includes(`href="${asset.url}"`)); assert.ok(html.includes('安装包 1.2.131'))
  assert.deepEqual(JSON.parse(html.match(/id="download-release" type="application\/json">(.*?)<\/script>/s)[1]), json)
  assert.ok(!html.includes('1.2.38')); assert.ok(!html.includes('1.2.88'))
}))
test('missing/mismatched/downloads for another app cannot be staged', () => {
  for (const changed of [
    { ...manifest, latestBuild: 130 }, { ...manifest, latestVersion: '1.2.130' },
    { ...manifest, flavors: { user: { androidArm64: { ...asset, url: asset.url.replace('User', 'Admin') } } } },
    { ...manifest, flavors: { user: { androidArm64: { ...asset, sha256: 'invalid' } } } },
    { ...manifest, flavors: { user: { androidArm64: { ...asset, url: asset.url + '?unreviewed=1' } } } },
  ]) assert.throws(() => studentDownloadRelease(changed, identity))
})
test('a verified embedded release stays downloadable when the online manifest fails', async () => {
  const app = page(studentDownloadRelease(manifest, identity), manifest, true)
  await new Promise(setImmediate)
  assert.equal(app.elements.download.href, asset.url)
  assert.match(app.elements.status.textContent, /本页已核验/)
  assert.equal(app.urls.length, 2)
  assert.ok(app.urls.some(url => url.startsWith('student-latest.json?')))
  assert.ok(app.urls.some(url => url.startsWith('../update.json?')))
})
test('a temporarily older discovery manifest cannot downgrade the page during publication', async () => {
  const old = { ...manifest, latestVersion: '1.2.130', latestBuild: 130, flavors: { user: { androidArm64: { ...asset, url: asset.url.replace('131', '130') } } } }
  const app = page(studentDownloadRelease(manifest, identity), old)
  await new Promise(setImmediate)
  assert.equal(app.elements.download.href, asset.url); assert.match(app.elements['release-meta'].textContent, /1\.2\.131/)
})
test('current canonical manifest makes a development/unprepared page usable without hardcoded APKs', async () => {
  const app = page({})
  await new Promise(setImmediate)
  assert.equal(app.elements.download.href, asset.url); assert.equal(app.elements.download.download, 'SunshineCampus-User-1.2.131.apk')
})
test('invalid remote app flavor preserves the verified fallback instead of redirecting users', async () => {
  const wrong = { ...manifest, flavors: { user: { androidArm64: { ...asset, url: asset.url.replace('User', 'Admin') } } } }
  const app = page(studentDownloadRelease(manifest, identity), wrong)
  await new Promise(setImmediate)
  assert.equal(app.elements.download.href, asset.url); assert.match(app.elements.status.textContent, /已核验/)
})

test('a verified local release enables downloads even when the old canonical manifest is incomplete', async () => {
  const local = { ...studentDownloadRelease(manifest, identity), url: '/downloads/SunshineCampus-User-1.2.131.apk', localPreview: true }
  const old = { latestVersion: '1.2.116', latestBuild: 116, assets: { androidArm64: { url: asset.url } } }
  const app = page({}, url => url.startsWith('student-latest.json?') ? local : old)
  await new Promise(setImmediate)
  assert.equal(app.elements.download.href, asset.url)
  assert.match(app.elements['release-meta'].textContent, /1\.2\.131/)
})

test('release preparation includes the promotional page, scripts and artwork with verified download JSON', () => fixture(root => {
  const source = join(root, 'public/download')
  mkdirSync(join(source, 'assets'), { recursive: true })
  writeFileSync(join(source, 'index.html'), '<h1>OHU promotion</h1>')
  writeFileSync(join(source, 'share.js'), '/* share UI */')
  writeFileSync(join(source, 'assets/fox.png'), 'artwork')
  writeFileSync(join(source, 'student-latest.json'), '{"status":"unprepared"}')
  const output = join(root, '.release-out/landing')
  prepareStudentDownload(root, output, manifest, identity)
  assert.equal(readFileSync(join(output, 'download/index.html'), 'utf8'), '<h1>OHU promotion</h1>')
  assert.equal(readFileSync(join(output, 'download/share.js'), 'utf8'), '/* share UI */')
  assert.equal(readFileSync(join(output, 'download/assets/fox.png'), 'utf8'), 'artwork')
  assert.equal(JSON.parse(readFileSync(join(output, 'download/student-latest.json'), 'utf8')).sha256, asset.sha256)
}))

test('iOS download identity stays unavailable unless a same-version IPA passes manifest and hash checks', () => fixture(root => {
  const output = join(root, '.release-out/landing')
  const unavailable = join(root, 'public/download/ios-latest.json')
  writeFileSync(unavailable, JSON.stringify({ app: '哦狐', platform: 'ios', shell: 'user', status: 'unavailable' }))
  prepareStudentDownload(root, output, manifest, identity)
  assert.equal(JSON.parse(readFileSync(join(output, 'download/source-identity.json'), 'utf8')).iosDownloadAvailable, false)

  const filename = `Ohhu-user-${identity.nativeVersion}-${identity.nativeBuild}-unsigned.ipa`
  const ipaPath = join(root, 'public/download', filename)
  const ipaBytes = Buffer.from('verified-fixture-ipa')
  writeFileSync(ipaPath, ipaBytes)
  writeFileSync(unavailable, JSON.stringify({ app: '哦狐', platform: 'ios', shell: 'user', status: 'available', signed: false,
    version: identity.nativeVersion, build: identity.nativeBuild, filename, url: `/download/${filename}`,
    size: ipaBytes.length, sha256: sha256File(ipaPath) }))

  prepareStudentDownload(root, output, manifest, identity)
  const staged = join(output, 'download/source-identity.json')
  assert.equal(JSON.parse(readFileSync(staged, 'utf8')).iosDownloadAvailable, true)
  assert.equal(readFileSync(join(output, 'download', filename)).compare(ipaBytes), 0)
  writeFileSync(ipaPath, 'tampered')
  assert.throws(() => prepareStudentDownload(root, output, manifest, identity), /size or SHA-256/)
}))
