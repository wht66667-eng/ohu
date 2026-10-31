/** Cover home preference ownership, old-default migration and real custom selections. */
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
const preferencesCode = compile('src/pages/home/home-preferences.ts')
const plain = value => JSON.parse(JSON.stringify(value))
const newDefault = ['schedule', 'messages', 'english']
const oldDefault = ['schedule', 'grades', 'english', 'tasks', 'market', 'sports']

function fixture(storage = new Map()) {
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  }
  function load(code, dependencies = {}) {
    const module = { exports: {} }
    vm.runInNewContext(code, {
      module, exports: module.exports, localStorage,
      require: name => {
        if (Object.hasOwn(dependencies, name)) return dependencies[name]
        throw new Error(`Unexpected dependency ${name}`)
      },
    })
    return module.exports
  }
  const campus = load(campusCode)
  const prefs = load(preferencesCode, { '../../lib/campus': campus })
  return {
    prefs, storage, localStorage,
    store(uid, value) { storage.set(prefs.homePreferenceKey(uid), JSON.stringify(value)) },
    read(uid) { return plain(prefs.loadHomePreferences(uid)) },
  }
}

test('normalization keeps one to six valid unique choices in the chosen order', () => {
  const { prefs } = fixture()
  assert.deepEqual(plain(prefs.normalizeHomeServices(['messages'])), ['messages'])
  assert.deepEqual(plain(prefs.normalizeHomeServices(['english', null, 'messages', 'english', 'unknown', 'schedule'])), ['english', 'messages', 'schedule'])
  assert.deepEqual(plain(prefs.normalizeHomeServices(['todo', 'focus', 'messages', 'market', 'exams', 'grades', 'sports'])), ['todo', 'focus', 'messages', 'market', 'exams', 'grades'])
  for (const input of [undefined, null, {}, [], ['unknown', 0]]) {
    assert.deepEqual(plain(prefs.normalizeHomeServices(input)), newDefault)
  }
  const choice = prefs.normalizeHomeServices(null)
  choice.reverse()
  assert.deepEqual(plain(prefs.normalizeHomeServices(null)), newDefault)
})

test('saving and reading remain isolated by uid, including guests and encoded uid characters', () => {
  const f = fixture()
  assert.equal(f.prefs.saveHomePreferences('A', { campus: '通灌校区', services: ['schedule', 'messages', 'english'] }), true)
  assert.equal(f.prefs.saveHomePreferences('B', { campus: '苍梧校区', services: ['focus', 'todo'] }), true)
  assert.equal(f.prefs.saveHomePreferences('', { campus: '宋跳校区', services: ['market'] }), true)
  assert.equal(f.prefs.saveHomePreferences('A:guest/%', { campus: '', services: ['grades'] }), true)
  assert.deepEqual(f.read('A'), { campus: '通灌校区', services: newDefault })
  assert.deepEqual(f.read('B'), { campus: '苍梧校区', services: ['focus', 'todo'] })
  assert.deepEqual(f.read(''), { campus: '宋跳校区', services: ['market'] })
  assert.deepEqual(f.read('A:guest/%'), { campus: '', services: ['grades'] })
  assert.deepEqual(f.read('unconfigured'), { campus: '', services: newDefault })
  assert.equal(f.storage.size, 4)
})

test('the legacy untouched six-item default migrates without losing campus or affecting other accounts', () => {
  const f = fixture()
  f.store('A', { campus: '宋跳校区', services: oldDefault })
  f.store('older', { version: 1, campus: '通灌校区', services: ['schedule', 'grades', 'english', 'tasks', 'market', 'food'] })
  f.store('B', { campus: '苍梧校区', services: ['sports', 'market', 'tasks', 'english', 'grades', 'schedule'] })
  assert.deepEqual(f.read('A'), { campus: '宋跳校区', services: newDefault })
  assert.deepEqual(f.read('older'), { campus: '通灌校区', services: newDefault })
  assert.deepEqual(f.read('B'), { campus: '苍梧校区', services: ['sports', 'market', 'tasks', 'english', 'grades', 'schedule'] })
  assert.equal(f.prefs.saveHomePreferences('A', f.prefs.loadHomePreferences('A')), true)
  assert.equal(JSON.parse(f.storage.get(f.prefs.homePreferenceKey('A'))).version, 2)
  assert.deepEqual(f.read('A'), { campus: '宋跳校区', services: newDefault })
})

test('legacy custom choices and an explicitly saved old default retain their valid order', () => {
  const f = fixture()
  f.store('custom', { campus: '通灌校区', services: ['english', 'tasks', 'market', 'sports', 'schedule', 'grades'] })
  assert.deepEqual(f.read('custom').services, ['english', 'tasks', 'market', 'sports', 'schedule', 'grades'])
  f.store('short', { campus: '通灌校区', services: ['messages', 'english'] })
  assert.deepEqual(f.read('short').services, ['messages', 'english'])
  assert.equal(f.prefs.saveHomePreferences('explicit', { campus: '苍梧校区', services: oldDefault }), true)
  assert.deepEqual(f.read('explicit'), { campus: '苍梧校区', services: oldDefault })
})

test('malformed or unavailable storage falls back safely and rejected writes report failure', () => {
  const f = fixture()
  f.storage.set(f.prefs.homePreferenceKey('broken'), '{')
  assert.deepEqual(f.read('broken'), { campus: '', services: newDefault })
  f.store('invalid', { campus: '不存在的校区', services: ['unknown', 'messages', 'messages', 'english'] })
  assert.deepEqual(f.read('invalid'), { campus: '', services: ['messages', 'english'] })
  assert.equal(f.prefs.saveHomePreferences('invalid', { campus: '不存在的校区', services: [] }), true)
  assert.deepEqual(f.read('invalid'), { campus: '', services: newDefault })
  f.localStorage.getItem = () => { throw new Error('synthetic blocked storage') }
  assert.deepEqual(f.read('A'), { campus: '', services: newDefault })
  f.localStorage.setItem = () => { throw new Error('synthetic quota limit') }
  assert.equal(f.prefs.saveHomePreferences('A', { campus: '', services: newDefault }), false)
})
