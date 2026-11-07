import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const compile = file => ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
function load(code, globals, dependencies = {}) {
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, Error, URL, ...globals, require: id => { if (id in dependencies) return dependencies[id]; throw Error(id) } })
  return module.exports
}
const source = compile('src/lib/ohu-sharing.ts')

test('system sharing uses only the fixed public URL, without current-page account parameters', async () => {
  let payload
  const mod = load(source, { navigator: { share: async value => { payload = value } }, window: { location: { href: 'http://localhost/?token=synthetic' } } })
  assert.match(await mod.shareOhuLink(), /完成/)
  assert.equal(payload.url, mod.OHU_SHARE_URL)
  assert.equal(new URL(payload.url).search, '')
})

test('cancelling a system share never silently copies anything', async () => {
  let copied = false
  const mod = load(source, { navigator: { share: async () => { throw Object.assign(new Error('cancel'), { name: 'AbortError' }) }, clipboard: { writeText: async () => { copied = true } } }, window: {} })
  assert.match(await mod.shareOhuLink(), /取消/)
  assert.equal(copied, false)
})

test('unsupported or failed sharing falls back to copying the same public URL', async () => {
  let copied
  const mod = load(source, { navigator: { share: async () => { throw new Error('unsupported') }, clipboard: { writeText: async value => { copied = value } } }, window: {} })
  assert.match(await mod.shareOhuLink(), /已复制/)
  assert.equal(copied, mod.OHU_SHARE_URL)
})

test('blocked clipboard offers manual copying and never claims a completed copy', async () => {
  const mod = load(source, { navigator: { clipboard: { writeText: async () => { throw Error('blocked') } } }, window: { prompt: (_, value) => value } })
  assert.match(await mod.shareOhuLink(), /手动复制/)
})

function panelFixture() {
  const hooks = [], calls = []
  let cursor = 0
  const node = (type, props) => ({ type, props })
  const api = load(compile('src/components/SharePosterSheet.tsx'), {}, {
    react: { useState(initial) { const slot = cursor++; if (!(slot in hooks)) hooks[slot] = initial; return [hooks[slot], value => { hooks[slot] = typeof value === 'function' ? value(hooks[slot]) : value }] }, useRef(initial) { const slot = cursor++; return hooks[slot] ||= { current: initial } }, useEffect() {} },
    'react/jsx-runtime': { jsx: node, jsxs: node }, '@capacitor/core': { Capacitor: { getPlatform: () => 'android' } },
    '../lib/share-image': { saveShareImage: async (...args) => { calls.push(args); return '已保存到相册' } }, '../lib/ohu-sharing': { OHU_SHARE_URL: 'https://example.org/download/', shareOhuLink: async () => { calls.push('link'); return '已分享' } }, './ohu-share-panel.module.css': { default: {} },
  })
  const render = () => { cursor = 0; return api.OhuSharePanel() }
  const all = tree => [tree, ...[tree?.props?.children].flat(Infinity).filter(value => value && typeof value === 'object').flatMap(all)]
  const nodes = () => all(render())
  return { hooks, calls, render, nodes }
}

test('unified panel exposes one primary action; changing mode reuses it and preserves Android gallery saving', async () => {
  const f = panelFixture()
  assert.equal(f.nodes().filter(row => row.type === 'button').length, 1)
  f.nodes().find(row => row.type === 'select').props.onChange({ target: { value: 'image' } })
  f.hooks[2] = 'data:image/png;base64,c3ludGhldGlj'; f.hooks[3] = false
  const buttons = f.nodes().filter(row => row.type === 'button')
  assert.equal(buttons.length, 1)
  assert.match(buttons[0].props.children, /保存分享图到相册/)
  const first = buttons[0].props.onClick()
  buttons[0].props.onClick()
  await first; await Promise.resolve()
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0][0], 'data:image/png;base64,c3ludGhldGlj')
})
