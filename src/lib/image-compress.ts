/**
 * 上传前压缩图片。相册原图普遍 3–8MB，超过上传底座 2MB 上限会直接被拦下。
 *
 * 用 browser-image-compression（MIT）：自研那版不处理 EXIF 方向，iPhone 和部分
 * 安卓拍的照片上传后是侧躺的；且 drawImage + toBlob 遇到 50MP / HEIC 这类大图
 * 可能既不 resolve 也不 reject，Promise 挂死会让 uploading 永远停在 true、
 * 发布按钮卡住。
 *
 * 不 import ./cb：同 upload-error.ts，别把单例带进只测纯函数的地方。
 */
import imageCompression from 'browser-image-compression'

export interface CompressResult {
  file: File
  /** 是否真的压过（false = 原样返回，调用方按原体积继续判断） */
  compressed: boolean
}

/** 压缩后的长边上限 */
const MAX_SIDE = 1600

/** GIF 不重编码（会丢动画）；体积已达标或环境不支持时原样返回 */
const SKIP_TYPES = new Set(['image/gif'])

/** 单档超时：挂住就退回原图，不让 UI 卡住 */
const STEP_TIMEOUT_MS = 20_000

/* 逐级收紧：先保画质，压不动再降分辨率。整档超时或抛错就换下一档。 */
const STEPS = [
  { maxWidthOrHeight: MAX_SIDE, initialQuality: 0.82 },
  { maxWidthOrHeight: 1280, initialQuality: 0.72 },
  { maxWidthOrHeight: 1024, initialQuality: 0.6 },
] as const

/** 把任意 Promise 变成「最多等 ms 毫秒」的 Promise；超时或失败都给 fallback */
function withTimeout<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(fallback)
    }, ms)
    const done = (value: T) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    work.then(done, () => done(fallback))
  })
}

function canCompress(file: File): boolean {
  if (SKIP_TYPES.has(file.type)) return false
  /* 非浏览器环境（单测 / SSR）没有 canvas 与 Image，原样返回即可 */
  if (typeof document === 'undefined' || typeof Image === 'undefined') return false
  return true
}

function renameToJpg(name: string): string {
  return name.replace(/\.[^.]+$/, '') + '.jpg'
}

/** 压到 maxBytes 以内；压不了或不该压就原样返回。调用方自行判断最终体积。 */
export async function compressImage(file: File, maxBytes: number): Promise<CompressResult> {
  if (file.size <= maxBytes || !canCompress(file)) return { file, compressed: false }

  const targetMb = Math.max(0.1, maxBytes / (1024 * 1024))

  for (const step of STEPS) {
    try {
      const out = await withTimeout(
        imageCompression(file, {
          maxSizeMB: targetMb,
          maxWidthOrHeight: step.maxWidthOrHeight,
          initialQuality: step.initialQuality,
          /* Worker 里做重编码，避免大图在 WebView 主线程里卡死 UI */
          useWebWorker: true,
        }),
        STEP_TIMEOUT_MS,
        null,
      )
      if (out && out.size > 0 && out.size <= maxBytes) {
        return { file: new File([out], renameToJpg(file.name), { type: 'image/jpeg' }), compressed: true }
      }
    } catch {
      /* 本档失败，换下一档 */
    }
  }

  /* 都失败了就交回原文件，让上层按体积报错 */
  return { file, compressed: false }
}
