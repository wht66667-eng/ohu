import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const ts = createRequire(import.meta.url)('typescript')
const source = fs.readFileSync(new URL('../src/lib/academic-terms.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const module = { exports: {} }
vm.runInNewContext(code, { module, exports: module.exports })
const terms = module.exports
const grade = (year, term, name) => ({ year, term, name })

test('academic term follows the teaching year across January and February', () => {
  assert.equal(terms.academicTermForDate(new Date('2026-10-26T12:00:00')), '2026-2027-1')
  assert.equal(terms.academicTermForDate(new Date('2027-01-31T12:00:00')), '2026-2027-1')
  assert.equal(terms.academicTermForDate(new Date('2027-02-01T12:00:00')), '2026-2027-2')
})

test('current term is selected without leaking historical or unlabelled results', () => {
  const rows = [grade('2025-2026', '2', '旧课'), grade('2026-2027', '1', '本学期'), grade('2026', '第1学期', '另一门'), grade('', '', '未标记')]
  assert.deepEqual(terms.gradesForScope(rows, 'current', '2026-2027-1').map((row) => row.name), ['本学期', '另一门'])
  assert.deepEqual(terms.gradesForScope(rows, '2025-2026-2', '2026-2027-1').map((row) => row.name), ['旧课'])
  assert.equal(terms.gradesForScope(rows, 'all', '2026-2027-1').length, 4)
  assert.deepEqual(Array.from(terms.availableGradeTerms(rows, '2026-2027-1')), ['2025-2026-2'])
})

test('an unpublished current term stays empty while older terms remain selectable', () => {
  const rows = [grade('2025-2026', '2', '历史成绩')]
  assert.equal(terms.gradesForScope(rows, 'current', '2026-2027-1').length, 0)
  assert.deepEqual(Array.from(terms.availableGradeTerms(rows, '2026-2027-1')), ['2025-2026-2'])
  assert.equal(terms.gradeTermKey(grade('unknown', '1', '未知')), null)
})
