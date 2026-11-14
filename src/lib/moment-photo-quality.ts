import FFT from 'fft.js'

export type QualityMode = 'none' | 'denoise' | 'blur' | 'sharpen' | 'wavelet-denoise' | 'wavelet-detail' | 'edges' | 'emboss' | 'median'
export type PhotoFilter = 'none' | 'mono' | 'warm' | 'cool' | 'vivid' | 'sepia' | 'invert' | 'fade'
export interface PhotoAdjustments { exposure: number; brightness: number; contrast: number; saturation: number; temperature: number; gamma: number; vignette: number }
export const DEFAULT_PHOTO_ADJUSTMENTS: PhotoAdjustments = { exposure: 0, brightness: 0, contrast: 0, saturation: 100, temperature: 0, gamma: 100, vignette: 0 }
export const CAMPUS_FILTERS = {
  original: { label: '原色', adjustments: DEFAULT_PHOTO_ADJUSTMENTS },
  morning: { label: '早八窗边', adjustments: { exposure: .1, contrast: -6, saturation: 103, temperature: 6, gamma: 105 } },
  breeze: { label: '海风蓝', adjustments: { contrast: 4, saturation: 88, temperature: -8 } },
  sunset: { label: '操场落日', adjustments: { exposure: -.1, contrast: 7, saturation: 111, temperature: 10, vignette: 6 } },
  album: { label: '旧相册', adjustments: { contrast: -12, saturation: 82, temperature: 5, gamma: 105, vignette: 8 } },
  night: { label: '夜自习', adjustments: { exposure: .1, contrast: -8, saturation: 90, temperature: -3, gamma: 110 } },
  whiteboard: { label: '白板笔记', adjustments: { contrast: 12, saturation: 0, gamma: 105 } },
} satisfies Record<string, { label: string; adjustments: Partial<PhotoAdjustments> }>
export type CampusFilter = keyof typeof CAMPUS_FILTERS
export interface PhotoTone { version: 2; shadows: number; highlights: number; tint: number; midtone: number }
export interface PhotoQuality { tone?: PhotoTone; preset?: CampusFilter; filterStrength?: number; sharpenRadius?: number; sharpenThreshold?: number; adaptiveWavelet?: boolean; waveletLevels?: number; waveletThreshold?: number; mode: QualityMode; strength: number; filter: PhotoFilter; adjustments?: PhotoAdjustments }

const SIZE = 128, HALO = 24, CORE = SIZE - HALO * 2
/** 镜像边界避免图片外缘与分块边缘因零填充而出现黑边。 */
function mirror(value: number, size: number): number {
  if (size <= 1) return 0
  const period = 2 * size - 2
  const at = ((value % period) + period) % period
  return at < size ? at : period - at
}

