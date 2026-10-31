import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')
const compile = file => ts.transpileModule(fs.readFileSync(join(root, file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const quick = compile('src/lib/express-quick-jump.ts')
const tracking = compile('src/lib/express.ts')

function fixture({ native = true, os = 'android', open = async () => ({ ok: true, route: 'direct' }) } = {}) {
  const module = { exports: {} }, calls = [], timers = new Map()
  let serial = 0
  vm.runInNewContext(quick, {
    module, exports: module.exports,
    setTimeout: callback => { const id = ++serial; timers.set(id, callback); return id },
    clearTimeout: id => timers.delete(id),
    require: name => {
      assert.equal(name, '@capacitor/core')
      return { Capacitor: { isNativePlatform: () => native, getPlatform: () => os }, registerPlugin: name => {
        assert.equal(name, 'AppProbe')
        return { openExpressEntry: options => { calls.push(options); return open(options) } }
      } }
    },
  })
  return { api: module.exports, calls, timers, expire: () => [...timers.values()].forEach(callback => callback()) }
}

test('seven fixed entries distinguish identity codes, pending parcels and order lists; web links stay on platform domains', () => {
  const { api } = fixture()
  assert.deepEqual(Array.from(api.QUICK_JUMP_ENTRIES, entry => entry.id), ['cainiao-code', 'taobao-code', 'pdd-code', 'taobao-pending', 'pdd-pending', 'douyin-orders', 'jd-orders'])
  assert.equal(api.QUICK_JUMP_ENTRIES.filter(entry => entry.group === 'code').length, 3)
  assert.equal(api.findQuickJumpEntry('jd-orders').title, '京东订单')
  assert.equal(api.findQuickJumpEntry('douyin-orders').title, '抖音订单')
  assert.equal(api.findQuickJumpEntry('douyin-orders').webUrl, undefined)
  for (const entry of api.QUICK_JUMP_ENTRIES.filter(entry => entry.webUrl)) {
    const url = new URL(entry.webUrl)
    assert.equal(url.protocol, 'https:')
    assert.equal(url.username + url.password, '')
    assert.ok(['taobao.com', 'pinduoduo.net', 'jd.com'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)))
  }
})

test('only a known entry ID crosses the native bridge, never a URL, package override, credential or Intent extra', async () => {
  const f = fixture()
  for (const id of ['', 'unknown', '__proto__', 'intent://evil', null, undefined]) {
    assert.equal((await f.api.openQuickJumpEntry(id)).ok, false)
  }
  assert.equal(f.calls.length, 0)
  for (const entry of f.api.QUICK_JUMP_ENTRIES) {
    assert.equal((await f.api.openQuickJumpEntry(entry.id)).ok, true)
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-1))), { entryId: entry.id })
  }
  assert.equal(f.timers.size, 0)
})

test('desktop, Android browsers and iOS do not invoke an Android-only bridge', async () => {
  for (const options of [{ native: false }, { native: true, os: 'ios' }, { native: false, os: 'android' }]) {
    const f = fixture(options)
    assert.equal(f.api.CAN_NATIVE_EXPRESS_JUMP, false)
    assert.equal((await f.api.openQuickJumpEntry('taobao-code')).route, 'unsupported')
    assert.equal(f.calls.length, 0)
    assert.equal(f.timers.size, 0)
  }
})

test('successful OS dispatch is reported as a request, without promising a displayed identity code', async () => {
  for (const route of ['direct', 'app', 'web']) {
    const f = fixture({ open: async () => ({ ok: true, route }) })
    const result = await f.api.openQuickJumpEntry('taobao-code')
    assert.equal(result.ok, true)
    assert.equal(result.route, route)
    assert.match(result.message, /已请求打开/)
    assert.doesNotMatch(result.message, /已显示|已获取|已刷新/)
    if (route === 'app') assert.match(result.message, /查找/)
    assert.equal(f.timers.size, 0)
  }
})

test('unavailable routes and old APK bridges return actionable errors with no automatic second launch', async () => {
  const missing = fixture({ open: async () => ({ ok: false, route: 'unavailable' }) })
  assert.equal((await missing.api.openQuickJumpEntry('taobao-code')).route, 'unavailable')
  assert.equal(missing.calls.length, 1)
  for (const code of ['UNIMPLEMENTED', 'UNAVAILABLE']) {
    const old = fixture({ open: async () => { throw { code } } })
    const result = await old.api.openQuickJumpEntry('taobao-code')
    assert.equal(result.route, 'needs-update')
    assert.match(result.message, /新版 APK/)
    assert.equal(old.calls.length, 1)
    assert.equal(old.timers.size, 0)
  }
})

test('malformed bridge success and an invented Douyin web fallback do not turn into success', async () => {
  for (const data of [null, {}, { ok: 'true', route: 'direct' }, { ok: true, route: 'anything' }, { ok: false, route: 'direct' }, { ok: true, route: 'unavailable' }]) {
    const f = fixture({ open: async () => data })
    assert.equal((await f.api.openQuickJumpEntry('taobao-code')).route, 'error')
  }
  const f = fixture({ open: async () => ({ ok: true, route: 'web' }) })
  assert.equal((await f.api.openQuickJumpEntry('douyin-orders')).route, 'error')
})

test('a hung or rejected bridge is bounded and cannot trigger another implicit App or browser open', async () => {
  let finish
  const f = fixture({ open: () => new Promise(resolve => { finish = resolve }) })
  const pending = f.api.openQuickJumpEntry('pdd-code')
  assert.equal(f.calls.length, 1)
  f.expire()
  assert.equal((await pending).route, 'error')
  finish({ ok: true, route: 'direct' })
  await Promise.resolve()
  assert.equal(f.calls.length, 1)
  assert.equal(f.timers.size, 0)
  const rejected = fixture({ open: async () => { throw new Error('failed') } })
  assert.equal((await rejected.api.openQuickJumpEntry('pdd-code')).route, 'error')
})

function trackingFixture(nativeOpen) {
  const module = { exports: {} }, websites = [], appRequests = [], copied = []
  vm.runInNewContext(tracking, {
    module, exports: module.exports,
    navigator: { clipboard: { writeText: async value => copied.push(value) } }, window: { isSecureContext: true },
    document: { createElement: () => { throw new Error('No hidden iframe or extra fallback is allowed') } },
    require: name => name === './campus-links' ? { openExternalUrl: url => websites.push(url) }
      : name === './express-app-probe' ? { launchScheme: async url => { appRequests.push(url); return nativeOpen }, canOpenScheme: async () => nativeOpen }
        : assert.fail(`Unexpected dependency ${name}`),
  })
  return { api: module.exports, websites, appRequests, copied }
}

test('existing tracking opens one fallback, stops after native success and still copies the user-supplied tracking number', async () => {
  for (const nativeOpen of [true, false]) {
    const f = trackingFixture(nativeOpen)
    const target = f.api.identifyExpress('YT1234567890123')
    await f.api.launchExpress(target)
    assert.deepEqual(f.copied, ['YT1234567890123'])
    assert.equal(f.appRequests.length, 1)
    assert.deepEqual(f.websites, nativeOpen ? [] : [target.h5Url])
  }
  const f = trackingFixture(false)
  await f.api.launchExpress({ appScheme: '', h5Url: 'https://track.cainiao.com/' })
  assert.deepEqual(f.websites, ['https://track.cainiao.com/'])
  assert.equal(f.appRequests.length, 0)
})
