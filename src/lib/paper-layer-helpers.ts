/**
 * 手账纸页彩笔 · 纯函数层（P1-05b TASK-E1）。
 * 笔迹数据结构、路径抽稀、橡皮命中判定、压感线宽、皮肤色板映射与
 * 撤销/重做命令栈全部在这里，零 import，供 Node --test 直接加载。
 * 颜色不随皮肤/深色模式改变（UX 总方案第 4 节），皮肤只影响「默认选中色」。
 */

export type PaperTool = 'pencil' | 'marker' | 'highlighter' | 'watercolor' | 'crayon'
/** 归一化坐标 [x, y] ∈ [0,1]，相对落笔时的纸页宽高，重开/换设备按比例还原。 */
export type PaperPoint = [number, number]

export interface PaperStroke {
  id: string
  tool: PaperTool
  color: string
  /** 笔迹名义粗细（滑杆 3–14px）；荧光笔渲染宽度按工具放大。 */
  size: number
  points: PaperPoint[]
}

export type PaperCommand =
  | { kind: 'add'; stroke: PaperStroke }
  | { kind: 'erase'; removed: Array<{ index: number; stroke: PaperStroke }> }

export interface PaperLayerState {
  strokes: PaperStroke[]
  undo: PaperCommand[]
  redo: PaperCommand[]
}

export interface PaperDrawContext {
  save(): void
  restore(): void
  beginPath(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  stroke(): void
  fill(): void
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void
  globalAlpha: number
  strokeStyle: string | CanvasGradient | CanvasPattern
  fillStyle: string | CanvasGradient | CanvasPattern
  lineWidth: number
  lineCap: string
  lineJoin: string
}

export const PAPER_TOOLS: ReadonlyArray<{ id: PaperTool; label: string; hint?: string }> = [
  { id: 'pencil', label: '铅笔' },
  { id: 'marker', label: '马克笔' },
  { id: 'highlighter', label: '荧光笔' },
  { id: 'watercolor', label: '水彩笔', hint: '半透明晕染叠加' },
  { id: 'crayon', label: '蜡笔', hint: '粗颗粒质感' },
]

/** 预设色板 7 色（视觉规格定稿：森林绿/狐狸橙/蓝/红/黄/青/紫）。 */
export const PAPER_PRESET_COLORS: ReadonlyArray<string> = ['#3e6b4f', '#ff8a3d', '#5b8bd0', '#d9534f', '#e9c46a', '#4aa8a2', '#9a6fc0']
export const PAPER_COLOR_LABELS: Readonly<Record<string, string>> = {
  '#3e6b4f': '森林绿', '#ff8a3d': '狐狸橙', '#5b8bd0': '蓝', '#d9534f': '红',
  '#e9c46a': '黄', '#4aa8a2': '青', '#9a6fc0': '紫',
}

/** 各皮肤的默认选中色（13 套皮肤 + 未知回退森林绿）；用户改选后以用户为准。 */
const SKIN_PAPER_DEFAULT: Readonly<Record<string, string>> = {
  classic: '#3e6b4f', companion: '#3e6b4f', pure: '#3e6b4f', handdrawn: '#d9534f', ink: '#3e6b4f',
  fox: '#ff8a3d', cute: '#ff8a3d', minimal: '#5b8bd0', immersive: '#3e6b4f', bloom: '#d9534f',
  glass: '#5b8bd0', meadow: '#3e6b4f', night: '#4aa8a2',
}
const FALLBACK_COLOR = '#3e6b4f'

export const MIN_PAPER_SIZE = 3
export const MAX_PAPER_SIZE = 14
export const DEFAULT_PAPER_SIZE = 6
export const DEFAULT_PAPER_TOOL: PaperTool = 'marker'
export const PAPER_ERASER_RADIUS = 14
export const MAX_PAPER_STROKES = 200
export const MAX_STROKE_POINTS = 800
export const MAX_PAPER_HISTORY = 50

const PAPER_TOOL_ALPHA: Readonly<Record<PaperTool, number>> = { pencil: 0.92, marker: 0.9, highlighter: 0.3, watercolor: 0.45, crayon: 0.75 }
/** 荧光笔渲染宽度放大倍率（视觉规格：宽扁高亮带）。 */
const HIGHLIGHTER_WIDTH_RATIO = 2.5

export function paperColorLabel(color: string) {
  return PAPER_COLOR_LABELS[color] ?? '自定义色'
}

export function paletteForSkin(variant?: string | null): { colors: string[]; defaultColor: string } {
  const defaultColor = (variant && SKIN_PAPER_DEFAULT[variant]) || FALLBACK_COLOR
  return { colors: PAPER_PRESET_COLORS.slice(), defaultColor }
}

export function isPaperTool(value: unknown): value is PaperTool {
  return value === 'pencil' || value === 'marker' || value === 'highlighter' || value === 'watercolor' || value === 'crayon'
}

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

export function clampPaperSize(value: number) {
  return Number.isFinite(value) ? Math.min(MAX_PAPER_SIZE, Math.max(MIN_PAPER_SIZE, Math.round(value))) : DEFAULT_PAPER_SIZE
}

export function paperStrokeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

/** 荧光笔实际渲染宽度是滑杆值的放大；其余工具按滑杆值。 */
export function paperRenderWidth(tool: PaperTool, size: number) {
  return tool === 'highlighter' ? size * HIGHLIGHTER_WIDTH_RATIO : size
}

/**
 * 压感视觉（用户点名「落笔有压感」）：以段长近似笔速——慢笔重、快笔轻。
 * 由几何确定性推导，实时绘制与重开渲染/导出合成走同一函数，笔迹还原一致。
 */
export function strokeSegmentWidth(tool: PaperTool, size: number, segmentLengthPx: number) {
  if (tool === 'highlighter') return size * HIGHLIGHTER_WIDTH_RATIO
  const profile = tool === 'pencil' ? { gain: 1.28, drop: 22, min: 0.55 } : { gain: 1.12, drop: 34, min: 0.8 }
  const factor = Math.min(profile.gain, Math.max(profile.min, profile.gain - segmentLengthPx / profile.drop))
  return size * factor
}

function squareDistanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const span = dx * dx + dy * dy
  if (span <= 0) return (px - ax) * (px - ax) + (py - ay) * (py - ay)
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / span))
  const qx = ax + t * dx - px
  const qy = ay + t * dy - py
  return qx * qx + qy * qy
}

