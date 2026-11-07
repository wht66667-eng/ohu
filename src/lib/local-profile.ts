/**
 * 学号本机资料：手机号账号移除后，昵称/学院等资料只保存在本机。
 * 不联网、不上传；换设备需要重新填写。
 */
import type { AuthProfile } from './auth'

const PREFIX = 'ohu.local-profile.v1:uid:'
const key = (uid: string) => `${PREFIX}${encodeURIComponent(uid)}`

export function readLocalProfile(uid: string, studentId: string): AuthProfile {
  const fallback: AuthProfile = {
    username: studentId ? `同学 ${studentId}` : '同学',
    building: '',
    isAdmin: false,
    studentId,
    realName: '',
    grade: '',
    major: '',
    college: '',
  }
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key(uid)) || 'null')
    if (!raw || typeof raw !== 'object') return fallback
    const record = raw as Record<string, unknown>
    return {
      ...fallback,
      username: typeof record.username === 'string' && record.username.trim() ? record.username.trim() : fallback.username,
      building: typeof record.building === 'string' ? record.building : '',
      realName: typeof record.realName === 'string' ? record.realName : '',
      grade: typeof record.grade === 'string' ? record.grade : '',
      major: typeof record.major === 'string' ? record.major : '',
      college: typeof record.college === 'string' ? record.college : '',
    }
  } catch {
    return fallback
  }
}

export function saveLocalProfile(uid: string, profile: AuthProfile): boolean {
  try {
    localStorage.setItem(key(uid), JSON.stringify({
      username: profile.username,
      building: profile.building,
      realName: profile.realName || '',
      grade: profile.grade || '',
      major: profile.major || '',
      college: profile.college || '',
    }))
    return true
  } catch {
    return false
  }
}
