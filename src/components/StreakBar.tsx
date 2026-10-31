import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { loadCampusAccount } from '../lib/campus-account'
import { getAppShell } from '../lib/app-shell'
import { getEngagementSync, resolveEngagementUid, type Engagement } from '../lib/engagement'

/**
 * 设置页底部一句轻提示：登录即记连击，无打卡按钮。
 * 首页 / 工作台不再展示显眼打卡条。
 */
export function QuietLoginStreak() {
  const auth = useAuth()
  const shell = getAppShell()
  const uid = resolveEngagementUid({
    cloudUid: auth.user?.uid,
    campusStuid: loadCampusAccount().stuid,
  })
  const [eng, setEng] = useState<Engagement>(() => getEngagementSync(uid, shell))

  useEffect(() => {
    setEng(getEngagementSync(uid, shell))
  }, [uid, shell])

  if (!eng.streakCurrent) return null

  return (
    <p
      style={{
        margin: '8px 4px 0',
        fontSize: 12,
        color: 'var(--text-3)',
        lineHeight: 1.4,
      }}
    >
      连续登录 {eng.streakCurrent} 天
      {eng.streakBest > eng.streakCurrent ? ` · 最长 ${eng.streakBest} 天` : ''}
      （登录即记，无需打卡）
    </p>
  )
}

/** @deprecated 保留空壳避免旧引用；请用 QuietLoginStreak */
export function StreakBar() {
  return null
}
