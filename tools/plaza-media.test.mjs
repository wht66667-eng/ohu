/**
 * 广场大厅发图测试：
 * 1) 图片消息正文统一落 '[图片]'，地址进 media_url，kind 标 image
 * 2) 只放行 https 且 ≤1024 的地址，非法地址不打到数据库
 * 3) 图片消息同样要过门禁（禁言 / 限制进大厅）
 * 4) 文本消息仍走敏感词与 500 字上限，拦下时不落库
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')
function load(relative, injected = {}, globals = {}) {
  const source = fs.readFileSync(join(root, relative), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(compiled, { module, exports: module.exports, URLSearchParams, window: { setTimeout, clearTimeout }, ...globals, require(name) { if (name in injected) return injected[name]; throw Error(`Unexpected dependency: ${name}`) } })
  return module.exports
}

const IMG = 'https://jou-d4gq7a3cqf51e6caa.ap-shanghai.app.tcloudbase.com/images/plaza/A/1.png'

function fixture(options = {}) {
  const inserts = []
  const gates = []
  const plaza = load('src/lib/plaza.ts', {
    './cb': {
      cbRdb: () => ({
        from: () => ({
          insert: (row) => ({
            select: async () => {
              inserts.push(row)
              return options.insert ? options.insert(row) : { data: [{ id: 7 }], error: null }
            },
          }),
        }),
      }),
    },
    './market': { fmtTime: () => '' },
    './sanctions': { assertPlazaWrite: async (uid, where) => { gates.push([uid, where]); return options.gate || null } },
  })
  return { plaza, inserts, gates }
}

test('image messages store the url separately and label the body [图片]', async () => {
  const { plaza, inserts, gates } = fixture()
  const r = await plaza.sendPlazaImage(IMG, 'A', '小狐', 'https://avatar.png')
  assert.equal(r.error, null)
  assert.equal(inserts.length, 1)
  assert.equal(inserts[0].body, '[图片]')
  assert.equal(inserts[0].kind, 'image')
  assert.equal(inserts[0].media_url, IMG)
  assert.equal(inserts[0].creator_uid, 'A')
  assert.deepEqual(gates, [['A', 'hall']])
})

test('unsafe urls are rejected before any write', async () => {
  const { plaza, inserts } = fixture()
  for (const bad of ['', 'javascript:alert(1)', 'http://a.com/x.png', `https://x.com/${'a'.repeat(1100)}`]) {
    assert.match((await plaza.sendPlazaImage(bad, 'A', '小狐')).error || '', /地址无效/)
  }
  assert.equal(inserts.length, 0)
})

test('a muted account cannot post images even with a valid url', async () => {
  const { plaza, inserts } = fixture({ gate: '你已被禁言' })
  const r = await plaza.sendPlazaImage(IMG, 'A', '小狐')
  assert.equal(r.error, '你已被禁言')
  assert.equal(inserts.length, 0)
})

test('text messages still moderate before writing', async () => {
  const { plaza, inserts } = fixture()
  assert.match((await plaza.sendPlazaMessage('   ', 'A', '小狐')).error || '', /不能为空/)
  assert.match((await plaza.sendPlazaMessage('x'.repeat(501), 'A', '小狐')).error || '', /500/)
  assert.match((await plaza.sendPlazaMessage('接单代考', 'A', '小狐')).error || '', /不当用语/)
  assert.equal(inserts.length, 0)
  const ok = await plaza.sendPlazaMessage('  今天食堂人好少  ', 'A', '小狐')
  assert.equal(ok.error, null)
  assert.equal(inserts[0].body, '今天食堂人好少')
  assert.equal(inserts[0].kind, 'text')
})
