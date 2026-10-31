/** Local task-image checks: all storage, database, session, and browser APIs are fakes. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(join(root, 'package.json'))('typescript')
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const plain = value => JSON.parse(JSON.stringify(value))
const file = (overrides = {}) => ({ name: 'parcel.png', type: 'image/png', size: 1024, ...overrides })
const IMAGE = 'https://images.example.test/tasks/A/parcel.png'

function load(relative, injected = {}, globals = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(join(root, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const module = { exports: {} }
  vm.runInNewContext(compiled, {
    module, exports: module.exports, URL, window: { setTimeout, clearTimeout }, ...globals,
    require(name) {
      if (name in injected) return injected[name]
      if (name.endsWith('.css')) return {}
      throw Error(`Unexpected dependency: ${name}`)
    },
  })
  return module.exports
}

function uploadFixture(options = {}) {
  const calls = { uploads: [] }
  const images = load('src/lib/task-images.ts', {
    './ugc-image': { async uploadUgcImage(selected, uid, scope) {
      calls.uploads.push({ file: selected, uid, scope })
      return options.upload ? options.upload(selected, uid, scope) : { url: IMAGE, error: null }
    } },
  })
  return { images, calls }
}

test('task image selection is capped at three images', () => {
  const { images } = uploadFixture()
  assert.equal(images.TASK_IMAGE_LIMIT, 3)
})

test('an empty account never starts the shared task uploader', async () => {
  const { images, calls } = uploadFixture()
  for (const uid of ['', '   ']) {
    const result = await images.uploadTaskImage(file(), uid)
    assert.equal(result.url, null)
    assert.ok(result.error)
  }
  assert.equal(calls.uploads.length, 0)
})

test('task upload delegates to the shared image uploader with the captured account and tasks scope', async () => {
  const { images, calls } = uploadFixture()
  const selected = file({ size: 8 * 1024 * 1024 })
  const result = await images.uploadTaskImage(selected, 'A')
  assert.deepEqual(plain(result), { url: IMAGE, error: null })
  assert.equal(calls.uploads.length, 1)
  assert.equal(calls.uploads[0].file, selected)
  assert.equal(calls.uploads[0].uid, 'A')
  assert.equal(calls.uploads[0].scope, 'tasks')
})

test('shared upload failures do not turn into task image URLs', async () => {
  for (const error of ['bucket unavailable', 'upload rejected', 'network interrupted']) {
    const { images } = uploadFixture({ upload: () => ({ url: null, error }) })
    const result = await images.uploadTaskImage(file(), 'A')
    assert.equal(result.url, null)
    assert.equal(result.error, error)
  }
})

test('a missing or unsafe public URL is reported as upload failure', async () => {
  for (const url of [null, '', 'tasks/A/parcel.png', 'http://images.example.test/parcel.png']) {
    const { images } = uploadFixture({ upload: () => ({ url, error: null }) })
    const result = await images.uploadTaskImage(file(), 'A')
    assert.equal(result.url, null)
    assert.ok(result.error)
  }
})

test('an expired account before upload starts does not touch storage', async () => {
  const { images, calls } = uploadFixture()
  const result = await images.uploadTaskImage(file(), 'A', () => false)
  assert.equal(result.url, null)
  assert.equal(calls.uploads.length, 0)
})

test('an account expiring while upload awaits cannot receive the late public URL', async () => {
  const gate = deferred()
  let current = true
  const { images, calls } = uploadFixture({ upload: () => gate.promise })
  const pending = images.uploadTaskImage(file(), 'A', () => current)
  assert.equal(calls.uploads.length, 1)
  current = false
  gate.resolve({ url: IMAGE, error: null })
  const result = await pending
  assert.equal(result.url, null)
})

test('an account expiring when the shared uploader returns cannot receive the URL', async () => {
  let current = true
  const { images } = uploadFixture({ upload: () => { current = false; return { url: IMAGE, error: null } } })
  const result = await images.uploadTaskImage(file(), 'A', () => current)
  assert.equal(result.url, null)
})

test('legacy image-less tasks remain valid and malformed image values are filtered', () => {
  const { images } = uploadFixture()
  for (const raw of [undefined, null, '', {}, 7]) assert.deepEqual(plain(images.taskImageUrls(raw)), [])
  const urls = images.taskImageUrls([
    `  ${IMAGE}  `, IMAGE, null, {}, 'blob:preview', 'data:image/png;base64,aaa', 'javascript:alert(1)',
    'http://images.example.test/unsafe.png', 'https://images.example.test/tasks/A/two.webp',
    'https://images.example.test/tasks/A/three.jpg', 'https://images.example.test/tasks/A/four.gif',
  ])
  assert.deepEqual(plain(urls), [IMAGE, 'https://images.example.test/tasks/A/two.webp', 'https://images.example.test/tasks/A/three.jpg'])
})

test('task insertion persists selected HTTPS image URLs and supports an image-less draft', async () => {
  const { images } = uploadFixture()
  const inserts = []
  let published = 0
  const market = load('src/lib/market.ts', {
    './cb': { cbRdb: () => ({ from: name => ({ insert: async row => { inserts.push({ name, row }); return { error: null } } }) }), cbStorage: () => { throw Error('Task insertion must not upload files') } },
    './task-images': images,
    './activity-ping': { pingBehavior: { taskPublish: () => published++ } },
    // market.ts 的错误文案抽到了零依赖的 upload-error.ts，这里照原样放行。
    // uploadGuardError 传入的 getter 取不到 cbAuth（本测试不 mock 它）会抛错，
    // 被守卫内部 catch 后返回 null —— 即「不阻断」，与线上降级策略一致。
    './upload-error': {
      uploadErrorText: (_e, fallback) => fallback,
      uploadGuardError: (_get) => null,
    },
    /* 上传前本地压缩：本测试不构造真实图片，原样返回即可。
       image-compress.ts 是零依赖模块，引入它不会把 ./cb 拖进 market.ts。 */
    './image-compress': {
      async compressImage(selected) { return { file: selected, compressed: false } },
    },
  })
  const draft = { title: '代取包裹', description: '一件', kind: '代取快递', reward: '', location: '通灌 · 驿站', deadline: '', contact: 'wechat-A', creator_name: '同学 A' }
  assert.equal((await market.createTask({ ...draft, images: [IMAGE] })).error, null)
  assert.equal((await market.createTask({ ...draft, images: [] })).error, null)
  assert.equal(inserts.length, 2)
  assert.equal(inserts[0].name, 'tasks')
  assert.deepEqual(plain(inserts[0].row.images), [IMAGE])
  assert.deepEqual(plain(inserts[1].row.images), [])
  assert.equal(inserts[0].row.status, 'open')
  assert.equal(inserts[0].row.contact, 'wechat-A')
  assert.equal(published, 2)
})
