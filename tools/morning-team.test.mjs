import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import path from 'node:path'
import { isMorningTeam, morningTeamState, nextMorningStart, parseLocalStart, validateMorningDraft } from '../src/lib/morning-team-rules.ts'

test('晨跑分类不把普通运动搭子或同名普通活动混入', () => {
  assert.equal(isMorningTeam({ category: 'teamup', tag: '阳光跑小队' }), true)
  assert.equal(isMorningTeam({ category: 'teamup', tag: '晨跑小队' }), true)
  assert.equal(isMorningTeam({ category: 'teamup', tag: '运动搭子' }), false)
  assert.equal(isMorningTeam({ category: 'activity', tag: '阳光跑小队' }), false)
  assert.equal(isMorningTeam({ tag: '阳光跑小队' }), false)
})

test('严格校验月份、日期和时间，保留闰年有效日期', () => {
  for (const invalid of ['2026-02-29T07:00', '2026-04-31T07:00', '2026-13-01T07:00', '2026-01-00T07:00', '2026-01-01T24:00', '2026-01-01T07:60', '明早七点']) assert.equal(parseLocalStart(invalid), null)
  assert.equal(parseLocalStart('2028-02-29T07:00')?.getDate(), 29)
})

test('早七点默认值跨月和跨年按本地日期滚动', () => {
  assert.equal(nextMorningStart(new Date(2026, 9, 1, 6, 59)), '2026-10-01T07:00')
  assert.equal(nextMorningStart(new Date(2026, 9, 1, 7, 0)), '2026-10-02T07:00')
  assert.equal(nextMorningStart(new Date(2026, 11, 31, 8, 0)), '2027-01-01T07:00')
})

test('发布拒绝过去、下午、浮点和越界名额', () => {
  const now = new Date(2026, 9, 1, 6).getTime()
  const good = { title: '操场晨跑', location: '东门', start: '2026-10-01T07:00', seats: '4', duration: 45 }
  assert.equal(validateMorningDraft(good, now), null)
  for (const patch of [{ start: '2026-10-01T06:00' }, { start: '2026-10-01T12:00' }, { start: '2026-10-02T03:59' }, { title: ' ' }, { location: '' }, { seats: '0' }, { seats: '31' }, { seats: '1.5' }, { seats: 'NaN' }, { duration: 999 }]) assert.ok(validateMorningDraft({ ...good, ...patch }, now))
})

test('报名状态处理满员、出发、结束和取消，不把坏时间当可报名', () => {
  const start = new Date(2026, 9, 1, 7).toISOString()
  const end = new Date(2026, 9, 1, 8).toISOString()
  const team = { category: 'teamup', tag: '阳光跑小队', status: 'open', start_at: start, end_at: end, seats: 4, signup_count: 3 }
  const before = Date.parse(start) - 1000
  assert.equal(morningTeamState(team, before), '可加入')
  assert.equal(morningTeamState({ ...team, signup_count: 4 }, before), '名额已满')
  assert.equal(morningTeamState(team, Date.parse(start)), '已出发')
  assert.equal(morningTeamState(team, Date.parse(end)), '已结束')
  assert.equal(morningTeamState({ ...team, status: 'cancelled' }, before), '已取消')
  assert.equal(morningTeamState({ ...team, start_at: '待定' }, before), '时间待确认')
})

function loadDataModule(responses) {
  const require = createRequire(process.env.SUNSHINE_PROJECT_ROOT ? path.join(process.env.SUNSHINE_PROJECT_ROOT, 'package.json') : new URL('../package.json', import.meta.url))
  const ts = require('typescript')
  const source = readFileSync(new URL('../src/lib/morning-teams.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const calls = []
  const cbRdb = () => ({ from(name) {
    const call = { name, filters: [], columns: null, limit: null }
    calls.push(call)
    const query = {
      select(columns) { call.columns = columns; return query },
      eq(key, value) { call.filters.push([key, value]); return query },
      gt(key, value) { call.filters.push([key, value]); return query },
      in(key, value) { call.filters.push([key, value]); return query },
      order() { return query }, limit(count) { call.limit = count; return query },
      then(resolve, reject) { return Promise.resolve(responses.shift() || { data: [] }).then(resolve, reject) },
    }
    return query
  } })
  const module = { exports: {} }
  vm.runInNewContext(code, { exports: module.exports, module, require(path) {
    if (path === './cb') return { cbRdb }
    if (path === './morning-team-rules') return { isMorningTeam, MORNING_TEAM_CATEGORY: 'teamup', MORNING_TEAM_TAGS: ['阳光跑小队', '晨跑小队'] }
    throw new Error(`Unexpected dependency ${path}`)
  }, Promise, Map, Set, Number, String, Array, Date })
  return { fetch: module.exports.fetchMorningTeams, calls }
}

test('游客请求服务器按阳光跑及旧标签筛选，且不请求私人报名名单', async () => {
  const data = loadDataModule([{ data: [{ id: 1, category: 'teamup', tag: '阳光跑小队', start_at: '2026-10-02', signup_count: 2 }, { id: 2, category: 'teamup', tag: '运动搭子' }] }])
  const result = await data.fetch()
  assert.equal(result.error, null)
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].viewerUid, '')
  assert.equal(result.rows[0].signupCountKnown, true)
  assert.equal(data.calls.length, 1)
  assert.deepEqual(data.calls[0].filters.slice(0, 3), [['category', 'teamup'], ['tag', ['阳光跑小队', '晨跑小队']], ['status', 'open']])
  assert.equal(data.calls[0].filters[3][0], 'start_at')
  assert.ok(Number.isFinite(Date.parse(data.calls[0].filters[3][1])))
})

test('报名查询失败必须显示错误，不能伪装成用户尚未加入', async () => {
  const data = loadDataModule([{ data: [] }, { data: [] }, { error: { message: 'permission denied' } }])
  const result = await data.fetch('uid-a')
  assert.equal(result.error, 'permission denied')
  assert.equal(result.rows.length, 0)
})

test('真实已取消报名保留在我的小队，公开人数优先，缺失人数不伪造为零', async () => {
  const common = { category: 'teamup', tag: '阳光跑小队', status: 'open', start_at: '2026-10-02T07:00:00Z', end_at: '2026-10-02T08:00:00Z' }
  const data = loadDataModule([
    { data: [{ ...common, id: 1, signup_count: 3 }] },
    { data: [{ ...common, id: 1, creator_uid: 'uid-a' }] },
    { data: [{ activity_id: 2 }] },
    { data: [{ ...common, id: 2, status: 'cancelled' }] },
  ])
  const result = await data.fetch('uid-a')
  assert.equal(result.error, null)
  assert.equal(result.rows.find((row) => row.id === 1).owned, true)
  assert.equal(result.rows.find((row) => row.id === 1).signup_count, 3)
  const joined = result.rows.find((row) => row.id === 2)
  assert.equal(joined.joined, true)
  assert.equal(joined.status, 'cancelled')
  assert.equal(joined.signupCountKnown, false)
  assert.equal(joined.viewerUid, 'uid-a')
})
