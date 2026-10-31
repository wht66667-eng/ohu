import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import QRCode from 'qrcode'
import jsQR from 'jsqr'

const ts = createRequire(import.meta.url)('typescript')
const source = fs.readFileSync(new URL('../src/lib/meet-share-url.ts', import.meta.url), 'utf8').replace('import.meta.env.VITE_PUBLIC_SHARE_ORIGIN', "''")
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const module = { exports: {} }
vm.runInNewContext(compiled, { module, exports: module.exports, URL })
const { buildMeetShareUrl, isPublicMeetUrl, meetInviteTheme } = module.exports

test('a given invitation keeps its decoration theme and codes produce varied themes', () => {
  const urls = Array.from({ length: 40 }, (_, i) => `https://ohu.example.com/meet/${String(i).padStart(16, '0')}`)
  for (const url of urls) assert.equal(meetInviteTheme(url), meetInviteTheme(url))
  assert.equal(new Set(urls.map(meetInviteTheme)).size, 4)
})

test('a public web origin produces the real browser route without native hashes', () => {
  assert.equal(buildMeetShareUrl('abcdef0123456789', 'https://ohu.example.com').url, 'https://ohu.example.com/meet/abcdef0123456789')
  assert.equal(buildMeetShareUrl('abcdef0123456789', 'capacitor://localhost', 'https://ohu.example.com').url, 'https://ohu.example.com/meet/abcdef0123456789')
})

test('local and private preview addresses are never offered as WeChat share URLs', () => {
  for (const origin of ['http://127.0.0.1:43123', 'https://localhost', 'https://127.0.0.1', 'https://10.0.0.8', 'https://192.168.1.2', 'https://172.16.1.9', 'https://100.64.0.1', 'https://[::1]', 'https://app.local', 'https://campus.internal', 'capacitor://localhost']) {
    const result = buildMeetShareUrl('abcdef0123456789', origin)
    assert.equal(result.url, null, origin)
    assert.match(result.reason, /本地预览/)
  }
})

test('invalid configuration, injected codes and credential URLs fail closed', () => {
  for (const configured of ['javascript:alert(1)', 'https://user:password@ohu.example.com', 'https://ohu.example.com/?token=x', 'https://ohu.example.com/#/meet/old', 'https://ohu.example.com/app/']) {
    assert.equal(buildMeetShareUrl('abcdef0123456789', 'https://ohu.example.com', configured).url, null)
  }
  for (const code of ['../admin', 'abc?token=1', 'abc#private', 'a/b/c', 'short', '活动编号']) assert.equal(buildMeetShareUrl(code, 'https://ohu.example.com').url, null)
  assert.equal(isPublicMeetUrl('https://ohu.example.com/meet/abcdef0123456789?token=secret'), false)
  assert.equal(isPublicMeetUrl('https://user:password@ohu.example.com/meet/abcdef0123456789'), false)
})

test('actual QR modules with a four-module quiet zone decode to the invitation URL', () => {
  const url = 'https://ohu.example.com/meet/0123456789abcdef'
  const qr = QRCode.create(url, { errorCorrectionLevel: 'M' })
  const margin = 4, scale = 8, size = (qr.modules.size + margin * 2) * scale
  const pixels = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const row = Math.floor(y / scale) - margin, column = Math.floor(x / scale) - margin
    const dark = row >= 0 && column >= 0 && row < qr.modules.size && column < qr.modules.size && qr.modules.get(row, column)
    const offset = (y * size + x) * 4
    pixels[offset] = dark ? 0 : 255
    pixels[offset + 1] = dark ? 0 : 255
    pixels[offset + 2] = dark ? 0 : 255
    pixels[offset + 3] = 255
  }
  const decoded = jsQR(pixels, size, size)
  assert.equal(decoded?.data, url)
})
