/**
 * 我的表情包测试（纯逻辑层，不碰 Canvas）：
 * 1) 添加去重、上限截断、按 uid 隔离
 * 2) 删除与订阅通知
 * 3) 云端优先、云端为空时本地回写；云端不可用只留本地
 * 4) 非法 URL 一律不入库（表情包最终会被当图片渲染，不能让 javascript: 混进来）
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

function storage() {
  const map = new Map()
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: key => { map.delete(key) },
    dump: () => map,
  }
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

function fixture(options = {}) {
  const writes = []
  const store = storage()
  const stickers = load('src/lib/stickers.ts', {
    './cb': {
      cbRdb: () => ({
        from(table) {
          const chain = {
            _table: table,
            select() { return chain },
            eq() { return chain },
            limit() { return chain },
            async then(resolve) { return resolve(options.cloud ? options.cloud() : { data: [], error: null }) },
            async update(body) { writes.push(['update', body]); return { error: null } },
            async insert(body) { writes.push(['insert', body]); return { error: null } },
          }
          return chain
        },
      }),
    },
  }, { localStorage: store })
  return { stickers, writes, store }
}

test('adding stickers dedupes urls, caps at the limit and keeps the newest first', () => {
  const { stickers } = fixture()
  const url = i => `https://cdn.example.com/s/${i}.png`
  stickers.addSticker('A', url(1))
  stickers.addSticker('A', url(1))
  assert.equal(stickers.getStickers('A').length, 1)
  for (let i = 2; i <= stickers.STICKER_LIMIT + 5; i += 1) stickers.addSticker('A', url(i))
  const list = stickers.getStickers('A')
  assert.equal(list.length, stickers.STICKER_LIMIT)
  assert.equal(list[0].url, url(stickers.STICKER_LIMIT + 5))
})

test('unsafe urls never enter the sticker pack', () => {
  const { stickers } = fixture()
  for (const bad of ['', 'javascript:alert(1)', 'http://a.com/x.png', `https://x.com/${'a'.repeat(1100)}`]) {
    stickers.addSticker('A', bad)
  }
  assert.equal(stickers.getStickers('A').length, 0)
})

test('sticker packs are isolated per account and removals notify subscribers', () => {
  const { stickers } = fixture()
  let fired = 0
  const off = stickers.subscribeStickers(() => { fired += 1 })
  stickers.addSticker('A', 'https://cdn.example.com/a.png')
  stickers.addSticker('B', 'https://cdn.example.com/b.png')
  assert.equal(stickers.getStickers('A').length, 1)
  assert.equal(stickers.getStickers('B').length, 1)
  const id = stickers.getStickers('A')[0].id
  stickers.removeSticker('A', id)
  assert.equal(stickers.getStickers('A').length, 0)
  assert.equal(stickers.getStickers('B').length, 1)
  assert.ok(fired >= 3)
  off()
})

test('cloud copy wins on pull; empty cloud falls back to local and backfills it', async () => {
  const remote = [{ id: 'r1', url: 'https://cdn.example.com/remote.png' }]
  const first = fixture({ cloud: async () => ({ data: [{ pref_value: { items: remote } }], error: null }) })
  const pulled = await first.stickers.pullStickers('A')
  assert.equal(pulled.length, 1)
  assert.equal(pulled[0].url, 'https://cdn.example.com/remote.png')

  const second = fixture({ cloud: async () => ({ data: [], error: null }) })
  second.stickers.addSticker('A', 'https://cdn.example.com/local.png')
  const kept = await second.stickers.pullStickers('A')
  assert.equal(kept.length, 1)
  assert.equal(kept[0].url, 'https://cdn.example.com/local.png')
  await flush()
  assert.ok(second.writes.some(([kind]) => kind === 'insert' || kind === 'update'))
})

test('a broken cloud read leaves the local pack untouched', async () => {
  const { stickers } = fixture({ cloud: async () => ({ data: null, error: { message: 'boom' } }) })
  stickers.addSticker('A', 'https://cdn.example.com/local.png')
  const list = await stickers.pullStickers('A')
  assert.equal(list.length, 1)
  assert.equal(list[0].url, 'https://cdn.example.com/local.png')
})
