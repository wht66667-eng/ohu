/**
 * 教练任务契约 1.1.0 纯函数回归（M4）：解析、字段/成环/日期/时长校验、四视图、示例与日期工具。
 * 被测模块为零副作用 .ts，Node 24 按类型擦除加载。运行：`node --test tools/coach-contract.test.mjs`。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  CONTRACT_SCHEMA,
  CONTRACT_VERSION,
  isValidDateKey,
  extractJsonObject,
  findDependencyCycle,
  validateContract,
  parseContractText,
} from '../src/services/coach/contract.ts'
import { todayView, planView, relationsView, reviewView } from '../src/services/coach/views.ts'
import { addDays, buildSampleContract } from '../src/services/coach/sample.ts'

const TODAY = '2026-11-13'

function task(over = {}) {
  return { id: 'a', title: 'A', date: TODAY, minutes: 30, dependsOn: [], category: '学习', done: false, note: '', ...over }
}
function contract(over = {}) {
  return { schema: CONTRACT_SCHEMA, version: CONTRACT_VERSION, title: '测试计划', horizon: { start: TODAY, end: addDays(TODAY, 6) }, tasks: [task()], ...over }
}

test('isValidDateKey 拒绝非法日历日期与非字符串', () => {
  assert.equal(isValidDateKey('2026-11-13'), true)
  assert.equal(isValidDateKey('2026-02-30'), false)
  assert.equal(isValidDateKey('2026-13-01'), false)
  assert.equal(isValidDateKey('2026-1-1'), false)
  assert.equal(isValidDateKey(null), false)
  assert.equal(isValidDateKey(20261113), false)
})

test('extractJsonObject 容忍围栏与前后废话，无对象返回 null', () => {
  const obj = extractJsonObject('好的，这是计划：\n```json\n{"schema":"ohu.task-contract"}\n```\n希望有用')
  assert.deepEqual(obj, { schema: 'ohu.task-contract' })
  assert.equal(extractJsonObject('没有任何对象'), null)
  assert.equal(extractJsonObject(''), null)
})

test('addDays 跨月跨年正确', () => {
  assert.equal(addDays('2026-11-13', 6), '2026-11-19')
  assert.equal(addDays('2026-11-30', 1), '2026-12-01')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
})

test('示例契约结构合法且通过校验', () => {
  const sample = buildSampleContract(TODAY)
  const result = validateContract(sample)
  assert.equal(result.ok, true)
  assert.equal(sample.tasks.length, 8)
  assert.equal(sample.horizon.start, TODAY)
  assert.equal(sample.schema, CONTRACT_SCHEMA)
  assert.equal(sample.version, CONTRACT_VERSION)
})

test('缺字段归为 schema 异常并列出问题', () => {
  const result = validateContract({ schema: CONTRACT_SCHEMA, version: CONTRACT_VERSION })
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'schema')
  const codes = result.issues.map(i => i.code)
  assert.ok(codes.includes('title'))
  assert.ok(codes.includes('horizon_start'))
  assert.ok(codes.includes('tasks'))
})

test('schema/version 不符归为 schema 异常', () => {
  const result = validateContract(contract({ version: '9.9.9' }))
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'schema')
  assert.ok(result.issues.some(i => i.code === 'version'))
})

test('无法解析的文本归为 parse 异常', () => {
  const result = parseContractText('这不是 JSON')
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'parse')
})

test('依赖成环归为 validation 异常', () => {
  const cyclic = contract({ tasks: [task({ id: 'a', dependsOn: ['b'] }), task({ id: 'b', title: 'B', dependsOn: ['a'] })] })
  const result = validateContract(cyclic)
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'validation')
  assert.ok(result.issues.some(i => i.code === 'dependency_cycle'))
  const cycle = findDependencyCycle(cyclic.tasks)
  assert.ok(Array.isArray(cycle) && cycle.length >= 2)
})

test('无环契约 findDependencyCycle 返回 null', () => {
  assert.equal(findDependencyCycle(buildSampleContract(TODAY).tasks), null)
})

test('日期越界归为 validation 异常', () => {
  const result = validateContract(contract({ tasks: [task({ date: addDays(TODAY, 30) })] }))
  assert.equal(result.ok, false)
  assert.equal(result.kind, 'validation')
  assert.ok(result.issues.some(i => i.code === 'date_out_of_horizon'))
})

test('单任务时长越界与非整数归为 validation 异常', () => {
  for (const minutes of [0, 481, 1.5, -5]) {
    const result = validateContract(contract({ tasks: [task({ minutes })] }))
    assert.equal(result.ok, false)
    assert.equal(result.kind, 'validation')
    assert.ok(result.issues.some(i => i.code === 'task_minutes'), `minutes=${minutes}`)
  }
  assert.equal(validateContract(contract({ tasks: [task({ minutes: 480 })] })).ok, true)
  assert.equal(validateContract(contract({ tasks: [task({ minutes: 1 })] })).ok, true)
})

test('未知依赖、自依赖、重复 id 均被标记', () => {
  const unknown = validateContract(contract({ tasks: [task({ dependsOn: ['ghost'] })] }))
  assert.ok(unknown.issues.some(i => i.code === 'unknown_dependency'))
  const self = validateContract(contract({ tasks: [task({ dependsOn: ['a'] })] }))
  assert.ok(self.issues.some(i => i.code === 'self_dependency'))
  const dup = validateContract(contract({ tasks: [task(), task({ title: 'B' })] }))
  assert.ok(dup.issues.some(i => i.code === 'duplicate_id'))
})

test('今日视图区分可开始与受阻', () => {
  const c = contract({ tasks: [task({ id: 'p', title: '前置' }), task({ id: 'c', title: '后续', minutes: 40, dependsOn: ['p'] })] })
  const view = todayView(c, TODAY)
  assert.equal(view.tasks.length, 2)
  assert.equal(view.readyCount, 1)
  assert.equal(view.blockedCount, 1)
  assert.equal(view.totalMinutes, 70)
  const blocked = view.tasks.find(t => t.task.id === 'c')
  assert.equal(blocked.ready, false)
  assert.deepEqual(blocked.blockedBy, ['前置'])
})

test('今日视图前置完成后解除受阻', () => {
  const c = contract({ tasks: [task({ id: 'p', title: '前置', done: true }), task({ id: 'c', title: '后续', dependsOn: ['p'] })] })
  const view = todayView(c, TODAY)
  assert.equal(view.blockedCount, 0)
  assert.equal(view.doneCount, 1)
})

test('计划视图按日期分组并汇总时长', () => {
  const view = planView(buildSampleContract(TODAY))
  assert.equal(view.taskCount, 8)
  assert.equal(view.totalMinutes, 375)
  assert.equal(view.days.length, 6)
  assert.equal(view.days[0].date, TODAY)
  assert.equal(view.days[0].tasks.length, 2)
  assert.equal(view.days[0].totalMinutes, 75)
})

test('关系视图给出拓扑顺序与依赖边数', () => {
  const view = relationsView(buildSampleContract(TODAY))
  assert.equal(view.hasCycle, false)
  assert.equal(view.edgeCount, 7)
  assert.equal(view.order.length, 8)
  assert.ok(view.order.indexOf('t1') < view.order.indexOf('t3'))
  assert.ok(view.order.indexOf('t6') < view.order.indexOf('t7'))
  assert.ok(view.order.indexOf('t7') < view.order.indexOf('t8'))
})

test('关系视图成环时不给顺序', () => {
  const c = contract({ tasks: [task({ id: 'a', dependsOn: ['b'] }), task({ id: 'b', title: 'B', dependsOn: ['a'] })] })
  const view = relationsView(c)
  assert.equal(view.hasCycle, true)
  assert.deepEqual(view.order, [])
})

test('复盘视图统计完成率、时长与分类', () => {
  const view = reviewView(buildSampleContract(TODAY))
  assert.equal(view.total, 8)
  assert.equal(view.done, 1)
  assert.equal(view.rate, 1 / 8)
  assert.equal(view.minutesTotal, 375)
  assert.equal(view.minutesDone, 45)
  assert.equal(view.unfinished.length, 7)
  const course = view.byCategory.find(c => c.category === '课程')
  assert.deepEqual(course, { category: '课程', total: 3, done: 1 })
})

test('parseContractText 端到端：围栏文本→合法契约', () => {
  const sample = buildSampleContract(TODAY)
  const result = parseContractText('前言\n```json\n' + JSON.stringify(sample) + '\n```\n后语')
  assert.equal(result.ok, true)
  assert.equal(result.contract.tasks.length, 8)
})