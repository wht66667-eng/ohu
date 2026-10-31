import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(`${root}/package.json`)('typescript')
const compile = name => ts.transpileModule(fs.readFileSync(`${root}/src/lib/${name}.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const settle = () => new Promise(resolve => setImmediate(resolve))
function setup({ initialUid = '', storedUid = 'A', bootEnabled = true } = {}) {
  let uid = initialUid, revision = 0
  const listeners = new Set(), events = new Map(), calls = []
  const overlay = { supported: true, enabled: true, permissionGranted: true, ownerUid: storedUid, pendingCount: 2, nextAt: Date.now() + 60_000, exactAlarmGranted: true, lastError: null }
  const boot = { supported: true, enabled: bootEnabled, ownerUid: storedUid, lastError: null }
  const choices = new Map([[storedUid, bootEnabled]])
  const hooks = {}
  const qbank = {
    captureQbankSession: () => ({ uid, revision }),
    isQbankSessionCurrent: session => session.uid === uid && session.revision === revision,
    subscribeQbank: listener => { listeners.add(listener); return () => listeners.delete(listener) },
  }
  const plugins = {
    ReminderOverlay: {
      getState: async () => hooks.overlayRead ? hooks.overlayRead() : { ...overlay },
      clear: async options => {
        calls.push({ name: 'overlay.clear', ...options })
        if (options.ownerUid && options.ownerUid !== overlay.ownerUid) return { ...overlay }
        overlay.pendingCount = 0; overlay.nextAt = null; overlay.lastError = null
        if (!options.preserveEnabled) { overlay.enabled = false; overlay.ownerUid = null }
        return { ...overlay }
      },
      sync: async options => { calls.push({ name: 'overlay.sync', ...options }); overlay.ownerUid = options.ownerUid; overlay.pendingCount = options.items.length; return { ...overlay, scheduledCount: options.items.length, skippedExpired: 0 } },
      setEnabled: async options => { calls.push({ name: 'overlay.enabled', ...options }); overlay.enabled = options.enabled; return { ...overlay } },
    },
    ReminderBoot: {
      getState: async () => hooks.bootRead ? hooks.bootRead() : { ...boot },
      selectOwner: async options => { calls.push({ name: 'boot.owner', ...options }); boot.ownerUid = options.ownerUid; boot.enabled = choices.get(options.ownerUid) ?? true; return { ...boot } },
      setEnabled: async options => { calls.push({ name: 'boot.enabled', ...options }); if (options.ownerUid !== boot.ownerUid) throw new Error('owner mismatch'); boot.enabled = options.enabled; choices.set(options.ownerUid, options.enabled); return { ...boot } },
      clearOwner: async options => { calls.push({ name: 'boot.clear', ...options }); if (options.ownerUid === boot.ownerUid) { boot.ownerUid = null; boot.enabled = false }; return { ...boot } },
    },
  }
  const core = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => true }, registerPlugin: name => plugins[name] }
  const modules = {}
  const load = name => {
    const module = { exports: {} }
    vm.runInNewContext(compile(name), {
      module, exports: module.exports, console, Date, Map, Set, Promise,
      window: { addEventListener: (name, listener) => { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(listener) } },
      require: name => name === '@capacitor/core' ? core : name === './qbank' ? qbank : name === './reminder-boot' ? modules.boot : (() => { throw new Error(name) })(),
    })
    return module.exports
  }
  modules.boot = load('reminder-boot')
  modules.overlay = load('reminder-overlay')
  return { ...modules, nativeOverlay: overlay, nativeBoot: boot, calls, hooks, change(nextUid) { if (uid === nextUid) return; uid = nextUid; revision++; listeners.forEach(listener => listener()) }, logout(ownerUid) { events.get('ohhu-reminder-owner-logout')?.forEach(listener => listener({ detail: { ownerUid } })) }, anonymous() { events.get('ohhu-reminder-auth-anonymous')?.forEach(listener => listener()) } }
}

// Hydrating the same real account after the OS reclaimed the process preserves persisted alarms.
const cold = setup({ bootEnabled: false })
cold.change('A'); await settle()
assert.equal(cold.nativeOverlay.pendingCount, 2)
assert.equal(cold.nativeOverlay.enabled, true)
assert.equal(cold.nativeBoot.enabled, false)
assert.equal(cold.calls.length, 0)
cold.change(''); await settle()
assert.equal(cold.nativeOverlay.pendingCount, 2, 'a transient missing UID is not a confirmed logout')
cold.change('A'); await settle()
assert.equal(cold.nativeOverlay.pendingCount, 2)

// Removing an empty classroom plan does not revoke the user's overlay opt-in or boot choice.
await cold.overlay.clearReminderOverlays('A', { preserveEnabled: true })
assert.equal(cold.nativeOverlay.pendingCount, 0)
assert.equal(cold.nativeOverlay.enabled, true)
assert.equal(cold.nativeOverlay.ownerUid, 'A')
assert.equal(cold.nativeBoot.ownerUid, 'A')
assert.equal(cold.calls.some(call => call.name === 'boot.clear'), false)

// A confirmed logout revokes that owner's plans; its late callback cannot erase B's state.
const logout = setup({ initialUid: 'A' })
await settle(); logout.logout('A'); logout.change(''); await settle()
assert.equal(logout.nativeOverlay.enabled, false)
assert.equal(logout.nativeBoot.ownerUid, null)
logout.change('B'); await settle()
logout.nativeOverlay.ownerUid = 'B'; logout.nativeOverlay.enabled = true; logout.nativeOverlay.pendingCount = 4
logout.logout('A'); await settle()
assert.equal(logout.nativeOverlay.pendingCount, 4)
assert.equal(logout.nativeBoot.ownerUid, 'B')

// Different authenticated owners reset overlay opt-in while preserving each boot switch choice.
const swap = setup({ initialUid: 'A', bootEnabled: false })
await settle(); swap.change('B'); await settle()
assert.equal(swap.nativeOverlay.enabled, false)
assert.equal(swap.nativeBoot.enabled, true)
await swap.boot.setReminderBootRestoreEnabled(false)
swap.change('A'); await settle()
assert.equal(swap.nativeBoot.enabled, false)
swap.change('B'); await settle()
assert.equal(swap.nativeBoot.enabled, false)

// A stale asynchronous schedule may neither replace nor clear a newly selected account.
const stale = setup({ initialUid: 'A' })
await settle()
let release, started
const entered = new Promise(resolve => { started = resolve })
stale.hooks.overlayRead = () => { started(); return new Promise(resolve => { release = resolve }) }
const pending = stale.overlay.syncReminderOverlays({ ownerUid: 'A', items: [{ id: 1, title: 'Class', body: 'Room', at: Date.now() + 60_000 }] })
await entered
stale.change('B'); stale.nativeOverlay.ownerUid = 'B'; stale.nativeOverlay.pendingCount = 4
delete stale.hooks.overlayRead; release({ ...stale.nativeOverlay })
assert.equal((await pending).scheduledCount, 0)
await settle()
assert.equal(stale.nativeOverlay.pendingCount, 4)
assert.equal(stale.calls.some(call => call.name === 'overlay.sync'), false)
// Only explicit confirmation of anonymity clears the persisted former owner.
const anonymous = setup()
anonymous.anonymous(); await settle()
assert.equal(anonymous.nativeOverlay.pendingCount, 0)
assert.equal(anonymous.nativeBoot.ownerUid, null)

// Authentication may finish while a native read from the guest cleanup is waiting.
const lateAnonymous = setup()
let releaseOverlay, releaseBoot
lateAnonymous.hooks.overlayRead = () => new Promise(resolve => { releaseOverlay = resolve })
lateAnonymous.hooks.bootRead = () => new Promise(resolve => { releaseBoot = resolve })
lateAnonymous.anonymous(); await settle()
lateAnonymous.change('B')
lateAnonymous.nativeOverlay.ownerUid = 'B'; lateAnonymous.nativeOverlay.pendingCount = 4
lateAnonymous.nativeBoot.ownerUid = 'B'
delete lateAnonymous.hooks.overlayRead; delete lateAnonymous.hooks.bootRead
releaseOverlay({ ...lateAnonymous.nativeOverlay }); releaseBoot({ ...lateAnonymous.nativeBoot }); await settle()
assert.equal(lateAnonymous.nativeOverlay.pendingCount, 4)
assert.equal(lateAnonymous.nativeBoot.ownerUid, 'B')
assert.equal(lateAnonymous.calls.some(call => call.name.endsWith('.clear')), false)
console.log('Overlay and boot account, cold-start, confirmed anonymous, opt-in and stale-work checks passed')

// Course phase expiry survives Date/ISO bridge conversion and invalid deadlines never replace a plan.
const lifetime=setup({initialUid:'A'}),alarmAt=Date.now()+60000,expiresAt=alarmAt+600000
await lifetime.overlay.syncReminderOverlays({ownerUid:'A',items:[{id:43000,title:'课程',body:'地点',at:new Date(alarmAt),expiresAt:new Date(expiresAt).toISOString()}]})
assert.equal(lifetime.calls.find(call=>call.name==='overlay.sync').items[0].expiresAt,expiresAt)
await assert.rejects(lifetime.overlay.syncReminderOverlays({ownerUid:'A',items:[{id:43000,title:'课程',body:'地点',at:alarmAt,expiresAt:'invalid'}]}),/无效条目/)
assert.equal(lifetime.calls.filter(call=>call.name==='overlay.sync').length,1)
