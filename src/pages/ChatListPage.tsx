import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CampusIcon } from '../components/CampusIcon'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { PageHeader } from '../components/PageHeader'
import { Avatar } from '../components/Thumbs'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../lib/auth'
import { AsyncOwner, type OwnerTicket } from '../lib/async-owner'
import { captureImSession, currentImSession, subscribeImSession } from '../lib/im-session'
import {
  CHAT_PAGE_SIZE, chatHideThread, chatPreviewText, chatRelTime, chatTopicLabel,
  fetchChatThreads, type ChatCursor, type ChatThreadItem,
} from '../lib/chat'
import styles from './ChatListPage.module.css'

/** The current first page owns duplicate rows; all loaded rows follow message time. */
function mergeThreads(first: ChatThreadItem[], older: ChatThreadItem[]) {
  const map = new Map<number, ChatThreadItem>()
  for (const item of [...first, ...older]) if (!map.has(item.id)) map.set(item.id, item)
  const time = (item: ChatThreadItem) => Date.parse(item.last_at || item.created_at) || 0
  return [...map.values()].sort((a, b) => time(b) - time(a) || b.id - a.id)
}

function errorText(error: unknown) {
  return error instanceof Error && error.message ? error.message : '网络连接异常，请稍后重试'
}

function isForeground() { return document.visibilityState !== 'hidden' }

type ReadRequest = { ticket: OwnerTicket; session: OwnerTicket; revision: number; lane: 'first' | 'older' }

/** /chats and the embedded /messages inbox use exactly the same list and request. */
export function ChatListPage() { return <ChatInbox /> }
export function AdminChatListPage() { return <ChatInbox work /> }

export function ChatInbox({ embedded = false, work = false }: { embedded?: boolean; work?: boolean }) {
  const auth = useAuth()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  return <ChatInboxContent key={uid || 'guest'} embedded={embedded} work={work} />
}

