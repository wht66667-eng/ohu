/** 校园档案（第二课堂/公选学分）本机缓存：按哦狐 uid 隔离，与 PU 分开存。 */
import { captureQbankSession, isQbankSessionCurrent } from './qbank'
import { qualityFromJson, qualityToJson, type QualitySummary } from './quality-parse'

const PREFIX = 'ohu.quality.v1:uid:'
export const QUALITY_EVENT = 'ohu-quality-change'
const key = (uid: string) => `${PREFIX}${encodeURIComponent(uid)}`

export function readQuality(): QualitySummary | null {
  try {
    const uid = captureQbankSession().uid
    if (!uid) return null
    return qualityFromJson(JSON.parse(localStorage.getItem(key(uid)) || 'null'))
  } catch {
    return null
  }
}

export function saveQuality(summary: QualitySummary): QualitySummary {
  const session = captureQbankSession()
  if (!session.uid) throw new Error('请先登录哦狐账号。')
  const normalized = qualityFromJson({ ...qualityToJson(summary), syncedAt: Date.now() })
  if (!normalized) throw new Error('公选学分格式不正确，未保存。')
  try {
    localStorage.setItem(key(session.uid), JSON.stringify(qualityToJson(normalized)))
    if (!isQbankSessionCurrent(session)) throw new Error('账号已切换')
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(QUALITY_EVENT))
    return normalized
  } catch {
    throw new Error('公选学分未能保存到本机，请检查存储空间。')
  }
}
