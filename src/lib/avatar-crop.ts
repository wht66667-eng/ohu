/**
 * 头像裁剪的纯几何部分（无 DOM，可单测）
 *
 * ⚠️ 2026-10-08：取景/缩放/裁剪这些几何计算已由 react-easy-crop 接管
 * （见 src/components/AvatarCropper.tsx）——它直接在源图坐标上给出裁剪区，
 * 修掉了自研版「圆形取景圈只占 78%，却按整个正方形导出」的所见非所得问题。
 *
 * 本文件目前仍在生产链路上的只有 `AVATAR_OUT`（导出边长）和 `canvasToFile`
 * （画布 → 512² JPEG）。下面的 scale/offset 算式保留用于回归参考与必要时回退，
 * 现由 tools/avatar-crop.test.mjs 覆盖，不再被组件调用。
 *
 * 旧模型说明：图片按 scale（屏幕像素 / 图片像素）缩放后居中放入 box，
 * 再整体平移 (tx, ty)——表示图片中心相对 box 中心的偏移。
 * 约束只有一条：图片任何时刻都要盖满 box（cover），不允许露底。
 */

/** 输出头像的边长（正方形） */
export const AVATAR_OUT = 512

/** 最大放大倍数：相对刚好盖满 box 的最小 scale */
export const AVATAR_MAX_ZOOM = 5

/** 刚好盖满 box 需要的 scale（cover） */
export function coverScale(imgW: number, imgH: number, box: number): number {
  if (!(imgW > 0) || !(imgH > 0) || !(box > 0)) return 1
  return Math.max(box / imgW, box / imgH)
}

/** 允许的 scale 区间：[cover, cover * maxZoom] */
export function scaleRange(imgW: number, imgH: number, box: number, maxZoom = AVATAR_MAX_ZOOM): { min: number; max: number } {
  const min = coverScale(imgW, imgH, box)
  const z = Number.isFinite(maxZoom) && maxZoom >= 1 ? maxZoom : AVATAR_MAX_ZOOM
  return { min, max: min * z }
}

/** 夹住缩放，避免缩到露出背景或放到离谱 */
export function clampScale(scale: number, imgW: number, imgH: number, box: number, maxZoom = AVATAR_MAX_ZOOM): number {
  const { min, max } = scaleRange(imgW, imgH, box, maxZoom)
  const s = Number.isFinite(scale) ? scale : min
  return Math.min(max, Math.max(min, s))
}

/**
 * 夹住平移量：图片缩放后比 box 大多少，就允许移多少。
 * 图片没盖满（理论不会发生，防御一下）时归零居中。
 */
export function clampOffset(
  scale: number,
  tx: number,
  ty: number,
  imgW: number,
  imgH: number,
  box: number,
): { tx: number; ty: number } {
  const dw = imgW * scale
  const dh = imgH * scale
  const fx = Math.max(0, (dw - box) / 2)
  const fy = Math.max(0, (dh - box) / 2)
  const nx = Number.isFinite(tx) ? tx : 0
  const ny = Number.isFinite(ty) ? ty : 0
  return {
    tx: Math.min(fx, Math.max(-fx, nx)),
    ty: Math.min(fy, Math.max(-fy, ny)),
  }
}

/**
 * 双指捏合 / 滚轮缩放时，保持手指下的图像内容不动：
 * 新 scale 下重新解出 tx，让同一个 box 点仍对应同一个图片点。
 */
export function zoomAt(
  scale: number,
  tx: number,
  ty: number,
  nextScale: number,
  px: number,
  py: number,
  imgW: number,
  imgH: number,
  box: number,
): { scale: number; tx: number; ty: number } {
  const s2 = clampScale(nextScale, imgW, imgH, box)
  // p 点下的图像坐标（相对图片中心，图片像素）：两个尺度下必须一致
  const cx = (px - box / 2 - tx) / scale
  const cy = (py - box / 2 - ty) / scale
  // 反解新平移量，让 p 点仍对着同一处图像内容
  const rawTx = px - box / 2 - cx * s2
  const rawTy = py - box / 2 - cy * s2
  const next = clampOffset(s2, rawTx, rawTy, imgW, imgH, box)
  return { scale: s2, ...next }
}

/**
 * 把当前视口对应的源图区域画到 out×out 的画布上（浏览器环境调用）。
 *
 * @param viewport 取景框的**实际渲染边长**（CSS 像素）；scale/tx/ty 都基于它
 */
export function drawAvatarCrop(
  img: HTMLImageElement | HTMLCanvasElement,
  scale: number,
  tx: number,
  ty: number,
  viewport: number,
  out = AVATAR_OUT,
): HTMLCanvasElement | null {
  const iw = 'naturalWidth' in img ? img.naturalWidth : img.width
  const ih = 'naturalHeight' in img ? img.naturalHeight : img.height
  if (!(viewport > 0) || !(scale > 0)) return null
  const srcSize = viewport / scale
  const sx = (iw - srcSize) / 2 - tx / scale
  const sy = (ih - srcSize) / 2 - ty / scale
  const canvas = document.createElement('canvas')
  canvas.width = out
  canvas.height = out
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  // 先铺白底：PNG 透明部分导出成 JPEG 时不会变黑
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, out, out)
  ctx.drawImage(img, sx, sy, srcSize, srcSize, 0, 0, out, out)
  return canvas
}

/** 画布 → JPEG File（头像统一转 512² JPEG，顺带把大图压到远小于 2MB） */
export async function canvasToFile(canvas: HTMLCanvasElement): Promise<File | null> {
  const blob = await new Promise<Blob | null>((resolve) => {
    if (canvas.toBlob) {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92)
    } else {
      // 老 WebView 兜底：dataURL → Blob
      try {
        const url = canvas.toDataURL('image/jpeg', 0.92)
        const bin = atob(url.split(',')[1] || '')
        const buf = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
        resolve(new Blob([buf], { type: 'image/jpeg' }))
      } catch {
        resolve(null)
      }
    }
  })
  if (!blob) return null
  return new File([blob], `avatar-${Date.now()}.jpg`, { type: 'image/jpeg' })
}