function ChatInboxContent({ embedded, work = false }: { embedded: boolean; work?: boolean }) {
  const nav = useNavigate()
  const toast = useToast()
  const auth = useAuth()
  const signed = auth.isSigned
  const uid = signed ? auth.user?.uid || '' : ''
  const scope = useRef(new AsyncOwner(uid))
  scope.current.select(uid)
  const reads = useRef<ReadRequest | null>(null)
  const writes = useRef<OwnerTicket | null>(null)
  const readRevision = useRef(0)
  const refreshPending = useRef(false)
  const paged = useRef(false)
  const refresh = useRef<() => Promise<void>>(async () => {})
  const [sessionVersion, setSessionVersion] = useState(0)
  const [first, setFirst] = useState<ChatThreadItem[]>([])
  const [older, setOlder] = useState<ChatThreadItem[]>([])
  const [cursor, setCursor] = useState<ChatCursor | null>(null)
  const [more, setMore] = useState(false)
  const [moreBusy, setMoreBusy] = useState(false)
  const [moreErr, setMoreErr] = useState('')
  const [unread, setUnread] = useState(0)
  const [synced, setSynced] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshBusy, setRefreshBusy] = useState(false)
  const [err, setErr] = useState('')
  const [hideId, setHideId] = useState<number | null>(null)
  const [hideBusy, setHideBusy] = useState(false)

  useEffect(() => subscribeImSession(() => {
    // A → B → A can happen before React renders B; a UID key is insufficient.
    scope.current.invalidate()
    readRevision.current++
    reads.current = null
    writes.current = null
    refreshPending.current = false
    paged.current = false
    setFirst([]); setOlder([]); setCursor(null); setMore(false); setUnread(0)
    setSynced(false); setLoading(true); setRefreshBusy(false); setErr(''); setMoreErr(''); setMoreBusy(false)
    setHideId(null); setHideBusy(false)
    setSessionVersion(value => value + 1)
  }), [])

  const isCurrent = useCallback((request: ReadRequest) => (
    scope.current.current(request.ticket) && currentImSession(request.session) && request.revision === readRevision.current
  ), [])

  const loadFirst = useCallback(async () => {
    if (!signed) { setLoading(false); return }
    if (!isForeground()) return
    if (reads.current) {
      if (reads.current.lane === 'older') refreshPending.current = true
      return
    }
    const session = captureImSession(uid)
    if (!session) return
    const request: ReadRequest = { ticket: scope.current.begin('first'), session, revision: readRevision.current, lane: 'first' }
    refreshPending.current = false
    reads.current = request
    setRefreshBusy(true)
    try {
      const result = await fetchChatThreads(CHAT_PAGE_SIZE)
      if (!isCurrent(request)) return
      if (result.error) { setErr(result.error); return }
      setErr('')
      setSynced(true)
      setFirst(result.data.items)
      setUnread(result.data.unread_total)
      if (!paged.current) {
        setCursor(result.data.next_cursor)
        setMore(result.data.has_more)
      }
    } catch (error) {
      if (isCurrent(request)) setErr(errorText(error))
    } finally {
      if (reads.current === request) {
        reads.current = null
        if (scope.current.current(request.ticket) && currentImSession(request.session)) { setLoading(false); setRefreshBusy(false) }
        if (refreshPending.current && isForeground()) {
          refreshPending.current = false
          void refresh.current()
        }
      }
    }
  }, [signed, uid, sessionVersion, isCurrent])
  refresh.current = loadFirst

  useEffect(() => {
    void loadFirst()
    return () => { scope.current.invalidate(); reads.current = null; refreshPending.current = false }
  }, [loadFirst])

  useEffect(() => {
    if (!signed) return
    const sync = () => { if (isForeground()) void loadFirst() }
    const timer = window.setInterval(sync, 10000)
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('focus', sync)
    }
  }, [signed, loadFirst])

  const list = useMemo(() => mergeThreads(first, older), [first, older])

  const loadOlder = useCallback(async () => {
    if (!signed || !cursor || reads.current || !isForeground()) return
    const session = captureImSession(uid)
    if (!session) return
    const request: ReadRequest = { ticket: scope.current.begin('older'), session, revision: readRevision.current, lane: 'older' }
    reads.current = request
    setMoreBusy(true)
    setMoreErr('')
    try {
      const result = await fetchChatThreads(CHAT_PAGE_SIZE, cursor)
      if (!isCurrent(request)) return
      if (result.error) { setMoreErr(result.error); return }
      paged.current = true
      setOlder(prev => mergeThreads(prev, result.data.items))
      setCursor(result.data.next_cursor)
      setMore(result.data.has_more)
    } catch (error) {
      if (isCurrent(request)) setMoreErr(errorText(error))
    } finally {
      if (reads.current === request) {
        reads.current = null
        if (scope.current.current(request.ticket) && currentImSession(request.session)) setMoreBusy(false)
        if (refreshPending.current && isForeground()) {
          refreshPending.current = false
          void refresh.current()
        }
      }
    }
  }, [signed, uid, cursor, isCurrent])

  async function hideThread() {
    if (hideId == null || writes.current || !signed) return
    const session = captureImSession(uid)
    if (!session) return
    const id = hideId
    const ticket = scope.current.begin('write')
    writes.current = ticket
    setHideBusy(true)
    try {
      const result = await chatHideThread(id, true)
      if (!scope.current.current(ticket) || !currentImSession(session)) return
      if (result.error) { toast.err(result.error); return }
      // Discard reads launched before this write succeeded. A subsequent read is
      // authoritative, including normal restoration when a new message arrives.
      readRevision.current++
      setFirst(prev => prev.filter(item => item.id !== id))
      setOlder(prev => prev.filter(item => item.id !== id))
      setSynced(false)
      setHideId(null)
      refreshPending.current = !!reads.current
      if (!reads.current) void refresh.current()
      toast.ok('已从你的会话列表移除')
    } catch (error) {
      if (scope.current.current(ticket) && currentImSession(session)) toast.err(errorText(error))
    } finally {
      if (writes.current === ticket) {
        writes.current = null
        if (scope.current.current(ticket) && currentImSession(session)) setHideBusy(false)
      }
    }
  }

  const hideTarget = list.find(item => item.id === hideId)
  const unreadKnown = synced && !err
  const status = !signed ? '' : unreadKnown ? (unread > 0 ? `私信未读 ${unread} 条` : '私信全部已读') : err ? '未读待更新' : '正在同步未读…'

  return (
    <section className={embedded ? styles.inbox : styles.page} aria-label="最近会话">
      {!embedded ? <PageHeader title={work ? '工作会话' : '私信'} right={<span className={styles.hint}>{status}</span>} /> : null}
      <div className={styles.sectionHead}>
        <h2>最近会话</h2>
        {embedded ? <span className={styles.hint} role="status">{status}</span> : null}
      </div>
      {!signed ? (
        <div className={styles.state}>
          <CampusIcon name="chat" size={28} />
          <p>登录后查看会话</p>
          <span>{work ? '使用管理员账号查看工作联系与会话。' : '和同学收发私信，继续之前的交流。'}</span>
          <button type="button" className={styles.action} onClick={() => void auth.ensureSignedIn('查看私信需要登录')}>去登录</button>
        </div>
      ) : null}
      {signed && loading ? <p className={styles.loading} role="status">正在同步会话…</p> : null}
      {signed && !loading && err ? (
        <div className={styles.error} role="alert">
          <div><strong>会话同步失败</strong><span>{err}{list.length ? '，已加载的会话仍可查看。' : ''}</span></div>
          <button type="button" className={styles.retry} onClick={() => void loadFirst()} disabled={refreshBusy}>{refreshBusy ? '重试中…' : '重试'}</button>
        </div>
      ) : null}
      {signed && !loading && !err && list.length === 0 ? (
        <div className={styles.state}>
          <CampusIcon name="chat" size={28} />
          <p>还没有会话</p>
          <span>{work ? '从通讯录联系同学，继续校园管理工作。' : '从好友通讯录找到同学，发起第一次交流。'}</span>
          <button type="button" className={styles.action} onClick={() => nav('/contacts')}>打开好友通讯录</button>
        </div>
      ) : null}
      {signed && list.length > 0 ? (
        <ul className={styles.list}>
          {list.map(item => (
            <li className={styles.row} key={item.id}>
              <button type="button" className={styles.hit} onClick={() => nav(`/chats/${item.id}`)} aria-label={`与${item.other_name}的会话${item.my_unread > 0 ? `，${item.my_unread} 条未读` : ''}`}>
                <span className={styles.avatar}><Avatar name={item.other_name} hue="var(--green-soft)" seed={item.other_uid} /></span>
                <span className={styles.main}>
                  <span className={styles.topline}><span className={styles.name}>{item.other_name}</span><time className={styles.time} dateTime={item.last_at}>{chatRelTime(item.last_at)}</time></span>
                  <span className={styles.preview}>{chatPreviewText(item)}</span>
                  {item.topic_type !== 'plaza_user' ? <span className={styles.topic}>{chatTopicLabel(item.topic_type)} · {item.topic_title || '会话'}</span> : null}
                </span>
                {item.my_unread > 0 ? <span className={styles.unread} aria-hidden="true">{item.my_unread > 99 ? '99+' : item.my_unread}</span> : null}
              </button>
              <button type="button" className={styles.remove} onClick={() => setHideId(item.id)} aria-label={`从列表移除与${item.other_name}的会话（${item.id}）`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {signed && more ? (
        <div className={styles.moreRow}>
          {moreErr ? <p role="alert" className={styles.moreError}>更早的会话加载失败：{moreErr}</p> : null}
          <button type="button" className={styles.moreButton} onClick={() => void loadOlder()} disabled={moreBusy || refreshBusy}>
            {moreBusy ? '正在加载…' : moreErr ? '重试加载更早的会话' : '加载更早的会话'}
          </button>
        </div>
      ) : null}
      {hideId != null ? (
        <ConfirmSheet title="从我的会话列表移除？" desc={`「${hideTarget?.other_name || '这条会话'}」只会从你的列表消失，对方仍可查看全部消息。对方再发消息或你重新打开会话时，会自动回来。`} confirmText="确认移除" busy={hideBusy} onConfirm={hideThread} onClose={() => { if (!hideBusy) setHideId(null) }} />
      ) : null}
    </section>
  )
}
