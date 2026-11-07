import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const compile = path => ts.transpileModule(fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const campusCode = compile('src/lib/campus.ts')
const preferenceCode = compile('src/lib/campus-preference.ts')

function fixture() {
  const storage = new Map()
  const handlers = new Set()
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  }
  const window = {
    addEventListener: (name, listener) => { if (name === 'storage') handlers.add(listener) },
    removeEventListener: (name, listener) => { if (name === 'storage') handlers.delete(listener) },
  }
  function load(code, dependencies = {}) {
    const module = { exports: {} }
    vm.runInNewContext(code, { module, exports: module.exports, localStorage, window,
      require: name => { if (Object.hasOwn(dependencies, name)) return dependencies[name]; throw new Error(`Unexpected dependency: ${name}`) },
    })
    return module.exports
  }
  const pref = load(preferenceCode, { './campus': load(campusCode) })
  return { pref, storage, localStorage, storageEvent: key => handlers.forEach(handler => handler({ key })) }
}

test('a saved campus survives module reload and stays isolated across accounts and guest', () => {
  const f = fixture()
  assert.equal(f.pref.saveCampusPreference('A', '宋跳校区'), true)
  assert.equal(f.pref.saveCampusPreference('B', '通灌校区'), true)
  assert.equal(f.pref.saveCampusPreference('', '苍梧校区'), true)
  assert.equal(f.pref.loadCampusPreference('A'), '宋跳校区')
  assert.equal(f.pref.loadCampusPreference('B'), '通灌校区')
  assert.equal(f.pref.loadCampusPreference(''), '苍梧校区')
  assert.equal(f.pref.loadCampusPreference('C'), '')
  const cold = fixture()
  for (const [key, value] of f.storage) cold.storage.set(key, value)
  assert.equal(cold.pref.loadCampusPreference('A'), '宋跳校区')
  assert.notEqual(f.pref.campusPreferenceKey('A:guest/%'), f.pref.campusPreferenceKey('A'))
})

test('an earlier homepage choice is reused without rewriting layout or other accounts', () => {
  const f = fixture()
  const original = JSON.stringify({ version: 4, campus: '通灌校区', services: ['todo'], cards: ['tasks'] })
  f.storage.set('ohhu.home.v1:A', original)
  assert.equal(f.pref.loadCampusPreference('A'), '通灌校区')
  assert.equal(f.pref.saveCampusPreference('A', '宋跳校区'), true)
  assert.equal(f.pref.loadCampusPreference('A'), '宋跳校区')
  assert.equal(f.storage.get('ohhu.home.v1:A'), original)
  assert.equal(f.pref.loadCampusPreference('B'), '')
})

test('an explicit cleared choice overrides legacy settings; invalid input is never persisted', () => {
  const f = fixture()
  f.storage.set('ohhu.home.v1:A', JSON.stringify({ campus: '宋跳校区' }))
  assert.equal(f.pref.saveCampusPreference('A', ''), true)
  assert.equal(f.pref.loadCampusPreference('A'), '')
  assert.equal(f.pref.saveCampusPreference('A', '伪造校区'), false)
  assert.equal(f.pref.loadCampusPreference('A'), '')
  f.storage.set(f.pref.campusPreferenceKey('B'), '{broken')
  assert.equal(f.pref.loadCampusPreference('B'), '')
  f.storage.set(f.pref.campusPreferenceKey('C'), JSON.stringify({ campus: '其他学校' }))
  assert.equal(f.pref.loadCampusPreference('C'), '')
})

test('unavailable persistence reports failure but all active consumers keep the current choice', () => {
  const f = fixture()
  let notified = 0
  const unsubscribe = f.pref.subscribeCampusPreference(() => notified++)
  f.localStorage.setItem = () => { throw new Error('quota') }
  assert.equal(f.pref.saveCampusPreference('A', '通灌校区'), false)
  f.localStorage.getItem = () => { throw new Error('blocked') }
  assert.equal(f.pref.loadCampusPreference('A'), '通灌校区')
  assert.equal(f.pref.loadCampusPreference('B'), '')
  assert.equal(notified, 1)
  unsubscribe()
})

test('same-tab changes notify subscribers and other-tab storage changes refresh persisted values', () => {
  const f = fixture()
  let notified = 0
  const unsubscribe = f.pref.subscribeCampusPreference(() => notified++)
  f.pref.saveCampusPreference('A', '通灌校区')
  assert.equal(notified, 1)
  f.storage.set(f.pref.campusPreferenceKey('A'), JSON.stringify({ campus: '宋跳校区' }))
  f.storageEvent(f.pref.campusPreferenceKey('A'))
  assert.equal(f.pref.loadCampusPreference('A'), '宋跳校区')
  assert.equal(notified, 2)
  f.storageEvent('unrelated')
  assert.equal(notified, 2)
  unsubscribe()
  f.storageEvent(f.pref.campusPreferenceKey('A'))
  assert.equal(notified, 2)
})

test('clearing storage in another tab clears a temporary fallback instead of retaining stale campus', () => {
  const f = fixture()
  const unsubscribe = f.pref.subscribeCampusPreference(() => {})
  f.localStorage.setItem = () => { throw new Error('quota') }
  f.pref.saveCampusPreference('A', '宋跳校区')
  assert.equal(f.pref.loadCampusPreference('A'), '宋跳校区')
  f.storage.clear()
  f.storageEvent(null)
  assert.equal(f.pref.loadCampusPreference('A'), '')
  unsubscribe()
})

test('map campus matching preserves cloud IDs and avoids falling back to the wrong selected campus', () => {
  const { pref } = fixture()
  const cloud = [{ id: 81, name: '苍梧校区' }, { id: 900, name: '江苏海洋大学 · 宋跳校区' }]
  assert.equal(pref.preferredCampusRow(cloud, '宋跳校区').id, 900)
  assert.equal(pref.preferredCampusRow([{ id: -2004, name: '宋跳校区' }], '宋跳校区').id, -2004)
  assert.equal(pref.preferredCampusRow(cloud, '通灌校区'), undefined)
  assert.equal(pref.preferredCampusRow(cloud, '').id, 81)
  assert.equal(pref.campusNameFromLabel('江苏海洋大学宋跳校区'), '宋跳校区')
  assert.equal(pref.campusNameFromLabel('其他大学宋跳校区'), '')
})

test('first login adopts the guest campus but never replaces an account preference or explicit clear', () => {
  const f = fixture()
  f.pref.saveCampusPreference('', '宋跳校区')
  f.pref.saveCampusPreference('existing', '苍梧校区')
  f.pref.saveCampusPreference('cleared', '')
  f.storage.set('ohhu.home.v1:legacy', JSON.stringify({ campus: '通灌校区', cards: ['tasks'] }))
  for (const uid of ['new', 'existing', 'cleared', 'legacy']) f.pref.inheritGuestCampus(uid)
  assert.equal(f.pref.loadCampusPreference('new'), '宋跳校区')
  assert.equal(f.pref.loadCampusPreference('existing'), '苍梧校区')
  assert.equal(f.pref.loadCampusPreference('cleared'), '')
  assert.equal(f.pref.loadCampusPreference('legacy'), '通灌校区')
  f.pref.saveCampusPreference('', '通灌校区')
  f.pref.inheritGuestCampus('new')
  assert.equal(f.pref.loadCampusPreference('new'), '宋跳校区')
})