/** 三级正交Haar小波：保留低频近似，仅对细节系数软阈值降噪或有限增强。 */
function wavelet(pixels: Uint8ClampedArray, result: Uint8ClampedArray, width: number, height: number, amount: number, detail: boolean, settings: PhotoQuality) {
  const padded = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(2, n)))
  const w = padded(width), h = padded(height), levels = Math.min(settings.waveletLevels ?? 3, Math.log2(w), Math.log2(h))
  const data = new Float32Array(w * h), temp = new Float32Array(Math.max(w, h)), root = Math.SQRT2
  for (let channel = 0; channel < 3; channel++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = pixels[(mirror(y, height) * width + mirror(x, width)) * 4 + channel]
    for (let level = 0; level < levels; level++) {
      const cw = w >> level, ch = h >> level
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw / 2; x++) { const a = data[y * w + x * 2], b = data[y * w + x * 2 + 1]; temp[x] = (a + b) / root; temp[x + cw / 2] = (a - b) / root }
        data.set(temp.subarray(0, cw), y * w)
      }
      for (let x = 0; x < cw; x++) {
        for (let y = 0; y < ch / 2; y++) { const a = data[y * 2 * w + x], b = data[(y * 2 + 1) * w + x]; temp[y] = (a + b) / root; temp[y + ch / 2] = (a - b) / root }
        for (let y = 0; y < ch; y++) data[y * w + x] = temp[y]
      }
    }
    const lowW = w >> levels, lowH = h >> levels, threshold = amount * 32
    if (settings.adaptiveWavelet) {
      const sample: number[] = []
      for (let y = h / 2; y < h; y += 4) for (let x = w / 2; x < w; x += 4) sample.push(Math.abs(data[y * w + x]))
      sample.sort((a, b) => a - b)
      const noiseVariance = (sample[Math.floor(sample.length / 2)] / .6745) ** 2
      const multiplier = settings.waveletThreshold ?? 1
      for (let level = 0; level < levels; level++) {
        const halfW = w >> (level + 1), halfH = h >> (level + 1)
        for (const [left, top] of [[halfW, 0], [0, halfH], [halfW, halfH]]) {
          let square = 0
          for (let y = top; y < top + halfH; y++) for (let x = left; x < left + halfW; x++) square += data[y * w + x] ** 2
          const signalDeviation = Math.sqrt(Math.max(0, square / (halfW * halfH) - noiseVariance))
          const cutoff = noiseVariance / Math.max(signalDeviation, 1e-6) * multiplier
          for (let y = top; y < top + halfH; y++) for (let x = left; x < left + halfW; x++) {
            const at = y * w + x, value = data[at]
            const magnitude = Math.max(0, Math.abs(value) - cutoff)
            data[at] = detail
              ? value + (level === 1 ? Math.sign(value) * magnitude * amount * .15 : 0)
              : value + (Math.sign(value) * magnitude - value) * amount
          }
        }
      }
    } else {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (x < lowW && y < lowH) continue
        const at = y * w + x, value = data[at]
        data[at] = detail ? value * (1 + amount * 1.2) : Math.sign(value) * Math.max(0, Math.abs(value) - threshold)
      }
    }
    for (let level = levels - 1; level >= 0; level--) {
      const cw = w >> level, ch = h >> level
      for (let x = 0; x < cw; x++) {
        for (let y = 0; y < ch / 2; y++) { const a = data[y * w + x], b = data[(y + ch / 2) * w + x]; temp[y * 2] = (a + b) / root; temp[y * 2 + 1] = (a - b) / root }
        for (let y = 0; y < ch; y++) data[y * w + x] = temp[y]
      }
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw / 2; x++) { const a = data[y * w + x], b = data[y * w + x + cw / 2]; temp[x * 2] = (a + b) / root; temp[x * 2 + 1] = (a - b) / root }
        data.set(temp.subarray(0, cw), y * w)
      }
    }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) result[(y * width + x) * 4 + channel] = data[y * w + x]
  }
}

