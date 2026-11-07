import { processPhotoPixels, type PhotoQuality } from './moment-photo-quality'

/** 原图只在本机 Worker 处理；大块像素使用 transfer，避免重复复制。 */
self.onmessage = (event: MessageEvent<{ buffer: ArrayBuffer; width: number; height: number; settings: PhotoQuality }>) => {
  try {
    const { buffer, width, height, settings } = event.data
    const pixels = processPhotoPixels(new Uint8ClampedArray(buffer), width, height, settings)
    self.postMessage({ buffer: pixels.buffer }, { transfer: [pixels.buffer] })
  } catch { self.postMessage({ error: '画质处理失败，请减小图片后重试。' }) }
}
