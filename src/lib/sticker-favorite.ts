/**
 * 编辑器裁切贴纸 → 收藏载荷的纯校验层（LIFE-LINK-8）。
 *
 * 收藏与生活记录分库（ohu-local-stickers），本模块只负责把编辑器
 * 裁切产物（贴前原图 dataURL + 加边贴纸 dataURL + 边参数）整理成
 * LocalSticker 可接受的 LifeRecordPhoto 形状；不做任何 I/O，
 * 可在 Node 直接加载测试。
 */
import type { LifeRecordPhoto } from './life-records.ts'
import type { StickerEdge } from './photo-sticker.ts'

const DATA_URL_PREFIX = 'data:image/png;base64,'
const MAX_DATA_URL_CHARS = 3_500_000

/** 校验并构造可收藏的贴纸载荷；任何一项不合法都返回 null，由调用方保持静默降级。 */
export function cropStickerFavorite(id: string, original: string, sticker: string, edge: StickerEdge): LifeRecordPhoto | null {
  const key = typeof id === 'string' ? id.trim() : ''
  if (!key || key.length > 64) return null
  const cleanedOriginal = typeof original === 'string' ? original : ''
  const cleanedSticker = typeof sticker === 'string' ? sticker : ''
  if (!cleanedOriginal.startsWith(DATA_URL_PREFIX) || cleanedOriginal.length > MAX_DATA_URL_CHARS) return null
  if (!cleanedSticker.startsWith(DATA_URL_PREFIX) || cleanedSticker.length > MAX_DATA_URL_CHARS) return null
  if (edge !== 'none' && edge !== 'paper' && edge !== 'white' && edge !== 'torn') return null
  return { id: key, original: cleanedOriginal, sticker: cleanedSticker, preset: 'photo', edge }
}
