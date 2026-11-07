/** 本机选图与编辑的统一边界，不读取整个相册，不在选图时上传。 */
export const MAX_MOMENT_IMAGE_BYTES = 20 * 1024 * 1024

/** 解码当前选择的图片；失败时返回可读错误，不把不支持的格式当成空白图。 */
export function loadMomentImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('这张图片无法解码，请转换为 JPG、PNG 或 WebP 后重试。'))
    image.src = src
  })
}

/** 按整数逻辑像素创建画布，避免零尺寸导致裁剪与导出失败。 */
export function photoCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(width)); canvas.height = Math.max(1, Math.round(height))
  return canvas
}

/** 归一化方向和解码格式，限制像素数；浏览器不能解码的 HEIC 不冒充支持。 */
export async function normalizeMomentPhoto(file: File, maxSide = 1600): Promise<File> {
  if (!file.type.startsWith('image/') || file.size < 1 || file.size > MAX_MOMENT_IMAGE_BYTES) throw new Error('请选择 20 MB 以内的图片。')
  const url = URL.createObjectURL(file)
  try {
    const image = await loadMomentImage(url)
    if (image.naturalWidth * image.naturalHeight > 60_000_000) throw new Error('图片像素过大，请先缩小图片。')
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = photoCanvas(image.naturalWidth * scale, image.naturalHeight * scale)
    const context = canvas.getContext('2d'); if (!context) throw new Error('无法打开图片画布。')
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvasPhotoFile(canvas, file.name)
  } finally { URL.revokeObjectURL(url) }
}

/** 合成为 JPEG 文件；只生成本机文件，不触发上传或写入云端。 */
export function canvasPhotoFile(canvas: HTMLCanvasElement, name = 'moment.jpg'): Promise<File> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(new File([blob], name.replace(/\.[^.]*$/, '') + '.jpg', { type: 'image/jpeg' })) : reject(new Error('图片导出失败，请重试。')), 'image/jpeg', 0.94))
}