export function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  return Math.sqrt(squareDistanceToSegment(px, py, ax, ay, bx, by))
}

/** Ramer–Douglas–Peucker 抽稀：保留转折，丢掉密集抖动点；超上限时等距截断。 */
export function simplifyPath(points: PaperPoint[], tolerance = 0.002): PaperPoint[] {
  if (!Array.isArray(points) || points.length <= 2) return points.slice()
  const limit = Math.max(0, tolerance) * Math.max(0, tolerance)
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length) {
    const [start, end] = stack.pop()!
    const [ax, ay] = points[start]
    const [bx, by] = points[end]
    let farthest = -1
    let maxSquare = 0
    for (let i = start + 1; i < end; i++) {
      const [px, py] = points[i]
      const square = squareDistanceToSegment(px, py, ax, ay, bx, by)
      if (square > maxSquare) { maxSquare = square; farthest = i }
    }
    if (farthest > 0 && maxSquare > limit) {
      keep[farthest] = 1
      stack.push([start, farthest], [farthest, end])
    }
  }
  const kept = points.filter((_, index) => keep[index] === 1)
  if (kept.length <= MAX_STROKE_POINTS) return kept
  const step = (kept.length - 1) / (MAX_STROKE_POINTS - 1)
  const decimated: PaperPoint[] = []
  for (let i = 0; i < MAX_STROKE_POINTS - 1; i++) decimated.push(kept[Math.round(i * step)])
  decimated.push(kept[kept.length - 1])
  return decimated
}

