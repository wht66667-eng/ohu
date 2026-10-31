import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'

const ts = createRequire(new URL('../package.json', import.meta.url))('typescript')
const source = fs.readFileSync(new URL('../src/lib/keyboard-viewport.ts', import.meta.url), 'utf8')
const module = { exports: {} }
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports })
const { keyboardViewport, isImeComposing, submitMessageKey } = module.exports

test('an overlay WebView follows the visible keyboard edge', () => {
  const view = keyboardViewport({ layoutHeight: 840, baselineHeight: 840, visualHeight: 520, nativeImeHeight: 320, editing: true })
  assert.equal(view.height, 520)
  assert.equal(view.keyboardOpen, true)
})

test('adjustResize and a native IME inset do not subtract the keyboard twice', () => {
  assert.equal(keyboardViewport({ layoutHeight: 520, baselineHeight: 840, visualHeight: 520, nativeImeHeight: 320, editing: true }).height, 520)
  assert.equal(keyboardViewport({ layoutHeight: 700, baselineHeight: 840, nativeImeHeight: 320, editing: true }).height, 520)
})

test('native WindowInsets handles WebViews whose visual viewport never shrinks', () => {
  assert.equal(keyboardViewport({ layoutHeight: 840, baselineHeight: 840, visualHeight: 840, nativeImeHeight: 320, editing: true }).height, 520)
})

test('keyboard panning preserves the visible origin; browser chrome and pinch zoom do not hide navigation', () => {
  const panned = keyboardViewport({ layoutHeight: 840, baselineHeight: 840, visualHeight: 500, visualOffsetTop: 30, editing: true })
  assert.equal(panned.offsetTop, 30)
  assert.equal(panned.height, 500)
  assert.equal(keyboardViewport({ layoutHeight: 840, baselineHeight: 840, visualHeight: 790, editing: true }).keyboardOpen, false)
  const zoom = keyboardViewport({ layoutHeight: 840, baselineHeight: 840, visualHeight: 420, visualScale: 2, editing: true })
  assert.equal(zoom.keyboardOpen, false)
  assert.equal(zoom.height, 840)
})

test('Enter keeps a newline and composing candidate confirmation never submits', () => {
  assert.equal(submitMessageKey({ key: 'Enter' }), false)
  assert.equal(submitMessageKey({ key: 'Enter', ctrlKey: true }), true)
  assert.equal(submitMessageKey({ key: 'Enter', metaKey: true }), true)
  assert.equal(submitMessageKey({ key: 'Enter', ctrlKey: true, nativeEvent: { isComposing: true } }), false)
  assert.equal(submitMessageKey({ key: 'Enter', ctrlKey: true, keyCode: 229 }), false)
  assert.equal(isImeComposing({ nativeEvent: { keyCode: 229, isComposing: false } }), true)
})
