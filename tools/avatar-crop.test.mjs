/**
 * 头像裁剪几何测试：
 * 1) cover scale 与缩放上下限
 * 2) 平移夹取：图片永远盖满取景框，不允许露底
 * 3) 以某点为锚缩放（zoomAt）：该点下的图像内容保持不动
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

function load(relative) {
  const source = fs.readFileSync(join(root, relative), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true } }).outputText
  const module = { exports: {} }
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require(name) {
      throw Error(`Unexpected dependency: ${name}`)
    },
  })
  return module.exports
}

const crop = load('src/lib/avatar-crop.ts')

test('cover scale and zoom limits', () => {
  // 横图 1000×500 放进 100 的方框：以高为准，scale = 0.2
  assert.equal(crop.coverScale(1000, 500, 100), 0.2)
  // 竖图 500×1000：以宽为准
  assert.equal(crop.coverScale(500, 1000, 100), 0.2)
  // 非法输入兜成 1，别让进度条/画布拿到 NaN
  assert.equal(crop.coverScale(0, 100, 100), 1)
  assert.equal(crop.coverScale(100, NaN, 100), 1)

  const range = crop.scaleRange(1000, 500, 100)
  assert.equal(range.min, 0.2)
  assert.equal(range.max, 1)
  assert.equal(crop.clampScale(0.01, 1000, 500, 100), 0.2)
  assert.equal(crop.clampScale(99, 1000, 500, 100), 1)
  assert.equal(crop.clampScale(NaN, 1000, 500, 100), 0.2)
  // 自定义最大倍数
  assert.equal(crop.scaleRange(1000, 500, 100, 2).max, 0.4)
})

test('offsets are clamped so the image always covers the viewport', () => {
  const eq = (a, b) => {
    assert.equal(a.tx, b.tx)
    assert.equal(a.ty, b.ty)
  }
  // 200×200 的图、box 100、scale 1：显示 200×200，四周各可移 50
  eq(crop.clampOffset(1, 80, -80, 200, 200, 100), { tx: 50, ty: -50 })
  // 刚好盖满时一个方向没得移
  eq(crop.clampOffset(0.5, 20, 20, 200, 200, 100), { tx: 0, ty: 0 })
  // 长图：纵向没得移，横向可以
  eq(crop.clampOffset(1, 30, 30, 300, 100, 100), { tx: 30, ty: 0 })
  // 非法值归零居中
  eq(crop.clampOffset(1, NaN, Infinity, 200, 200, 100), { tx: 0, ty: 0 })
})

test('zoomAt keeps the anchored image point fixed', () => {
  // 图 200×200、box 100：最小 scale 0.5 时刚好铺满且居中
  // 以左上角 (0,0) 为锚放大到 1：图像左缘必须仍压在 box 左缘（tx = 50）
  const corner = crop.zoomAt(0.5, 0, 0, 1, 0, 0, 200, 200, 100)
  assert.equal(corner.scale, 1)
  assert.deepEqual({ tx: corner.tx, ty: corner.ty }, { tx: 50, ty: 50 })
  // 以中心为锚缩放：保持居中
  const center = crop.zoomAt(0.5, 0, 0, 1, 50, 50, 200, 200, 100)
  assert.deepEqual({ tx: center.tx, ty: center.ty }, { tx: 0, ty: 0 })
  // 已偏移的图，以中心为锚放大：偏移按比例放大
  const shifted = crop.zoomAt(0.5, 25, 0, 1, 50, 50, 200, 200, 100)
  assert.equal(shifted.tx, 50)
  // 缩放结果同样不许露底：请求一个超小的 scale 也会被夹回 cover
  const tiny = crop.zoomAt(1, 50, 50, 0.01, 50, 50, 200, 200, 100)
  assert.equal(tiny.scale, 0.5)
  assert.deepEqual({ tx: tiny.tx, ty: tiny.ty }, { tx: 0, ty: 0 })
})
