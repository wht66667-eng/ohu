import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')
function fixture({ native = true, build = 116, version = '1.2.116', getInfo } = {}) {
  const replies = [], fetches = [], opens = [], modules = new Map()
  let infoCalls = 0
  const load = (file) => {
    if (modules.has(file)) return modules.get(file)
    const source = fs.readFileSync(join(root, file), 'utf8').replaceAll('import.meta.env.BASE_URL', "'./'")
    const module = { exports: {} }
    modules.set(file, module.exports)
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      module, exports: module.exports, URL, AbortController, setTimeout, clearTimeout,
      window: { open: (...args) => opens.push(args) },
      require: name => {
        if (name === '@capacitor/core') return { Capacitor: { isNativePlatform: () => native } }
        if (name === '@capacitor/app') return { App: { getInfo: () => { infoCalls++; return getInfo ? getInfo(infoCalls) : Promise.resolve({ id: 'com.sunshinecampus.app', version, build: String(build) }) } } }
        if (name === './platform') return { IS_NATIVE: native }
        if (name === './app-shell') return { getAppShell: () => 'user' }
        if (name === './app-version') return load('src/lib/app-version.ts')
        throw new Error('Unexpected import ' + name)
      },
      fetch: async url => {
        fetches.push(url)
        const value = replies.shift()
        if (value instanceof Error) throw value
        return { ok: true, json: async () => value }
      },
    })
    return module.exports
  }
  return { api: load('src/lib/app-update.ts'), versionApi: load('src/lib/app-version.ts'), replies, fetches, opens, infoCalls: () => infoCalls }
}

test('missing work flavor cannot select a generic student APK', () => {
  const { api } = fixture(), manifest = { assets: { androidArm64: { url: 'https://example.test/student.apk' } } }
  assert.equal(api.pickDownloadUrl(manifest, 'user'), 'https://example.test/student.apk')
  assert.equal(api.pickDownloadUrl(manifest, 'admin'), undefined)
})
test('each shell chooses only its own HTTPS download', () => {
  const { api } = fixture(), flavors = Object.fromEntries(['user', 'admin'].map(shell => [shell, { downloadUrl: 'https://example.test/' + shell + '.apk' }]))
  for (const shell of Object.keys(flavors)) assert.equal(api.pickDownloadUrl({ flavors }, shell), flavors[shell].downloadUrl)
  assert.equal(api.pickDownloadUrl({ flavors: { admin: { downloadUrl: 'javascript:alert(1)' } } }, 'admin'), undefined)
})
test('bundled fallback never claims the online latest version was verified', async () => {
  const { api, replies } = fixture()
  replies.push(new Error('offline'), new Error('offline'), { latestVersion: '1.2.19', latestBuild: 34 })
  const result = await api.checkAppUpdate()
  assert.equal(result.status, 'up_to_date')
  assert.equal(result.verifiedRemote, false)
})
test('student shell reads the student-only APK manifest before the shared one', async () => {
  const { api, replies, fetches } = fixture()
  replies.push({ latestVersion: '1.2.36', latestBuild: 51 })
  assert.equal((await api.checkAppUpdate()).status, 'up_to_date')
  assert.ok(fetches[0].endsWith('/update-user.json'))
  assert.equal(fetches.length, 1)
})
test('real remote response can confirm up-to-date and lower builds do not downgrade', async () => {
  const { api, replies } = fixture()
  replies.push({ latestVersion: '1.2.36', latestBuild: 51 })
  const result = await api.checkAppUpdate()
  assert.equal(result.status, 'up_to_date')
  assert.equal(result.verifiedRemote, true)
})
test('an OTA at Web build 122 cannot hide an APK upgrade from installed build 116', async () => {
  const { api, replies } = fixture()
  replies.push({ latestVersion: '1.2.122', latestBuild: 122 })
  assert.ok(api.APP_BUILD >= 122)
  assert.equal((await api.checkAppUpdate()).status, 'available')
})
test('a higher version name with lower native build never prompts an Android downgrade', async () => {
  const { api, replies } = fixture({ build: 122, version: '1.2.122' })
  replies.push({ latestVersion: '2.0.0', latestBuild: 121 })
  assert.equal((await api.checkAppUpdate()).status, 'up_to_date')
})
test('a higher native build remains an upgrade even if its display label is lower', async () => {
  const { api, replies } = fixture({ build: 122 })
  replies.push({ latestVersion: '1.0.0', latestBuild: 123, force: true })
  assert.equal((await api.checkAppUpdate()).status, 'forced')
})
test('Web skips native APK checks and does not fetch APK manifests', async () => {
  const { api, fetches, infoCalls } = fixture({ native: false })
  assert.equal((await api.checkAppUpdate()).status, 'error')
  assert.equal(fetches.length, 0)
  assert.equal(infoCalls(), 0)
})
test('unreadable native metadata cannot be replaced by the Web build', async () => {
  const { api, fetches } = fixture({ getInfo: () => Promise.reject(new Error('bridge unavailable')) })
  assert.equal((await api.checkAppUpdate()).status, 'error')
  assert.equal(fetches.length, 0)
})
test('native info is cached after success and can retry a synchronous bridge failure', async () => {
  const { versionApi, infoCalls } = fixture({ getInfo: call => {
    if (call === 1) throw new Error('not ready')
    return Promise.resolve({ id: 'com.sunshinecampus.app', version: '1.2.116', build: '116' })
  } })
  assert.equal(await versionApi.getNativeAppVersion(), null)
  const info = await versionApi.getNativeAppVersion()
  assert.equal(info.build, 116)
  assert.equal((await versionApi.getNativeAppVersion()).build, 116)
  assert.equal(infoCalls(), 2)
})
test('noninteger remote builds are rejected in both remote and bundled manifests', async () => {
  const { api, replies } = fixture()
  replies.push({ latestVersion: '1.2.123', latestBuild: 123.5 }, { latestVersion: '1.2.123', latestBuild: 123.5 }, { latestVersion: '1.2.123', latestBuild: 123.5 })
  assert.equal((await api.checkAppUpdate()).status, 'error')
})
