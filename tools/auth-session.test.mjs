import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')
const module = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync(join(root, 'src/lib/auth-session.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports })
const { SessionReadGuard } = module.exports
test('late administrator read cannot overwrite a newer ordinary account', () => {
  const guard = new SessionReadGuard()
  const old = guard.begin(); guard.select(old, 'admin-account')
  const next = guard.begin(); guard.select(next, 'ordinary-account')
  assert.equal(guard.accepts(old, 'admin-account'), false)
  assert.equal(guard.select(old, 'admin-account'), false)
  assert.equal(guard.accepts(next, 'ordinary-account'), true)
})
test('logout invalidates even a pending read of the same UID', () => {
  const guard = new SessionReadGuard()
  const ticket = guard.begin(); guard.select(ticket, 'account')
  guard.reset()
  assert.equal(guard.accepts(ticket, 'account'), false)
  assert.equal(guard.uid, '')
})
test('newer refresh wins when responses return out of order for one UID', () => {
  const guard = new SessionReadGuard()
  const first = guard.begin(); guard.select(first, 'same-account')
  const second = guard.begin(); guard.select(second, 'same-account')
  assert.equal(guard.accepts(first, 'same-account'), false)
  assert.equal(guard.accepts(second, 'same-account'), true)
})
