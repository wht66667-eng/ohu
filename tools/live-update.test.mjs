import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
const hash = 'a'.repeat(64), otherHash = 'b'.repeat(64)
function fixture({ native = true, nativeBuild = 122, shell = 'user', active, pending = null, failSet = false } = {}) {
  const store = new Map(), calls = { download: 0, set: [], ready: 0 }
  let current = active || { id: 'builtin', version: '1.2.38', checksum: '' }
  const downloaded = { id: 'new-bundle', version: '1.2.122', checksum: hash, status: 'pending' }
  const plugin = {
    current: async () => ({ bundle: current, native: '1.2.38' }),
    getNextBundle: async () => pending,
    list: async () => ({ bundles: [] }),
    addListener: async () => ({ remove: async () => {} }),
    download: async ({ version, checksum }) => { calls.download++; return { ...downloaded, version, checksum } },
    set: async ({ id }) => { calls.set.push(id); if (failSet) throw Error('set failed') },
    notifyAppReady: async () => { calls.ready++ },
  }
  const nativeInfo = native ? { appId: `com.sunshinecampus.${shell === 'user' ? 'app' : 'admin'}`, version: `1.2.${nativeBuild}`, build: nativeBuild } : null
  const module = { exports: {} }
  const source = fs.readFileSync(root + 'src/lib/live-update.ts', 'utf8').replaceAll('import.meta.env.VITE_OTA_MANIFEST_URL', 'undefined')
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module, exports: module.exports, console, URL, AbortController,
    window: { setTimeout, clearTimeout }, fetch: async () => { throw Error('offline') },
    localStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) },
    require: name => {
      if (name === '@capgo/capacitor-updater') return { CapacitorUpdater: plugin }
      if (name === './platform') return { IS_NATIVE: native }
      if (name === './app-shell') return { getAppShell: () => shell, SHELL_APP_ID: { user: 'com.sunshinecampus.app', admin: 'com.sunshinecampus.admin' } }
      if (name === './app-version') return { WEB_VERSION: '1.2.122', WEB_BUILD: 122, getNativeAppVersion: async () => nativeInfo, knownNativeAppVersion: () => nativeInfo }
      throw Error('Unexpected module ' + name)
    },
  })
  return { api: module.exports, store, calls, activate: value => { current = value } }
}
const manifest = (extra = {}) => ({ version: '1.2.122', build: 123, checksum: hash, url: 'https://example.test/123.zip', shell: 'user', minNativeBuild: 122, ...extra })

test('native OS version remains separate from a stale updater builtin label', async () => {
  const f = fixture(), state = await f.api.currentOtaRuntime()
  assert.equal(state.native.build, 122)
  assert.equal(state.builtinVersion, '1.2.38')
  assert.equal(state.version, '1.2.122')
  assert.equal(state.build, 122)
})
test('a confirmed same-version higher build does not download again after restart', async () => {
  const f = fixture(), remote = manifest()
  assert.equal((await f.api.downloadAndQueueOta(remote)).ok, true)
  assert.equal(f.calls.ready, 0)
  f.activate({ id: 'new-bundle', version: remote.version, checksum: hash, status: 'success' })
  await f.api.confirmCurrentOtaBundle()
  const state = await f.api.currentOtaRuntime()
  assert.equal(state.build, 123)
  assert.equal(f.api.shouldApplyOta(remote, state.version), false)
  assert.equal(f.api.shouldApplyOta(manifest({ build: 124, checksum: otherHash }), state.version), true)
})
test('a matching current checksum prevents repeat downloads even after local storage was cleared', async () => {
  const f = fixture({ active: { id: 'existing', version: '1.2.122', checksum: hash } })
  const version = await f.api.currentBundleVersion()
  assert.equal(f.api.shouldApplyOta(manifest(), version), false)
})
test('a pending bundle with a different checksum is never applied as the new build', async () => {
  const f = fixture({ pending: { id: 'stale', version: '1.2.122', checksum: otherHash, status: 'pending' } })
  assert.equal((await f.api.downloadAndQueueOta(manifest())).ok, true)
  assert.equal(f.calls.download, 1)
  assert.deepEqual(f.calls.set, ['new-bundle'])
})
test('only exact pending bytes can be reused and set does not confirm health', async () => {
  const f = fixture({ pending: { id: 'cached', version: '1.2.122', checksum: hash, status: 'pending' } })
  assert.equal((await f.api.downloadAndQueueOta(manifest())).ok, true)
  assert.equal(f.calls.download, 0)
  assert.deepEqual(f.calls.set, ['cached'])
  assert.equal(f.calls.ready, 0)
})
test('old native packages, wrong shells and wrong channels reject OTA before download', async () => {
  for (const [settings, remote] of [
    [{ nativeBuild: 116 }, manifest()],
    [{ shell: 'admin' }, manifest()],
    [{}, manifest({ channel: 'testing' })],
  ]) {
    const f = fixture(settings)
    assert.equal((await f.api.downloadAndQueueOta(remote)).ok, false)
    assert.equal(f.calls.download, 0)
    assert.equal(f.calls.set.length, 0)
  }
})
test('failed activation never marks a build confirmed and remains retryable', async () => {
  const f = fixture({ failSet: true })
  assert.equal((await f.api.downloadAndQueueOta(manifest())).ok, false)
  assert.equal(f.store.has('sc.ota.confirmed.v2'), false)
  const version = await f.api.currentBundleVersion()
  assert.equal(f.api.shouldApplyOta(manifest(), version), true)
})
test('rollback discards staged identity without confirming the wrong package', async () => {
  const f = fixture()
  await f.api.downloadAndQueueOta(manifest())
  await f.api.confirmCurrentOtaBundle()
  assert.equal(f.store.has('sc.ota.staged.v2'), false)
  assert.equal(f.store.has('sc.ota.confirmed.v2'), false)
  assert.match(f.api.readOtaError().msg, /恢复/)
})
test('browser environments do not start native updates or acknowledge native readiness', async () => {
  const f = fixture({ native: false })
  await f.api.initLiveUpdate()
  await f.api.confirmCurrentOtaBundle()
  assert.equal(f.api.shouldApplyOta(manifest(), '1.0.0'), false)
  assert.equal(f.calls.ready, 0)
})

test('importing the readiness module never confirms health; repeated mounted effects confirm once', async () => {
  let calls = 0
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(root + 'src/ota-ready.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    module, exports: module.exports, console,
    require: name => name === './lib/platform' ? { IS_NATIVE: true } : { confirmCurrentOtaBundle: async () => { calls++ } },
  })
  assert.equal(calls, 0)
  await Promise.all([module.exports.confirmOtaAppReady(), module.exports.confirmOtaAppReady()])
  await module.exports.confirmOtaAppReady()
  assert.equal(calls, 1)
})

test('a failed readiness acknowledgement can retry on the next usable screen', async () => {
  let calls = 0
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(root + 'src/ota-ready.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    module, exports: module.exports, console: { info() {} },
    require: name => name === './lib/platform' ? { IS_NATIVE: true } : { confirmCurrentOtaBundle: async () => { if (++calls === 1) throw Error('not ready') } },
  })
  await module.exports.confirmOtaAppReady()
  await module.exports.confirmOtaAppReady()
  assert.equal(calls, 2)
})
