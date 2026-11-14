/**
 * PU 二课本机缓存：按哦狐账号隔离，图标只存结构化学分，不存任何账号、token 或页面原文。
 *
 * 与「公选进度」不是同一口径：PU 来自口袋校园（独立账号体系），公选来自校园档案；
 * 两边不混算、不互相抵扣。
 */
import { captureQbankSession, isQbankSessionCurrent } from './qbank'
import { puSummaryFromJson, puSummaryToJson, type PuSummary } from './pocketuni-parse'

const STORAGE_PREFIX = 'ohu.pocketuni.v1'
export const PU_STORAGE_EVENT = 'ohu-pocketuni-change'

export const PU_HOME_URL = 'https://class.pocketuni.net/'

const storageKey = (uid: string) => `${STORAGE_PREFIX}:${uid ? `uid:${encodeURIComponent(uid)}` : 'guest'}`

export function readPocketUni(): PuSummary | null {
  try {
    const raw = localStorage.getItem(storageKey(captureQbankSession().uid))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return puSummaryFromJson(parsed)
  } catch {
    return null
  }
}

export function savePocketUni(summary: PuSummary): PuSummary {
  const session = captureQbankSession()
  const key = storageKey(session.uid)
  const normalized = puSummaryFromJson({ ...puSummaryToJson(summary), syncedAt: Date.now() })
  if (!normalized) throw new Error('PU 数据格式不正确，未保存。')
  let previous: string | null = null
  try {
    previous = localStorage.getItem(key)
    const encoded = JSON.stringify(puSummaryToJson(normalized))
    localStorage.setItem(key, encoded)
    if (localStorage.getItem(key) !== encoded || !isQbankSessionCurrent(session)) {
      if (previous === null) localStorage.removeItem(key)
      else localStorage.setItem(key, previous)
      throw new Error('账号已切换，PU 数据没有保存。')
    }
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(PU_STORAGE_EVENT))
    return normalized
  } catch (error) {
    if (error instanceof Error && error.message.includes('账号已切换')) throw error
    throw new Error('PU 学分未能保存到本机，请检查存储空间后重试。')
  }
}

export function clearPocketUni(): boolean {
  try {
    localStorage.removeItem(storageKey(captureQbankSession().uid))
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(PU_STORAGE_EVENT))
    return true
  } catch {
    return false
  }
}
