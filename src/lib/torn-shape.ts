/** 撕纸边形状的纯计算层（零依赖，Node 可测）；画布合成在 photo-sticker.ts。 */

/** 由种子生成确定性的伪随机数序列（mulberry32），同一照片重算撕纸边得到同一形状。 */
export function seededRandom(seed: string) {
  let state = 2166136261
  for (let i = 0; i < seed.length; i += 1) { state ^= seed.charCodeAt(i); state = Math.imul(state, 16777619) }
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** 撕纸边多边形（归一化 0..1 坐标，椭圆基线 + 种子抖动）；纯函数。 */
export function tornPolygonPoints(seed: string, count = 26): Array<{ x: number; y: number }> {
  const random = seededRandom(seed || 'ohu')
  const points: Array<{ x: number; y: number }> = []
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2
    const jitter = 0.86 + random() * 0.14
    points.push({ x: 0.5 + Math.cos(angle) * 0.5 * jitter, y: 0.5 + Math.sin(angle) * 0.5 * jitter })
  }
  return points
}
