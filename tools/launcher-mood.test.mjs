import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')
process.env.TZ = 'Asia/Shanghai'
const NOW = Date.parse('2026-10-03T17:00:00Z') // Oct 4, 01:00 in Shanghai
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])) }
  static now() { return NOW }
}
function load(file, require, globals) {
  const module = { exports: {} }
  const source = fs.readFileSync(join(root, file), 'utf8').replaceAll('import.meta.env.BASE_URL', "'/'")
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, require, Date: Clock, ...globals }, { filename: file })
  return module.exports
}
function setup({ native = true, rejectSync = false, rejectEnabled = false, failedEnabled = false, failedIcon = false, nativeReadError = false, slowCloud = false, slowEnabled = false, storedEnabled } = {}) {
  const values = new Map(), snapshots = new Map(), calls = [], events = []
  if (storedEnabled !== undefined) values.set('sc.launcher.mood.enabled.v1', storedEnabled)
  const storage = (map) => ({ getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) })
  const globals = {
    localStorage: storage(values), sessionStorage: storage(snapshots),
    Event: class { constructor(type) { this.type = type } },
    CustomEvent: class { constructor(type, opts) { this.type = type; this.detail = opts.detail } },
    window: { dispatchEvent: (event) => events.push(event) },
  }
  let releaseEnabled
  const waitingEnabled = new Promise(resolve => { releaseEnabled = resolve })
  const plugin = {
    setEnabled: async ({ enabled }) => {
      calls.push(['enabled', enabled])
      if (slowEnabled) await waitingEnabled
      if (rejectEnabled) throw new Error('请安装新版本后重试')
      return { ok: !failedEnabled, enabled: failedEnabled ? false : enabled, name: enabled ? 'streak_3' : 'default', error: failedEnabled ? '系统拒绝了图标设置' : undefined }
    },
    syncMood: async (opts) => { calls.push(['sync', opts]); if (rejectSync) throw new Error('unavailable'); return { ok: true } },
    resetMood: async () => { calls.push(['reset']); return { ok: true, name: 'default' } },
    setIcon: async (opts) => { calls.push(['icon', opts]); return { ok: !failedIcon, error: failedIcon ? '切换失败' : undefined } },
    getIcon: async () => ({ name: 'default', error: nativeReadError ? '后台切换图标失败' : undefined }),
  }
  const calendar = load('src/lib/fox-calendar.ts', () => ({}), globals)
  const icons = load('src/lib/app-icon.ts', (name) => {
    if (name === '@capacitor/core') return { Capacitor: { getPlatform: () => 'android' }, registerPlugin: () => plugin }
    if (name === './platform') return { IS_NATIVE: native }
    if (name === './fox-calendar') return calendar
    return { foxAssetUrl: (pose) => pose, FOX_MOOD_POSES: {} }
  }, globals)
  let releaseCloud
  const waitCloud = new Promise((resolve) => { releaseCloud = resolve })
  const query = { select: () => query, eq: () => query, limit: async () => ({ data: [] }), insert: async () => { if (slowCloud) await waitCloud }, update: () => query }
  const engagement = load('src/lib/engagement.ts', (name) => {
    if (name === './app-icon') return icons
    if (name === './fox-calendar') return calendar
    if (name === './cb') return { cbRdb: () => ({ from: () => query }) }
    if (name === './app-shell') return { getAppShell: () => 'user' }
    return { FOX_LABELS: {} }
  }, globals)
  return { values, snapshots, calls, events, icons, engagement, releaseCloud, releaseEnabled }
}

test('activity timestamps use the local calendar day around Shanghai midnight', () => {
  const { icons } = setup()
  assert.equal(icons.activityDay('2026-10-02T17:00:00Z'), '2026-10-03')
  assert.equal(icons.activityDay('2026-10-03'), '2026-10-03')
  assert.equal(icons.activityDay(null), null)
  assert.equal(icons.activityDay('invalid'), null)
})

test('desktop mood is only offered on the Android native host', () => {
  assert.equal(setup().icons.supportsLauncherMood(), true)
  assert.equal(setup({ native: false }).icons.supportsLauncherMood(), false)
})

