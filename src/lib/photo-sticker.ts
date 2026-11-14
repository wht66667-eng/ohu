import { photoCanvas } from './moment-photo'
import { tornPolygonPoints } from './torn-shape'

export type StickerEdge = 'none' | 'paper' | 'white' | 'torn'

export const STICKER_EDGES: { value: StickerEdge; label: string }[] = [
  { value: 'none', label: '无白边' },
  { value: 'paper', label: '纸边' },
  { value: 'white', label: '透明白边' },
  { value: 'torn', label: '撕纸' },
]

function roundedRect(ctx: CanvasRenderingContext2D, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(r, 0)
  ctx.lineTo(width - r, 0)
  ctx.arcTo(width, 0, width, r, r)
  ctx.lineTo(width, height - r)
  ctx.arcTo(width, height, width - r, height, r)
  ctx.lineTo(r, height)
  ctx.arcTo(0, height, 0, height - r, r)
  ctx.lineTo(0, r)
  ctx.arcTo(0, 0, r, 0, r)
  ctx.closePath()
}


/** 裁切主体外加纸边／白边／撕纸边，边框外保持透明；全程本机画布，不上传照片。 */
export function stickerEdgeCanvas(source: HTMLCanvasElement, edge: StickerEdge, border = 14, seed = ''): HTMLCanvasElement {
  if (edge === 'none' || border <= 0) return source
  if (edge === 'torn') return tornEdgeCanvas(source, border, seed)
  const pad = Math.max(1, Math.round(border))
  const out = photoCanvas(source.width + pad * 2, source.height + pad * 2)
  const ctx = out.getContext('2d')
  if (!ctx) return source
  ctx.fillStyle = edge === 'paper' ? '#f6f1e6' : '#ffffff'
  roundedRect(ctx, out.width, out.height, pad + 10)
  ctx.fill()
  ctx.drawImage(source, pad, pad)
  return out
}

/** 撕纸边：不规则纸色底 + 内缩多边形裁切主体；同一种子形状一致（换边重算不变形）。 */
function tornEdgeCanvas(source: HTMLCanvasElement, border: number, seed: string): HTMLCanvasElement {
  const pad = Math.max(2, Math.round(border))
  const out = photoCanvas(source.width + pad * 2, source.height + pad * 2)
  const ctx = out.getContext('2d')
  if (!ctx) return source
  const points = tornPolygonPoints(seed)
  const cx = out.width / 2, cy = out.height / 2
  const build = (scale: number) => {
    ctx.beginPath()
    points.forEach((point, index) => {
      const x = cx + (point.x - 0.5) * out.width * scale
      const y = cy + (point.y - 0.5) * out.height * scale
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.closePath()
  }
  // 纸色底：最外层撕边多边形
  build(1)
  ctx.fillStyle = '#f6f1e6'
  ctx.fill()
  // 主体：内缩多边形裁切，露出撕边
  const shrink = Math.max(0.55, 1 - (pad * 2.4) / Math.min(out.width, out.height))
  ctx.save()
  build(shrink)
  ctx.clip()
  ctx.drawImage(source, pad, pad)
  ctx.restore()
  return out
}