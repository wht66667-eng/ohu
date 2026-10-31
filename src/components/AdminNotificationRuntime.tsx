import { useEffect, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { IS_NATIVE } from '../lib/platform'
import { clearAdminNotifications, validAdminNotificationOwner } from '../lib/admin-notifications'
import { captureImSession, currentImSession, subscribeImSession } from '../lib/im-session'
import { adminNotificationPath } from '../lib/notification-scope'
import { ShellNotifyHost } from './ShellNotifyHost'

export function AdminNotificationRuntime({ enabled = true }: { enabled?: boolean }) {
  const auth = useAuth()
  const navigate = useNavigate()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const revision = useSyncExternalStore(subscribeImSession, () => captureImSession(uid)?.revision ?? -1, () => -1)
  const ownerKey = `${uid}:${revision}`
  const [notificationsReady, setNotificationsReady] = useState('')
  const [notificationFailure, setNotificationFailure] = useState('')
  const [notificationTap, setNotificationTap] = useState<Record<string, unknown> | null>(null)
  const allowed = auth.isSigned && !!(auth.profile?.isAdmin || auth.profile?.isSuperAdmin)
  useEffect(() => {
    let alive = true
    const session = captureImSession(uid)
    setNotificationFailure('')
    if (auth.phase === 'booting') return
    void clearAdminNotifications().then(() => {
      if (alive && (!session || currentImSession(session))) setNotificationsReady(ownerKey)
    }).catch(() => { if (alive) setNotificationFailure('切换账号后的管理通知清理失败，请重新打开管理端后重试。') })
    return () => { alive = false; void clearAdminNotifications().catch(() => undefined) }
  }, [uid, revision, ownerKey, auth.phase])
  useEffect(() => {
    if (!IS_NATIVE) return
    let disposed = false
    let remove: (() => Promise<void>) | undefined
    void import('@capacitor/local-notifications').then(async ({ LocalNotifications }) => {
      const listener = await LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
        if (!disposed && event.notification.extra?.type === 'admin-work') setNotificationTap(event.notification.extra)
      })
      if (disposed) await listener.remove()
      else remove = () => listener.remove()
    }).catch(() => undefined)
    return () => { disposed = true; void remove?.() }
  }, [])
  useEffect(() => {
    if (!notificationTap || auth.phase === 'booting' || notificationsReady !== ownerKey) return
    const session = captureImSession(uid)
    setNotificationTap(null)
    if (allowed && enabled && validAdminNotificationOwner(notificationTap, session)) navigate(adminNotificationPath(String(notificationTap.link || '')), { replace: true })
  }, [notificationTap, auth.phase, notificationsReady, ownerKey, uid, allowed, enabled, navigate])
  if (!enabled || !allowed) return null
  if (notificationFailure) return <p role="alert">{notificationFailure}</p>
  return notificationsReady === ownerKey ? <ShellNotifyHost /> : null
}
