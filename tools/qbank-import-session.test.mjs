/**
 * 词汇 JSON 导入（免费）与「文件出题不得回退为客户端免费路径」的回归测试。
 *
 * 2026-10-03：文件 AI 出题改为付费服务端实现（src/services/qbank/paid-file.ts +
 * cloudfunctions/examGenerator），doc.ts 只保留本地词汇 JSON 导入。
 * 原先测试 doc.ts 的 importDocToBank（客户端解析 → AI 循环）已随该功能移除，
 * 这里改为覆盖现有行为，并锁定产品决策：文件出题必须走付费服务端。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(`${root}/package.json`)('typescript')
const compile = (file) =>
  ts.transpileModule(fs.readFileSync(`${root}/${file}`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText

function loadDoc() {
  const doc = { exports: {} }
  const saved = []
  vm.runInNewContext(compile('src/services/qbank/doc.ts'), {
    module: doc,
    exports: doc.exports,
    Math,
    JSON,
    require: (name) => {
      if (name === './import') {
        return {
          createQuestionsFromImport: async (rows, sourceType) => {
            saved.push({ rows, sourceType })
            return { created: rows.length, dup: 0, failed: 0 }
          },
        }
      }
      if (name === './hash') return { contentHash: (...parts) => parts.join('|') }
      throw new Error(`Unexpected import: ${name}`)
    },
  })
  return { api: doc.exports, saved }
}

const vocab = JSON.stringify({
  subject: '英语',
  sourceType: 'cet4_2025_12',
  items: [
    { zh: '苹果', en: 'apple' },
    { zh: '书本', en: 'book' },
    { zh: '猫', en: 'cat' },
    { zh: '狗', en: 'dog' },
  ],
})

test('valid vocabulary JSON creates one question per translation direction', async () => {
  const { api, saved } = loadDoc()
  const res = await api.importVocabularyFile(vocab)
  assert.equal(res.ok, true)
  assert.equal(res.created, 8, '4 条词汇 × 中→英 / 英→中')
  assert.equal(saved.length, 1)
  assert.equal(saved[0].sourceType, 'cet4_2025_12')
  const stems = saved[0].rows.map((r) => r.stem)
  assert.ok(stems.some((s) => s.includes('「苹果」的英文是？')))
  assert.ok(stems.some((s) => s.includes('「apple」的中文是？')))
})

test('each generated question carries four options and a resolvable answer', async () => {
  const { api, saved } = loadDoc()
  await api.importVocabularyFile(vocab)
  for (const row of saved[0].rows) {
    assert.equal(row.options.length, 4)
    // 数组来自 vm realm，跨 realm 的 deepEqual 会失败，这里按值比较
    assert.equal([...row.options].map((o) => o.key).join(','), 'A,B,C,D')
    const hit = row.options.find((o) => o.key === row.answer)
    assert.ok(hit, 'answer 必须指向一个真实选项')
    assert.ok(row.explanation.length > 0)
    assert.ok(row.contentHash.length > 0)
  }
})

test('malformed JSON is rejected without touching the bank', async () => {
  const { api, saved } = loadDoc()
  const res = await api.importVocabularyFile('{ not json')
  assert.equal(res.ok, false)
  assert.equal(res.created, 0)
  assert.match(res.error, /JSON/)
  assert.equal(saved.length, 0)
})

test('a file with no items is rejected', async () => {
  const { api, saved } = loadDoc()
  const res = await api.importVocabularyFile(JSON.stringify({ subject: '英语', items: [] }))
  assert.equal(res.ok, false)
  assert.equal(res.created, 0)
  assert.equal(saved.length, 0)
})

test('entries missing zh or en are skipped instead of producing broken stems', async () => {
  const { api, saved } = loadDoc()
  const res = await api.importVocabularyFile(
    JSON.stringify({
      items: [
        { zh: '苹果', en: 'apple' },
        { zh: '', en: 'ghost' },
        { zh: '孤词', en: '' },
        { zh: '猫', en: 'cat' },
        { zh: '狗', en: 'dog' },
        { zh: '鸟', en: 'bird' },
      ],
    }),
  )
  assert.equal(res.ok, true)
  assert.equal(res.created, 8, '仅 4 条完整条目生效')
  const stems = saved[0].rows.map((r) => r.stem).join('\n')
  assert.ok(!stems.includes('「」'), '空字段不能产生题干')
})

test('no client-side free file-to-AI entry remains in doc.ts', async () => {
  const { api } = loadDoc()
  assert.deepEqual(Object.keys(api), ['importVocabularyFile'], 'doc.ts 只保留免费词汇导入')
  for (const forbidden of ['importDocToBank', 'generateFromFile', 'generateQuestionsFromText']) {
    assert.equal(
      typeof api[forbidden],
      'undefined',
      `${forbidden} 属于已移除的客户端免费文件出题，如需恢复必须走付费服务端实现`,
    )
  }
})
