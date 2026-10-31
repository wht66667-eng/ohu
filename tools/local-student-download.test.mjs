import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { RELEASE_SIGNER_SHA256, sha256File } from './release-common.mjs'
import { latestLocalStudentRelease, localStudentDownload } from './local-student-download.mjs'

async function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'ohhu-local-download-'))
  try { return await run(root) } finally {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('ohhu-local-download-')) throw Error('Unsafe cleanup')
    rmSync(root, { recursive: true, force: true })
  }
}

function apk(root, build = 138, changes = {}) {
  const version = `1.2.${build}`
  const directory = join(root, `.release-out/apk/${version}-${build}`)
  mkdirSync(directory, { recursive: true })
  const file = `SunshineCampus-User-${version}.apk`
  const body = Buffer.from(`verified APK fixture ${build}`)
  const source = join(directory, file)
  writeFileSync(source, body)
  const artifact = { shell: 'user', applicationId: 'com.sunshinecampus.app', version, build, abis: ['arm64-v8a'],
    signingCertificateSha256: RELEASE_SIGNER_SHA256, file, bytes: body.length, sha256: sha256File(source), ...changes }
  writeFileSync(join(directory, 'release-both.json'), JSON.stringify({ version, build, artifacts: [artifact] }))
  return { body, source, artifact }
}

test('local preview selects the latest completed verified student APK independently of the next source version', () => fixture(root => {
  apk(root, 137); const latest = apk(root, 138)
  mkdirSync(join(root, '.release-out/apk/1.2.139-139')) // next build is not yet complete
  const found = latestLocalStudentRelease(root)
  assert.equal(found.source, latest.source)
  assert.equal(found.release.nativeVersion, '1.2.138')
  assert.equal(found.release.sha256, latest.artifact.sha256)
  assert.equal(found.release.url, '/downloads/SunshineCampus-User-1.2.138.apk')
  assert.equal(found.release.localPreview, true)
}))

test('local APK metadata must match bytes, student package, release signer and ARM64', () => fixture(root => {
  const tampered = apk(root)
  writeFileSync(tampered.source, 'changed bytes')
  assert.throws(() => latestLocalStudentRelease(root), /changed since verification/)
  for (const changes of [{ applicationId: 'com.sunshinecampus.admin' }, { abis: ['x86_64'] }, { signingCertificateSha256: 'a'.repeat(64) }, { file: '../release.apk' }]) {
    apk(root, 138, changes)
    assert.throws(() => latestLocalStudentRelease(root), /Invalid verified/)
  }
}))

test('missing verified packages do not advertise a fabricated download', () => fixture(root => {
  assert.throws(() => latestLocalStudentRelease(root), /No verified/)
}))

test('dev/preview serves verified metadata and exact APK bytes, updates after a new completed build, and blocks other files', () => fixture(async root => {
  const current = apk(root)
  const plugin = localStudentDownload(root)
  assert.equal(plugin.apply, 'serve')
  let handler
  plugin.configurePreviewServer({ middlewares: { use(value) { handler = value } } })
  assert.equal(typeof handler, 'function')
  const server = createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end() }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  try {
    const info = await fetch(`${origin}/download/student-latest.json`)
    assert.equal(info.status, 200); assert.equal(info.headers.get('cache-control'), 'no-store')
    const release = await info.json()
    assert.equal(release.sha256, current.artifact.sha256)
    const downloaded = await fetch(origin + release.url)
    assert.equal(downloaded.headers.get('content-type'), 'application/vnd.android.package-archive')
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), current.body)
    const head = await fetch(origin + release.url, { method: 'HEAD' })
    assert.equal(head.headers.get('content-length'), String(current.body.length))
    assert.equal((await head.arrayBuffer()).byteLength, 0)
    assert.equal((await fetch(origin + release.url, { method: 'POST' })).status, 405)
    assert.equal((await fetch(`${origin}/downloads/SunshineCampus-User-1.2.999.apk`)).status, 404)
    assert.equal((await fetch(`${origin}/.release-out/apk/1.2.138-138/release-both.json`)).status, 404)
    apk(root, 139)
    assert.equal((await (await fetch(`${origin}/download/student-latest.json`)).json()).nativeBuild, 139)
  } finally { await new Promise(resolve => server.close(resolve)) }
}))
