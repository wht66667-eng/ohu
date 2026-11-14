import { loadMomentImage, normalizeMomentPhoto, photoCanvas } from './moment-photo'
import { stickerEdgeCanvas, type StickerEdge } from './photo-sticker'
import { defaultEdgeForPreset, lifeRecordId, type LifeRecordPhoto, type PhotoPreset } from './life-records'

const STICKER_MAX_SIDE = 512

function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取照片失败，请重试。'))
    reader.readAsDataURL(file)
  })
}

async function stickerDataUrl(original: string, edge: StickerEdge, seed = ''): Promise<string> {
  const image = await loadMomentImage(original)
  const scale = Math.min(1, STICKER_MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = photoCanvas(image.naturalWidth * scale, image.naturalHeight * scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法打开图片画布。')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return stickerEdgeCanvas(canvas, edge, 14, seed).toDataURL('image/png')
}

/** 本机压缩原图并生成透明 PNG 贴纸；失败抛错，调用方仍可先保存文字记录。 */
export async function buildLifePhoto(file: File, preset: PhotoPreset): Promise<LifeRecordPhoto> {
  const original = await fileDataUrl(await normalizeMomentPhoto(file))
  const edge = defaultEdgeForPreset(preset)
  const id = lifeRecordId()
  return { id, original, sticker: await stickerDataUrl(original, edge, id), preset, edge }
}

/** 换边或换预设时基于同一张原图重算贴纸，不新增记录。 */
export async function restyleLifePhoto(photo: LifeRecordPhoto, edge: StickerEdge, preset: PhotoPreset = photo.preset): Promise<LifeRecordPhoto> {
  return { ...photo, preset, edge, sticker: await stickerDataUrl(photo.original, edge, photo.id) }
}