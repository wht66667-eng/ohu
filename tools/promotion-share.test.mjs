import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import jsQR from 'jsqr'
import { PUBLIC_SHARE_URL, POSTER_THEMES, promotionShareContext, isPublicHttpsUrl } from '../public/download/share.mjs'

const require = createRequire(import.meta.url)
const { PNG } = require('pngjs')

test('local and WebView previews share only the configured public page, never local addresses or query secrets', () => {
  for (const current of ['http://127.0.0.1:43123/download/index.html', 'http://192.168.1.2/download/', 'capacitor://localhost/download/index.html', 'https://localhost/download/?token=private', 'invalid']) {
    const context = promotionShareContext(current)
    assert.equal(context.preview, true)
    assert.equal(context.url, PUBLIC_SHARE_URL)
    assert.equal(new URL(context.url).search, '')
  }
  assert.equal(promotionShareContext(PUBLIC_SHARE_URL).preview, false)
  assert.equal(promotionShareContext(PUBLIC_SHARE_URL + '?token=private#draft').url, PUBLIC_SHARE_URL)
})

test('private, reserved and non-HTTPS hosts are never described as a public page', () => {
  for (const url of ['http://public.com', 'https://127.0.0.1/', 'https://10.0.0.2', 'https://172.20.0.1', 'https://192.168.0.1', 'https://100.64.0.1', 'https://169.254.1.1', 'https://[::1]', 'https://app.local', 'https://campus.internal', 'https://a.test', 'https://user:pass@public.com']) assert.equal(isPublicHttpsUrl(url), false, url)
  assert.equal(isPublicHttpsUrl(PUBLIC_SHARE_URL), true)
})

test('the shipped QR image really decodes to the public HTTPS promotional page', () => {
  const png = PNG.sync.read(fs.readFileSync(new URL('../public/download/assets/share-qr.png', import.meta.url)))
  assert.equal(png.width, 360)
  assert.equal(png.height, 360)
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)
  assert.equal(decoded?.data, PUBLIC_SHARE_URL)
  // Four modules at 8px per module remain plain white on every edge.
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    if (x >= 32 && x < png.width - 32 && y >= 32 && y < png.height - 32) continue
    const offset = (y * png.width + x) * 4
    assert.deepEqual([...png.data.subarray(offset, offset + 4)], [255, 255, 255, 255])
  }
})

test('all postcard themes use existing local fox assets, while HTML loads the new share controller once', () => {
  assert.equal(new Set(POSTER_THEMES.map(theme => theme.name)).size, 3)
  for (const theme of POSTER_THEMES) assert.ok(fs.existsSync(new URL('../public/download/assets/' + theme.fox, import.meta.url)))
  const html = fs.readFileSync(new URL('../public/download/index.html', import.meta.url), 'utf8')
  assert.equal((html.match(/src="share\.mjs(?:\?[^" ]*)?"/g) || []).length, 1)
  assert.match(html, /href="share\.css"/)
  for (const id of ['shareModal', 'sharePoster', 'sharePosterFrame', 'savePoster', 'sendPoster', 'copyLink', 'posterStatus']) assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1)
  assert.doesNotMatch(html, /clipboard\.writeText\(location\.href\)/)
  assert.doesNotMatch(html, /const closeShare|const DOWNLOAD_LINKS/)
  assert.match(html, /本次修改需发布后才会在线显示/)
})
