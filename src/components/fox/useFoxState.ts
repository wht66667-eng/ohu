/**
 * 个人表情和图鉴共用 engagement 快照；功能位单独选择动作。
 */
import { useEffect, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { loadCampusAccount } from '../../lib/campus-account'
import { getAppShell } from '../../lib/app-shell'
import {
  FOX_EVENT,
  getEngagementSync,
  resolveEngagementUid,
  type Engagement,
} from '../../lib/engagement'

export { FOX_EVENT }

export function readEngagement(uid: string, shell = getAppShell()): Engagement {
  return getEngagementSync(uid, shell)
}

/**
 * 订阅狐狸表情状态：所有 FoxAvatar / FoxInline / FoxMoment 共用。
 * checkIn / touchActive 会广播 'fox-state-change'，从而全局同步变脸。
 */
export function useFoxState(): Engagement | null {
  const auth = useAuth()
  const shell = getAppShell()
  const uid = resolveEngagementUid({
    cloudUid: auth.user?.uid,
    campusStuid: loadCampusAccount().stuid,
  })
  const [eng, setEng] = useState<Engagement | null>(() => readEngagement(uid, shell))

  useEffect(() => {
    const snap = () => setEng(readEngagement(uid, shell))
    snap()
    const onChange = (e: Event) => {
      const d = (e as CustomEvent<Engagement>).detail
      if (d?.uid === uid && d.shell === shell) setEng(d)
    }
    window.addEventListener(FOX_EVENT, onChange)
    window.addEventListener('focus', snap)
    document.addEventListener('visibilitychange', snap)
    return () => {
      window.removeEventListener(FOX_EVENT, onChange)
      window.removeEventListener('focus', snap)
      document.removeEventListener('visibilitychange', snap)
    }
  }, [uid, shell])

  return eng?.uid === uid && eng.shell === shell ? eng : readEngagement(uid, shell)
}