test('account change resets the native mood while preserving the user opt-in', async () => {
  const { icons, values, calls } = setup({ storedEnabled: '1' })
  values.set('sc.launcher.icon.v1', 'away_30')
  await icons.resetLauncherMoodForAccountChange()
  assert.equal(icons.getCachedIconState(), 'default')
  assert.equal(icons.isLauncherMoodEnabled(), true)
  assert.deepEqual(calls, [['reset']])
})

test('an old account cannot restore its icon after an account change during a delayed native request', async () => {
  const { icons, calls, releaseEnabled } = setup({ storedEnabled: '1', slowEnabled: true })
  const pending = icons.syncLauncherMood({ lastActiveAt: '2026-10-03T17:00:00Z', lastCheckinDate: '2026-10-04', streakCurrent: 3, iconState: 'streak_3' })
  await icons.resetLauncherMoodForAccountChange()
  releaseEnabled()
  assert.equal((await pending).ok, false)
  assert.equal(icons.getCachedIconState(), 'default')
  assert.equal(calls.filter(([kind]) => kind === 'sync').length, 0)
})

test('launcher mood requires a stored explicit opt-in on both native and Web', () => {
  for (const native of [false, true]) {
    assert.equal(setup({ native }).icons.isLauncherMoodEnabled(), false)
    assert.equal(setup({ native, storedEnabled: '0' }).icons.isLauncherMoodEnabled(), false)
    assert.equal(setup({ native, storedEnabled: 'true' }).icons.isLauncherMoodEnabled(), false)
    assert.equal(setup({ native, storedEnabled: '1' }).icons.isLauncherMoodEnabled(), true)
  }
})

test('native refusal cannot produce a saved opt-in or a success result', async () => {
  for (const options of [{ failedEnabled: true }, { rejectEnabled: true }]) {
    const { icons, events } = setup(options)
    await assert.rejects(icons.setLauncherMoodEnabled(true), /系统拒绝|安装新版本/)
    assert.equal(icons.isLauncherMoodEnabled(), false)
    assert.ok(icons.getLauncherMoodError())
    assert.equal(events.at(-1).detail.ok, false)
  }
})

test('Web cannot claim that it enabled a native launcher capability', async () => {
  const { icons } = setup({ native: false })
  await assert.rejects(icons.setLauncherMoodEnabled(true), /Android/)
  assert.equal(icons.isLauncherMoodEnabled(), false)
})

test('native rollback after a failed re-enable also turns off an existing Web opt-in', async () => {
  const { icons } = setup({ storedEnabled: '1', failedEnabled: true })
  await assert.rejects(icons.setLauncherMoodEnabled(true), /系统拒绝/)
  assert.equal(icons.isLauncherMoodEnabled(), false)
})

test('settings can read an error from deferred background application', async () => {
  const { icons, events } = setup({ nativeReadError: true })
  await icons.refreshLauncherMoodStatus()
  assert.equal(icons.getLauncherMoodError(), '后台切换图标失败')
  assert.equal(events.at(-1).detail.ok, false)
})

test('missing legacy toggle never falls back to a native sync or icon write', async () => {
  const { icons, calls } = setup({ rejectEnabled: true })
  const result = await icons.syncLauncherMood({ lastActiveAt: null, lastCheckinDate: null, streakCurrent: 1, iconState: 'streak_1' })
  assert.equal(result.ok, false)
  assert.deepEqual(calls.map(([kind]) => kind), ['enabled'])
  assert.equal(icons.getCachedIconState(), 'default')
})

test('failed icon application never changes the cached icon', async () => {
  const { icons } = setup({ storedEnabled: '1', failedIcon: true })
  await icons.setLauncherMoodEnabled(true)
  const before = icons.getCachedIconState()
  await assert.rejects(icons.applyLauncherIcon('away_30'), /切换失败/)
  assert.equal(icons.getCachedIconState(), before)
})

test('launcher previews are exact copies of the 13 Android icons and stay independent of UI themes', () => {
  const { icons } = setup()
  for (const state of icons.ICON_STATE_KEYS) {
    const preview = icons.launcherIconPreviewUrl(state)
    assert.equal(preview, `/launcher-icon-previews/${state}.png`)
    const nativeName = state === 'default' ? 'ic_mood_default' : `ic_${state}`
    assert.deepEqual(fs.readFileSync(join(root, 'public', preview.slice(1))), fs.readFileSync(join(root, 'android/app/src/main/res/mipmap-xxxhdpi', `${nativeName}.png`)))
  }
  assert.equal(icons.launcherIconPreviewUrl('untrusted'), '/launcher-icon-previews/default.png')
})

