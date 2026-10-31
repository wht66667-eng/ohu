import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const ts = createRequire(import.meta.url)('typescript')
const source = ts.transpileModule(fs.readFileSync(new URL('../src/lib/schedule-group.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const module = { exports: {} }
vm.runInNewContext(source, { module, exports: module.exports, require: () => ({}) })
const { commonFreeSlots } = module.exports
const periods = Array.from({ length: 11 }, (_, index) => [`${String(8 + index).padStart(2, '0')}:00`, `${String(8 + index).padStart(2, '0')}:45`])

test('common free time requires at least two schedules', () => {
  assert.equal(commonFreeSlots([], 1, periods).length, 0)
  assert.equal(commonFreeSlots([{ rows: [] }], 1, periods).length, 0)
})

test('busy sections from every selected person split merged free ranges', () => {
  const schedules = [
    { rows: [{ week: 2, day: 1, sections: [1, 2], name: 'A', room: '', teacher: '' }] },
    { rows: [{ week: 2, day: 1, sections: [5, 6], name: 'B', room: '', teacher: '' }] },
  ]
  const monday = commonFreeSlots(schedules, 2, periods).filter(slot => slot.day === 1)
  assert.equal(JSON.stringify(monday.map(slot => [slot.startSection, slot.endSection])), JSON.stringify([[3, 4], [7, 11]]))
  assert.equal(monday[0].sectionLabel, '第 3–4 节')
  assert.equal(monday[0].timeLabel, '10:00–11:45')
})

test('courses in another week do not make the selected week busy', () => {
  const schedules = [
    { rows: [{ week: 3, day: 2, sections: [1], name: 'A', room: '', teacher: '' }] },
    { rows: [{ week: 4, day: 2, sections: [1], name: 'B', room: '', teacher: '' }] },
  ]
  const tuesday = commonFreeSlots(schedules, 3, periods).find(slot => slot.day === 2)
  assert.equal(`${tuesday.startSection}-${tuesday.endSection}`, '2-11')
})
