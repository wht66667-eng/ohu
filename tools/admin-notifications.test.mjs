import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const compile = (path) => ts.transpileModule(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function load(path, dependencies, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(compile(path), { module, exports: module.exports, require: (name) => { if (Object.hasOwn(dependencies, name)) return dependencies[name]; throw Error(`Unexpected ${name}`) }, ...globals })
  return module.exports
}
const scope = load('src/lib/notification-scope.ts', {})
test('administrator notices exclude personal courses, tasks, points and historical commerce kinds', () => {
  const rows = ['todo_due', 'cat_point', 'cat_exchange', 'role_review', 'order_new', 'role_apply_admin', 'report_new'].map((kind, id) => ({ id, kind }))
  assert.deepEqual(Array.from(scope.filterNotesForShell(rows, 'admin'), (row) => row.kind), ['report_new'])
  assert.deepEqual(Array.from(scope.filterNotesForShell(rows, 'user'), (row) => row.kind), ['todo_due', 'cat_point', 'cat_exchange', 'role_review'])
  for (const path of ['/admin/reports?id=3', '/admin/content', '/admin/members']) assert.equal(scope.adminNotificationPath(path), path)
  for (const path of ['/schedule', '/administer', '//evil.test', 'https://example.org', '/admin/moments']) assert.equal(scope.adminNotificationPath(path), '/admin/reports')
})
function polling() {
  const seen = new Map(), pings = [], studentPings = []
  let rows = [], reports = [], noteError = null, reportError = null, deliver = true
  const api = load('src/lib/shell-notify.ts', {
    './app-shell': { getAppShell: () => 'admin' }, './notification-scope': scope,
    './notify': { fetchNotifications: async () => ({ rows, error: noteError }) },
    './reports': { fetchReports: async () => ({ rows: reports, error: reportError }) },
    './admin-notifications': { pingAdminNotification: async (...args) => { pings.push(args); if (deliver instanceof Error) throw deliver; return deliver } },
    './alert-effects': { fireAlertBurst: async (...args) => studentPings.push(args) },
  }, { localStorage: { getItem: (key) => seen.get(key) || null, setItem: (key, value) => seen.set(key, value) } })
  return { api, pings, studentPings, set(options) { ({ rows = rows, reports = reports, noteError = noteError, reportError = reportError, deliver = deliver } = options) } }
}
test('management polling uses separate work notifications and new report identities rather than growing counts', async () => {
  const f = polling()
  f.set({ rows: [{ uid: 'A', id: 1, kind: 'todo_due' }, { uid: 'B', id: 2, kind: 'report_new' }], reports: [{ id: 4 }] })
  const first = await f.api.pollShellAlerts({ uid: 'A', shell: 'admin' })
  assert.equal(first.messages, 0); assert.equal(first.adminPending, 1); assert.equal(f.pings.length, 1); assert.equal(f.studentPings.length, 0)
  await f.api.pollShellAlerts({ uid: 'A', shell: 'admin' }); assert.equal(f.pings.length, 1)
  f.set({ reports: [] }); await f.api.pollShellAlerts({ uid: 'A', shell: 'admin' })
  f.set({ reports: [{ id: 5 }] }); await f.api.pollShellAlerts({ uid: 'A', shell: 'admin' }); assert.equal(f.pings.length, 2)
})
test('failed management reads stay errors and an obsolete session cannot issue a work ping', async () => {
  const f = polling()
  f.set({ reportError: 'permission denied' })
  await assert.rejects(f.api.pollShellAlerts({ uid: 'A', shell: 'admin' }), /举报同步失败.*permission denied/)
  f.set({ reports: [{ id: 9 }], reportError: null })
  let current = true
  const pending = f.api.pollShellAlerts({ uid: 'A', shell: 'admin', isCurrent: () => current }); current = false
  const result = await pending
  assert.equal(result.adminPending, 0); assert.equal(f.pings.length, 0)
})
test('new native management channel rings and vibrates but preserves any existing system personalization', async () => {
  const channels = [], calls = []
  let permission = 'granted'
  const notifications = {
    listChannels: async () => ({ channels }), createChannel: async (value) => { channels.push(value); calls.push(['create', value]) },
    checkPermissions: async () => ({ display: permission }), requestPermissions: async () => { calls.push(['request']); return { display: permission } },
    schedule: async (value) => calls.push(['schedule', value]),
  }
  const im = load('src/lib/im-session.ts', { './async-owner': load('src/lib/async-owner.ts', {}) })
  im.selectImSession('A')
  const api = load('src/lib/admin-notifications.ts', { './platform': { IS_NATIVE: true }, './im-session': im, '@capacitor/local-notifications': { LocalNotifications: notifications } })
  await api.pingAdminNotification('举报', '有 1 条待处理', 'A')
  assert.equal(channels[0].id, 'admin-work-v1'); assert.equal(channels[0].importance, 4); assert.equal(channels[0].vibration, true)
  assert.equal(Object.hasOwn(channels[0], 'sound'), false, 'the plugin should use the real system default, never a missing raw default asset')
  assert.equal(calls.filter(([kind]) => kind === 'request').length, 0, 'polling never prompts for permission')
  channels[0].vibration = false; channels[0].sound = null
  await api.ensureAdminNotificationChannel(); assert.equal(calls.filter(([kind]) => kind === 'create').length, 1)
  permission = 'denied'; assert.equal(await api.pingAdminNotification('举报', '新举报', 'A'), false)
  assert.equal(calls.filter(([kind]) => kind === 'schedule').length, 1)
})
test('denied permission and native schedule failures never commit seen markers and remain retryable', async () => {
  for (const deliver of [false, Error('schedule refused')]) {
    const f = polling(); f.set({ reports: [{ id: 22 }], deliver })
    try { await f.api.pollShellAlerts({ uid: 'A', shell: 'admin' }) } catch (error) { assert.match(error.message, /schedule refused/) }
    f.set({ deliver: true }); await f.api.pollShellAlerts({ uid: 'A', shell: 'admin' })
    assert.equal(f.pings.length, 2)
    await f.api.pollShellAlerts({ uid: 'A', shell: 'admin' }); assert.equal(f.pings.length, 2)
  }
})
test('administrator notification clicks verify account and current revision; cold-start owner recovery is allowed', async () => {
  const im = load('src/lib/im-session.ts', { './async-owner': load('src/lib/async-owner.ts', {}) })
  const api = load('src/lib/admin-notifications.ts', { './platform': { IS_NATIVE: false }, './im-session': im })
  im.selectImSession('A'); const a = im.captureImSession('A')
  const extra = { type: 'admin-work', ownerUid: 'A', ownerRun: api.ADMIN_NOTIFICATION_RUN, ownerRevision: a.revision }
  assert.equal(api.validAdminNotificationOwner(extra, a), true)
  im.selectImSession('B'); assert.equal(api.validAdminNotificationOwner(extra, im.captureImSession('B')), false)
  im.selectImSession('A'); assert.equal(api.validAdminNotificationOwner(extra, im.captureImSession('A')), false)
  assert.equal(api.validAdminNotificationOwner({ ...extra, ownerRun: 'a-previous-app-process' }, im.captureImSession('A')), true)
  assert.equal(api.validAdminNotificationOwner({ type: 'class-soon', ownerUid: 'A' }, im.captureImSession('A')), false)
  assert.equal(api.validAdminNotificationOwner(undefined, null), false)
})
test('account switch cleanup removes only management pending and delivered notifications', async () => {
  const im = load('src/lib/im-session.ts', { './async-owner': load('src/lib/async-owner.ts', {}) }), calls = []
  const api = load('src/lib/admin-notifications.ts', { './platform': { IS_NATIVE: true }, './im-session': im, '@capacitor/local-notifications': { LocalNotifications: {
    getPending: async () => ({ notifications: [{ id: 1, extra: { type: 'admin-work' } }, { id: 2, extra: { type: 'class-start' } }] }),
    getDeliveredNotifications: async () => ({ notifications: [{ id: 3, extra: { type: 'admin-work' } }, { id: 4, extra: { type: 'todo' } }] }),
    cancel: async (options) => calls.push(['cancel', Array.from(options.notifications, (item) => item.id)]),
    removeDeliveredNotifications: async (options) => calls.push(['delivered', Array.from(options.notifications, (item) => item.id)]),
  } } })
  await api.clearAdminNotifications()
  assert.deepEqual(calls, [['cancel', [1]], ['delivered', [3]]])
})
test('pre-channel Android support keeps ordinary work notifications, while real channel failures stay visible', async () => {
  const im = load('src/lib/im-session.ts', { './async-owner': load('src/lib/async-owner.ts', {}) }); im.selectImSession('A')
  for (const code of ['UNAVAILABLE', 'UNIMPLEMENTED', 'CHANNEL_IO_ERROR']) {
    let sent = 0
    const api = load('src/lib/admin-notifications.ts', { './platform': { IS_NATIVE: true }, './im-session': im, '@capacitor/local-notifications': { LocalNotifications: {
      checkPermissions: async () => ({ display: 'granted' }), listChannels: async () => { throw Object.assign(Error('native channel API'), { code }) }, schedule: async () => { sent++ },
    } } })
    if (code === 'CHANNEL_IO_ERROR') { await assert.rejects(api.pingAdminNotification('work', 'work', 'A'), /native channel API/); assert.equal(sent, 0) }
    else { assert.equal(await api.pingAdminNotification('work', 'work', 'A'), true); assert.equal(sent, 1) }
  }
})
