/**
 * 自制表情包：把用户输入的文字（可含 emoji）画到画布上导出 PNG。
 *
 * 不走服务端、不依赖任何原生插件——Canvas 在 WebView 里就能出图，
 * 这样「制作表情」也能靠热更新下发。产出的 File 直接复用聊天图片上传通道。
 */
const SIZE = 480
const MAX_LINES = 4

export interface StickerDraft {
  text: string
  /** 底色，十六进制 */
  bg: string
}

export const STICKER_BG_OPTIONS = ['#ffffff', '#ffe9c7', '#d8f0c8', '#d9e8ff', '#ffdfe6', '#2f3a2f']

/** 深色底自动用浅色字，省得让用户再选一个前景色 */
function inkFor(bg: string): string {
  const hex = String(bg || '').replace('#', '')
  if (hex.length !== 6) return '#2f3a2f'
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? '#2f3a2f' : '#f4f8f0'
}

/** 按宽度折行：emoji 与中文都按整字符测量，不按字节 */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    let line = ''
    for (const ch of Array.from(paragraph || '')) {
      if (ctx.measureText(line + ch).width > maxWidth && line) {
        lines.push(line)
        line = ch
        if (lines.length >= MAX_LINES) break
      } else {
        line += ch
      }
    }
    if (lines.length < MAX_LINES && line) lines.push(line)
    if (lines.length >= MAX_LINES) break
  }
  return lines.length ? lines.slice(0, MAX_LINES) : ['']
}

function toFile(blob: Blob, name: string): File {
  return new File([blob], name, { type: 'image/png' })
}

function blobOf(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      if (typeof canvas.toBlob === 'function') {
        canvas.toBlob((blob) => resolve(blob), 'image/png')
        return
      }
    } catch {
      /* 老 WebView 没有 toBlob，走 dataURL 兜底 */
    }
    try {
      const url = canvas.toDataURL('image/png')
      const comma = url.indexOf(',')
      if (comma < 0) return resolve(null)
      const binary = atob(url.slice(comma + 1))
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      resolve(new Blob([bytes], { type: 'image/png' }))
    } catch {
      resolve(null)
    }
  })
}

/** 画一版预览（返回 canvas 供 UI 直接展示） */
export function drawSticker(canvas: HTMLCanvasElement, draft: StickerDraft): boolean {
  const text = String(draft.text || '').trim().slice(0, 40)
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  canvas.width = SIZE
  canvas.height = SIZE
  ctx.clearRect(0, 0, SIZE, SIZE)
  ctx.fillStyle = draft.bg || '#ffffff'
  ctx.fillRect(0, 0, SIZE, SIZE)
  ctx.fillStyle = inkFor(draft.bg || '#ffffff')
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const lines = wrap(ctx, text, SIZE - 64)
  const size = lines.length >= 3 ? 64 : lines.length === 2 ? 84 : 112
  ctx.font = `bold ${size}px system-ui, -apple-system, "Noto Color Emoji", "Segoe UI Emoji", sans-serif`
  const lineHeight = size * 1.22
  const top = SIZE / 2 - ((lines.length - 1) * lineHeight) / 2
  lines.forEach((line, i) => ctx.fillText(line, SIZE / 2, top + i * lineHeight, SIZE - 64))
  return true
}

/** 导出为可直接上传的 PNG 文件 */
export async function renderStickerFile(draft: StickerDraft): Promise<File | null> {
  const text = String(draft.text || '').trim()
  if (!text) return null
  const canvas = document.createElement('canvas')
  if (!drawSticker(canvas, draft)) return null
  const blob = await blobOf(canvas)
  if (!blob) return null
  return toFile(blob, `sticker-${Date.now()}.png`)
}