/** 二维傅里叶滤波：行列分离变换，固定小块加重叠边界，限制手机内存峰值。 */
export function processPhotoPixels(pixels: Uint8ClampedArray, width: number, height: number, settings: PhotoQuality): Uint8ClampedArray {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 2048 || height > 2048 || pixels.length !== width * height * 4) throw new Error('图片尺寸超出处理范围')
  if (!['none', 'denoise', 'blur', 'sharpen', 'wavelet-denoise', 'wavelet-detail', 'edges', 'emboss', 'median'].includes(settings.mode) || !['none', 'mono', 'warm', 'cool', 'vivid', 'sepia', 'invert', 'fade'].includes(settings.filter) || !Number.isFinite(settings.strength)) throw new Error('画质参数无效')
  const adjust = { ...DEFAULT_PHOTO_ADJUSTMENTS, ...settings.adjustments }
  if (settings.preset !== undefined && !Object.hasOwn(CAMPUS_FILTERS, settings.preset)) throw new Error('滤镜无效')
  const preset = { ...DEFAULT_PHOTO_ADJUSTMENTS, ...CAMPUS_FILTERS[settings.preset ?? 'original'].adjustments }
  const presetMix = settings.preset && settings.preset !== 'original' ? (settings.filterStrength ?? 60) / 100 : 0
  if (!Number.isFinite(presetMix) || presetMix < 0 || presetMix > 1) throw new Error('滤镜强度无效')
  const ranges: Record<keyof PhotoAdjustments, [number, number]> = { exposure: [-2, 2], brightness: [-50, 50], contrast: [-50, 50], saturation: [0, 200], temperature: [-50, 50], gamma: [50, 200], vignette: [0, 100] }
  for (const key of Object.keys(ranges) as Array<keyof PhotoAdjustments>) {
    if (!Number.isFinite(adjust[key]) || adjust[key] < ranges[key][0] || adjust[key] > ranges[key][1]) throw new Error('调节参数超出范围')
  }
  if (settings.sharpenRadius !== undefined && (!Number.isFinite(settings.sharpenRadius) || settings.sharpenRadius < .4 || settings.sharpenRadius > 3)) throw new Error('锐化半径无效')
  if (settings.sharpenThreshold !== undefined && (!Number.isFinite(settings.sharpenThreshold) || settings.sharpenThreshold < 0 || settings.sharpenThreshold > 20)) throw new Error('锐化阈值无效')
  if (settings.waveletLevels !== undefined && settings.waveletLevels !== 2 && settings.waveletLevels !== 3) throw new Error('小波层数无效')
  if (settings.waveletThreshold !== undefined && (!Number.isFinite(settings.waveletThreshold) || settings.waveletThreshold < .6 || settings.waveletThreshold > 1.2)) throw new Error('小波阈值倍率无效')
  const tone = settings.tone
  if (tone && (tone.version !== 2 || [tone.shadows, tone.highlights, tone.tint, tone.midtone].some(value => !Number.isFinite(value) || Math.abs(value) > 50))) throw new Error('色调参数无效')
  const amount = Math.min(1, Math.max(0, settings.strength / 100))
  const result = new Uint8ClampedArray(pixels)
  if (['denoise', 'blur', 'sharpen'].includes(settings.mode) && amount > 0) {
    const fft = new FFT(SIZE)
    const block = new Float64Array(SIZE * SIZE * 2)
    const line = new Float64Array(SIZE * 2), transformed = new Float64Array(SIZE * 2)
    const weights = new Float64Array(SIZE * SIZE)
    const sigma = settings.mode === 'blur' ? 0.3 + amount * 4 : settings.mode === 'denoise' ? 0.3 + amount * 1.2 : (settings.sharpenRadius ?? 1.2)
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
      const fx = Math.min(x, SIZE - x) / SIZE, fy = Math.min(y, SIZE - y) / SIZE
      const low = Math.exp(-2 * Math.PI ** 2 * sigma ** 2 * (fx * fx + fy * fy))
      weights[y * SIZE + x] = settings.mode === 'sharpen' ? 1 + amount * 1.8 * (1 - low) : low
    }
    const transform = (inverse: boolean) => {
      for (let axis = 0; axis < 2; axis++) for (let row = 0; row < SIZE; row++) {
        for (let col = 0; col < SIZE; col++) {
          const at = (axis === 0 ? row * SIZE + col : col * SIZE + row) * 2
          line[col * 2] = block[at]; line[col * 2 + 1] = block[at + 1]
        }
        if (inverse) fft.inverseTransform(transformed, line)
        else fft.transform(transformed, line)
        for (let col = 0; col < SIZE; col++) {
          const at = (axis === 0 ? row * SIZE + col : col * SIZE + row) * 2
          block[at] = transformed[col * 2]; block[at + 1] = transformed[col * 2 + 1]
        }
      }
    }
    for (let top = 0; top < height; top += CORE) for (let left = 0; left < width; left += CORE) {
      for (let channel = 0; channel < 3; channel++) {
        for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
          const at = (y * SIZE + x) * 2
          block[at] = pixels[(mirror(top + y - HALO, height) * width + mirror(left + x - HALO, width)) * 4 + channel]
          block[at + 1] = 0
        }
        transform(false)
        for (let i = 0; i < weights.length; i++) { block[i * 2] *= weights[i]; block[i * 2 + 1] *= weights[i] }
        transform(true)
        for (let y = 0; y < CORE && top + y < height; y++) for (let x = 0; x < CORE && left + x < width; x++) {
          const pixel = ((top + y) * width + left + x) * 4 + channel
          const filtered = block[((y + HALO) * SIZE + x + HALO) * 2]
          const threshold = settings.mode === 'sharpen' ? settings.sharpenThreshold ?? 0 : 0
          result[pixel] = Math.abs(filtered - pixels[pixel]) < threshold ? pixels[pixel] : filtered
        }
      }
    }
  }
  if ((settings.mode === 'wavelet-denoise' || settings.mode === 'wavelet-detail') && amount > 0) wavelet(pixels, result, width, height, amount, settings.mode === 'wavelet-detail', settings)
  if (['edges', 'emboss', 'median'].includes(settings.mode) && amount > 0) {
    const sample = (x: number, y: number, c: number) => pixels[(mirror(y, height) * width + mirror(x, width)) * 4 + c]
    const values = new Float64Array(9)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) {
      const at = (y * width + x) * 4 + c
      let value: number
      if (settings.mode === 'median') {
        let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) values[n++] = sample(x + dx, y + dy, c)
        values.sort(); value = values[4]
      } else if (settings.mode === 'emboss') value = 128 + sample(x + 1, y + 1, c) - sample(x - 1, y - 1, c)
      else {
        const gx = -sample(x - 1, y - 1, c) + sample(x + 1, y - 1, c) - 2 * sample(x - 1, y, c) + 2 * sample(x + 1, y, c) - sample(x - 1, y + 1, c) + sample(x + 1, y + 1, c)
        const gy = -sample(x - 1, y - 1, c) - 2 * sample(x, y - 1, c) - sample(x + 1, y - 1, c) + sample(x - 1, y + 1, c) + 2 * sample(x, y + 1, c) + sample(x + 1, y + 1, c)
        value = Math.hypot(gx, gy) / 4
      }
      result[at] = pixels[at] * (1 - amount) + value * amount
    }
  }
  const gain = 2 ** adjust.exposure, contrast = (100 + adjust.contrast) / (100 - adjust.contrast), saturation = adjust.saturation / 100
  const exposureLut = tone && adjust.exposure !== 0 ? Float32Array.from({ length: 256 }, (_, index) => {
    const encoded = index / 255
    const linear = encoded <= .04045 ? encoded / 12.92 : ((encoded + .055) / 1.055) ** 2.4
    const exposed = linear * gain
    return 255 * (exposed <= .0031308 ? 12.92 * exposed : 1.055 * exposed ** (1 / 2.4) - .055)
  }) : null
  for (let i = 0; i < result.length; i += 4) {
    let r = result[i], g = result[i + 1], b = result[i + 2]
    if (settings.filter === 'mono') { const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b; result[i] = grey; result[i + 1] = grey; result[i + 2] = grey }
    if (settings.filter === 'warm') { result[i] = r * 1.06 + 4; result[i + 2] = b * 0.92 }
    if (settings.filter === 'cool') { result[i] = r * 0.94; result[i + 2] = b * 1.06 + 3 }
    if (settings.filter === 'vivid') { const mid = (r + g + b) / 3; result[i] = mid + (r - mid) * 1.25; result[i + 1] = mid + (g - mid) * 1.25; result[i + 2] = mid + (b - mid) * 1.25 }
    if (settings.filter === 'sepia') { result[i] = r * .393 + g * .769 + b * .189; result[i + 1] = r * .349 + g * .686 + b * .168; result[i + 2] = r * .272 + g * .534 + b * .131 }
    if (settings.filter === 'invert') { result[i] = 255 - r; result[i + 1] = 255 - g; result[i + 2] = 255 - b }
    if (settings.filter === 'fade') { result[i] = r * .8 + 25; result[i + 1] = g * .8 + 25; result[i + 2] = b * .8 + 25 }
    r = result[i]; g = result[i + 1]; b = result[i + 2]
    if (presetMix > 0) {
      const luma = r * .2126 + g * .7152 + b * .0722
      const x = (i / 4) % width, y = Math.floor(i / 4 / width)
      const edge = ((x - (width - 1) / 2) / Math.max(1, width / 2)) ** 2 + ((y - (height - 1) / 2) / Math.max(1, height / 2)) ** 2
      const shade = 1 - Math.min(1, edge / 2) * preset.vignette * .008
      const contrast = (100 + preset.contrast) / (100 - preset.contrast)
      const gain = 2 ** preset.exposure
      const gamma = 100 / preset.gamma
      const render = (input: number, tint: number) => {
        const color = luma + (input - luma) * preset.saturation / 100 + tint * preset.temperature / 2
        const value = ((color * gain - 128) * contrast + 128) / 255
        const filtered = 255 * Math.min(1, Math.max(0, value)) ** gamma * shade
        return input + (filtered - input) * presetMix
      }
      r = render(r, 1); g = render(g, 0); b = render(b, -1)
    }
    const grey = r * .2126 + g * .7152 + b * .0722
    const x = (i / 4) % width, y = Math.floor(i / 4 / width)
    const distance = ((x - (width - 1) / 2) / Math.max(1, width / 2)) ** 2 + ((y - (height - 1) / 2) / Math.max(1, height / 2)) ** 2
    const vignette = 1 - Math.min(1, distance / 2) * adjust.vignette / 100 * .8
    const channels = [grey + (r - grey) * saturation + adjust.temperature * .5, grey + (g - grey) * saturation, grey + (b - grey) * saturation - adjust.temperature * .5]
    for (let c = 0; c < 3; c++) {
      const channel = channels[c]
      let exposed = tone ? channel : channel * gain
      if (exposureLut) {
        const bounded = Math.min(255, Math.max(0, channel)), floor = Math.floor(bounded)
        exposed = exposureLut[floor] + (exposureLut[Math.min(255, floor + 1)] - exposureLut[floor]) * (bounded - floor)
      }
      let value = ((exposed - 128) * contrast + 128 + adjust.brightness * 2.55) / 255
      if (tone) {
        const luminance = Math.min(1, Math.max(0, grey / 255))
        const shape = 4 * luminance * (1 - luminance)
        value += shape * (tone.shadows * (1 - luminance) ** 2 + tone.highlights * luminance ** 2 + tone.midtone + tone.tint * (c === 1 ? -.7 : .35)) / 250
      }
      result[i + c] = 255 * Math.min(1, Math.max(0, value)) ** (100 / adjust.gamma) * vignette
    }
  }
  return result
}
