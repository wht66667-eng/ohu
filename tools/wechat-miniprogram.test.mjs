import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')

const VALID_SCHEME = 'weixin://dl/business/?appid=wx1234567890abcdef&path=pages/index/index'

function fixture({ native = true } = {}) {
  const replies = [], fetches = [], launches = []
  let launchResult = true
  const doc = {
    visibilityState: 'visible',
    listeners: new Set(),
    addEventListener(type, cb) { if (type === 'visibilitychange') this.listeners.add(cb) },
    removeEventListener(type, cb) { this.listeners.delete(cb) },
    hide() { this.visibilityState = 'hidden'; for (const cb of [...this.listeners]) cb() },
  }
  const source = fs.readFileSync(join(root, 'src/lib/wechat-miniprogram.ts'), 'utf8')
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module, exports: module.exports, URL, AbortController, setTimeout, clearTimeout,
    document: doc,
    require: name => {
      if (name === './platform') return { IS_NATIVE: native }
      if (name === './express-app-probe') return {
        launchScheme: async scheme => {
          launches.push(scheme)
          if (launchResult) doc.hide()
          return launchResult
        },
      }
      throw new Error('Unexpected import ' + name)
    },
    fetch: async url => {
      fetches.push(url)
      const value = replies.shift()
      if (value instanceof Error) throw value
      return {
        ok: true,
        json: async () => {
          if (value && value.__jsonError) throw new SyntaxError('not json')
          return value
        },
      }
    },
  })
  return { api: module.exports, replies, fetches, launches, doc, setLaunchResult: v => { launchResult = v } }
}

test('只接受微信业务 Scheme，拒绝其他协议与微信首页', () => {
  const { api } = fixture()
  assert.equal(api.isWeChatBusinessScheme(VALID_SCHEME), true)
  assert.equal(api.isWeChatBusinessScheme('weixin://dl/business/?t=TICKET'), true)
  for (const bad of [
    undefined, null, 123, '', 'weixin://', 'weixin://dl/business/',
    'https://web.traceint.com/web/index.html', 'javascript:alert(1)',
    'weixin://dl/scan', 'weixin://dl/business/?appid=wx123\n',
    'weixin://dl/business/?appid=' + 'x'.repeat(3000),
  ]) assert.equal(api.isWeChatBusinessScheme(bad), false, String(bad))
})

test('配置解析只提取合法的 librarySeat 字段', () => {
  const { api } = fixture()
  assert.equal(api.parseWeChatSchemes({ librarySeat: VALID_SCHEME }).librarySeat, VALID_SCHEME)
  for (const bad of [null, undefined, 'x', 42, {}, { librarySeat: 'https://evil.test' }, { librarySeat: 1 }, []]) {
    assert.equal(api.parseWeChatSchemes(bad).librarySeat, null)
  }
})

test('未配置时直达失败且不触碰原生拉起', async () => {
  const { api, replies, fetches, launches } = fixture()
  replies.push({})
  assert.equal(await api.tryOpenLibraryMiniProgram(), false)
  assert.equal(fetches.length, 1)
  assert.ok(fetches[0].endsWith('/wechat-schemes.json'))
  assert.equal(launches.length, 0)
})

test('托管 SPA 兜底返回 HTML 时按未配置处理', async () => {
  const { api, replies, launches } = fixture()
  replies.push({ __jsonError: true })
  assert.equal(await api.tryOpenLibraryMiniProgram(), false)
  assert.equal(launches.length, 0)
})

test('配置合法且页面转后台时直达成功', async () => {
  const { api, replies, launches } = fixture()
  replies.push({ librarySeat: VALID_SCHEME })
  assert.equal(await api.tryOpenLibraryMiniProgram(), true)
  assert.deepEqual(launches, [VALID_SCHEME])
})

test('原生拉起失败时取消看门狗并返回失败', async () => {
  const { api, replies, launches, doc, setLaunchResult } = fixture()
  setLaunchResult(false)
  replies.push({ librarySeat: VALID_SCHEME })
  assert.equal(await api.tryOpenLibraryMiniProgram(), false)
  assert.equal(launches.length, 1)
  assert.equal(doc.listeners.size, 0)
})

test('非原生环境不请求配置直接失败', async () => {
  const { api, fetches, launches } = fixture({ native: false })
  assert.equal(await api.tryOpenLibraryMiniProgram(), false)
  assert.equal(fetches.length, 0)
  assert.equal(launches.length, 0)
})

test('网络失败不缓存，下次点击重新请求', async () => {
  const { api, replies, fetches } = fixture()
  replies.push(new Error('offline'), { librarySeat: VALID_SCHEME })
  assert.equal(await api.tryOpenLibraryMiniProgram(), false)
  assert.equal(await api.tryOpenLibraryMiniProgram(), true)
  assert.equal(fetches.length, 2)
})

test('合法配置缓存后不再重复请求', async () => {
  const { api, replies, fetches } = fixture()
  replies.push({ librarySeat: VALID_SCHEME })
  assert.equal(await api.tryOpenLibraryMiniProgram(), true)
  assert.equal(await api.tryOpenLibraryMiniProgram(), true)
  assert.equal(fetches.length, 1)
})

function fakeTarget(state = 'visible') {
  return {
    visibilityState: state,
    listeners: new Set(),
    addEventListener(type, cb) { if (type === 'visibilitychange') this.listeners.add(cb) },
    removeEventListener(type, cb) { this.listeners.delete(cb) },
    hide() { this.visibilityState = 'hidden'; for (const cb of [...this.listeners]) cb() },
  }
}

test('看门狗：转后台判成功，超时仍可见判失败', async () => {
  const { api } = fixture()
  const hidden = fakeTarget()
  const watchHidden = api.watchAppBackground(hidden, 50)
  hidden.hide()
  assert.equal(await watchHidden.promise, true)
  assert.equal(hidden.listeners.size, 0)

  const visible = fakeTarget()
  const watchVisible = api.watchAppBackground(visible, 20)
  assert.equal(await watchVisible.promise, false)
  assert.equal(visible.listeners.size, 0)
})

test('看门狗：已隐藏立即成功；取消后不再监听', async () => {
  const { api } = fixture()
  const already = fakeTarget('hidden')
  assert.equal(await api.watchAppBackground(already, 50).promise, true)
  assert.equal(already.listeners.size, 0)

  const target = fakeTarget()
  const watch = api.watchAppBackground(target, 50)
  watch.cancel()
  assert.equal(await watch.promise, false)
  assert.equal(target.listeners.size, 0)
  target.hide()
})