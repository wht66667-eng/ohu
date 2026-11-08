const pendingText = '当前版本的 iPhone 安装包尚未完成构建与校验。'

function validRelease(release, source) {
  if (!release || release.app !== '哦狐' || release.platform !== 'ios' || release.shell !== 'user' || release.status !== 'available' || release.signed !== false) return false
  if (!/^\d+\.\d+\.\d+$/.test(release.version) || !Number.isSafeInteger(release.build) || release.build < 1) return false
  if (!source || source.iosDownloadAvailable !== true || source.nativeVersion !== release.version || source.nativeBuild !== release.build) return false
  if (!/^[a-f0-9]{64}$/i.test(release.sha256) || !Number.isSafeInteger(release.size) || release.size < 1) return false
  try {
    const target = new URL(release.url, window.location.origin)
    return typeof release.filename === 'string' && target.protocol === 'https:' && target.origin === window.location.origin
      && target.pathname === `/download/${release.filename}` && target.pathname.toLowerCase().endsWith('.ipa')
      && !target.username && !target.password && !target.search && !target.hash
  } catch { return false }
}

function updateStatus(message) {
  document.querySelectorAll('[data-ios-status]').forEach((node) => { node.textContent = message })
}

function enableLinks(release) {
  document.querySelectorAll('[data-ios-package]').forEach((node) => {
    node.href = release.url
    node.download = release.filename || new URL(release.url).pathname.split('/').at(-1)
    node.removeAttribute('aria-disabled')
    node.classList.remove('is-unavailable')
    node.querySelector('[data-ios-version]')?.replaceChildren(document.createTextNode(`第二步 · ${release.version}`))
    node.querySelector('[data-ios-label]')?.replaceChildren(document.createTextNode('下载哦狐 IPA 安装包'))
  })
  document.querySelectorAll('[data-ios-current]').forEach((node) => {
    node.textContent = `当前提供 ${release.version}（构建 ${release.build}）的未签名 IPA，与安卓安装包同版本。`
    node.hidden = false
  })
  updateStatus(`版本 ${release.version} · 构建 ${release.build} · ${(release.size / 1024 / 1024).toFixed(1)} MB · SHA-256 ${release.sha256}`)
}

async function loadRelease() {
  try {
    const [releaseResponse, sourceResponse] = await Promise.all([
      fetch('/download/ios-latest.json', { cache: 'no-store' }),
      fetch('/download/source-identity.json', { cache: 'no-store' }),
    ])
    if (!releaseResponse.ok || !sourceResponse.ok) throw new Error('metadata unavailable')
    const [release, source] = await Promise.all([releaseResponse.json(), sourceResponse.json()])
    if (!validRelease(release, source)) {
      updateStatus(release?.message || pendingText)
      return
    }
    enableLinks(release)
  } catch {
    updateStatus(pendingText)
  }
}

void loadRelease()
