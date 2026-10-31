import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar } from '../components/Thumbs'
import { CampusIcon } from '../components/CampusIcon'
import { PageHeader } from '../components/PageHeader'
import { avatar } from '../data/images'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../lib/auth'
import {
  HELP_KIND_TEXT,
  HELP_STATUS_TEXT,
  LOST_KIND_TEXT,
  LOST_STATUS_TEXT,
  activitySeatText,
  fetchActivitiesByIds,
  fetchHelpMine,
  fetchLostMine,
  fetchMySignupIds,
  fetchNews,
  fetchNewsBroadcasts,
  fetchReadBroadcastIds,
  fmtBulletinTime,
  markBroadcastRead,
} from '../lib/bulletin'
import { getAppShell } from '../lib/app-shell'
import {
  ITEM_STATUS_TEXT,
  TASK_STATUS_TEXT,
  fetchMyItems,
  fetchMyTasks,
} from '../lib/market'
import { fetchUnreadCount } from '../lib/notify'
import { fetchChatThreads } from '../lib/chat'
import { unreadFailures, unreadSource, type UnreadSnapshot } from '../lib/message-unread-summary'
import { infoTargetPath } from '../lib/info-target'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateViews'
import styles from './me.module.css'

const GROUPS = ['小海助手', '官方公告', '我报名的活动', '我的发布'] as const
type GroupName = (typeof GROUPS)[number]

interface FeedEntry {
  key: string
  group: GroupName
  name: string
  preview: string
  time: string
  /** 有 to 时整行可点；没有 to 的（申请进度）只做展示 */
  to?: string
  kind: 'ai' | 'system' | 'user' | 'info'
  broadcastId?: number
}

export function MessageUpdatesPage() {
  const auth = useAuth()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  return <MessagesContent key={uid || 'guest'} />
}

