import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import { DialogLayer } from '../../components/ui/DialogLayer'
import styles from './MomentPhotoEditor.module.css'

type Sticker = { id: string; kind: 'emoji' | 'photo'; value: string; x: number; y: number; size: number; url?: string }
const EMOJIS = ['✨', '❤️', '🌸', '🎉', '😂', '🐾', '☀️', '🌿', '🦊', '💚']

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片读取失败'))
    image.src = src
  })
}

function canvasFile(canvas: HTMLCanvasElement): Promise<File> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob
    ? resolve(new File([blob], `moment-${Date.now()}.jpg`, { type: 'image/jpeg' }))
    : reject(new Error('图片导出失败，请重试')), 'image/jpeg', 0.92))
}

export function MomentPhotoEditor({ file, availableFiles, onClose, onSave }: { file: File; availableFiles: File[]; onClose: () => void; onSave: (file: File) => void }) {
  const sourceUrl = useMemo(() => URL.createObjectURL(file), [file])
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [aspect, setAspect] = useState<number | undefined>(1)
  const [originalAspect, setOriginalAspect] = useState(1)
  const [area, setArea] = useState<Area | null>(null)
  const [stickers, setStickers] = useState<Sticker[]>([])
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const stickerInput = useRef<HTMLInputElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const liveStickerUrls = useRef<string[]>([])

  useEffect(() => {
    void loadImage(sourceUrl).then(image => setOriginalAspect(image.naturalWidth / Math.max(1, image.naturalHeight))).catch(() => setError('这张图片暂时无法编辑。'))
    return () => { URL.revokeObjectURL(sourceUrl); liveStickerUrls.current.forEach(url => URL.revokeObjectURL(url)) }
  }, [sourceUrl])

  const completed = useCallback((_percent: Area, pixels: Area) => setArea(pixels), [])
  function addSticker(kind: Sticker['kind'], value: string, url?: string) {
    const id = `sticker-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    setStickers(current => [...current, { id, kind, value, url, x: 0.5, y: 0.5, size: kind === 'emoji' ? 0.16 : 0.24 }])
    setSelected(id)
  }
  function choosePhotoSticker(next?: File) {
    if (!next) return
    if (!next.type.startsWith('image/')) { setError('请选择图片文件作为贴纸。'); return }
    const url = URL.createObjectURL(next)
    liveStickerUrls.current.push(url)
    addSticker('photo', '', url)
    setError('')
  }
  function moveSticker(id: string, event: React.PointerEvent<HTMLButtonElement>) {
    const bounds = stage.current?.getBoundingClientRect()
    if (!bounds) return
    const x = Math.min(0.95, Math.max(0.05, (event.clientX - bounds.left) / bounds.width))
    const y = Math.min(0.95, Math.max(0.05, (event.clientY - bounds.top) / bounds.height))
    setStickers(current => current.map(item => item.id === id ? { ...item, x, y } : item))
  }
  async function exportEdited() {
    if (!area) { setError('请稍等图片加载完成。'); return }
    setBusy(true); setError('')
    try {
      const image = await loadImage(sourceUrl)
      // Use the actual cropped pixel region and cap the longest edge so tall
      // panoramas cannot allocate an unexpectedly huge canvas on mobile.
      const sourceWidth = Math.max(1, Math.round(area.width))
      const sourceHeight = Math.max(1, Math.round(area.height))
      const scale = Math.min(1, 2048 / Math.max(sourceWidth, sourceHeight))
      const width = Math.max(1, Math.round(sourceWidth * scale))
      const height = Math.max(1, Math.round(sourceHeight * scale))
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('无法创建图片画布')
      ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, width, height)
      for (const sticker of stickers) {
        const size = width * sticker.size, x = width * sticker.x - size / 2, y = height * sticker.y - size / 2
        if (sticker.kind === 'emoji') {
          ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`
          ctx.shadowColor = 'rgba(20,30,20,.32)'; ctx.shadowBlur = width * 0.015; ctx.fillText(sticker.value, x + size / 2, y + size / 2); ctx.restore()
        } else if (sticker.url) {
          const overlay = await loadImage(sticker.url)
          ctx.save(); ctx.shadowColor = 'rgba(20,30,20,.35)'; ctx.shadowBlur = width * 0.014; ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.clip()
          ctx.drawImage(overlay, x + size * .055, y + size * .055, size * .89, size * .89)
          ctx.restore(); ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.lineWidth = width * .009; ctx.strokeStyle = '#fff'; ctx.stroke()
        }
      }
      onSave(await canvasFile(canvas))
    } catch (failure) { setError((failure as Error).message || '保存编辑失败，请重试。') }
    finally { setBusy(false) }
  }

  return <DialogLayer title="编辑朋友圈图片" onClose={onClose} full allowClose={!busy}>
    <div className={styles.sheet}>
      <header className={styles.header}><div><span>照片编辑</span><h2>裁剪与贴纸</h2></div><button type="button" className={styles.close} onClick={onClose} disabled={busy}>×</button></header>
      <p className={styles.hint}>拖动图片调整取景；贴纸可拖动位置。图片贴纸会裁成圆形并加白边，不会自动抠除背景。</p>
      <div className={styles.ratios} aria-label="裁剪比例">{[{ label: '正方形', value: 1 }, { label: '4:3', value: 4 / 3 }, { label: '16:9', value: 16 / 9 }, { label: '原图', value: originalAspect }].map(option => <button type="button" key={option.label} aria-pressed={Math.abs((aspect || originalAspect) - option.value) < .01} onClick={() => { setAspect(option.value); setCrop({ x: 0, y: 0 }); setZoom(1) }}>{option.label}</button>)}</div>
      <div className={styles.stage} ref={stage}>
        <Cropper image={sourceUrl} crop={crop} zoom={zoom} aspect={aspect} minZoom={1} maxZoom={4} objectFit="contain" restrictPosition showGrid onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={completed} />
        <div className={styles.stickerLayer}>
          {stickers.map(item => <button key={item.id} type="button" className={`${styles.sticker} ${item.kind === 'photo' ? styles.photoSticker : ''}`} style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.size * 100}%` }} aria-label="拖动贴纸" onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setSelected(item.id) }} onPointerMove={event => { if (event.buttons) moveSticker(item.id, event) }}>
            {item.kind === 'emoji' ? item.value : item.url ? <img src={item.url} alt="图片贴纸" /> : null}
          </button>)}
        </div>
      </div>
      <label className={styles.zoom}>缩放<input type="range" min="1" max="4" step=".01" value={zoom} onChange={event => setZoom(Number(event.target.value))} /></label>
      <section className={styles.stickerTools}>
        <strong>添加表情贴纸</strong><div className={styles.emojiList}>{EMOJIS.map(emoji => <button type="button" key={emoji} onClick={() => addSticker('emoji', emoji)}>{emoji}</button>)}
          <button type="button" onClick={() => stickerInput.current?.click()}>＋ 新图片贴纸</button><input ref={stickerInput} hidden type="file" accept="image/*" onChange={event => { choosePhotoSticker(event.target.files?.[0]); event.target.value = '' }} /></div>
        {availableFiles.length > 1 ? <div className={styles.photoStickerChoices} aria-label="将已选照片变成贴纸">{availableFiles.map((source, index) => <button type="button" key={`${source.name}-${index}`} onClick={() => choosePhotoSticker(source)}>第 {index + 1} 张图变贴纸</button>)}</div> : null}
        {selected ? <div className={styles.selectedSticker}><label>贴纸大小<input type="range" min=".08" max=".42" step=".01" value={stickers.find(item => item.id === selected)?.size ?? .16} onChange={event => setStickers(current => current.map(item => item.id === selected ? { ...item, size: Number(event.target.value) } : item))} /></label><button type="button" onClick={() => { const removed = stickers.find(item => item.id === selected); setStickers(current => current.filter(item => item.id !== selected)); setSelected(''); if (removed?.url) { URL.revokeObjectURL(removed.url); liveStickerUrls.current = liveStickerUrls.current.filter(url => url !== removed.url) } }}>删除选中贴纸</button></div> : null}
      </section>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.actions}><button type="button" className={styles.cancel} onClick={onClose} disabled={busy}>取消</button><button type="button" className={styles.save} onClick={() => void exportEdited()} disabled={busy}>{busy ? '正在生成…' : '完成编辑'}</button></div>
    </div>
  </DialogLayer>
}
