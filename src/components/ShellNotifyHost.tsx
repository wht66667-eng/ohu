import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { getAppShell } from '../lib/app-shell'
import { pollShellAlerts, type ShellBadge } from '../lib/shell-notify'
import { startAdaptivePolling } from '../lib/adaptive-polling'
import { captureImSession, currentImSession, subscribeImSession } from '../lib/im-session'
import { clearShellBadgeOwner, getShellBadgeCount, setShellBadgeOwner, shellBadgeOwnerKey, updateShellBadgeCount } from '../lib/shell-badge'
import styles from './ShellNotifyHost.module.css'

/**
 * 管理端工作提醒条：仅轮询已授权账号的举报与治理通知。
 * 学生端课表类仍由 RemindHost 负责。
 */
export function ShellNotifyHost() {
  const auth = useAuth()
  const shell = getAppShell()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const ownerKey = shellBadgeOwnerKey(uid, shell)
  const sessionRevision = useSyncExternalStore(subscribeImSession, () => captureImSession(uid)?.revision ?? -1, () => -1)
  const [snapshot, setSnapshot] = useState<{ uid: string; shell: typeof shell; sessionRevision: number; badge: ShellBadge } | null>(null)
  const [failure, setFailure] = useState<{ owner: string; revision: number; text: string } | null>(null)
  const [retry, setRetry] = useState(0)
  const error = failure?.owner === ownerKey && failure.revision === sessionRevision ? failure.text : ''
  const badge = snapshot?.uid === uid && snapshot?.shell === shell && snapshot?.sessionRevision === sessionRevision ? snapshot.badge : null

  useLayoutEffect(() => {
    const session = captureImSession(uid)
    setShellBadgeOwner(ownerKey, session)
    return () => clearShellBadgeOwner(ownerKey, session)
  }, [uid, ownerKey, sessionRevision])

  useEffect(() => {
    const session = captureImSession(uid)
    if (!session) return
    let alive = true
    const isCurrent = () => alive && currentImSession(session)
    const tick = async () => {
      if (!isCurrent()) return false
      try {
        const b = await pollShellAlerts({ uid, shell, isCurrent })
        if (!isCurrent()) return false
        setFailure(null)
        setSnapshot({ uid, shell, sessionRevision: session.revision, badge: b })
        updateShellBadgeCount(ownerKey, b.orders + b.messages + b.adminPending, session)
        return true
      } catch (error) {
        if (isCurrent()) setFailure({ owner: ownerKey, revision: session.revision, text: error instanceof Error ? error.message : '管理通知同步失败' })
        return false
      }
    }
    const polling = startAdaptivePolling(tick, { intervalMs: 30000 })
    return () => {
      alive = false
      polling.stop()
    }
  }, [uid, shell, ownerKey, sessionRevision, retry])

  if (!auth.isSigned) return null
  if (error) return <div className={styles.bar} role="status"><span className={styles.txt}>管理通知暂未同步：{error}</span><button type="button" className={styles.go} onClick={() => setRetry((value) => value + 1)}>重试</button></div>
  if (!badge?.label) return null

  const link =
    shell === 'admin'
      ? badge.adminPending > 0 ? '/admin/reports' : '/admin/notify'
      : '/notify'

  return (
    <div className={styles.bar} aria-label="业务提醒">
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.txt}>{badge.label}</span>
      <Link to={link} className={styles.go}>
        查看
      </Link>
    </div>
  )
}

/** Retained for callers that read the current shell badge without subscribing. */
export function readShellBadgeHint(): number {
  return getShellBadgeCount()
}
