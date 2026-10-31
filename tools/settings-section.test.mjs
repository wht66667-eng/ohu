import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(`${root}/package.json`)('typescript')
const module = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync(`${root}/src/lib/settings-section.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports })
const { resolveSettingsSection: resolve } = module.exports
const student = { studentRemind: true, showAdminBlock: false }
test('a student cannot reveal administrator settings using a direct URL', () => {
  assert.equal(resolve('admin', student), 'overview')
  assert.equal(resolve('reminders', student), 'reminders')
  assert.equal(resolve('account', student), 'account')
})
test('work shells do not expose student class-reminder sections', () => {
  const work = { studentRemind: false, showAdminBlock: false }
  assert.equal(resolve('reminders', work), 'overview')
  assert.equal(resolve('account', work), 'account')
})
test('administrator sections close as soon as current access is removed', () => {
  assert.equal(resolve('admin', { ...student, showAdminBlock: true }), 'admin')
  assert.equal(resolve('admin', student), 'overview')
})
test('unknown URL sections fall back to a usable overview', () => {
  for (const value of [null, '', 'constructor', '__proto__', 'privacy', 'admin/content']) assert.equal(resolve(value, student), 'overview')
})
