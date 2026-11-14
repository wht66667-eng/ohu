import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import {
  DEFAULT_PAPER_SIZE, DEFAULT_PAPER_TOOL, MAX_PAPER_SIZE, MIN_PAPER_SIZE, PAPER_ERASER_RADIUS, PAPER_TOOLS,
  clampPaperSize, commitErase, commitStroke, drawStrokePath, drawStrokeSegment, eraserHits, isHexColor, paletteForSkin,
  paperColorLabel, paperStrokeId, redoPaper, simplifyPath, undoPaper,
  type PaperLayerState, type PaperPoint, type PaperStroke, type PaperTool,
} from '../lib/paper-layer-helpers'
import styles from './PaperPenBox.module.css'

/**
 * 手账纸页彩笔笔框（P1-05b TASK-E2，用户指定交互形态）：
 * 纸页右下角「彩笔」笔盒按钮 → 上方弹出浮层（笔类/颜色/粗细/橡皮）→
 * 选中即收框进入绘画模式；撤销/重做在笔盒外部左下角全程可用。
 * 默认触摸用于滚动（浮层关闭时画布不拦截指针），绘画模式下才落笔；
 * 荧光笔整笔重绘保持半透明均匀，铅笔/马克笔增量段呈现压感线宽。
 */
export interface PaperPenBoxProps {
  entryId: string
  /** 当前已提交笔迹与撤销/重做命令栈（宿主页面持有并负责持久化）。 */
  layer: PaperLayerState
  onLayer: (next: PaperLayerState) => void
  /** 纸页元素引用：画布按它的盒子取尺寸。 */
  hostRef: RefObject<HTMLElement | null>
}

interface PaperGesture {
  stroke: PaperStroke | null
  removed: PaperStroke[]
  pointerId: number
  width: number
}

type ViewBox = { w: number; h: number; dpr: number }

const ICONS: Readonly<Record<string, string[]>> = {
  pencil: ['M4 20l1-4L16 5l3 3L8 19l-4 1z', 'M13.5 7.5l3 3'],
  marker: ['M12 3l4 4-1.5 10h-5L8 7l4-4z', 'M10.5 17l1.5 4 1.5-4'],
  highlighter: ['M5 16h10l4-4-3-3-11 7z', 'M6 20h9'],
  watercolor: ['M6 20c0-6 3-12 8-14l4 4c-2 5-8 10-12 10z', 'M14 6l4 4'],
  crayon: ['M4 20l2-6L16 4l4 4L10 18l-6 2z', 'M6 14l4 4'],
  eraser: ['M7 17l-3-3a1.4 1.4 0 0 1 0-2l7-7a1.4 1.4 0 0 1 2 0l4 4a1.4 1.4 0 0 1 0 2l-6 6H7z', 'M5 21h14'],
  undo: ['M4 9h9a5 5 0 0 1 0 10H9', 'M8 5L4 9l4 4'],
  redo: ['M20 9h-9a5 5 0 0 0 0 10h4', 'M16 5l4 4-4 4'],
}

