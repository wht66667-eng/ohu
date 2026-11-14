import { useEffect, useRef, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import { Canvas, FabricImage, IText, PencilBrush, type FabricObject } from 'fabric'
import { ComposerKeyboard } from '../../components/ComposerKeyboard'
import { FOX_V1_STICKERS, foxV1StickerUrl } from '../../lib/fox-v1-assets'
import { DialogLayer } from '../../components/ui/DialogLayer'
import { canvasPhotoFile, loadMomentImage, normalizeMomentPhoto, photoCanvas } from '../../lib/moment-photo'
import { STICKER_EDGES, stickerEdgeCanvas, type StickerEdge } from '../../lib/photo-sticker'
import { listLocalStickers, deleteLocalSticker, saveLocalSticker, LOCAL_STICKERS_CHANGED_EVENT, type LocalSticker } from '../../lib/local-stickers'
import { PHOTO_PRESETS, lifeRecordId, type LifeRecordPhoto } from '../../lib/life-records'
import { cropStickerFavorite } from '../../lib/sticker-favorite'
import { CAMPUS_FILTERS, DEFAULT_PHOTO_ADJUSTMENTS, type CampusFilter, type PhotoTone, type PhotoFilter, type PhotoQuality, type QualityMode, type PhotoAdjustments } from '../../lib/moment-photo-quality'
import { MOMENT_FONTS, loadMomentFont, loadSnapshotFonts } from '../../lib/moment-fonts'
import styles from './MomentPhotoEditor.module.css'

export interface MomentEditState { json: string; width: number; height: number; base: string }
type Tool = 'select' | 'draw' | 'text' | 'sticker' | 'quality' | 'layers' | 'mosaic'
const ADJUSTMENTS: Array<[keyof PhotoAdjustments, string, number, number, number]> = [['exposure', '曝光', -2, 2, .1], ['brightness', '亮度', -50, 50, 1], ['contrast', '对比度', -50, 50, 1], ['saturation', '饱和度', 0, 200, 1], ['temperature', '色温', -50, 50, 1], ['gamma', '伽马', 50, 200, 5], ['vignette', '暗角', 0, 100, 1]]
const NEUTRAL_TONE: PhotoTone = { version: 2, shadows: 0, highlights: 0, tint: 0, midtone: 0 }
const TONE_CONTROLS = [['shadows', '阴影'], ['highlights', '高光'], ['tint', '绿／洋红色偏'], ['midtone', '中间调']] as const
const COLORS = ['#ffffff', '#151515', '#ff5353', '#ffcc35', '#07c160', '#58b7ff', '#ac8bfa']
const STICKERS = [['heart', '绿心'], ['sparkles', '闪光'], ['sun', '太阳'], ['flower', '樱花'], ['party', '庆祝'], ['cat', '猫咪'], ['coffee', '咖啡'], ['book', '书本'], ['star', '星星'], ['thumb', '赞'], ['rainbow', '彩虹'], ['smile', '笑脸']] as const
const EMOJIS = ['✨', '❤️', '🌸', '🎉', '😂', '☀️', '🌿', '💚']

/** 深色本机编辑器：几何变换与对象层分离，裁剪/旋转合并图层后仍可撤销。 */
export function MomentPhotoEditor({ owner, file, initialState, availableFiles, startWithFilters = false, onClose, onSave }: {
  owner: string; startWithFilters?: boolean; file: File; initialState?: MomentEditState; availableFiles: File[]; onClose: () => void
  onSave: (file: File, state: MomentEditState) => void
}) {
  const element = useRef<HTMLCanvasElement>(null), host = useRef<HTMLDivElement>(null)
  const canvas = useRef<Canvas | null>(null), base = useRef(''), original = useRef('')
  const active = useRef(true), locked = useRef(false), worker = useRef<Worker | null>(null)
  const history = useRef<MomentEditState[]>([]), cursor = useRef(-1)
  const [position, setPosition] = useState({ index: -1, total: 0 })
  const [processing, setProcessing] = useState(false)
  const [cropRatio, setCropRatio] = useState(1)
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [tool, setTool] = useState<Tool>(startWithFilters ? 'quality' : 'select'), [color, setColor] = useState('#ffffff'), [brushSize, setBrushSize] = useState(10)
  const [fontFamily, setFontFamily] = useState('sans-serif'), [fontLoading, setFontLoading] = useState(false)
  const [layers, setLayers] = useState<Array<{ index: number; label: string; visible: boolean; opacity: number; blend: GlobalCompositeOperation }>>([])
  const [viewSize, setViewSize] = useState({ width: 1, height: 1 })
  const [mosaicArea, setMosaicArea] = useState<Area | null>(null), [mosaicSize, setMosaicSize] = useState(16)
  const mosaicStart = useRef<{ x: number; y: number } | null>(null)
  const [status, setStatus] = useState('')
  const [text, setText] = useState(''), [selected, setSelected] = useState(false), [comparing, setComparing] = useState(false)
  const [quality, setQuality] = useState<PhotoQuality>({ mode: 'none', strength: 35, filter: 'none', adjustments: { ...DEFAULT_PHOTO_ADJUSTMENTS } })
  const [cropSource, setCropSource] = useState<{ src: string; sticker: boolean } | null>(null)
  const [stickerEdge, setStickerEdge] = useState<StickerEdge>('none')
  const [crop, setCrop] = useState({ x: 0, y: 0 }), [zoom, setZoom] = useState(1)
  const [aspect, setAspect] = useState<number | undefined>(), [area, setArea] = useState<Area | null>(null)
  const photoText = useRef<HTMLInputElement>(null)
  const stickerInput = useRef<HTMLInputElement>(null)
  const [collection, setCollection] = useState<LocalSticker[] | null>(null)
  const [collectionError, setCollectionError] = useState('')
  const [collectionRevision, setCollectionRevision] = useState(0)
  const [removingSticker, setRemovingSticker] = useState('')
  // 上一张裁切贴纸：只留在本机内存里，等用户显式收藏；关闭编辑器或收藏成功即清除。
  const [lastSticker, setLastSticker] = useState<LifeRecordPhoto | null>(null)
  const [collectingSticker, setCollectingSticker] = useState(false)

  useEffect(() => {
    if (tool !== 'sticker') return
    let disposed = false, request = 0
    const load = () => {
      const current = ++request
      void listLocalStickers(owner).then(rows => {
        if (!disposed && current === request) { setCollection(rows); setCollectionError('') }
      }, () => {
        if (!disposed && current === request) setCollectionError('本机贴纸读取失败，请重试。')
      })
    }
    const changed = (event: Event) => {
      if ((event as CustomEvent<{ owner: string }>).detail?.owner === owner) load()
    }
    load()
    window.addEventListener(LOCAL_STICKERS_CHANGED_EVENT, changed)
    return () => { disposed = true; window.removeEventListener(LOCAL_STICKERS_CHANGED_EVENT, changed) }
  }, [owner, tool, collectionRevision])

  /** 画布始终保留逻辑像素，仅缩小CSS尺寸；导出和触控坐标使用同一坐标系。 */
  function fit() {
    const c = canvas.current, bounds = host.current?.getBoundingClientRect()
    if (!c || !bounds) return
    const scale = Math.min((bounds.width - 16) / c.width, (bounds.height - 16) / c.height, 1)
    c.setDimensions({ width: Math.max(1, c.width * scale), height: Math.max(1, c.height * scale) }, { cssOnly: true })
    setViewSize({ width: Math.max(1, c.width * scale), height: Math.max(1, c.height * scale) })
    c.calcOffset(); c.requestRenderAll()
  }
  function snapshot(): MomentEditState {
    const c = canvas.current!
    return { json: JSON.stringify(c.toJSON()), width: c.width, height: c.height, base: base.current }
  }
  function refreshLayers() {
    const c = canvas.current; if (!c || !active.current) return
    setLayers(c.getObjects().map((object, index) => ({ index, label: object instanceof IText ? object.text.slice(0, 10) || '文字' : object.type.toLowerCase() === 'path' ? '涂鸦' : '图片 / 马赛克', visible: object.visible, opacity: object.opacity, blend: object.globalCompositeOperation })))
  }
  function remember() {
    if (!active.current || !canvas.current || locked.current) return
    refreshLayers()
    const state = snapshot(), previous = history.current[cursor.current]
    if (previous?.json === state.json && previous.width === state.width && previous.height === state.height) return
    history.current = [...history.current.slice(0, cursor.current + 1), state]
    // 大图历史按条数与编码字节双重约束，不随操作无限增长。
    while (history.current.length > 12 || (history.current.length > 1 && history.current.reduce((n, item) => n + item.json.length + item.base.length, 0) > 16_000_000)) history.current.shift()
    cursor.current = history.current.length - 1; setPosition({ index: cursor.current, total: history.current.length })
  }
  async function changeBase(src: string, clear = true) {
    const c = canvas.current!, image = await FabricImage.fromURL(src)
    if (!active.current) return
    if (clear) c.remove(...c.getObjects())
    image.set({ selectable: false, evented: false, left: 0, top: 0, originX: 'left', originY: 'top' })
    c.setDimensions({ width: image.width, height: image.height }); c.backgroundImage = image
    base.current = src; fit()
  }
  async function restore(state: MomentEditState) {
    const c = canvas.current!
    await loadSnapshotFonts(state.json)
    if (!active.current) return
    await c.loadFromJSON(state.json)
    if (!active.current) return
    c.setDimensions({ width: state.width, height: state.height }); base.current = state.base
    setSelected(false); refreshLayers(); fit()
  }
  useEffect(() => {
    active.current = true
    const c = new Canvas(element.current!, { backgroundColor: '#fff', preserveObjectStacking: true, enableRetinaScaling: false })
    canvas.current = c
    const observer = new ResizeObserver(fit); if (host.current) observer.observe(host.current)
    const changed = () => remember()
    const selection = () => { if (active.current) setSelected(!!c.getActiveObject()); refreshLayers() }
    c.on('object:modified', changed)
    c.on('path:created', ({ path }) => {
      if (c.getObjects().length > 40) { c.remove(path); if (active.current) setError('每张图片最多40个对象，请先删除一些。') }
      else remember()
    })
    c.on('text:changed', ({ target }) => { if (target.text.length > 120) target.set('text', target.text.slice(0, 120)) })
    c.on('text:editing:exited', changed)
    c.on('selection:created', selection); c.on('selection:updated', selection); c.on('selection:cleared', selection)
    locked.current = true
    void normalizeMomentPhoto(file).then(async normalized => {
      const url = URL.createObjectURL(normalized)
      try {
        const image = await loadMomentImage(url)
        const src = photoCanvas(image.naturalWidth, image.naturalHeight)
        src.getContext('2d')!.drawImage(image, 0, 0); original.current = src.toDataURL('image/jpeg', .94)
        if (!active.current) return
        if (initialState) await restore(initialState)
        else await changeBase(original.current)
        if (!active.current) return
        locked.current = false; remember(); setReady(true)
      } finally { URL.revokeObjectURL(url) }
    }).catch(reason => { if (active.current) { locked.current = false; setError(reason instanceof Error ? reason.message : '图片打开失败') } })
    return () => { active.current = false; observer.disconnect(); stopWorker.current?.(); worker.current?.terminate(); canvas.current = null; void c.dispose() }
    // 编辑会话以照片ID挂载；原图/历史不会在普通渲染中反复初始化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const c = canvas.current; if (!c) return
    c.isDrawingMode = tool === 'draw'
    if (tool === 'draw') { const brush = new PencilBrush(c); brush.color = color; brush.width = brushSize * c.width / 400; c.freeDrawingBrush = brush; c.discardActiveObject() }
    c.requestRenderAll()
  }, [tool, color, brushSize, ready])

  async function task(work: () => Promise<void>) {
    if (locked.current || !ready) return
    canvas.current?.discardActiveObject(); if (tool === 'draw' || tool === 'text') setTool('select')
    locked.current = true; setBusy(true); setError('')
    try { await work() } catch (reason) { if (active.current) setError(reason instanceof Error ? reason.message : '编辑失败，请重试') }
    finally { if (active.current) { locked.current = false; setBusy(false) } }
  }
  async function undo(direction: number) {
    const next = cursor.current + direction
    if (next < 0 || next >= history.current.length) return
    await task(async () => { await restore(history.current[next]); cursor.current = next; setPosition({ index: next, total: history.current.length }) })
  }
  function addObject(object: FabricObject, at?: { x: number; y: number }) {
    const c = canvas.current; if (!c || locked.current) return
    if (c.getObjects().length >= 40) { setError('每张图片最多添加40个对象，请先删除一些。'); return }
    object.set({ left: at?.x ?? c.width / 2, top: at?.y ?? c.height / 2, originX: 'center', originY: 'center', cornerColor: '#07c160', cornerSize: 14, touchCornerSize: 34, transparentCorners: false })
    c.add(object); c.setActiveObject(object); setTool('select'); c.requestRenderAll(); remember()
  }
  function addText(value: string) {
    if (!value.trim()) return
    addObject(new IText(value.trim(), { fontFamily, fontSize: canvas.current!.width * .065, fill: color, stroke: '#0005', strokeWidth: .5 }))
    setText('')
  }
  function removeSelected() {
    const c = canvas.current; if (!c || locked.current) return
    const objects = c.getActiveObjects(); c.discardActiveObject(); c.remove(...objects); c.requestRenderAll(); remember()
  }
  async function rotate(flip = false) {
    await task(async () => {
      const c = canvas.current!, image = await loadMomentImage(c.toDataURL({ format: 'png', multiplier: 1 }))
      if (!active.current) return
      const result = photoCanvas(flip ? c.width : c.height, flip ? c.height : c.width), ctx = result.getContext('2d')!
      if (flip) { ctx.translate(result.width, 0); ctx.scale(-1, 1) }
      else { ctx.translate(result.width, 0); ctx.rotate(Math.PI / 2) }
      ctx.drawImage(image, 0, 0)
      await changeBase(result.toDataURL('image/png'))
    }); remember()
  }
  function openCrop(src: string, sticker: boolean) { setCrop({ x: 0, y: 0 }); setZoom(1); setAspect(undefined); setArea(null); setStickerEdge('none'); setCropSource({ src, sticker }) }
  async function chooseSticker(file?: File) {
    if (!file || locked.current) return
    await task(async () => {
      const normalized = await normalizeMomentPhoto(file, 800), url = URL.createObjectURL(normalized)
      try { const image = await loadMomentImage(url); if (!active.current) return; const c = photoCanvas(image.naturalWidth, image.naturalHeight); c.getContext('2d')!.drawImage(image, 0, 0); openCrop(c.toDataURL('image/png'), true) }
      finally { URL.revokeObjectURL(url) }
    })
  }
  async function acceptCrop() {
    if (!area || !cropSource) return
    const source = cropSource
    await task(async () => {
      const image = await loadMomentImage(source.src); if (!active.current) return
      const result = photoCanvas(area.width, area.height)
      result.getContext('2d')!.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, result.width, result.height)
      if (source.sticker) {
        const original = result.toDataURL('image/png')
        const src = stickerEdgeCanvas(result, stickerEdge, 14, lifeRecordId()).toDataURL('image/png')
        const object = await FabricImage.fromURL(src); if (!active.current) return
        object.scaleToWidth(canvas.current!.width * .28)
        locked.current = false; addObject(object); locked.current = true
        // 保留最近一次裁切结果，供「收藏上一张贴纸」显式收藏；构造失败保持静默（不收藏）。
        if (active.current) setLastSticker(cropStickerFavorite(lifeRecordId(), original, src, stickerEdge))
      } else await changeBase(result.toDataURL('image/png'))
      if (active.current) setCropSource(null)
    }); remember()
  }
  async function applyQuality() {
    await task(async () => {
      const image = await loadMomentImage(base.current); if (!active.current) return
      const bitmap = photoCanvas(image.naturalWidth, image.naturalHeight), ctx = bitmap.getContext('2d')!
      ctx.drawImage(image, 0, 0); const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
      const processed = await new Promise<Uint8ClampedArray>((resolve, reject) => {
        const w = new Worker(new URL('../../lib/moment-photo-quality.worker.ts', import.meta.url), { type: 'module' }); worker.current = w; setProcessing(true)
        const timer = window.setTimeout(() => { w.terminate(); worker.current = null; reject(new Error('处理时间过长，请降低图片尺寸后重试。')) }, 45000)
        const done = () => { if (active.current) setProcessing(false); clearTimeout(timer); w.terminate(); if (worker.current === w) worker.current = null }
        w.onmessage = event => { done(); if (event.data.error) reject(new Error(event.data.error)); else resolve(new Uint8ClampedArray(event.data.buffer)) }
        w.onerror = () => { done(); reject(new Error('当前设备无法完成画质处理，请重试。')) }
        // 终止时结算Promise，避免本机界面一直处于忙碌状态。
        w.onmessageerror = () => { done(); reject(new Error('处理结果读取失败')) }
        stopWorker.current = () => { done(); reject(new Error('已停止画质处理，图片保持原样。')) }
        w.postMessage({ buffer: data.data.buffer, width: bitmap.width, height: bitmap.height, settings: quality }, [data.data.buffer])
      })
      stopWorker.current = null
      if (!active.current) return
      ctx.putImageData(new ImageData(new Uint8ClampedArray(processed), bitmap.width, bitmap.height), 0, 0)
      const background = await FabricImage.fromURL(bitmap.toDataURL('image/png'))
      background.set({ left: 0, top: 0, originX: 'left', originY: 'top', selectable: false, evented: false })
      if (active.current && canvas.current) { canvas.current.backgroundImage = background; canvas.current.requestRenderAll() }
    }); remember()
  }
  const stopWorker = useRef<(() => void) | null>(null)
  async function chooseFont(family: string) {
    setFontLoading(true); setError('')
    try { await loadMomentFont(family); if (!active.current) return; setFontFamily(family); const object = canvas.current?.getActiveObject(); if (object instanceof IText) { object.set('fontFamily', family); object.initDimensions(); canvas.current?.requestRenderAll(); remember() } }
    catch (reason) { if (active.current) setError(reason instanceof Error ? reason.message : '字体加载失败') }
    finally { if (active.current) setFontLoading(false) }
  }
  async function addLocalSticker(src: string) {
    await task(async () => { const object = await FabricImage.fromURL(src); if (!active.current) return; object.scaleToWidth(canvas.current!.width * .2); locked.current = false; addObject(object); locked.current = true })
  }
  async function removeCollectionSticker(id: string) {
    if (removingSticker !== id) { setRemovingSticker(id); return }
    await task(async () => {
      await deleteLocalSticker(owner, id)
      if (active.current) { setCollection(rows => rows?.filter(row => row.id !== id) ?? null); setRemovingSticker(''); setStatus('已移除收藏，不影响已贴到图片上的内容。') }
    })
  }
  // 显式收藏上一张贴纸：只写收藏库，不产生生活记录；收藏库变更事件会刷新列表。
  async function collectLastSticker() {
    if (!lastSticker || busy || collectingSticker) return
    setCollectingSticker(true)
    try {
      await saveLocalSticker(owner, lastSticker)
      if (active.current) { setLastSticker(null); setStatus('已收藏贴纸，可在「我的本机贴纸」里复用。') }
    } catch {
      if (active.current) setStatus('贴纸收藏失败，请检查本机存储后重试。')
    } finally { if (active.current) setCollectingSticker(false) }
  }

  function changeLayer(index: number, values: Partial<FabricObject>, save = true) {
    if (locked.current) return
    const object = canvas.current?.getObjects()[index]; if (!object) return
    object.set(values); canvas.current?.requestRenderAll(); refreshLayers(); if (save) remember()
  }
  function moveLayer(index: number, direction: number) {
    const c = canvas.current; if (!c || locked.current) return
    const object = c.getObjects()[index]; if (object) { c.moveObjectTo(object, index + direction); c.requestRenderAll(); remember() }
  }
  function loadPreset() {
    try {
      const saved = JSON.parse(localStorage.getItem('ohu.photo-adjustment.v1') || 'null') as PhotoQuality | null
      if (!saved || typeof saved !== 'object' || !['none','denoise','blur','sharpen','wavelet-denoise','wavelet-detail','edges','emboss','median'].includes(saved.mode) || !['none','mono','warm','cool','vivid','sepia','invert','fade'].includes(saved.filter) || !Number.isFinite(saved.strength) || saved.strength < 0 || saved.strength > 100) throw Error()
      const adjustments = { ...DEFAULT_PHOTO_ADJUSTMENTS, ...saved.adjustments }
      for (const [id,,min,max] of ADJUSTMENTS) if (!Number.isFinite(adjustments[id]) || adjustments[id] < min || adjustments[id] > max) throw Error()
      setQuality({ ...saved, adjustments }); setStatus('已载入常用参数，点击应用后生效。')
    } catch { setError('没有可用的常用参数，请先保存一组。') }
  }
  async function applyMosaic() {
    if (!mosaicArea || mosaicArea.width < 4 || mosaicArea.height < 4) return
    const region = mosaicArea
    await task(async () => {
      const image = await loadMomentImage(canvas.current!.toDataURL({ format: 'png', multiplier: 1 })); if (!active.current) return
      const small = photoCanvas(Math.ceil(region.width / mosaicSize), Math.ceil(region.height / mosaicSize))
      small.getContext('2d')!.drawImage(image, region.x, region.y, region.width, region.height, 0, 0, small.width, small.height)
      const output = photoCanvas(region.width, region.height), ctx = output.getContext('2d')!; ctx.imageSmoothingEnabled = false; ctx.drawImage(small, 0, 0, output.width, output.height)
      const object = await FabricImage.fromURL(output.toDataURL('image/png')); if (!active.current) return
      locked.current = false; addObject(object, { x: region.x + region.width / 2, y: region.y + region.height / 2 }); locked.current = true; setMosaicArea(null)
    }); remember()
  }
  async function save() {
    await task(async () => {
      const c = canvas.current!; await loadSnapshotFonts(JSON.stringify(c.toJSON())); c.discardActiveObject(); c.requestRenderAll()
      const rendered = await loadMomentImage(c.toDataURL({ format: 'png', multiplier: 1 }))
      const result = photoCanvas(c.width, c.height), ctx = result.getContext('2d')!
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, result.width, result.height); ctx.drawImage(rendered, 0, 0)
      const output = await canvasPhotoFile(result, file.name)
      if (active.current) onSave(output, snapshot())
    })
  }
  return <DialogLayer title="编辑朋友圈图片" onClose={onClose} full allowClose={!busy} className={styles.surface}>
    <div className={styles.editor}>
      <header className={styles.header}><button type="button" onClick={onClose} disabled={busy}>取消</button><span>照片编辑</span><button type="button" className={styles.done} onClick={() => void save()} disabled={!ready || busy}>完成</button></header>
      <div className={styles.history}><button type="button" disabled={busy || position.index <= 0} onClick={() => void undo(-1)}>↶ 撤销</button><button type="button" disabled={busy || position.index >= position.total - 1} onClick={() => void undo(1)}>↷ 重做</button><button type="button" disabled={!ready || busy} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setComparing(true) }} onPointerUp={() => setComparing(false)} onPointerCancel={() => setComparing(false)} onLostPointerCapture={() => setComparing(false)} onKeyDown={e => { if (e.key === ' ') { e.preventDefault(); setComparing(true) } }} onKeyUp={() => setComparing(false)} onBlur={() => setComparing(false)}>按住看原图</button></div>
      <div className={styles.canvasHost} ref={host} style={{ pointerEvents: busy ? 'none' : undefined }}><canvas ref={element} />{tool === 'mosaic' && ready && !busy ? <svg className={styles.mosaicOverlay} style={viewSize} viewBox={`0 0 ${canvas.current?.width || 1} ${canvas.current?.height || 1}`} onPointerDown={event => { const rect = event.currentTarget.getBoundingClientRect(), c = canvas.current!; const point = { x: (event.clientX - rect.left) / rect.width * c.width, y: (event.clientY - rect.top) / rect.height * c.height }; mosaicStart.current = point; event.currentTarget.setPointerCapture(event.pointerId); setMosaicArea({ ...point, width: 0, height: 0 }) }} onPointerMove={event => { if (!mosaicStart.current) return; const rect = event.currentTarget.getBoundingClientRect(), c = canvas.current!, start = mosaicStart.current; const x = Math.max(0, Math.min(c.width, (event.clientX - rect.left) / rect.width * c.width)), y = Math.max(0, Math.min(c.height, (event.clientY - rect.top) / rect.height * c.height)); setMosaicArea({ x: Math.min(x, start.x), y: Math.min(y, start.y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) }) }} onPointerUp={() => { mosaicStart.current = null }} onPointerCancel={() => { mosaicStart.current = null; setMosaicArea(null) }} aria-label="拖动框选马赛克区域">{mosaicArea ? <rect {...mosaicArea} fill="#07c16033" stroke="#07c160" strokeWidth="3" /> : null}</svg> : null}{comparing && original.current ? <img className={styles.original} src={original.current} alt="本次编辑前的图片" /> : null}{!ready && !error ? <p role="status" className={styles.loading}>正在打开图片…</p> : null}</div>
      {status ? <p className={styles.note} role="status">{status}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {busy ? <div className={styles.busy} role="status">正在处理图片…{processing ? <button type="button" onClick={() => stopWorker.current?.()}>停止处理</button> : null}</div> : null}
      <div className={styles.options}>
        {(tool === 'text' || tool === 'draw') ? <div className={styles.palette} aria-label="选择颜色">{COLORS.map(value => <button type="button" key={value} aria-label={`颜色 ${value}`} aria-pressed={color === value} onClick={() => setColor(value)} style={{ background: value }} disabled={busy} />)}</div> : null}
        {tool === 'text' ? <><label className={styles.fontPicker}>字体<select aria-label="文字字体" disabled={busy || fontLoading} value={fontFamily} onChange={event => void chooseFont(event.target.value)}>{MOMENT_FONTS.map(font => <option key={font.id} value={font.family}>{font.label}</option>)}</select></label><div className={styles.textRow}><input ref={photoText} aria-label="图片文字" value={text} maxLength={120} onChange={e => setText(e.target.value)} placeholder="写点什么，添加后可双击修改" disabled={busy} /><button type="button" disabled={busy || fontLoading || !ready || !text.trim()} onClick={() => addText(text)}>添加</button></div><ComposerKeyboard field={photoText} value={text} onChange={setText} disabled={busy} />{fontLoading ? <p className={styles.note} role="status">正在加载字库…</p> : null}<a className={styles.licenseLink} href={`${import.meta.env.BASE_URL}moment-editor/NOTICE.md`} target="_blank" rel="noreferrer">字体与素材许可</a></> : null}
        {tool === 'draw' ? <label className={styles.range}>画笔粗细<input type="range" min="2" max="28" value={brushSize} disabled={busy} onChange={e => setBrushSize(Number(e.target.value))} /></label> : null}
        {tool === 'sticker' ? <><section className={styles.collection} aria-label="本机贴纸收藏">
          <h3>我的本机贴纸</h3>
          <p>在「记一笔」或本编辑器裁切后收藏。点按重贴，不增加生活记录；移除收藏不影响已贴内容。</p>
          {lastSticker ? <div className={styles.collectRow}>
            <img src={lastSticker.sticker} width="40" height="40" alt="上一张贴纸预览" />
            <button type="button" disabled={busy || collectingSticker} onClick={() => void collectLastSticker()}>{collectingSticker ? '收藏中…' : '收藏上一张贴纸'}</button>
          </div> : null}
          {collectionError ? <p role="alert">{collectionError}<button type="button" disabled={busy} onClick={() => setCollectionRevision(value => value + 1)}>重试读取</button></p> : collection === null ? <p role="status">正在读取本机贴纸…</p> : collection.length === 0 && !lastSticker ? <p>还没有收藏，可先在「记一笔」选照片并收藏贴纸。</p> : null}
          <ul className={styles.collectionList}>{collection?.map((sticker, index) => <li key={sticker.id} className={styles.collectionCard}>
            <button type="button" disabled={busy || !ready} aria-label={`贴上第${index + 1}张收藏贴纸`} onClick={() => void addLocalSticker(sticker.sticker)}>
              <img src={sticker.sticker} width="56" height="56" alt="" loading="lazy" />
              <span>{PHOTO_PRESETS.find(preset => preset.value === sticker.preset)?.label}</span>
            </button>
            <button type="button" className={styles.delete} disabled={busy || !ready} onClick={() => void removeCollectionSticker(sticker.id)}>{removingSticker === sticker.id ? '确认移除' : '移除收藏'}</button>
            {removingSticker === sticker.id ? <button type="button" disabled={busy} onClick={() => setRemovingSticker('')}>保留收藏</button> : null}
          </li>)}</ul>
        </section><div className={styles.openStickers}>{STICKERS.map(([id, label]) => <button type="button" key={id} disabled={busy || !ready} aria-label={`添加${label}贴纸`} onClick={() => void addLocalSticker(import.meta.env.BASE_URL + 'moment-editor/stickers/' + id + '.svg')}><img src={`${import.meta.env.BASE_URL}moment-editor/stickers/${id}.svg`} width="40" height="40" alt="" /></button>)}</div><details className={styles.adjustments}><summary>阿狐贴纸</summary><div className={styles.openStickers}>{FOX_V1_STICKERS.map(sticker => <button type="button" key={sticker.id} disabled={busy || !ready} aria-label={'添加' + sticker.name} onClick={() => void addLocalSticker(foxV1StickerUrl(sticker))}><img src={foxV1StickerUrl(sticker)} width="40" height="40" alt="" loading="lazy" /></button>)}</div></details><div className={styles.emoji}>{EMOJIS.map(emoji => <button type="button" disabled={busy || !ready} key={emoji} onClick={() => addText(emoji)}>{emoji}</button>)}<button type="button" disabled={busy || !ready} onClick={() => stickerInput.current?.click()}>图片贴纸</button></div><div className={styles.photoChoices}>{availableFiles.map((source, index) => <button type="button" key={index} disabled={busy || !ready} onClick={() => void chooseSticker(source)}>裁第{index + 1}张</button>)}</div></> : null}
        {tool === 'quality' ? <>
          <label className={styles.range}>校园滤镜<select value={quality.preset ?? 'original'} disabled={busy} onChange={event => setQuality(q => ({ ...q, preset: event.target.value as CampusFilter, filter: 'none' }))}>{Object.entries(CAMPUS_FILTERS).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}</select></label>
          <label className={styles.range}>滤镜强度 {quality.filterStrength ?? 60}%<input type="range" min="0" max="100" value={quality.filterStrength ?? 60} disabled={busy || !quality.preset || quality.preset === 'original'} onChange={event => setQuality(q => ({ ...q, filterStrength: Number(event.target.value) }))} /></label>
          <div className={styles.qualityRow}><label>滤镜<select aria-label="滤镜" value={quality.filter} disabled={busy} onChange={e => setQuality(q => ({ ...q, filter: e.target.value as PhotoFilter, preset: 'original' }))}>{[['none', '原色'], ['mono', '黑白'], ['warm', '暖调'], ['cool', '冷调'], ['vivid', '鲜明'], ['sepia', '复古棕'], ['invert', '反相'], ['fade', '褪色']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>画质<select aria-label="画质" value={quality.mode} disabled={busy} onChange={e => setQuality(q => ({ ...q, mode: e.target.value as QualityMode, adaptiveWavelet: e.target.value.startsWith('wavelet-') }))}>{[['none', '不处理'], ['denoise', '柔和去噪'], ['blur', '模糊'], ['sharpen', '傅里叶锐化'], ['wavelet-denoise', '小波降噪'], ['wavelet-detail', '小波细节'], ['median', '中值去斑'], ['edges', 'Sobel边缘'], ['emboss', '浮雕']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><label className={styles.range}>画质强度 {quality.strength}<input type="range" min="0" max="100" value={quality.strength} disabled={busy} onChange={e => setQuality(q => ({ ...q, strength: Number(e.target.value) }))} /></label><details className={styles.adjustments}><summary>专业调节</summary>
          {quality.mode === 'sharpen' ? <>
            <label className={styles.range}>锐化半径 {quality.sharpenRadius ?? 1.2} px<input type="range" min=".4" max="3" step=".1" value={quality.sharpenRadius ?? 1.2} disabled={busy} onChange={event => setQuality(q => ({ ...q, sharpenRadius: Number(event.target.value) }))} /></label>
            <label className={styles.range}>细节阈值 {quality.sharpenThreshold ?? 0}<input type="range" min="0" max="20" value={quality.sharpenThreshold ?? 0} disabled={busy} onChange={event => setQuality(q => ({ ...q, sharpenThreshold: Number(event.target.value) }))} /></label>
          </> : null}
          {quality.mode.startsWith('wavelet-') ? <>
            <label className={styles.range}><span>自适应小波</span><input type="checkbox" checked={!!quality.adaptiveWavelet} disabled={busy} onChange={event => setQuality(q => ({ ...q, adaptiveWavelet: event.target.checked }))} /></label>
            {quality.adaptiveWavelet ? <>
              <label className={styles.range}>分解层数<select value={quality.waveletLevels ?? 3} disabled={busy} onChange={event => setQuality(q => ({ ...q, waveletLevels: Number(event.target.value) }))}><option value="2">2 层</option><option value="3">3 层</option></select></label>
              <label className={styles.range}>阈值倍率 {quality.waveletThreshold ?? 1}<input type="range" min=".6" max="1.2" step=".05" value={quality.waveletThreshold ?? 1} disabled={busy} onChange={event => setQuality(q => ({ ...q, waveletThreshold: Number(event.target.value) }))} /></label>
            </> : null}
          </> : null}
          <label className={styles.range}><span>线性光曝光与进阶色调</span><input type="checkbox" checked={!!quality.tone} disabled={busy} onChange={event => setQuality(q => ({ ...q, tone: event.target.checked ? { ...NEUTRAL_TONE } : undefined }))} /></label>
          {quality.tone ? TONE_CONTROLS.map(([id, label]) => <label className={styles.range} key={id}>{label} {quality.tone?.[id]}<input type="range" min="-50" max="50" step="1" value={quality.tone?.[id] ?? 0} disabled={busy} onChange={event => setQuality(q => ({ ...q, tone: { ...NEUTRAL_TONE, ...q.tone, [id]: Number(event.target.value) } }))} /></label>) : null}
          {ADJUSTMENTS.map(([id, label, min, max, step]) => <label className={styles.range} key={id}>{label} {quality.adjustments?.[id] ?? DEFAULT_PHOTO_ADJUSTMENTS[id]}<input aria-label={label} type="range" min={min} max={max} step={step} disabled={busy} value={quality.adjustments?.[id] ?? DEFAULT_PHOTO_ADJUSTMENTS[id]} onChange={event => setQuality(q => ({ ...q, adjustments: { ...DEFAULT_PHOTO_ADJUSTMENTS, ...q.adjustments, [id]: Number(event.target.value) } }))} /></label>)}</details><div className={styles.presets}><button type="button" disabled={busy} onClick={() => setQuality({ mode: 'none', strength: 35, filter: 'none', adjustments: { ...DEFAULT_PHOTO_ADJUSTMENTS } })}>还原参数</button><button type="button" disabled={busy} onClick={() => { try { localStorage.setItem('ohu.photo-adjustment.v1', JSON.stringify(quality)); setStatus('已保存常用参数，只记录调节数值，不保存照片。') } catch { setError('常用参数保存失败') } }}>保存常用</button><button type="button" disabled={busy} onClick={loadPreset}>使用常用</button></div><p className={styles.note}>小波细节与傅里叶锐化可能放大噪点；去噪会减少细节。选择参数后应用，可撤销。</p><button type="button" className={styles.apply} disabled={busy || !ready} onClick={() => void applyQuality()}>应用并查看效果</button></> : null}
        {tool === 'mosaic' ? <><p className={styles.note}>拖动框选要遮盖的区域；发表时会合成为图片。模糊不能保证隐藏文字，请用足够大的格块或实色贴纸覆盖。</p><label className={styles.range}>格块 {mosaicSize}<input type="range" min="8" max="48" value={mosaicSize} onChange={event => setMosaicSize(Number(event.target.value))} /></label><button type="button" className={styles.apply} disabled={busy || !mosaicArea || mosaicArea.width < 4 || mosaicArea.height < 4} onClick={() => void applyMosaic()}>应用马赛克</button></> : null}
        {tool === 'layers' ? <><p className={styles.note}>文字、涂鸦、贴纸与马赛克是独立图层；顶部为前景。</p>{[...layers].reverse().map(layer => <div className={styles.layerRow} key={layer.index}><button type="button" disabled={busy} onClick={() => { const c = canvas.current!, object = c.getObjects()[layer.index]; if (object) { c.setActiveObject(object); c.requestRenderAll() } }}>{layer.label}</button><button type="button" disabled={busy} aria-label={`${layer.visible ? '隐藏' : '显示'}图层${layer.index + 1}`} onClick={() => changeLayer(layer.index, { visible: !layer.visible })}>{layer.visible ? '可见' : '隐藏'}</button><button type="button" disabled={busy || layer.index === layers.length - 1} onClick={() => moveLayer(layer.index, 1)}>上移</button><button type="button" disabled={busy || layer.index === 0} onClick={() => moveLayer(layer.index, -1)}>下移</button><label>透明度<input aria-label={`图层${layer.index + 1}透明度`} type="range" min="0" max="100" step="5" value={Math.round(layer.opacity * 100)} onChange={event => changeLayer(layer.index, { opacity: Number(event.target.value) / 100 }, false)} onPointerUp={() => remember()} onKeyUp={() => remember()} onBlur={() => remember()} disabled={busy} /></label><select aria-label={`图层${layer.index + 1}混合模式`} disabled={busy} value={layer.blend} onChange={event => changeLayer(layer.index, { globalCompositeOperation: event.target.value as GlobalCompositeOperation })}><option value="source-over">正常</option><option value="multiply">正片叠底</option><option value="screen">滤色</option><option value="overlay">叠加</option></select></div>)}{!layers.length ? <p className={styles.note}>添加文字、涂鸦或贴纸后，会在这里显示。</p> : null}<button type="button" disabled={busy || !ready} onClick={() => void rotate(true)}>水平翻转整图</button></> : null}
        {selected ? <button className={styles.delete} type="button" disabled={busy} onClick={removeSelected}>删除选中内容</button> : null}
      </div>
      <nav className={styles.toolbar} aria-label="图片编辑工具">{([['select', '移动'], ['draw', '涂鸦'], ['text', '文字'], ['sticker', '贴纸'], ['mosaic', '马赛克'], ['quality', '滤镜画质'], ['layers', '图层']] as const).map(([id, label]) => <button type="button" aria-pressed={tool === id} key={id} disabled={busy || !ready} onClick={() => setTool(id)}>{label}</button>)}<button type="button" disabled={busy || !ready} onClick={() => { canvas.current!.discardActiveObject(); openCrop(canvas.current!.toDataURL({ format: 'png', multiplier: 1 }), false) }}>裁剪</button><button type="button" disabled={busy || !ready} onClick={() => void rotate()}>旋转</button></nav>
      <input type="file" hidden accept="image/*" ref={stickerInput} onChange={e => { void chooseSticker(e.target.files?.[0]); e.target.value = '' }} />
    </div>
    {cropSource ? <DialogLayer title={cropSource.sticker ? '裁剪图片贴纸' : '裁剪图片'} full onClose={() => setCropSource(null)} allowClose={!busy} className={styles.surface}>
      <div className={styles.cropEditor}><header className={styles.header}><button type="button" disabled={busy} onClick={() => setCropSource(null)}>取消</button><span>{cropSource.sticker ? '裁剪图片贴纸' : '裁剪'}</span><button className={styles.done} type="button" disabled={busy || !area} onClick={() => void acceptCrop()}>确定</button></header>
        <div className={styles.cropStage} style={{ pointerEvents: busy ? 'none' : undefined }}><Cropper image={cropSource.src} crop={crop} zoom={zoom} aspect={aspect ?? cropRatio} onMediaLoaded={media => setCropRatio(media.naturalWidth / media.naturalHeight)} objectFit="contain" onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, pixels) => setArea(pixels)} /></div>
        {cropSource.sticker ? <div className={styles.ratios} role="group" aria-label="贴纸边">{STICKER_EDGES.map(edge => <button type="button" key={edge.value} disabled={busy} aria-pressed={stickerEdge === edge.value} onClick={() => setStickerEdge(edge.value)}>{edge.label}</button>)}</div> : null}
        <div className={styles.ratios}>{([['原图', undefined], ['1:1', 1], ['4:3', 4 / 3], ['16:9', 16 / 9]] as const).map(([label, ratio]) => <button type="button" key={label} disabled={busy} aria-pressed={aspect === ratio} onClick={() => { setAspect(ratio); setCrop({ x: 0, y: 0 }); setZoom(1) }}>{label}</button>)}</div>
        <label className={styles.range}>缩放<input type="range" min="1" max="4" step=".01" disabled={busy} value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label><p className={styles.note}>{cropSource.sticker ? '裁好后可拖动、缩放和旋转贴纸。' : '裁剪会合并当前文字、涂鸦和贴纸，仍可撤销。'}</p>
      </div>
    </DialogLayer> : null}
  </DialogLayer>
}
