import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')
function flow() {
  const values = new Map()
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(join(root, 'src/lib/first-run.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, require: () => ({ getAppShell: () => 'user' }), localStorage: { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) } })
  return module.exports
}
test('only a fresh student installation receives the three-page introduction', () => {
  const run = flow()
  assert.equal(run.needsStudentGuide('user'), true)
  for (const shell of ['admin']) assert.equal(run.needsStudentGuide(shell), false)
})
test('skipping the product introduction does not accept legal terms or permissions', () => {
  const run = flow()
  run.markStudentGuideFinished()
  assert.equal(run.needsStudentGuide(), false)
  assert.equal(run.hasAcceptedLegal(), false)
  assert.equal(run.hasFinishedPerms(), false)
  assert.equal(run.isFirstRunComplete(), false)
})
test('existing consent survives the redesign without a forced product tour', () => {
  const run = flow()
  run.markLegalAccepted(); run.markPermsFinished()
  assert.equal(run.needsStudentGuide(), false)
  assert.equal(run.isFirstRunComplete(), true)
})