function Icon({ name, size = 20 }: { name: keyof typeof ICONS & string; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {ICONS[name].map(path => <path key={path} d={path} />)}
  </svg>
}

function skinVariant() {
  if (typeof document === 'undefined') return null
  return document.documentElement.dataset.uiVariant ?? null
}

function paperPoint(clientX: number, clientY: number, rect: DOMRect): PaperPoint {
  return [
    Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
    Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
  ]
}

export function PaperPenBox({ entryId, layer, onLayer, hostRef }: PaperPenBoxProps) {
  const baseRef = useRef<HTMLCanvasElement>(null)
  const liveRef = useRef<HTMLCanvasElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const viewRef = useRef<ViewBox>({ w: 0, h: 0, dpr: 1 })
  const gestureRef = useRef<PaperGesture | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(false)
  const [tool, setTool] = useState<PaperTool>(DEFAULT_PAPER_TOOL)
  const [eraser, setEraser] = useState(false)
  const [color, setColor] = useState(paletteForSkin(skinVariant()).defaultColor)
  const [size, setSize] = useState(DEFAULT_PAPER_SIZE)
  const [announce, setAnnounce] = useState('')
  const palette = paletteForSkin(skinVariant())

  function redraw(exclude?: ReadonlySet<string>) {
    const ctx = baseRef.current?.getContext('2d')
    const view = viewRef.current
    if (!ctx || !view.w) return
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
    ctx.clearRect(0, 0, view.w, view.h)
    for (const stroke of layer.strokes) {
      if (exclude?.has(stroke.id)) continue
      drawStrokePath(ctx, stroke, view.w, view.h)
    }
  }
  const redrawRef = useRef(redraw)
  redrawRef.current = redraw

  function clearLive() {
    const ctx = liveRef.current?.getContext('2d')
    const view = viewRef.current
    if (!ctx || !view.w) return
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
    ctx.clearRect(0, 0, view.w, view.h)
  }

  /** 画布尺寸跟随纸页盒子（含 textarea 拖高/换皮肤），归一化笔迹按比例还原。 */
  useEffect(() => {
    const host = hostRef.current
    const base = baseRef.current
    const live = liveRef.current
    if (!host || !base || !live) return
    const resize = () => {
      const rect = host.getBoundingClientRect()
      if (rect.width < 4 || rect.height < 4) return
      const dpr = Math.min(3, window.devicePixelRatio || 1)
      viewRef.current = { w: rect.width, h: rect.height, dpr }
      for (const canvas of [base, live]) {
        canvas.width = Math.round(rect.width * dpr)
        canvas.height = Math.round(rect.height * dpr)
      }
      redrawRef.current()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    return () => observer.disconnect()
  }, [hostRef])

  useEffect(() => { redrawRef.current() }, [layer.strokes, entryId])

  // 点开笔框后，点外面（含纸面）先收框。
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])

  function startDrawing(message: string) {
    setOpen(false)
    setActive(true)
    setAnnounce(message)
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }
  function pickTool(next: PaperTool) {
    setTool(next)
    setEraser(false)
    startDrawing(`绘画模式：${PAPER_TOOLS.find(item => item.id === next)?.label ?? ''}`)
  }
  function pickColor(next: string) {
    setColor(next)
    setEraser(false)
    startDrawing(`绘画模式：${paperColorLabel(next)}`)
  }
  function pickEraser() {
    setEraser(true)
    startDrawing('擦除模式：橡皮擦只擦除笔迹')
  }
  function exitDrawing() {
    setActive(false)
    setOpen(false)
    setAnnounce('已退出绘画模式，恢复滚动')
  }

  function moveRing(event: ReactPointerEvent) {
    const ring = ringRef.current
    const host = hostRef.current
    if (!ring || !host) return
    const rect = host.getBoundingClientRect()
    ring.style.transform = `translate(${event.clientX - rect.left}px, ${event.clientY - rect.top}px)`
  }

  function eraseAt(point: PaperPoint, rect: DOMRect) {
    const gesture = gestureRef.current
    if (!gesture) return
    const ids = eraserHits(layer.strokes, point[0], point[1], PAPER_ERASER_RADIUS, rect.width, rect.height)
    const known = new Set(gesture.removed.map(stroke => stroke.id))
    const fresh = layer.strokes.filter(stroke => ids.includes(stroke.id) && !known.has(stroke.id))
    if (!fresh.length) return
    gesture.removed.push(...fresh)
    redrawRef.current(new Set(gesture.removed.map(stroke => stroke.id)))
  }

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!active) return
    if (open) { setOpen(false); return }
    const canvas = liveRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width < 4) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = paperPoint(event.clientX, event.clientY, rect)
    if (eraser) {
      gestureRef.current = { stroke: null, removed: [], pointerId: event.pointerId, width: rect.width }
      eraseAt(point, rect)
      return
    }
    const stroke: PaperStroke = { id: paperStrokeId(), tool, color, size, points: [point] }
    gestureRef.current = { stroke, removed: [], pointerId: event.pointerId, width: rect.width }
    const ctx = canvas.getContext('2d')
    const view = viewRef.current
    if (ctx && view.w) {
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
      drawStrokeSegment(ctx, stroke, 0, rect.width, rect.height)
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (eraser) moveRing(event)
    const gesture = gestureRef.current
    if (!gesture || event.pointerId !== gesture.pointerId) return
    const canvas = liveRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width < 4) return
    const native = event.nativeEvent
    const samples = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : []
    const points = (samples.length ? samples : [native]).map(sample => paperPoint(sample.clientX, sample.clientY, rect))
    const view = viewRef.current
    const liveCtx = canvas.getContext('2d')
    for (const point of points) {
      if (gesture.stroke) {
        const stroke = gesture.stroke
        const [lastX, lastY] = stroke.points[stroke.points.length - 1]
        if (Math.hypot((point[0] - lastX) * rect.width, (point[1] - lastY) * rect.height) < 1.4) continue
        // 画布中途被改变尺寸（旋转/拖高）时整笔重绘，保持增量段与全量渲染一致。
        const resized = gesture.width !== rect.width
        gesture.width = rect.width
        stroke.points.push(point)
        if (!liveCtx || !view.w) continue
        liveCtx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
        if (stroke.tool === 'highlighter' || stroke.tool === 'watercolor' || stroke.tool === 'crayon') {
          liveCtx.clearRect(0, 0, view.w, view.h)
          drawStrokePath(liveCtx, stroke, rect.width, rect.height)
        } else if (resized) {
          liveCtx.clearRect(0, 0, view.w, view.h)
          drawStrokePath(liveCtx, stroke, rect.width, rect.height)
        } else {
          drawStrokeSegment(liveCtx, stroke, stroke.points.length - 1, rect.width, rect.height)
        }
      } else {
        eraseAt(point, rect)
      }
    }
  }

  function endGesture(event: ReactPointerEvent<HTMLCanvasElement>) {
    const gesture = gestureRef.current
    if (!gesture || event.pointerId !== gesture.pointerId) return
    gestureRef.current = null
    if (gesture.stroke) {
      const stroke = { ...gesture.stroke, points: simplifyPath(gesture.stroke.points) }
      gesture.stroke = null
      clearLive()
      if (stroke.points.length) onLayer(commitStroke(layer, stroke))
    } else if (gesture.removed.length) {
      onLayer(commitErase(layer, gesture.removed))
    }
  }

  return <>
    <div className={styles.stage} data-active={active ? '' : undefined} data-eraser={eraser ? '' : undefined}>
      <canvas ref={baseRef} className={styles.ink} role="img" aria-label="手账纸页笔迹" />
      <canvas ref={liveRef} className={styles.inkLive} aria-hidden="true"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={endGesture} onPointerCancel={endGesture} />
      {active && eraser ? <div ref={ringRef} className={styles.eraserRing} /> : null}
    </div>
    {active ? <button type="button" className={styles.badge} onClick={exitDrawing} aria-label="退出绘画模式，恢复滚动">✏ 绘画中</button> : null}
    <div className={styles.history}>
      <button type="button" className={styles.round} disabled={!layer.undo.length} onClick={() => onLayer(undoPaper(layer))} aria-label="撤销上一笔"><Icon name="undo" /></button>
      <button type="button" className={styles.round} disabled={!layer.redo.length} onClick={() => onLayer(redoPaper(layer))} aria-label="重做上一笔"><Icon name="redo" /></button>
    </div>
    <div className={styles.dock}>
      {open ? <div ref={popoverRef} className={styles.box} role="dialog" aria-label="彩笔笔盒" onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}>
        <div className={styles.tools} role="group" aria-label="笔类">
          {PAPER_TOOLS.map(item => <button type="button" key={item.id} className={styles.pen} aria-pressed={!eraser && tool === item.id}
            onClick={() => pickTool(item.id)}><Icon name={item.id} /><span>{item.label}</span></button>)}
        </div>
        <div className={styles.colors} role="group" aria-label="颜色">
          {palette.colors.map(value => <button type="button" key={value} className={styles.dot}
            style={{ background: value, color: value }} aria-label={paperColorLabel(value)}
            aria-pressed={!eraser && color === value} onClick={() => pickColor(value)} />)}
          <label className={styles.custom} aria-label="自定义颜色">
            <input type="color" value={isHexColor(color) ? color : '#ff8a3d'} onChange={event => pickColor(event.target.value)} />
            <span aria-hidden="true">＋</span>
          </label>
        </div>
        <div className={styles.sizeRow}>
          <span id="paper-pen-size">粗细</span>
          <input type="range" className={styles.slider} min={MIN_PAPER_SIZE} max={MAX_PAPER_SIZE} step={1} value={size}
            aria-labelledby="paper-pen-size" onChange={event => setSize(clampPaperSize(Number(event.target.value)))} />
          <output>{size}px</output>
        </div>
        <button type="button" className={styles.eraser} aria-pressed={eraser} onClick={pickEraser}><Icon name="eraser" size={18} />橡皮擦</button>
      </div> : null}
      <button type="button" ref={triggerRef} className={styles.trigger} data-drawing={active ? '' : undefined}
        aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(value => !value)}>
        <Icon name="pencil" size={18} />彩笔
      </button>
    </div>
    <span role="status" className={styles.sr}>{announce}</span>
  </>
}

/** 翻阅日记等只读纸页的笔迹还原层（TASK-E3 重开一致）。 */
export function PaperStrokesView({ strokes }: { strokes: PaperStroke[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    if (!host || !canvas) return
    const draw = () => {
      const rect = host.getBoundingClientRect()
      if (rect.width < 4 || rect.height < 4) return
      const dpr = Math.min(3, window.devicePixelRatio || 1)
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, rect.width, rect.height)
      for (const stroke of strokes) drawStrokePath(ctx, stroke, rect.width, rect.height)
    }
    draw()
    const observer = new ResizeObserver(draw)
    observer.observe(host)
    return () => observer.disconnect()
  }, [strokes])
  return <div ref={hostRef} className={styles.strokeHost} aria-hidden="true"><canvas ref={canvasRef} /></div>
}
