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
const storage = new Map();
vm.runInNewContext(source, { module, exports: module.exports, require: () => ({}), localStorage: {
  getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
} })
const { commonFreeSlots, commonFreeSlotsForDate, encodeScheduleShare, decodeScheduleShare,
  importLocalScheduleShare, readLocalScheduleShares, renameLocalScheduleShare, removeLocalScheduleShare,
} = module.exports
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

const sourceRows = [{ week: 1, day: 1, sections: [1, 2], name: '课程私密名', room: '私密教室', teacher: '私密教师', token: '账号私密值' }]
const snapshot = (patch = {}) => ({ defaultName: '同学的课表', visibility: 'busy', termStart: '2026-09-07', rows: sourceRows, ...patch })

test('busy export excludes names, teachers, rooms and unexpected fields while full exports only named course fields', () => {
  const busy = encodeScheduleShare(snapshot())
  for (const value of ['课程私密名', '私密教室', '私密教师', '账号私密值']) assert.equal(busy.includes(value), false)
  assert.equal(decodeScheduleShare(busy).rows[0].name, '课程')
  const full = encodeScheduleShare(snapshot({ visibility: 'full' }))
  assert.equal(full.includes('课程私密名'), true)
  assert.equal(full.includes('私密教室'), true)
  assert.equal(full.includes('私密教师'), true)
  assert.equal(full.includes('账号私密值'), false)
})

test('local import uses the selected account, prevents duplicates and preserves a local rename', () => {
  const text = encodeScheduleShare(snapshot())
  const first = importLocalScheduleShare('student-A', text).active
  assert.equal(readLocalScheduleShares('student-B').length, 0)
  assert.equal(readLocalScheduleShares('').length, 0)
  renameLocalScheduleShare('student-A', first.id, '我给同桌的备注')
  const again = importLocalScheduleShare('student-A', text)
  assert.equal(again.duplicate, true)
  assert.equal(again.active.localName, '我给同桌的备注')
  assert.equal(again.items.length, 1)
  removeLocalScheduleShare('student-A', first.id)
  assert.equal(readLocalScheduleShares('student-A').length, 0)
})

test('malformed, oversized, invalid-date and invalid-section text is not imported', () => {
  assert.throws(() => importLocalScheduleShare('guest', 'ABC123'), /完整课表文本/)
  assert.throws(() => importLocalScheduleShare('guest', ' '.repeat(256001)), /太长/)
  const good = JSON.parse(encodeScheduleShare(snapshot()))
  assert.throws(() => decodeScheduleShare(JSON.stringify({ ...good, termStart: '2026-02-30' })), /有效的学期起始日期/)
  good.rows[0].sections = [0, 15]
  assert.throws(() => decodeScheduleShare(JSON.stringify(good)), /无效周次、星期或节次/)
  assert.equal(readLocalScheduleShares('guest').length, 0)
})

test('imported text participates in actual-date free slots across different term start dates', () => {
  const text = encodeScheduleShare(snapshot({ termStart: '2026-09-14' }))
  const { active } = importLocalScheduleShare('student-C', text)
  const slots = commonFreeSlotsForDate({ date: '2026-09-14', ownRows: [{ ...sourceRows[0], week: 2, sections: [4] }],
    ownTermStart: '2026-09-07', otherSchedules: [active], periods })
  assert.equal(JSON.stringify(slots.map(slot => [slot.startSection, slot.endSection])), '[[3,3],[5,11]]')
})
test('out-of-coverage dates do not appear as a full day of availability', () => {
  const other = decodeScheduleShare(encodeScheduleShare(snapshot()))
  assert.throws(() => commonFreeSlotsForDate({ date: '2026-09-14', ownRows: [],
    ownTermStart: '2026-09-07', otherSchedules: [other], periods }), /已知周次/)
})