function pointList(input: unknown): PaperPoint[] {
  if (!Array.isArray(input)) return []
  const points: PaperPoint[] = []
  for (const item of input) {
    if (!Array.isArray(item) || item.length < 2) continue
    const [x, y] = item
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) continue
    points.push([Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))])
    if (points.length >= MAX_STROKE_POINTS) break
  }
  return points
}

/** 本机库读取的笔迹一律先过这道校验（脏数据不进画布）。 */
export function normalizeStroke(input: unknown): PaperStroke | null {
  if (!input || typeof input !== 'object') return null
  const row = input as Record<string, unknown>
  const tool = isPaperTool(row.tool) ? row.tool : null
  const color = isHexColor(row.color) ? row.color : null
  const points = pointList(row.points)
  if (!tool || !color || !points.length) return null
  const size = clampPaperSize(typeof row.size === 'number' ? row.size : DEFAULT_PAPER_SIZE)
  const id = typeof row.id === 'string' && row.id ? row.id : paperStrokeId()
  return { id, tool, color, size, points }
}

export function normalizeStrokes(input: unknown): PaperStroke[] {
  if (!Array.isArray(input)) return []
  const strokes: PaperStroke[] = []
  for (const item of input) {
    const stroke = normalizeStroke(item)
    if (stroke) strokes.push(stroke)
    if (strokes.length >= MAX_PAPER_STROKES) break
  }
  return strokes
}

/** 橡皮命中判定：指针到任一线段的距离 ≤ 橡皮半径 + 笔迹半宽（荧光笔按渲染宽度）。 */
export function strokeHit(stroke: PaperStroke, x: number, y: number, radius: number, width: number, height: number) {
  const points = stroke.points
  if (!points.length) return false
  const threshold = radius + paperRenderWidth(stroke.tool, stroke.size) / 2
  const [x0, y0] = points[0]
  if (points.length === 1) return Math.hypot(x * width - x0 * width, y * height - y0 * height) <= threshold
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]
    const [bx, by] = points[i]
    if (distanceToSegment(x * width, y * height, ax * width, ay * height, bx * width, by * height) <= threshold) return true
  }
  return false
}

/** 一次橡皮手势内被命中的笔迹 id（保持存储顺序）。 */
export function eraserHits(strokes: PaperStroke[], x: number, y: number, radius: number, width: number, height: number) {
  return strokes.filter(stroke => strokeHit(stroke, x, y, radius, width, height)).map(stroke => stroke.id)
}

function dotPath(ctx: PaperDrawContext, stroke: PaperStroke, x: number, y: number) {
  ctx.beginPath()
  ctx.arc(x, y, Math.max(1, paperRenderWidth(stroke.tool, stroke.size) / 2 * 0.9), 0, Math.PI * 2)
  ctx.fillStyle = stroke.color
  ctx.fill()
}

