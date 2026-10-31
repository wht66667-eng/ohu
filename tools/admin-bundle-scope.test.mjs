import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { trimShellPublicAssets } from './build-multiplatform.mjs'

const require = createRequire(new URL('../package.json', import.meta.url)), ts = require('typescript')
const source = ts.transpileModule(fs.readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
const module = { exports: {} }
vm.runInNewContext(source, { module, exports: module.exports, process, require: (name) => name === 'vite' ? { defineConfig: (config) => config } : name === '@vitejs/plugin-react' ? { __esModule: true, default: () => ({}) } : require(name) })
const entry = module.exports.managementEntry

test('management build replaces the HTML input while normal H5/student entry stays shared', () => {
  const html = '<script type="module" src="/src/main.tsx"></script>'
  assert.match(entry('admin').transformIndexHtml.handler(html), /main-admin\.tsx/)
  assert.equal(entry('user').transformIndexHtml.handler(html), html)
})
test('management build rejects student routes and personal reminder runtime before distributing assets', () => {
  for (const path of ['src/App.tsx', 'src/components/PhoneShell.tsx', 'src/components/PublishSheet.tsx', 'src/components/CourseReminderSettings.tsx', 'src/components/RemindHost.tsx', 'src/pages/schedule/ScheduleHome.tsx', 'src/pages/moments/MomentsPage.tsx', 'src/lib/class-remind.ts', 'src/lib/notify-setup.ts']) {
    assert.throws(() => entry('admin').generateBundle.call({ getModuleIds: () => [`C:/project/${path}`], error: (text) => { throw Error(text) } }), /包含学生专用模块/, path)
  }
  entry('admin').generateBundle.call({ getModuleIds: () => ['C:/project/src/pages/AdminContentPage.tsx', 'C:/project/src/pages/AdminSettingsPage.tsx'], error: () => { throw Error('management page rejected') } })
  entry('user').generateBundle.call({ getModuleIds: () => ['C:/project/src/pages/schedule/ScheduleHome.tsx'], error: () => { throw Error('student rejected') } })
})
test('management output excludes student downloads and cosmetic packs without touching source or shared assets', () => {
  const root = fs.mkdtempSync(join(tmpdir(), 'ohhu-admin-bundle-'))
  try {
    const output = join(root, 'dist-app')
    for (const folder of ['download', 'launcher-icon-previews', 'theme-packs', 'pixel-fox', 'boot', 'assets']) { fs.mkdirSync(join(output, folder), { recursive: true }); fs.writeFileSync(join(output, folder, 'fixture'), 'fixture') }
    fs.writeFileSync(join(output, 'last-snapshot.json'), '{}')
    fs.mkdirSync(join(root, 'public/download'), { recursive: true }); fs.writeFileSync(join(root, 'public/download/source'), 'preserve')
    trimShellPublicAssets(root, output, 'user')
    assert.equal(fs.existsSync(join(output, 'download/fixture')), true)
    trimShellPublicAssets(root, output, 'admin')
    for (const folder of ['download', 'launcher-icon-previews', 'theme-packs', 'last-snapshot.json']) assert.equal(fs.existsSync(join(output, folder)), false)
    for (const folder of ['pixel-fox', 'boot', 'assets']) assert.equal(fs.existsSync(join(output, folder, 'fixture')), true)
    assert.equal(fs.readFileSync(join(root, 'public/download/source'), 'utf8'), 'preserve')
    assert.throws(() => trimShellPublicAssets(root, root, 'admin'), /Unsafe/)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
