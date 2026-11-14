/**
 * 学习通课程缓存：按哦狐账号隔离。
 *
 * 只存课程名与页面上的详情文字，不存 cookie、密码或签名链接；
 * 与云端只读同步（`learning-sync`）是两条独立通道，互不覆盖。
 */
import { captureQbankSession, isQbankSessionCurrent } from './qbank'
import { chaoxingFromJson, chaoxingToJson, type ChaoxingCourse, type ChaoxingCourses } from './chaoxing-parse'

const STORAGE_PREFIX = 'ohu.chaoxing.courses.v1'
export const CHAOXING_COURSES_EVENT = 'ohu-chaoxing-courses-change'

const storageKey = (uid: string) => `${STORAGE_PREFIX}:${uid ? `uid:${encodeURIComponent(uid)}` : 'guest'}`

export function readChaoxingCourses(): ChaoxingCourses | null {
  try {
    const raw = localStorage.getItem(storageKey(captureQbankSession().uid))
    if (!raw) return null
    return chaoxingFromJson(JSON.parse(raw))
  } catch {
    return null
  }
}

export function saveChaoxingCourses(courses: ChaoxingCourse[], session = captureQbankSession()): ChaoxingCourses {
  if (!isQbankSessionCurrent(session)) throw new Error('账号已切换，课程没有保存。')
  const key = storageKey(session.uid)
  const normalized = chaoxingFromJson({ courses, syncedAt: Date.now() })
  if (!normalized) throw new Error('课程数据格式不正确，未保存。')
  let previous: string | null = null
  try {
    previous = localStorage.getItem(key)
    const encoded = JSON.stringify(chaoxingToJson(normalized))
    localStorage.setItem(key, encoded)
    if (localStorage.getItem(key) !== encoded || !isQbankSessionCurrent(session)) {
      if (previous === null) localStorage.removeItem(key)
      else localStorage.setItem(key, previous)
      throw new Error('账号已切换，课程没有保存。')
    }
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHAOXING_COURSES_EVENT))
    return normalized
  } catch (error) {
    if (error instanceof Error && error.message.includes('账号已切换')) throw error
    throw new Error('课程未能保存到本机，请检查存储空间后重试。')
  }
}

export function clearChaoxingCourses(): boolean {
  try {
    localStorage.removeItem(storageKey(captureQbankSession().uid))
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHAOXING_COURSES_EVENT))
    return true
  } catch {
    return false
  }
}