function MessagesContent() {
  const toast = useToast()
  const auth = useAuth()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const signed = auth.isSigned

  const [entries, setEntries] = useState<FeedEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [unreadSnapshot, setUnreadSnapshot] = useState<UnreadSnapshot | null>(null)
  const [unreadBusy, setUnreadBusy] = useState(false)
  /* 重试计数：错误态「重试」按钮自增后触发消息流重新拉取 */
  const [reloadTick, setReloadTick] = useState(0)

  // 公告对游客开放，其余分组只在中标/登录后拉取
  useEffect(() => {
    let alive = true
    void (async () => {
      setLoading(true)
      const list: FeedEntry[] = []
      const errors: string[] = []

      const news = await fetchNews()
      if (news.error) errors.push(news.error)
      for (const n of news.rows.slice(0, 10)) {
        list.push({
          key: `n-${n.id}`,
          group: '官方公告',
          name: n.source || n.creator_name || '校园信息站',
          preview: n.title + (n.summary ? ` · ${n.summary}` : ''),
          time: fmtBulletinTime(n.published_at || n.created_at),
          to: infoTargetPath('news', n.id),
          kind: 'info',
        })
      }

      if (signed && getAppShell() === 'user') {
        const [casts, reads] = await Promise.all([fetchNewsBroadcasts(), fetchReadBroadcastIds(uid)])
        if (!casts.error) {
          for (const b of casts.rows.slice(0, 8)) {
            list.push({
              key: `bc-${b.id}`,
              group: '官方公告',
              name: reads.has(b.id) ? '校园通知' : '未读通知',
              preview: b.title + (b.body ? ` · ${b.body}` : ''),
              time: fmtBulletinTime(b.created_at),
              to: b.news_id ? infoTargetPath('news', b.news_id) : '/info',
              kind: 'info',
              broadcastId: b.id,
            })
          }
        }
      }

      if (signed) {
        const [signupIds, tasks, items, lost, help] = await Promise.all([
          fetchMySignupIds(uid),
          fetchMyTasks(uid),
          fetchMyItems(uid),
          fetchLostMine(uid),
          fetchHelpMine(uid),
        ])

        if (signupIds.length) {
          const acts = await fetchActivitiesByIds(signupIds)
          if (acts.error) errors.push(acts.error)
          for (const a of acts.rows) {
            list.push({
              key: `a-${a.id}`,
              group: '我报名的活动',
              name: a.title,
              preview: `${a.organizer || a.creator_name || '组织者'} · ${activitySeatText(a)}`,
              time: a.start_at || fmtBulletinTime(a.created_at),
              to: infoTargetPath('activity', a.id),
              kind: 'system',
            })
          }
        }

        if (tasks.error) errors.push(tasks.error)
        for (const t of tasks.rows.slice(0, 10)) {
          list.push({
            key: `t-${t.id}`,
            group: '我的发布',
            name: `任务 · ${t.title}`,
            preview: `${TASK_STATUS_TEXT[t.status] || t.status} · ${t.location || '校园'} · 报酬 ${t.reward || '面议'}`,
            time: fmtBulletinTime(t.created_at),
            to: `/task/${t.id}`,
            kind: 'user',
          })
        }

        if (items.error) errors.push(items.error)
        for (const i of items.rows.slice(0, 10)) {
          list.push({
            key: `i-${i.id}`,
            group: '我的发布',
            name: `闲置 · ${i.title}`,
            preview: `${ITEM_STATUS_TEXT[i.status] || i.status} · ${i.category || '闲置'} · ¥${i.price}`,
            time: fmtBulletinTime(i.created_at),
            to: `/item/${i.id}`,
            kind: 'user',
          })
        }

        if (lost.error) errors.push(lost.error)
        for (const l of lost.rows.slice(0, 10)) {
          list.push({
            key: `l-${l.id}`,
            group: '我的发布',
            name: `${LOST_KIND_TEXT[l.kind] || '失物'} · ${l.title}`,
            preview: `${LOST_STATUS_TEXT[l.status] || l.status} · ${l.place || '校园'}`,
            time: fmtBulletinTime(l.created_at),
            to: infoTargetPath('lost', l.id),
            kind: 'user',
          })
        }

        if (help.error) errors.push(help.error)
        for (const h of help.rows.slice(0, 10)) {
          list.push({
            key: `h-${h.id}`,
            group: '我的发布',
            name: `${HELP_KIND_TEXT[h.kind] || '互助'} · ${h.title}`,
            preview: `${HELP_STATUS_TEXT[h.status] || h.status} · ${h.place || '校园'}`,
            time: fmtBulletinTime(h.created_at),
            to: '/info',
            kind: 'user',
          })
        }
      }

      if (!alive) return
      setEntries(list)
      setError(errors[0] || '')
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [signed, uid, reloadTick])

  const grouped = useMemo(() => {
    const ai: FeedEntry = {
      key: 'ai',
      group: '小海助手',
      name: '小海阿狐',
      preview: '你好呀，今天想查课表、找食堂，还是聊聊心事？',
      time: '随时在线',
      to: '/chat',
      kind: 'ai',
    }
    const all = [ai, ...entries]
    return GROUPS.map((g) => ({ group: g, list: all.filter((e) => e.group === g) })).filter((s) => s.list.length > 0)
  }, [entries])

  /* 通知 / 私信未读红点：20 秒轻量轮询（切后台暂停），避免与通知页、私信页同时高频请求 */
  useEffect(() => {
    if (!signed || !uid) {
      setUnreadSnapshot(null)
      return
    }
    let alive = true
    let pending = false
    const load = async () => {
      if (!alive || pending || document.visibilityState !== 'visible') return
      pending = true
      setUnreadBusy(true)
      try {
        const [n, c] = await Promise.allSettled([fetchUnreadCount(uid), fetchChatThreads(1)])
        if (!alive) return
        setUnreadSnapshot({ uid,
          notifications: n.status === 'fulfilled' ? unreadSource(n.value.count, n.value.error) : unreadSource(null, '网络连接失败'),
          chats: c.status === 'fulfilled' ? unreadSource(c.value.data.unread_total, c.value.error) : unreadSource(null, '网络连接失败'),
        })
      } finally { pending = false; if (alive) setUnreadBusy(false) }
    }
    void load()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 20000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [signed, uid, reloadTick])

  const unread = unreadSnapshot?.uid === uid ? unreadSnapshot.notifications.count : null
  const chatUnread = unreadSnapshot?.uid === uid ? unreadSnapshot.chats.count : null
  // 私信未读只认自建会话线：IM 已下线，再叠加 im.unread 会把同一批会话数两遍
  const combinedChatUnread = chatUnread
  const chatIncomplete = chatUnread == null
  const unreadIssues = unreadFailures(uid, unreadSnapshot?.uid === uid ? unreadSnapshot : null)
  const chatFailed = unreadIssues.some(issue => issue.to === '/chats')

  return (
    <div className={styles.page}>
      <PageHeader title="校园与我的动态" />

      {!signed ? (
        <div className={styles.gateTip}>
          <span>登录后可查看报名、订单与发布动态</span>
          <button onClick={() => void auth.ensureSignedIn('查看消息中心需要登录')}>去登录</button>
        </div>
      ) : null}

      <div className={styles.entryGrid}>
        {signed ? <>
          <Link to="/chats" className={styles.entryCard}>
            <span className={styles.entryIc}>💬</span>
            <span className={styles.entryMeta}>
              <b>私信</b>
              <em>{combinedChatUnread ? `${chatIncomplete ? '至少 ' : ''}${combinedChatUnread > 99 ? '99+' : combinedChatUnread} 条未读` : chatIncomplete ? chatFailed ? '部分私信暂时无法读取' : '正在读取未读数量' : '全部已读'}</em>
            </span>
            {combinedChatUnread ? <span className={styles.entryDot} /> : null}
          </Link>
          <Link to="/notify" className={styles.entryCard}>
            <span className={styles.entryIc}>🔔</span>
            <span className={styles.entryMeta}>
              <b>通知中心</b>
              <em>{unread == null ? unreadSnapshot?.notifications.error ? '未读数量暂时无法读取' : '正在读取未读数量' : unread ? `${unread} 条未读` : '全部已读'}</em>
            </span>
            {unread ? <span className={styles.entryDot} /> : null}
          </Link>
        </> : null}
        <Link to="/contacts" className={`${styles.entryCard} ${styles.friendsEntry}`}>
          <span className={styles.entryIc} aria-hidden="true"><CampusIcon name="partner" size={21} /></span>
          <span className={styles.entryMeta}>
            <b>好友通讯录</b>
            <em>{signed ? '查看好友、好友申请与添加好友' : '登录后查看好友与好友申请'}</em>
          </span>
          <span className={styles.entryArrow} aria-hidden="true">›</span>
        </Link>
      </div>

      {signed && unreadIssues.length > 0 ? (
        <section className={styles.unreadStatus} aria-label="消息连接状态" aria-live="polite">
          <div>{unreadIssues.map(issue => <p key={issue.label}><b>{issue.label}</b> · {issue.message}</p>)}</div>
          <button type="button" disabled={unreadBusy} onClick={() => setReloadTick(t => t + 1)}>
            {unreadBusy ? '正在连接' : '重试连接'}
          </button>
        </section>
      ) : null}

      {loading && entries.length === 0 ? <LoadingState compact title="正在同步消息…" /> : null}
      {!loading && error ? (
        <ErrorState
          compact
          title="消息同步失败"
          hint={
            /FetchError|NetworkError|Failed to fetch|Load failed/i.test(error)
              ? '网络开小差了，公告暂时同步不了，稍后再试'
              : error
          }
          action={
            <button type="button" onClick={() => setReloadTick((t) => t + 1)}>
              重试
            </button>
          }
        />
      ) : null}

      <div className={styles.inbox}>
        {grouped.map((section) => (
          <section key={section.group}>
            <h4 className={styles.groupTitle}>{section.group}</h4>
            {section.list.map((m) => {
              const inner = (
                <>
                  {m.kind === 'ai' ? (
                    <img className={styles.msgAvatar} src={avatar.sun} alt="" />
                  ) : (
                    <Avatar name={m.name} hue={m.kind === 'system' ? '#ffe4cc' : '#dcebff'} />
                  )}
                  <span className={styles.grow}>
                    <b>
                      {m.name}
                      <em>{m.time}</em>
                    </b>
                    <p>{m.preview}</p>
                  </span>
                </>
              )
              if (m.to) {
                return (
                  <Link
                    key={m.key}
                    to={m.to}
                    className={styles.msg}
                    onClick={() => {
                      if (m.broadcastId && uid) void markBroadcastRead(m.broadcastId, uid)
                    }}
                  >
                    {inner}
                  </Link>
                )
              }
              return (
                <button key={m.key} className={styles.msg} onClick={() => toast(m.preview)}>
                  {inner}
                </button>
              )
            })}
          </section>
        ))}

        {/* 同步失败时不算「没有消息」：空态只在确实无数据且无错误时出现 */}
        {!loading && !error && grouped.length <= 1 ? (
          <EmptyState
            compact
            title="还没有新消息"
            hint="报名、订单与发布动态都会汇总到这里"
            action={<Link to="/tasks">去任务大厅逛逛</Link>}
          />
        ) : null}
      </div>
    </div>
  )
}
