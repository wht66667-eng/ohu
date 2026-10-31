/** Local preview only: serve an existing verified APK without publishing it. */
import { createReadStream, existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { RELEASE_SIGNER_SHA256, assertOutputPath, sha256File } from './release-common.mjs'

export function latestLocalStudentRelease(root) {
  const outputRoot = join(root, '.release-out')
  const apkRoot = join(outputRoot, 'apk')
  if (!existsSync(apkRoot)) throw Error('No verified local student APK')
  const candidates = []
  for (const directory of readdirSync(apkRoot)) {
    if (!/^\d+\.\d+\.\d+-\d+$/.test(directory)) continue
    const folder = assertOutputPath(root, outputRoot, join(apkRoot, directory))
    if (!lstatSync(folder).isDirectory()) continue
    for (const descriptorName of ['release-both.json', 'release-user.json']) {
      const descriptorPath = assertOutputPath(root, outputRoot, join(folder, descriptorName))
      if (!existsSync(descriptorPath)) continue
      const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'))
      const artifact = descriptor.artifacts?.find(item => item.shell === 'user')
      if (artifact) candidates.push({ descriptor, artifact, folder })
    }
  }
  candidates.sort((a, b) => Number(b.descriptor.build) - Number(a.descriptor.build))
  const selected = candidates[0]
  if (!selected) throw Error('No verified local student APK')
  const { artifact, descriptor, folder } = selected
  if (!/^\d+\.\d+\.\d+$/.test(descriptor.version) || !Number.isSafeInteger(descriptor.build) || descriptor.build < 1
    || artifact.applicationId !== 'com.sunshinecampus.app' || artifact.version !== descriptor.version || artifact.build !== descriptor.build
    || artifact.signingCertificateSha256 !== RELEASE_SIGNER_SHA256 || artifact.abis?.length !== 1 || artifact.abis[0] !== 'arm64-v8a'
    || artifact.file !== `SunshineCampus-User-${descriptor.version}.apk` || basename(artifact.file) !== artifact.file
    || !/^[a-f0-9]{64}$/.test(artifact.sha256) || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1) {
    throw Error('Invalid verified local student APK descriptor')
  }
  const source = assertOutputPath(root, outputRoot, join(folder, artifact.file))
  if (statSync(source).size !== artifact.bytes || sha256File(source) !== artifact.sha256) throw Error('Local student APK changed since verification')
  return { source, release: { app: '哦狐', shell: 'user', packageName: artifact.applicationId,
    nativeVersion: artifact.version, nativeBuild: artifact.build, size: artifact.bytes, sha256: artifact.sha256,
    abi: artifact.abis[0], minSdkVersion: 23, url: `/downloads/${artifact.file}`, localPreview: true } }
}

export function localStudentDownload(root) {
  let cached
  let fingerprint = ''
  // Descriptor discovery is cheap; APK hashing occurs only when its file changes.
  function current() {
    const apkRoot = join(root, '.release-out/apk')
    const marks = existsSync(apkRoot) ? readdirSync(apkRoot).filter(name => /^\d+\.\d+\.\d+-\d+$/.test(name)).flatMap(name => {
      const folder = assertOutputPath(root, join(root, '.release-out'), join(apkRoot, name))
      return readdirSync(folder).filter(file => /^(release-(both|user)\.json|SunshineCampus-User-\d+\.\d+\.\d+\.apk)$/.test(file)).map(file => {
        const path = assertOutputPath(root, join(root, '.release-out'), join(folder, file))
        const stat = statSync(path)
        return `${name}/${file}:${stat.size}:${stat.mtimeMs}`
      })
    }).join('|') : ''
    if (!cached || marks !== fingerprint) { cached = latestLocalStudentRelease(root); fingerprint = marks }
    return cached
  }
  function middleware(req, res, next) {
    const path = (req.url || '').split('?')[0]
    const metadata = path === '/download/student-latest.json'
    if (!metadata && !/^\/downloads\/SunshineCampus-User-\d+\.\d+\.\d+\.apk$/.test(path)) return next()
    if (!['GET', 'HEAD'].includes(req.method || 'GET')) { res.statusCode = 405; res.setHeader('Allow', 'GET, HEAD'); res.end(); return }
    try {
      const { source, release } = current()
      if (!metadata && path !== release.url) { res.statusCode = 404; res.end('Local student APK not found'); return }
      res.setHeader('Cache-Control', 'no-store')
      if (metadata) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify(release))
      } else {
        res.setHeader('Content-Type', 'application/vnd.android.package-archive')
        res.setHeader('Content-Disposition', `attachment; filename="${basename(source)}"`)
        res.setHeader('Content-Length', release.size)
        if (req.method === 'HEAD') return res.end()
        const stream = createReadStream(source)
        res.on('close', () => stream.destroy())
        stream.on('error', () => res.destroy())
        stream.pipe(res)
      }
    } catch {
      res.statusCode = 503
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify({ error: 'No verified local student APK is available. Prepare an APK first.' }))
    }
  }
  return { name: 'local-student-download', apply: 'serve',
    configureServer(server) { server.middlewares.use(middleware) },
    configurePreviewServer(server) { server.middlewares.use(middleware) } }
}
