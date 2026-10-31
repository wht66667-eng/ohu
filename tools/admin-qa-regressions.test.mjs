import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
const ts = createRequire(import.meta.url)('typescript')
const compile = file => ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText
function moderation(failure = '', throws = false) {
  const module = { exports: {} }
  vm.runInNewContext(compile('src/lib/moderation.ts'), { module, exports: module.exports, require: () => ({ queryRows: async table => { if (throws) throw new Error('offline'); return { rows: table === 'secondhand_items' ? [{ id: 1, status: 'off' }] : [], error: failure } } }) })
  return module.exports
}
test('moderation counters distinguish failed reads from a genuinely empty collection', async () => {
  const ok = await moderation().fetchModerationStats()
  assert.equal(ok.goods, 1); assert.equal(ok.offGoods, 1); assert.equal(ok.comments, 0)
  for (const api of [moderation('offline'), moderation('', true)]) {
    const failed = await api.fetchModerationStats()
    assert.equal(failed.goods, null); assert.equal(failed.comments, null); assert.equal(failed.offGoods, null)
  }
})
const jsx = (type, props) => ({ type, props })
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)]
function render(file, name, profile, signed = true, options = {}) {
  const noop = () => {}; const toast = options.toast || Object.assign(noop, { err: noop, ok: noop })
  let stateIndex = 0
  const hooks = { useState: v => [stateIndex++ === 1 && options.rows ? options.rows : typeof v === 'function' ? v() : v, noop], useRef: v => ({ current: v }), useEffect: noop, useCallback: f => f, useMemo: f => f() }
  const module = { exports: {} }
  const imports = { react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-router-dom': { useNavigate: () => noop }, '../lib/auth': { useAuth: () => ({ isSigned: signed, profile, user: signed ? { uid: 'isolated-admin' } : null }) }, '../lib/use-im-session-version': { useImSessionVersion: () => 1 }, '../lib/im-session': { captureImSession: uid => uid ? { owner: uid, revision: 1 } : null, currentImSession: owner => !!owner }, '../context/ToastContext': { useToast: () => toast }, '../lib/hooks': { usePollingRows: () => ({ rows: [], error: null, loading: false, reload: noop }) }, '../lib/moderation': moderation(), '../components/ui/StateViews': { DeniedState: 'denied', EmptyState: 'empty', LoadingState: 'loading', ErrorState: 'error' } }
  Object.assign(imports, options.imports)
  vm.runInNewContext(compile(file), { module, exports: module.exports, require: key => imports[key] || new Proxy({ __esModule: true, default: {} }, { get: (target, name) => name in target ? target[name] : noop }) })
  let tree = module.exports[name]()
  // Account/session wrappers intentionally isolate child state. Execute the actual
  // local child component rather than treating that wrapper as a rendered screen.
  while (typeof tree?.type === 'function') tree = tree.type(tree.props)
  return nodes(tree)
}
for (const action of ['删除原文', '禁言 1 天']) {
  test(`report action ${action} preserves a closure failure instead of reporting complete success`, async () => {
    const messages = [], writes = []
    const toast = Object.assign(message => messages.push(['info', message]), { err: message => messages.push(['error', message]), ok: message => messages.push(['ok', message]) })
    const tree = render('src/pages/AdminReportsPage.tsx', 'AdminReportsPage', { isAdmin: true }, true, { toast, rows: [{ id: 1, target_id: '2', target_type: 'plaza_post', status: 'pending', reason: 'test' }], imports: {
      '../lib/reports': { fetchReports: async () => ({ rows: [], error: null }), resolveReport: async () => { writes.push('close'); return { error: 'offline' } } },
      '../lib/plaza': { deletePlazaPost: async () => { writes.push('delete'); return { error: null } }, fetchPlazaPostById: async () => ({ creator_uid: 'author', creator_name: 'Author' }) },
      '../lib/sanctions': { applySanction: async () => { writes.push('sanction'); return { error: null } } },
    } })
    const button = tree.find(n => n.type === 'button' && n.props.children === action)
    assert.ok(button); button.props.onClick()
    await new Promise(setImmediate)
    assert.deepEqual(writes, [action === '删除原文' ? 'delete' : 'sanction', 'close'])
    assert.equal(messages.length, 1); assert.equal(messages[0][0], 'error'); assert.match(messages[0][1], /已.*但举报结案失败.*offline/)
  })
}

test('report destructive actions ignore duplicate clicks while the first mutation is outstanding', async () => {
  let resume
  const gate = new Promise(resolve => { resume = resolve })
  const writes = []
  const tree = render('src/pages/AdminReportsPage.tsx', 'AdminReportsPage', { isAdmin: true }, true, { rows: [{ id: 1, target_id: '2', target_type: 'plaza_post', status: 'pending', reason: 'test' }], imports: {
    '../lib/reports': { fetchReports: async () => ({ rows: [], error: null }), resolveReport: async () => { writes.push('close'); return { error: null } } },
    '../lib/plaza': { deletePlazaPost: async () => { writes.push('delete'); await gate; return { error: null } } },
  } })
  const button = tree.find(n => n.type === 'button' && n.props.children === '删除原文')
  button.props.onClick(); button.props.onClick()
  assert.deepEqual(writes, ['delete'])
  resume(); await new Promise(setImmediate)
  assert.deepEqual(writes, ['delete', 'close'])
})

test('an account switch after deleting the source cannot close a report under the next session', async () => {
  let current = true, resume
  const gate = new Promise(resolve => { resume = resolve })
  const writes = [], messages = []
  const toast = Object.assign(message => messages.push(message), { err: message => messages.push(message), ok: message => messages.push(message) })
  const tree = render('src/pages/AdminReportsPage.tsx', 'AdminReportsPage', { isAdmin: true }, true, { toast, rows: [{ id: 1, target_id: '2', target_type: 'plaza_post', status: 'pending', reason: 'test' }], imports: {
    '../lib/im-session': { captureImSession: uid => ({ owner: uid, revision: 1 }), currentImSession: () => current },
    '../lib/reports': { fetchReports: async () => ({ rows: [], error: null }), resolveReport: async () => { writes.push('close'); return { error: null } } },
    '../lib/plaza': { deletePlazaPost: async () => { writes.push('delete'); await gate; return { error: null } } },
  } })
  tree.find(n => n.type === 'button' && n.props.children === '删除原文').props.onClick()
  current = false; resume(); await new Promise(setImmediate)
  assert.deepEqual(writes, ['delete']); assert.deepEqual(messages, [])
})

test('failed report mutation releases its lock so the same action can be retried', async () => {
  let attempts = 0
  const writes = [], messages = []
  const toast = Object.assign(message => messages.push(message), { err: message => messages.push(message), ok: message => messages.push(message) })
  const tree = render('src/pages/AdminReportsPage.tsx', 'AdminReportsPage', { isAdmin: true }, true, { toast, rows: [{ id: 1, target_id: '2', target_type: 'plaza_post', status: 'pending', reason: 'test' }], imports: {
    '../lib/reports': { fetchReports: async () => ({ rows: [], error: null }), resolveReport: async () => { writes.push('close'); return { error: null } } },
    '../lib/plaza': { deletePlazaPost: async () => { writes.push('delete'); return { error: ++attempts === 1 ? 'offline' : null } } },
  } })
  const button = tree.find(n => n.type === 'button' && n.props.children === '删除原文')
  button.props.onClick(); await new Promise(setImmediate)
  assert.deepEqual(messages, ['offline']); assert.deepEqual(writes, ['delete'])
  button.props.onClick(); await new Promise(setImmediate)
  assert.deepEqual(writes, ['delete', 'delete', 'close'])
  assert.equal(messages.at(-1), '已删除原文并结案')
})

function accountAccessApi(response) {
  const calls = [], module = { exports: {} }
  vm.runInNewContext(compile('src/lib/admin.ts'), { module, exports: module.exports, require: () => ({ cbRdb: () => ({ rpc: async (name, params) => { calls.push({ name, ...params }); if (response instanceof Error) throw response; return response } }) }) })
  return { api: module.exports, calls }
}
test('account access sends one target-specific atomic RPC and accepts only its complete receipt', async () => {
  const receipt = { ok: true, account: 'test-student', uid: 'student-uid', banned: false }
  for (const data of [receipt, [receipt]]) {
    const { api, calls } = accountAccessApi({ data })
    assert.equal((await api.setAccountAccess('test-student', 'student-uid', false, '解除')).error, null)
    assert.deepEqual(calls.map(x => ({ ...x })), [{ name: 'admin_set_account_access', account: 'test-student', target_uid: 'student-uid', banned: false, reason: '解除' }])
  }
})
test('missing, wrong-target and failed atomic account receipts never report success or issue fallback writes', async () => {
  const receipt = { ok: true, account: 'test-student', uid: 'student-uid', banned: false }
  const responses = [
    { data: null }, { data: [] }, { data: [receipt, receipt] },
    { data: { ...receipt, uid: 'another-uid' } }, { data: { ...receipt, account: 'another-account' } },
    { data: { ...receipt, banned: true } }, { data: { ...receipt, ok: false } },
    { error: { message: 'atomic rollback' } }, new Error('offline'),
  ]
  for (const response of responses) {
    const { api, calls } = accountAccessApi(response)
    assert.ok((await api.setAccountAccess('test-student', 'student-uid', false, '解除')).error)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].name, 'admin_set_account_access')
  }
  const { api, calls } = accountAccessApi({ data: receipt })
  assert.ok((await api.setAccountAccess('', 'student-uid', false, '解除')).error)
  assert.ok((await api.setAccountAccess('test-student', '', false, '解除')).error)
  assert.equal(calls.length, 0)
})
for (const name of ['AdminContentPage', 'AdminNewsPage', 'AdminReportsPage']) {
  test(`${name}: highest administrator has access; students and unsigned profiles remain denied`, () => {
    const file = `src/pages/${name}.tsx`
    assert.equal(render(file, name, { isAdmin: false, isSuperAdmin: true }).some(n => n.type === 'denied'), false)
    assert.equal(render(file, name, { isAdmin: false, isSuperAdmin: false }).some(n => n.type === 'denied'), true)
    assert.equal(render(file, name, { isAdmin: true }, false).some(n => n.type === 'denied'), true)
  })
}