/** 完整笔迹渲染：荧光笔单路径保证半透明均匀；铅笔/马克笔按压感逐段变宽。 */
export function drawStrokePath(ctx: PaperDrawContext, stroke: PaperStroke, width: number, height: number) {
  const points = stroke.points
  if (!points.length) return
  ctx.save()
  ctx.globalAlpha = PAPER_TOOL_ALPHA[stroke.tool]
  ctx.strokeStyle = stroke.color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const [x0, y0] = points[0]
  if (stroke.tool === 'highlighter' || stroke.tool === 'watercolor') {
    ctx.lineWidth = paperRenderWidth(stroke.tool, stroke.size)
    if (stroke.tool === 'watercolor') {
      // 水彩：主笔触 + 两条偏移淡色副笔触模拟晕染
      const jitter = Math.max(2, ctx.lineWidth * 0.18)
      for (const [dx, dy, alpha] of [[0, 0, 0.45], [jitter, -jitter * 0.6, 0.22], [-jitter, jitter * 0.5, 0.18]]) {
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.beginPath()
        ctx.moveTo(x0 * width + dx, y0 * height + dy)
        if (points.length === 1) ctx.lineTo(x0 * width + dx + 1, y0 * height + dy)
        else for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0] * width + dx, points[i][1] * height + dy)
        ctx.stroke()
        ctx.restore()
      }
      return
    }
    if (points.length === 1) {
      dotPath(ctx, stroke, x0 * width, y0 * height)
    } else {
      ctx.beginPath()
      ctx.moveTo(x0 * width, y0 * height)
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0] * width, points[i][1] * height)
      ctx.stroke()
    }
  } else if (stroke.tool === 'crayon') {
    // 蜡笔：线段分小步，每步随机微抖动模拟颗粒
    ctx.lineWidth = paperRenderWidth(stroke.tool, stroke.size)
    if (points.length === 1) {
      dotPath(ctx, stroke, x0 * width, y0 * height)
    } else {
      let seed = stroke.points.length + stroke.color.length
      const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280 - 0.5 }
      ctx.beginPath()
      ctx.moveTo(x0 * width, y0 * height)
      for (let i = 1; i < points.length; i++) {
        const [px, py] = points[i - 1]
        const [nx, ny] = points[i]
        const steps = Math.max(2, Math.round(Math.hypot(nx - px, ny - py) * 12))
        for (let k = 1; k <= steps; k++) {
          const ix = px + (nx - px) * k / steps + rnd() * 0.004
          const iy = py + (ny - py) * k / steps + rnd() * 0.004
          ctx.lineTo(ix * width, iy * height)
        }
      }
      ctx.stroke()
    }
  } else if (points.length === 1) {
    dotPath(ctx, stroke, x0 * width, y0 * height)
  } else {
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1]
      const [bx, by] = points[i]
      const segment = Math.hypot((bx - ax) * width, (by - ay) * height)
      ctx.beginPath()
      ctx.moveTo(ax * width, ay * height)
      ctx.lineTo(bx * width, by * height)
      ctx.lineWidth = strokeSegmentWidth(stroke.tool, stroke.size, segment)
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** 实时落笔的增量段：与 drawStrokePath 同一套宽度函数，抬笔后还原一致。 */
export function drawStrokeSegment(ctx: PaperDrawContext, stroke: PaperStroke, index: number, width: number, height: number) {
  const points = stroke.points
  if (!points.length || index < 0 || index >= points.length || stroke.tool === 'highlighter') return
  ctx.save()
  ctx.globalAlpha = PAPER_TOOL_ALPHA[stroke.tool]
  ctx.strokeStyle = stroke.color
  ctx.fillStyle = stroke.color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const [x, y] = points[index]
  if (index === 0) {
    dotPath(ctx, stroke, x * width, y * height)
  } else {
    const [ax, ay] = points[index - 1]
    const segment = Math.hypot((x - ax) * width, (y - ay) * height)
    ctx.beginPath()
    ctx.moveTo(ax * width, ay * height)
    ctx.lineTo(x * width, y * height)
    ctx.lineWidth = strokeSegmentWidth(stroke.tool, stroke.size, segment)
    ctx.stroke()
  }
  ctx.restore()
}

export function emptyPaperLayer(): PaperLayerState {
  return { strokes: [], undo: [], redo: [] }
}

function trimHistory(history: PaperCommand[]) {
  return history.length > MAX_PAPER_HISTORY ? history.slice(history.length - MAX_PAPER_HISTORY) : history
}

