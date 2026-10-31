/** Actual moments data APIs against isolated synthetic tables; never contact CloudBase. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const load = (file, dependencies = {}) => {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, Date, require: name => { if (Object.hasOwn(dependencies, name)) return dependencies[name]; throw Error(`Unexpected ${name}`) } })
  return module.exports
}
const plain = value => JSON.parse(JSON.stringify(value))
const post = (id = 1, uid = 'A') => ({ id, creator_uid: uid, body: '隔离测试近况', created_at: '2030-01-01T00:00:00Z' })
function fixture() {
  let uid = 'A'
  const owner = load('src/lib/async-owner.ts'), session = load('src/lib/im-session.ts', { './async-owner': owner })
  session.selectImSession(uid)
  const rows = { moments: [post()], moments_likes: [], moments_comments: [] }, calls = [], flags = { error: null, before: null, emptyWrite: false }
  const rdb = { from(table) {
    const query = { table, mode: 'select', filters: [], value: null }
    const b = {
      select() { return b }, eq(key, value) { query.filters.push([key, value]); return b }, in(key, values) { query.filters.push([key, values]); return b }, order() { return b }, limit() { return b },
      insert(value) { query.mode = 'insert'; query.value = value; return b }, delete() { query.mode = 'delete'; return b },
      then(resolve, reject) { return (async () => {
        const call = { ...query, filters: [...query.filters] }; calls.push(call)
        if (flags.before) await flags.before(call)
        if (flags.error) return { data: null, error: flags.error }
        const matches = row => call.filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value)
        if (call.mode === 'select') return { data: rows[table].filter(matches).map(row => ({ ...row })), error: null }
        if (call.mode === 'delete') { const data = rows[table].filter(matches); rows[table] = rows[table].filter(row => !matches(row)); return { data: flags.emptyWrite ? [] : data, error: null } }
        const data = { id: rows[table].length + 20, ...call.value }; rows[table].push(data)
        return { data: flags.emptyWrite ? [] : [data], error: null }
      })().then(resolve, reject) },
    }; return b
  } }
  const api = load('src/lib/moments.ts', { './cb': { cbRdb: () => rdb }, './social-actor': { currentActor: () => uid ? { uid, name: '测试本人', avatar: '' } : null }, './im-session': session, './async-owner': owner, './market': { fmtTime: value => value } })
  return { api, rows, calls, flags, switch(next) { uid = next; session.selectImSession(next) } }
}
test('guest does not access private feed, comments or writes', async () => {
  const f = fixture(); f.switch('')
  for (const result of await Promise.all([f.api.fetchMoments(), f.api.fetchMomentComments(1), f.api.fetchMomentLikes(1), f.api.createMoment('测试'), f.api.likeMoment(1), f.api.deleteMoment(1), f.api.commentMoment(1, '测试')])) assert.match(result.error, /登录/)
  assert.equal(f.calls.length, 0)
})
test('post creation validates text, images and visibility before write and confirms returned id', async () => {
  const f = fixture()
  assert.match((await f.api.createMoment(' ')).error, /不能为空/)
  assert.match((await f.api.createMoment('测试', ['javascript:alert(1)'])).error, /有效图片/)
  assert.match((await f.api.createMoment('测试', [], 'image', 'invalid')).error, /可见范围/)
  assert.equal(f.calls.length, 0)
  assert.equal((await f.api.createMoment(' 测试近况 ', ['https://fixture.invalid/photo.jpg'], 'image', 'private')).id, 21)
  assert.equal(f.calls[0].value.creator_uid, 'A'); assert.equal(f.calls[0].value.visibility, 'private'); assert.equal(f.calls[0].value.body, '测试近况')
  f.flags.emptyWrite = true
  assert.match((await f.api.createMoment('测试')).error, /未确认/)
})
test('reading errors remain errors; like-status failure alone does not hide readable moments', async () => {
  const f = fixture(); f.flags.error = { message: '合成权限错误' }
  assert.match((await f.api.fetchMoments()).error, /权限错误/)
  f.flags.error = null; f.flags.before = call => { if (call.table === 'moments_likes') throw Error('isolated likes read failure') }
  assert.equal((await f.api.fetchMoments()).rows.length, 1)
})
test('late A response is rejected after account switches A → B → A', async () => {
  const f = fixture(); let release; const gate = new Promise(resolve => { release = resolve })
  f.flags.before = () => gate
  const pending = f.api.fetchMoments(); f.switch('B'); f.switch('A'); release()
  assert.match((await pending).error, /账号已变化/)
})
test('the mounted moments subtree gets a new key when A → B → A completes before the next React render', () => {
  const owner = load('src/lib/async-owner.ts'), session = load('src/lib/im-session.ts', { './async-owner': owner })
  session.selectImSession('A')
  let notify = 0, unsubscribe
  const dependencies = {
    react: { useSyncExternalStore(subscribe, snapshot) { unsubscribe ??= subscribe(() => { notify++ }); return snapshot() } },
    'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'react-router-dom': {}, '../../lib/auth': { useAuth: () => ({ isSigned: true, user: { uid: 'A' } }) },
    '../../lib/im-session': session, '../../lib/async-owner': owner, '../../lib/moments': {},
    './MomentCard': {}, './MomentComposer': {}, './MomentDetails': {}, './MomentsPage.module.css': { default: {} },
  }
  const page = load('src/pages/moments/MomentsPage.tsx', dependencies)
  try {
    const first = page.MomentsPage(), unchanged = page.MomentsPage()
    assert.equal(first.key, unchanged.key)
    session.selectImSession('B'); session.selectImSession('A')
    assert.equal(notify, 2)
    const remounted = page.MomentsPage()
    assert.equal(first.props.uid, remounted.props.uid)
    assert.notEqual(first.key, remounted.key, 'the parent key resets every feed, composer, details and card state')
  } finally { unsubscribe?.() }
})
test('like is idempotent in repeated calls; unlike and delete include current owner filters', async () => {
  const f = fixture(); assert.equal((await f.api.likeMoment(1)).error, null); assert.equal((await f.api.likeMoment(1)).error, null)
  assert.equal(f.rows.moments_likes.length, 1)
  f.rows.moments_likes.push({ id: 99, moment_id: 1, liker_uid: 'B' })
  await f.api.unlikeMoment(1); assert.equal(f.rows.moments_likes.length, 1); assert.equal(f.rows.moments_likes[0].liker_uid, 'B')
  assert.equal((await f.api.deleteMoment(1)).error, null)
  assert.deepEqual(plain(f.calls.at(-1).filters), [['id', 1], ['creator_uid', 'A']])
  assert.match((await f.api.deleteMoment(1)).error, /不存在或已删除/)
})
test('comments confirm actual write and return user-visible permission errors', async () => {
  const f = fixture(); assert.equal((await f.api.commentMoment(1, ' 合成评论 ')).error, null)
  assert.equal(f.rows.moments_comments[0].commenter_uid, 'A'); assert.equal(f.rows.moments_comments[0].body, '合成评论')
  assert.equal((await f.api.fetchMomentComments(1)).rows.length, 1)
  f.flags.emptyWrite = true; assert.match((await f.api.commentMoment(1, '测试')).error, /未确认/)
  f.flags.error = { message: 'parent is not visible' }; assert.match((await f.api.commentMoment(1, '测试')).error, /not visible/)
})
test('invalid moment IDs never issue read or destructive queries', async () => {
  const f = fixture()
  for (const method of ['fetchMoment', 'fetchMomentComments', 'fetchMomentLikes', 'likeMoment', 'unlikeMoment', 'deleteMoment']) assert.match((await f.api[method](NaN)).error, /不存在/)
  assert.equal(f.calls.length, 0)
})
test('visibility policy keeps private owner-only, accepts either confirmed edge, blocks pending/deleted relations and protects child rows', () => {
  const sql = fs.readFileSync(new URL('../docs/sql/moments-visibility-130.sql', import.meta.url), 'utf8')
  assert.match(sql, /f\.user_uid = auth\.uid\(\).*f\.friend_uid = moments\.creator_uid/s)
  assert.match(sql, /f\.friend_uid = auth\.uid\(\).*f\.user_uid = moments\.creator_uid/s)
  assert.match(sql, /r\.status = 'accepted'/)
  assert.equal((sql.match(/EXISTS \(SELECT 1 FROM public\.moments m WHERE m\.id = moments_/g) || []).length, 4)
  assert.doesNotMatch(sql, /SECURITY DEFINER|DELETE FROM|UPDATE public|INSERT INTO|TRUNCATE|GRANT /i)
  const visible = (viewer, creator, visibility, edge, status) => !!viewer && (viewer === creator || visibility === 'public' || visibility === 'friends_only' && !!edge && status === 'accepted')
  assert.equal(visible('A', 'A', 'private', false, ''), true)
  assert.equal(visible('B', 'A', 'private', true, 'accepted'), false)
  for (const edge of ['A→B', 'B→A']) assert.equal(visible('B', 'A', 'friends_only', edge, 'accepted'), true)
  assert.equal(visible('B', 'A', 'friends_only', 'A→B', 'pending'), false)
  assert.equal(visible('B', 'A', 'friends_only', false, 'accepted'), false)
  assert.equal(visible('', 'A', 'public', false, ''), false)
})
