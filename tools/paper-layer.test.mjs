/**
 * 手账纸页彩笔纯函数回归（P1-05b TASK-E1）：路径抽稀、橡皮命中、压感线宽、
 * 渲染指令、撤销/重做命令栈、皮肤色板与脏数据校验。
 * 被测模块零 import，Node 24 按类型擦除加载。
 * 运行：`node --test tools/paper-layer.test.mjs`。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_PAPER_SIZE, DEFAULT_PAPER_TOOL, MAX_PAPER_STROKES, MAX_STROKE_POINTS,
  PAPER_PRESET_COLORS, PAPER_TOOLS,
  clampPaperSize, commitErase, commitStroke, drawStrokePath, drawStrokeSegment, emptyPaperLayer,
  eraserHits, isHexColor, isPaperTool, normalizeStroke, normalizeStrokes, paletteForSkin,
  paperColorLabel, paperRenderWidth, paperStrokeId, redoPaper, simplifyPath,
  strokeSegmentWidth, undoPaper,
} from '../src/lib/paper-layer-helpers.ts'

function stroke(overrides = {}, points = [[0, 0], [0.5, 0.5], [1, 0]]) {
  return { id: 's1', tool: 'marker', color: '#ff8a3d', size: 6, points, ...overrides }
}

function mockCtx() {
  const ctx = {
    calls: [],
    globalAlpha: 1, lineWidth: 0, strokeStyle: '', fillStyle: '', lineCap: 'butt', lineJoin: 'miter',
    save() { ctx.calls.push('save') },
    restore() { ctx.calls.push('restore') },
    beginPath() { ctx.calls.push('beginPath') },
    moveTo(...args) { ctx.calls.push(['moveTo', ...args]) },
    lineTo(...args) { ctx.calls.push(['lineTo', ...args]) },
    stroke() { ctx.calls.push('stroke') },
    fill() { ctx.calls.push('fill') },
    arc(...args) { ctx.calls.push(['arc', ...args]) },
  }
  return ctx
}

test('纸面工具与色板元数据（视觉规格定稿）', () => {
  assert.deepEqual(PAPER_TOOLS.map(item => item.label), ['铅笔', '马克笔', '荧光笔', '水彩笔', '蜡笔'])
  assert.equal(PAPER_PRESET_COLORS.length, 7)
  assert.equal(DEFAULT_PAPER_TOOL, 'marker')
  assert.equal(DEFAULT_PAPER_SIZE, 6)
  assert.ok(isPaperTool('highlighter') && isPaperTool('watercolor') && isPaperTool('crayon') && !isPaperTool('pen'))
  assert.ok(isHexColor('#3E6B4F') && !isHexColor('#12345') && !isHexColor('red'))
})

test('paletteForSkin：皮肤只切默认选中色，色板本身不随皮肤/深色变化', () => {
  const fox = paletteForSkin('fox')
  assert.equal(fox.defaultColor, '#ff8a3d')
  assert.deepEqual(fox.colors, [...PAPER_PRESET_COLORS])
  assert.equal(paletteForSkin('classic').defaultColor, '#3e6b4f')
  assert.equal(paletteForSkin('night').defaultColor, '#4aa8a2')
  const unknown = paletteForSkin('unknown-variant')
  assert.deepEqual(unknown.colors, [...PAPER_PRESET_COLORS])
  assert.ok(PAPER_PRESET_COLORS.includes(unknown.defaultColor))
  for (const variant of ['', null, undefined, 'fox']) {
    assert.ok(PAPER_PRESET_COLORS.includes(paletteForSkin(variant).defaultColor))
  }
  assert.equal(paperColorLabel('#ff8a3d'), '狐狸橙')
  assert.equal(paperColorLabel('#123456'), '自定义色')
})

test('clampPaperSize 限制在 3–14px 滑杆范围', () => {
  assert.equal(clampPaperSize(1), 3)
  assert.equal(clampPaperSize(6.4), 6)
  assert.equal(clampPaperSize(99), 14)
  assert.equal(clampPaperSize(Number.NaN), DEFAULT_PAPER_SIZE)
})

test('simplifyPath：保留端点与转折，抽掉共线密集点', () => {
  const straight = [[0, 0], [0.01, 0], [0.02, 0], [0.03, 0], [1, 0]]
  const simplified = simplifyPath(straight, 0.002)
  assert.equal(simplified.length, 2)
  assert.deepEqual(simplified[0], [0, 0])
  assert.deepEqual(simplified.at(-1), [1, 0])
  const zigzag = [[0, 0], [0.5, 0.4], [1, 0]]
  assert.equal(simplifyPath(zigzag, 0.002).length, 3)
  assert.equal(simplifyPath([[0, 0]]).length, 1)
  // 超长笔迹被截断到点数上限
  const dense = Array.from({ length: MAX_STROKE_POINTS + 400 }, (_, i) => [i / (MAX_STROKE_POINTS + 399), Math.sin(i / 50) * 0.2 + 0.5])
  assert.ok(simplifyPath(dense, 0.0001).length <= MAX_STROKE_POINTS)
})

test('normalizeStroke 丢弃脏数据并收拢取值范围', () => {
  assert.equal(normalizeStroke(null), null)
  assert.equal(normalizeStroke({ tool: 'marker', color: '#fff', points: [[0, 0]] }), null)
  assert.ok(normalizeStroke({ tool: 'crayon', color: '#ff8a3d', points: [[0, 0]] }), 'crayon 是合法 tool')
  assert.equal(normalizeStroke({ tool: 'marker', color: '#ff8a3d', points: [] }), null)
  const cleaned = normalizeStroke({ tool: 'marker', color: '#ff8a3d', size: 999, points: [[-3, 0.2], [0.4, 2], ['x', 'y']], id: '' })
  assert.equal(cleaned.size, 14)
  assert.deepEqual(cleaned.points[0], [0, 0.2])
  assert.deepEqual(cleaned.points[1], [0.4, 1])
  assert.equal(cleaned.points.length, 2)
  assert.ok(cleaned.id)
  const unknownRows = [{ tool: 'pencil', color: '#3e6b4f', size: 5, points: [[0, 0], [1, 1]] }, 'junk', null]
  assert.equal(normalizeStrokes(unknownRows).length, 1)
  assert.equal(normalizeStrokes('nope').length, 0)
})

test('压感线宽：慢笔重、快笔轻、荧光笔恒宽，实时与渲染同一函数', () => {
  const slow = strokeSegmentWidth('pencil', 6, 1)
  const fast = strokeSegmentWidth('pencil', 6, 60)
  assert.ok(slow > 6 && slow <= 6 * 1.28)
  assert.ok(fast < 6 && fast >= 6 * 0.55)
  assert.ok(strokeSegmentWidth('marker', 6, 80) >= 6 * 0.8)
  assert.equal(strokeSegmentWidth('highlighter', 6, 80), 6 * 2.5)
  assert.equal(paperRenderWidth('highlighter', 6), 15)
  assert.equal(paperRenderWidth('pencil', 6), 6)
  assert.ok(paperStrokeId())
})

test('drawStrokePath：荧光笔单路径均匀半透明；铅笔逐段压感', () => {
  const highlighter = mockCtx()
  drawStrokePath(highlighter, stroke({ tool: 'highlighter' }), 100, 100)
  assert.equal(highlighter.calls.filter(name => name === 'beginPath').length, 1)
  assert.equal(highlighter.calls.filter(name => name === 'stroke').length, 1)
  assert.equal(highlighter.globalAlpha, 0.3)
  assert.equal(highlighter.lineWidth, 15)
  assert.equal(highlighter.strokeStyle, '#ff8a3d')

  const pencil = mockCtx()
  drawStrokePath(pencil, stroke({ tool: 'pencil', points: [[0, 0], [0.5, 0], [1, 0]] }), 100, 100)
  assert.equal(pencil.calls.filter(name => name === 'beginPath').length, 2)
  assert.equal(pencil.calls.filter(name => name === 'stroke').length, 2)
  assert.equal(pencil.globalAlpha, 0.92)
  assert.ok(pencil.lineWidth > 0)

  const dot = mockCtx()
  drawStrokePath(dot, stroke({ points: [[0.5, 0.5]] }), 100, 100)
  assert.equal(dot.calls.filter(name => name === 'fill').length, 1)
  assert.equal(dot.calls.filter(name => name === 'stroke').length, 0)

  const segment = mockCtx()
  drawStrokeSegment(segment, stroke({ points: [[0, 0], [0.5, 0.5]] }), 1, 100, 100)
  assert.equal(segment.calls.filter(name => name === 'stroke').length, 1)
  assert.equal(segment.lineWidth, strokeSegmentWidth('marker', 6, Math.hypot(0.5 * 100, 0.5 * 100)))
  // 荧光笔不走增量段（实时用整笔重绘保持透明度均匀）
  const flat = mockCtx()
  drawStrokeSegment(flat, stroke({ tool: 'highlighter', points: [[0, 0], [0.5, 0.5]] }), 1, 100, 100)
  assert.equal(flat.calls.length, 0)
})

test('橡皮命中：只命中线段附近的笔迹，阈值含笔迹半宽', () => {
  const thick = stroke({ id: 'thick', size: 14, points: [[0.2, 0.5], [0.8, 0.5]] })
  const thin = stroke({ id: 'thin', size: 3, color: '#3e6b4f', points: [[0.2, 0.2], [0.8, 0.2]] })
  const far = stroke({ id: 'far', points: [[0.1, 0.95], [0.9, 0.95]] })
  const hits = eraserHits([thick, thin, far], 0.5, 0.5, 10, 100, 100)
  assert.deepEqual(hits, ['thick'])
  assert.equal(eraserHits([thick, thin, far], 0.5, 0.33, 8, 100, 100).length, 0)
  assert.deepEqual(eraserHits([thick, thin, far], 0.5, 0.26, 8, 100, 100), ['thin'])
  const dot = stroke({ id: 'dot', points: [[0.5, 0.5]] })
  assert.deepEqual(eraserHits([dot], 0.51, 0.51, 10, 100, 100), ['dot'])
})

test('命令栈：落笔→撤销→重做全程可用', () => {
  let state = emptyPaperLayer()
  const a = stroke({ id: 'a' })
  const b = stroke({ id: 'b', color: '#3e6b4f' })
  state = commitStroke(state, a)
  state = commitStroke(state, b)
  assert.equal(state.strokes.length, 2)
  assert.equal(state.undo.length, 2)
  assert.equal(state.redo.length, 0)
  state = undoPaper(state)
  assert.deepEqual(state.strokes.map(item => item.id), ['a'])
  assert.equal(state.redo.length, 1)
  state = undoPaper(state)
  assert.equal(state.strokes.length, 0)
  state = redoPaper(state)
  assert.deepEqual(state.strokes.map(item => item.id), ['a'])
  state = redoPaper(state)
  assert.deepEqual(state.strokes.map(item => item.id), ['a', 'b'])
  assert.equal(redoPaper(state), state)
  assert.deepEqual(undoPaper(emptyPaperLayer()), emptyPaperLayer())
  // 新笔画清空重做分支
  state = commitStroke(state, stroke({ id: 'c' }))
  assert.equal(state.redo.length, 0)
  assert.equal(state.strokes.length, 3)
})

test('橡皮命令栈：一次手势擦多笔，撤销按原顺序插回', () => {
  let state = emptyPaperLayer()
  for (const id of ['a', 'b', 'c', 'd']) state = commitStroke(state, stroke({ id, color: '#3e6b4f' }))
  const removed = state.strokes.filter(item => ['b', 'd'].includes(item.id))
  state = commitErase(state, removed)
  assert.deepEqual(state.strokes.map(item => item.id), ['a', 'c'])
  state = undoPaper(state)
  assert.deepEqual(state.strokes.map(item => item.id), ['a', 'b', 'c', 'd'])
  state = redoPaper(state)
  assert.deepEqual(state.strokes.map(item => item.id), ['a', 'c'])
  assert.equal(commitErase(state, [stroke({ id: 'missing' })]), state)
})

test('上限保护：笔迹数与历史深度封顶', () => {
  let state = emptyPaperLayer()
  for (let i = 0; i < MAX_PAPER_STROKES + 10; i++) state = commitStroke(state, stroke({ id: 's' + i }))
  assert.equal(state.strokes.length, MAX_PAPER_STROKES)
  assert.equal(state.undo.length, 50)
  const erased = commitErase(state, state.strokes.slice(0, 3))
  assert.equal(erased.strokes.length, MAX_PAPER_STROKES - 3)
  assert.equal(erased.undo.length, 50)
})
