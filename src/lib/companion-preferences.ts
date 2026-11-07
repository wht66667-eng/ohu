/** 宠物外观与位置只保存在当前设备，不上传照片、不执行皮肤脚本。 */
export type CompanionPosition = { x: number; y: number }
export interface CompanionPreferences { image: string; position: CompanionPosition | null }
const KEY = 'ohu.companion.preferences.v1'
const EVENT = 'ohu-companion-preferences'
export const MAX_COMPANION_DATA_LENGTH = 360_000

/** 只接受经本机重新编码的PNG，不允许远程URL、SVG或任意数据协议。 */
export function validateCompanionPreferences(value: unknown): CompanionPreferences {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const image = typeof raw.image === 'string' && raw.image.length <= MAX_COMPANION_DATA_LENGTH && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(raw.image) ? raw.image : ''
  const point = raw.position as Partial<CompanionPosition> | null
  const position = point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number(point.x) >= 0 && Number(point.x) <= 1 && Number(point.y) >= 0 && Number(point.y) <= 1 ? { x: Number(point.x), y: Number(point.y) } : null
  return { image, position }
}
export function getCompanionPreferences(): CompanionPreferences {
  try { return validateCompanionPreferences(JSON.parse(localStorage.getItem(KEY) || 'null')) } catch { return { image: '', position: null } }
}
/** 存储失败向上返回，避免界面误报已经记住宠物／位置。 */
export function saveCompanionPreferences(next: CompanionPreferences): void {
  const checked = validateCompanionPreferences(next)
  if (checked.image !== next.image || (next.position && !checked.position)) throw new Error('宠物设置无效，请重新选择')
  localStorage.setItem(KEY, JSON.stringify(checked)); window.dispatchEvent(new Event(EVENT))
}
export function subscribeCompanionPreferences(callback: () => void): () => void {
  const onStorage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) callback() }
  window.addEventListener(EVENT, callback); window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener(EVENT, callback); window.removeEventListener('storage', onStorage) }
}
/** 使用可用区域的归一化坐标，屏幕旋转或换页面后仍不会拖到屏幕外。 */
export function companionPoint(position: CompanionPosition | null, width: number, height: number) {
  const maxX = Math.max(0, width - 76 - 16), maxY = Math.max(0, height - 84 - 98)
  return { x: 8 + (position?.x ?? 1) * maxX, y: 8 + (position?.y ?? 1) * maxY, maxX, maxY }
}
