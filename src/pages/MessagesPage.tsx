import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CampusIcon } from '../components/CampusIcon'
import { PageHeader } from '../components/PageHeader'
import { useAuth } from '../lib/auth'
import { AsyncOwner, type OwnerTicket } from '../lib/async-owner'
import { captureImSession, currentImSession, subscribeImSession } from '../lib/im-session'
import { fetchUnreadCount } from '../lib/notify'
import { fetchFriendRequests } from '../lib/friends'
import { unreadSource, type UnreadSource } from '../lib/message-unread-summary'
import { ChatInbox } from './ChatListPage'
import { MessageUpdatesPage } from './MessageUpdatesPage'
import styles from './MessagesPage.module.css'

interface Overview { notifications: UnreadSource; requests: UnreadSource }

export function MessagesPage() {
  const [params] = useSearchParams()
  const auth = useAuth()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  if (params.get('view') === 'updates') return <MessageUpdatesPage />
  return <MessagesContent key={uid || 'guest'} />
}

function countLabel(source: UnreadSource | undefined, unit: string) {
  if (!source) return '正在同步'
  if (source.error || source.count == null) return '数量暂未更新'
  return source.count ? `${source.count > 99 ? '99+' : source.count} ${unit}` : unit === '条未读' ? '暂无未读' : '暂无新申请'
}

function MessagesContent() {
  const auth = useAuth()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const owner = useRef(new AsyncOwner(uid))
  owner.current.select(uid)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!uid) return
    let alive = true
    let pending: OwnerTicket | null = null
    const load = async () => {
      if (!alive || pending || document.visibilityState === 'hidden') return
      const session = captureImSession(uid)
      if (!session) return
      const ticket = owner.current.begin('overview')
      pending = ticket
      setBusy(true)
      try {
        const [notifications, requests] = await Promise.allSettled([fetchUnreadCount(uid), fetchFriendRequests()])
        if (!alive || !owner.current.current(ticket) || !currentImSession(session)) return
        setOverview({
          notifications: notifications.status === 'fulfilled' ? unreadSource(notifications.value.count, notifications.value.error) : unreadSource(null, '网络连接失败'),
          requests: requests.status === 'fulfilled' ? unreadSource(requests.value.rows.length, requests.value.error) : unreadSource(null, '网络连接失败'),
        })
      } finally {
        if (pending === ticket) pending = null
        if (alive && owner.current.current(ticket) && currentImSession(session)) setBusy(false)
      }
    }
    const resume = () => { void load() }
    const unsubscribe = subscribeImSession(() => {
      owner.current.invalidate(); pending = null; setOverview(null); setBusy(false)
      resume()
    })
    void load()
    const timer = window.setInterval(resume, 20_000)
    window.addEventListener('focus', resume)
    document.addEventListener('visibilitychange', resume)
    return () => { alive = false; owner.current.invalidate(); unsubscribe(); window.clearInterval(timer); window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume) }
  }, [uid, reload])

  const failures = [overview?.notifications.error ? '通知未读' : '', overview?.requests.error ? '好友申请' : ''].filter(Boolean)
  return <div className={styles.page}>
    <PageHeader title="消息" />
    <nav className={styles.shortcuts} aria-label="通知与好友">
      <Link to="/notify" className={styles.shortcut}>
        <CampusIcon name="bell" size={22} />
        <span className={styles.shortcutText}><strong>通知</strong><small>{uid ? countLabel(overview?.notifications, '条未读') : '登录后查看通知'}</small></span>
      </Link>
      <Link to="/contacts" className={styles.shortcut}>
        <CampusIcon name="partner" size={22} />
        <span className={styles.shortcutText}><strong>好友</strong><small>{uid ? countLabel(overview?.requests, '条新申请') : '通讯录与添加好友'}</small></span>
      </Link>
    </nav>
    <nav className={styles.secondary} aria-label="更多消息入口">
      <Link to="/messages?view=updates">校园与我的动态<span aria-hidden="true">›</span></Link>
      <Link to="/chat">阿狐助手<span aria-hidden="true">›</span></Link>
    </nav>
    {uid && failures.length ? <section className={styles.connection} role="status">
      <span>{failures.join('、')}暂时无法读取，其他会话仍可查看。</span>
      <button type="button" disabled={busy} onClick={() => setReload(value => value + 1)}>{busy ? '正在同步' : '重试'}</button>
    </section> : null}
    <ChatInbox embedded />
  </div>
}
