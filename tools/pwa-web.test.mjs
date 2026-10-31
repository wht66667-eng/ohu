import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { studentWebAppMetadata } from './pwa-web.mjs'

test('the installed student web app launches its own root without a saved session or tutorial URL', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url)))
  assert.equal(manifest.scope, '/')
  assert.equal(manifest.start_url, '/?source=homescreen')
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.name, '哦狐')
  for (const icon of manifest.icons) {
    const file = new URL(`../public${icon.src}`, import.meta.url)
    assert.ok(existsSync(file))
    const png = readFileSync(file)
    assert.equal(icon.sizes, `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`)
  }
})

test('web install metadata is idempotent and does not install a private-data service worker', () => {
  const source = '<html><head><title>哦狐</title></head><body></body></html>'
  const html = studentWebAppMetadata(source)
  assert.match(html, /rel="manifest" href="\/manifest.webmanifest"/)
  assert.match(html, /apple-mobile-web-app-capable" content="yes"/)
  assert.equal(studentWebAppMetadata(html), html)
  assert.doesNotMatch(html, /serviceWorker|caches\.open|access_token/)
  assert.throws(() => studentWebAppMetadata('<html>'), /head/)
})
