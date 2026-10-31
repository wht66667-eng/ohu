import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { fetchUnreadCount } from '../lib/notify'
import { fetchChatThreads } from '../lib/chat'
import { startAdaptivePolling } from '../lib/adaptive-polling'
import { summarizeUnread, unreadFailures, unreadSource, type UnreadSnapshot } from '../lib/message-unread-summary'
import { IconBell } from './Icons'
import styles from './MessageEntry.module.css'

/** Notification and private-message counts come from existing authenticated APIs. */
export function MessageEntry() {
  const auth = useAuth()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const [snapshot, setSnapshot] = useState<UnreadSnapshot | null>(null)
  useEffect(() => {
    if (!uid) return
    let alive = true
    if (navigator.onLine === false) {
      setSnapshot({ uid, notifications: unreadSource(null, '当前已离线'), chats: unreadSource(null, '当前已离线') })
    }
    const load = async () => {
      if (!alive) return false
      const [notes, chats] = await Promise.allSettled([fetchUnreadCount(uid), fetchChatThreads(1)])
      if (!alive) return false
      const next = {
        uid,
        notifications: notes.status === 'fulfilled' ? unreadSource(notes.value.count, notes.value.error) : unreadSource(null, true),
        chats: chats.status === 'fulfilled' ? unreadSource(chats.value.data.unread_total, chats.value.error) : unreadSource(null, true),
      }
      setSnapshot(next)
      return !next.notifications.error && !next.chats.error
    }
    const polling = startAdaptivePolling(load, { intervalMs: 30000 })
    return () => {
      alive = false
      polling.stop()
    }
  }, [uid])
  const combined = snapshot
  const { count, incomplete, error, hint } = summarizeUnread(uid, combined)
  const failures = unreadFailures(uid, combined)
  const status = error ? `${failures.map(f => f.label).join('、')}暂时无法读取，打开消息中心重试` : hint
  const label = !uid ? '消息，登录后查看未读' : count != null ? `消息，${incomplete ? '至少 ' : ''}${count} 条未读${status ? `，${status}` : ''}` : `消息，${status || '正在读取未读数量'}`
  return <span className={styles.wrap}>
    <Link to="/messages" className={styles.entry} aria-label={label} title={label}>
      <IconBell size={22} />
      {count != null && count > 0 ? <span className={styles.badge} aria-hidden="true">{count > 99 ? '99+' : incomplete ? `${count}+` : count}</span> : error ? <span className={styles.unavailable} aria-hidden="true">!</span> : null}
    </Link>
  </span>
}
