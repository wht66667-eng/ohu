import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const compile = file => ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const domainCode = compile('src/plugins/fox-safety.ts')
const manifestCode = compile('src/plugins/plugin-manifest.ts')
function fixture() {
  const storage = new Map()
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }
  const load = code => {
    const module = { exports: {} }
    vm.runInNewContext(code, { module, exports: module.exports, localStorage, TextEncoder })
    return module.exports
  }
  return { storage, localStorage, api: load(domainCode), manifest: load(manifestCode) }
}
const json = rows => JSON.stringify({ schemaVersion: 1, questions: rows })
const bank = JSON.parse(fs.readFileSync(new URL('../src/plugins/data/fox-safety-bank.json', import.meta.url), 'utf8'))

test('bundled source contains 1000 complete questions with resolvable option labels and pinned provenance', () => {
  assert.equal(bank.questions.length, 1000)
  assert.equal(new Set(bank.questions.map(row => row.id)).size, 1000)
  assert.equal(bank.source.license, 'Apache-2.0')
  assert.match(bank.source.commit, /^[0-9a-f]{40}$/)
  assert.match(bank.source.databaseSha256, /^[0-9a-f]{64}$/)
  for (const row of bank.questions) {
    assert.equal(row.source, 'github')
    assert.equal(row.answerKind, 'letters')
    assert.ok(row.title.trim())
    assert.ok(row.options.length >= 2)
    for (const label of row.answer.split('、')) assert.ok(row.options.some(option => option.key === label))
  }
})

test('search finds question text and option text, folds width and case, and combines terms', () => {
  const { api } = fixture()
  const found = api.searchSafetyQuestions(bank.questions, '涉密计算机 有线鼠标', 'github')
  assert.ok(found.total > 0)
  assert.ok(found.items.every(row => row.title.includes('涉密计算机')))
  const sample = [{ id: '1', title: 'ABC 安全', options: [], source: 'github', answer: 'A', answerKind: 'letters' }]
  assert.equal(api.searchSafetyQuestions(sample, 'ａｂｃ', 'all').total, 1)
})

test('source filtering and pagination retain counts and clamp out-of-range pages', () => {
  const { api } = fixture()
  const rows = [...bank.questions, ...api.parseSafetyImport(json([{ title: '个人安全记录', answer: 'AB' }]))]
  assert.equal(api.searchSafetyQuestions(rows, '', 'all').total, 1001)
  assert.equal(api.searchSafetyQuestions(rows, '', 'imported').total, 1)
  const last = api.searchSafetyQuestions(rows, '', 'github', 9999)
  assert.equal(last.page, 49)
  assert.equal(last.items.length, 20)
  assert.equal(api.searchSafetyQuestions(rows, '不可能匹配的安全题目XYZ', 'all', 9).page, 0)
})

test('imports accept BOM and preserve reference text without importing executable fields or guessing options', () => {
  const { api } = fixture()
  const rows = api.parseSafetyImport('\uFEFF' + json([{ title: '<script>安全题</script>', answer: ' A ', options: [{ key: 'A', text: '猜测内容' }], run: 'alert(1)' }]))
  assert.equal(rows[0].title, '<script>安全题</script>')
  assert.equal(rows[0].answer, 'A')
  assert.equal(rows[0].source, 'imported')
  assert.equal(rows[0].options.length, 0)
  assert.equal('run' in rows[0], false)
  assert.throws(() => api.parseSafetyImport('const answers = {};'), /JSON/)
})

test('malformed and oversized imports fail atomically and preserve the previous bank', () => {
  const f = fixture()
  f.api.saveSafetyImport('A', json([{ title: '原记录', answer: 'A' }]))
  for (const text of ['{}', json([]), json([{ title: '新记录', answer: 'B' }, { title: '', answer: 'C' }]), ' '.repeat(1024 * 1024 + 1)]) {
    assert.throws(() => f.api.saveSafetyImport('A', text))
    assert.equal(f.api.readSafetyImport('A').questions[0].title, '原记录')
  }
})

test('saved imports are account-scoped and removing one account never changes another or the guest', () => {
  const f = fixture()
  for (const uid of ['A', 'B', '']) f.api.saveSafetyImport(uid, json([{ title: `记录${uid}`, answer: 'C' }]))
  assert.equal(f.api.readSafetyImport('A').questions[0].title, '记录A')
  assert.equal(f.api.readSafetyImport('new').questions.length, 0)
  f.api.removeSafetyImport('A')
  assert.equal(f.api.readSafetyImport('A').questions.length, 0)
  assert.equal(f.api.readSafetyImport('B').questions[0].title, '记录B')
  assert.equal(f.api.readSafetyImport('').questions[0].title, '记录')
})

test('blocked storage reports a visible error instead of claiming a saved or removed import', () => {
  const f = fixture()
  f.localStorage.setItem = () => { throw Error('quota') }
  assert.throws(() => f.api.saveSafetyImport('A', json([{ title: '记录', answer: 'A' }])), /没有保存/)
  f.localStorage.getItem = () => { throw Error('blocked') }
  assert.ok(f.api.readSafetyImport('A').error)
  f.localStorage.removeItem = () => { throw Error('blocked') }
  assert.throws(() => f.api.removeSafetyImport('A'), /无法移除/)
})

test('the nonofficial plugin is disabled by default, has a unique ID and only isolated local-data permissions', () => {
  const { api, manifest } = fixture()
  const plugin = manifest.BUILT_IN_PLUGINS.find(row => row.id === api.FOX_SAFETY_PLUGIN_ID)
  assert.ok(plugin)
  assert.equal(plugin.entryPath, '/plugins/fox-safety')
  assert.equal(plugin.official, false)
  assert.equal(plugin.author, 'wft')
  assert.equal(manifest.readPluginPreferences('A').enabled.includes(plugin.id), false)
  assert.deepEqual(Array.from(plugin.permissions), ['local-bank:read', 'local-bank:write'])
})
