import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')
function moduleFor(packageId, injected) {
  const source = fs.readFileSync(join(root, 'src/lib/app-shell.ts'), 'utf8').replaceAll('import.meta.env.VITE_APP_SHELL', 'undefined')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }, window = { __SC_SHELL__: injected }
  vm.runInNewContext(compiled, { module, exports: module.exports, window, require: (name) => {
    if (name === '@capacitor/core') return { Capacitor: { isPluginAvailable: () => true } }
    if (name === './platform') return { IS_NATIVE: true }
    if (name === '@capacitor/app') return { App: { getInfo: async () => ({ id: packageId }) } }
    throw Error('Unexpected dependency')
  } })
  return { api: module.exports, window }
}
for (const [shell, suffix] of [['user', 'app'], ['admin', 'admin']]) {
  test(`native package calibrates ${shell} before rendering even with stale student injection`, async () => {
    const { api, window } = moduleFor(`com.sunshinecampus.${suffix}`, 'user')
    assert.equal(api.getAppShell(), 'user')
    assert.equal(await api.initAppShell(), shell)
    assert.equal(api.getAppShell(), shell)
    assert.equal(window.__SC_SHELL__, shell)
    assert.equal(api.SHELL_APP_ID[shell], `com.sunshinecampus.${suffix}`)
  })
}