/** 提交一笔：抽稀在组件侧完成后走这里（校验+上限+入栈清空重做）。 */
export function commitStroke(state: PaperLayerState, input: PaperStroke): PaperLayerState {
  const stroke = normalizeStroke(input)
  if (!stroke) return state
  const strokes = state.strokes.length >= MAX_PAPER_STROKES
    ? state.strokes.slice(state.strokes.length - MAX_PAPER_STROKES + 1)
    : state.strokes
  return { strokes: [...strokes, stroke], undo: trimHistory([...state.undo, { kind: 'add', stroke }]), redo: [] }
}

/** 提交一次橡皮手势（可一次擦多笔，整段计一次撤销）。 */
export function commitErase(state: PaperLayerState, removed: PaperStroke[]): PaperLayerState {
  const targets = new Set(removed.map(stroke => stroke.id))
  if (!targets.size) return state
  const entries: Array<{ index: number; stroke: PaperStroke }> = []
  state.strokes.forEach((stroke, index) => {
    if (targets.has(stroke.id)) entries.push({ index, stroke })
  })
  if (!entries.length) return state
  return {
    strokes: state.strokes.filter(stroke => !targets.has(stroke.id)),
    undo: trimHistory([...state.undo, { kind: 'erase', removed: entries }]),
    redo: [],
  }
}

function insertRemoved(strokes: PaperStroke[], removed: Array<{ index: number; stroke: PaperStroke }>) {
  const next = strokes.slice()
  for (const { index, stroke } of [...removed].sort((a, b) => a.index - b.index)) {
    next.splice(Math.min(Math.max(0, index), next.length), 0, stroke)
  }
  return next
}

function removeIds(strokes: PaperStroke[], ids: ReadonlySet<string>) {
  return strokes.filter(stroke => !ids.has(stroke.id))
}

export function undoPaper(state: PaperLayerState): PaperLayerState {
  const command = state.undo[state.undo.length - 1]
  if (!command) return state
  if (command.kind === 'add') {
    return {
      strokes: removeIds(state.strokes, new Set([command.stroke.id])),
      undo: state.undo.slice(0, -1),
      redo: trimHistory([...state.redo, command]),
    }
  }
  return {
    strokes: insertRemoved(state.strokes, command.removed),
    undo: state.undo.slice(0, -1),
    redo: trimHistory([...state.redo, command]),
  }
}

export function redoPaper(state: PaperLayerState): PaperLayerState {
  const command = state.redo[state.redo.length - 1]
  if (!command) return state
  if (command.kind === 'add') {
    return {
      strokes: [...state.strokes, command.stroke],
      undo: trimHistory([...state.undo, command]),
      redo: state.redo.slice(0, -1),
    }
  }
  const ids = new Set(command.removed.map(({ stroke }) => stroke.id))
  return {
    strokes: removeIds(state.strokes, ids),
    undo: trimHistory([...state.undo, command]),
    redo: state.redo.slice(0, -1),
  }
}


/** 画笔渲染参数：线宽倍率与透明度（水彩半透明叠层，蜡笔颗粒抖动）。 */
export function paperToolRender(tool: PaperTool): { widthScale: number; alpha: number } {
  if (tool === 'highlighter') return { widthScale: 2.4, alpha: 0.3 }
  if (tool === 'watercolor') return { widthScale: 1.8, alpha: 0.45 }
  if (tool === 'crayon') return { widthScale: 1.6, alpha: 0.75 }
  return { widthScale: 1, alpha: 1 }
}


/** 纸张材质：默认米白（皮肤令牌）/ 牛皮纸 / 白画纸。 */
export type PaperMaterial = 'default' | 'kraft' | 'sketch'
export const PAPER_MATERIALS: ReadonlyArray<{ id: PaperMaterial; label: string; bg: string }> = [
  { id: 'default', label: '米白纸', bg: '' },
  { id: 'kraft', label: '牛皮纸', bg: '#c8a878' },
  { id: 'sketch', label: '白画纸', bg: '#ffffff' },
]
export function paperMaterialBg(material: PaperMaterial): string {
  return PAPER_MATERIALS.find(m => m.id === material)?.bg ?? ''
}
