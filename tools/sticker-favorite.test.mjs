/**
 * 编辑器贴纸收藏纯函数回归（LIFE-LINK-8）：裁切产物 → LifeRecordPhoto 载荷的
 * 校验与降级。被测模块零运行时 import，Node 24 按类型擦除加载。
 * 运行：`node --test tools/sticker-favorite.test.mjs`。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { cropStickerFavorite } from '../src/lib/sticker-favorite.ts'

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='

test('cropStickerFavorite 接受合法 PNG 载荷并固定 preset 为 photo', () => {
  const payload = cropStickerFavorite('abc-123', PNG, PNG, 'paper')
  assert.deepEqual(payload, { id: 'abc-123', original: PNG, sticker: PNG, preset: 'photo', edge: 'paper' })
})

test('cropStickerFavorite 接受三种边参数', () => {
  for (const edge of ['none', 'paper', 'white']) {
    assert.equal(cropStickerFavorite('id', PNG, PNG, edge)?.edge, edge)
  }
})

test('cropStickerFavorite 拒绝空/超长 id', () => {
  assert.equal(cropStickerFavorite('', PNG, PNG, 'paper'), null)
  assert.equal(cropStickerFavorite('   ', PNG, PNG, 'paper'), null)
  assert.equal(cropStickerFavorite('x'.repeat(65), PNG, PNG, 'paper'), null)
})

test('cropStickerFavorite 拒绝非 PNG dataURL 与非字符串', () => {
  assert.equal(cropStickerFavorite('id', JPEG, PNG, 'paper'), null)
  assert.equal(cropStickerFavorite('id', PNG, JPEG, 'white'), null)
  assert.equal(cropStickerFavorite('id', 'https://example.com/a.png', PNG, 'paper'), null)
  assert.equal(cropStickerFavorite('id', undefined, PNG, 'paper'), null)
  assert.equal(cropStickerFavorite('id', PNG, null, 'none'), null)
})

test('cropStickerFavorite 拒绝超大数据 URL', () => {
  const huge = PNG + 'A'.repeat(3_500_000)
  assert.equal(cropStickerFavorite('id', huge, PNG, 'paper'), null)
  assert.equal(cropStickerFavorite('id', PNG, huge, 'paper'), null)
})

test('cropStickerFavorite 拒绝未知边参数', () => {
  assert.equal(cropStickerFavorite('id', PNG, PNG, 'gold'), null)
  assert.equal(cropStickerFavorite('id', PNG, PNG, ''), null)
})
