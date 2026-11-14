/**
 * 首次启动的端别与学校档案（M-ENTRY）。
 *
 * 首登出现「学生端 / 社工端」两个入口：
 * - 学生端沿用现有学号认证链（CampusGate → 一键获取），需选择就读学校（当前仅江苏海洋大学开放）；
 * - 社工端面向校外/社会用户，走 CloudBase 邮箱或手机验证码登录（auth 层已具备）。
 * 端别与学校只存本机，可随时在「我的 → 切换身份」重选；不影响云端账号。
 *
 * TASK-A6（社工端复用学生端壳）：新增 useEntryTrack()——页面据此条件化隐藏学生专属
 * 入口（课表/成绩/考试/校历/一键获取等），只藏按钮不删路由；端别变化通过
 * TRACK_EVENT + storage 事件通知订阅者。
 */
import { useSyncExternalStore } from 'react'

export type EntryTrack = 'student' | 'social'

export interface SchoolProfile {
  id: string
  name: string
}

/** 已接入教务链的学校；其余为占位，开放前不可选。 */
export const SCHOOLS: (SchoolProfile & { available: boolean })[] = [
  { id: 'jou', name: '江苏海洋大学', available: true },
  { id: 'demo-a', name: '更多学校 · 即将开放', available: false },
  { id: 'demo-b', name: '合作院校接入中', available: false },
]

const TRACK_KEY = 'ohu.entry-track.v1'
const SCHOOL_KEY = 'ohu.school-profile.v1'
const TRACK_EVENT = 'ohhu-entry-track-change'

export function readEntryTrack(): EntryTrack | null {
  try {
    const raw = localStorage.getItem(TRACK_KEY)
    return raw === 'student' || raw === 'social' ? raw : null
  } catch { return null }
}

function notifyTrackChanged(): void {
  try { window.dispatchEvent(new Event(TRACK_EVENT)) } catch { /* 非浏览器环境忽略 */ }
}

export function saveEntryTrack(track: EntryTrack): void {
  try { localStorage.setItem(TRACK_KEY, track) } catch { /* 存储不可用时本次会话有效 */ }
  notifyTrackChanged()
}

export function clearEntryTrack(): void {
  try { localStorage.removeItem(TRACK_KEY) } catch { /* 忽略 */ }
  notifyTrackChanged()
}

function subscribeEntryTrack(onChange: () => void): () => void {
  window.addEventListener(TRACK_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(TRACK_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

/** 当前端别（student/social/未选择 null）；端别变化自动重渲染，供各页隐藏学生专属入口。 */
export function useEntryTrack(): EntryTrack | null {
  return useSyncExternalStore(subscribeEntryTrack, readEntryTrack, readEntryTrack)
}

export function readSchoolProfile(): SchoolProfile | null {
  try {
    const raw = localStorage.getItem(SCHOOL_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SchoolProfile
    return parsed && typeof parsed.id === 'string' && typeof parsed.name === 'string' ? parsed : null
  } catch { return null }
}

export function saveSchoolProfile(profile: SchoolProfile): void {
  try { localStorage.setItem(SCHOOL_KEY, JSON.stringify(profile)) } catch { /* 忽略 */ }
}