test('one local day away uses the V1 one-day art through its compatible alias', () => {
  const { engagement } = setup()
  const result = engagement.resolveIconState({ streakCurrent: 14, lastCheckinDate: '2026-10-03', lastActiveAt: '2026-10-02T17:00:00Z' })
  assert.equal(result.awayDays, 1)
  assert.equal(result.iconState, 'away_2')
})

test('V1 away thresholds and streak milestones match native alias mapping', () => {
  const { engagement } = setup()
  for (const [day, alias] of [[1, 'away_2'], [2, 'away_5'], [3, 'away_8'], [7, 'away_12'], [15, 'away_15'], [30, 'away_30']]) {
    const date = new Clock(); date.setDate(date.getDate() - day)
    const result = engagement.resolveIconState({ streakCurrent: 14, lastCheckinDate: null, lastActiveAt: date.toISOString() })
    assert.equal(result.awayDays, day)
    assert.equal(result.iconState, alias)
  }
  for (const [day, alias] of [[1, 'streak_1'], [3, 'streak_3'], [7, 'streak_7'], [14, 'streak_7'], [30, 'streak_14']]) {
    assert.equal(engagement.resolveIconState({ streakCurrent: day, lastCheckinDate: '2026-10-04', lastActiveAt: '2026-10-03T17:00:00Z' }).iconState, alias)
  }
})

test('native mood sync receives the same local date as the engagement record', async () => {
  const { icons, calls } = setup()
  await icons.syncLauncherMood({ lastActiveAt: '2026-10-03T17:00:00Z', lastCheckinDate: '2026-10-04', streakCurrent: 3, iconState: 'streak_3' })
  assert.equal(calls.find(([kind]) => kind === 'sync')[1].lastActiveDate, '2026-10-04')
  assert.deepEqual(calls[0], ['enabled', false])
})

test('disabled mood keeps the default cache while updating native activity records', async () => {
  const { icons, calls } = setup()
  await icons.setLauncherMoodEnabled(true)
  await icons.applyLauncherIcon('away_30')
  await icons.setLauncherMoodEnabled(false)
  assert.equal(icons.getCachedIconState(), 'default')
  calls.length = 0
  await icons.syncLauncherMood({ lastActiveAt: new Clock().toISOString(), lastCheckinDate: '2026-10-04', streakCurrent: 3, iconState: 'streak_3' })
  assert.equal(icons.getCachedIconState(), 'default')
  assert.deepEqual(calls.map(([kind]) => kind), ['sync'])
  await icons.setLauncherMoodEnabled(true)
  assert.equal(icons.getCachedIconState(), 'streak_3')
})

test('a missing sync plugin never changes icons while the feature is disabled', async () => {
  const { icons, calls } = setup({ rejectSync: true })
  await icons.setLauncherMoodEnabled(false)
  calls.length = 0
  const result = await icons.syncLauncherMood({ lastActiveAt: null, lastCheckinDate: null, streakCurrent: 1, iconState: 'streak_1' })
  assert.deepEqual(calls.map(([kind]) => kind), ['sync'])
  assert.equal(result.ok, false)
  assert.match(icons.getLauncherMoodError(), /安装新版本/)
})

test('login snapshots publish before a slow cloud write completes', async () => {
  const { engagement, snapshots, events, calls, releaseCloud } = setup({ slowCloud: true })
  const pending = engagement.touchActive('cloud-student')
  const before = JSON.parse(snapshots.get('sc.away.before.v1'))
  assert.equal(before.first, true)
  assert.equal(before.days, 0)
  assert.equal(events.filter((event) => event.type === engagement.AWAY_SNAPSHOT_EVENT).length, 1)
  // The user's off-by-default choice reaches native before any mood records.
  assert.equal(calls.filter(([kind]) => kind === 'enabled').length, 1)
  await new Promise(setImmediate)
  assert.equal(calls.filter(([kind]) => kind === 'sync').length, 1)
  releaseCloud()
  const current = await pending
  assert.equal(current.checkedInToday, true)
  assert.equal(current.streakCurrent, 1)
  const again = await engagement.checkInToday('cloud-student')
  assert.equal(again.streakCurrent, 1)
})
