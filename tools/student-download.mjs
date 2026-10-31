import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertOutputPath } from './release-common.mjs'
import { verifiedIosDownload } from './ios-download-release.mjs'

/** The public landing page and its legacy JSON use the very same verified APK artifact. */
export function studentDownloadRelease(manifest, identity) {
  const asset = manifest.flavors?.user?.androidArm64 || manifest.assets?.androidArm64
  let url
  try { url = new URL(asset?.url) } catch { throw Error('Verified student download URL required') }
  if (manifest.latestVersion !== identity.nativeVersion || manifest.latestBuild !== identity.nativeBuild
    || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || url.pathname !== `/downloads/SunshineCampus-User-${identity.nativeVersion}.apk`
    || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.size) || asset.size < 1) {
    throw Error('Student download page does not match the verified APK release')
  }
  return { app: '哦狐', shell: 'user', packageName: 'com.sunshinecampus.app', nativeVersion: identity.nativeVersion,
    nativeBuild: identity.nativeBuild, clientVersion: identity.version, clientBuild: identity.webBuild,
    url: url.href, downloadPage: new URL('/download/student.html', url).href, size: asset.size, sha256: asset.sha256,
    abi: 'arm64-v8a', minSdkVersion: 23 }
}

export function prepareStudentDownload(root, output, manifest, identity) {
  const release = studentDownloadRelease(manifest, identity)
  const directory = assertOutputPath(root, join(root, '.release-out'), join(output, 'download'))
  mkdirSync(directory, { recursive: true })
  const source = join(root, 'public/download/student.html')
  if (!existsSync(source)) throw Error('Student download template is missing')
  let html = readFileSync(source, 'utf8')
  for (const marker of ['id="release-meta"', 'id="download"', 'id="download-release"']) {
    if (!html.includes(marker)) throw Error('Student download template is incomplete')
  }
  // APK-manifest-only uploads must carry the same promotional page and local
  // artwork/scripts as website uploads. Never copy the unprepared JSON template.
  function copyPublicFiles(from, to) {
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      if (from === join(root, 'public/download') && ['student.html', 'student-latest.json'].includes(entry.name)) continue
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.ipa')) continue
      const source = join(from, entry.name)
      const target = assertOutputPath(root, join(root, '.release-out'), join(to, entry.name))
      const stat = lstatSync(source)
      if (stat.isSymbolicLink()) throw Error('Student download assets must not contain symbolic links')
      if (stat.isDirectory()) { mkdirSync(target, { recursive: true }); copyPublicFiles(source, target) }
      else if (stat.isFile()) copyFileSync(source, target)
      else throw Error('Unsupported student download asset')
    }
  }
  copyPublicFiles(join(root, 'public/download'), directory)
  const iosRelease = verifiedIosDownload(root, identity)
  if (iosRelease) copyFileSync(iosRelease.source, assertOutputPath(root, join(root, '.release-out'), join(directory, iosRelease.manifest.filename)))
  writeFileSync(join(directory, 'source-identity.json'), JSON.stringify({
    nativeVersion: identity.nativeVersion, nativeBuild: identity.nativeBuild, iosDownloadAvailable: Boolean(iosRelease),
  }, null, 2))
  const filename = new URL(release.url).pathname.split('/').at(-1)
  html = html.replace(/(<p class="meta" id="release-meta">)[^<]*(<\/p>)/,
    `$1安装包 ${release.nativeVersion} · ${(release.size / 1024 / 1024).toFixed(1)} MB$2`)
    .replace(/<a class="download" id="download"[^>]*>[^<]*<\/a>/,
      `<a class="download" id="download" href="${release.url}" download="${filename}">一键下载学生端</a>`)
    .replace(/(<script id="download-release" type="application\/json">)[\s\S]*?(<\/script>)/,
      `$1${JSON.stringify(release).replaceAll('<', '\\u003c')}$2`)
  writeFileSync(join(directory, 'student.html'), html)
  writeFileSync(join(directory, 'student-latest.json'), JSON.stringify(release, null, 2) + '\n')
  return release
}
