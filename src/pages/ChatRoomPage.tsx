import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { IconBack, IconImage, IconSmile } from '../components/Icons'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../lib/auth'
import { AsyncOwner, positiveRecordId, type OwnerTicket } from '../lib/async-owner'
import { captureImSession, currentImSession, subscribeImSession } from '../lib/im-session'
import { uploadChatImage } from '../lib/chat-image'
import { queryRows } from '../lib/market'
import {
  CHAT_MSG_PAGE_SIZE,
  chatBubbleTime,
  chatMarkRead,
  chatSendImage,
  chatSendMessage,
  chatTopicLabel,
  chatTopicPath,
  fetchChatMessages,
  type ChatMessageItem,
} from '../lib/chat'
import { collegeName, fetchCollegeGroups, sendCollegeGroupImage, sendCollegeGroupMessage, type CollegeGroup } from '../lib/college-group'
import { ErrorState } from '../components/ui/StateViews'
import { ImagePickButton } from '../components/ImageUploadField'
import { StickerPanel } from '../components/StickerPanel'
import { submitMessageKey } from '../lib/keyboard-viewport'
import styles from './ChatRoomPage.module.css'

/** 会话头只用于展示（对方是谁 / 话题是什么），派生字段由 chat_thread_list 提供 */
interface ThreadRow {
  id: number
  topic_type: string
  topic_id: number | null
  topic_title: string
  /** 学院群（kind='group'）没有「双方」，这两列皆为 null */
  user_uid: string | null
  user_name: string | null
  peer_uid: string | null
  peer_name: string | null
  kind?: string | null
  college_key?: string | null
  created_at?: string
}

function mergeById<T extends { id: number }>(groups: T[][]): T[] {
  const map = new Map<number, T>()
  for (const g of groups) for (const x of g) map.set(x.id, x)
  return [...map.values()].sort((a, b) => a.id - b.id)
}

/** 本地乐观消息：发送中 / 发送失败先上屏，成功后被服务端返回的消息替换 */
interface OutgoingMsg {
  key: number
  body: string
  kind: 'text' | 'image'
  /** kind==='image' 时是已上传到 CloudBase images 桶的公开地址 */
  mediaUrl?: string
  state: 'sending' | 'failed'
}

/**
 * 私信会话页（/chats/:id）
 *
 * - 进入即 chat_mark_read 把我这一侧未读清零（幂等，不依赖前端直写 UPDATE）
 * - 历史消息走 chat_messages_page 的 id 游标：不传 before_id 取最新一页，
 *   传「当前最旧一条」的 id 往前翻更早的一页
 * - 发送走 chat_send：服务端落库 + 返回 message，本地直接上屏，不等下一次轮询
 * - 5 秒轮询最新一页（切后台暂停）；话题卡片可回到对应的闲置 / 任务详情
 */
export function ChatRoomPage() {
  const { id } = useParams()
  const auth = useAuth()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const threadId = positiveRecordId(id)
  return <ChatRoomContent key={`${uid || 'guest'}:${threadId || 'invalid'}`} threadId={threadId} />
}

type ChatWork = { page: OwnerTicket; session: OwnerTicket }
type ScrollAnchor = { id: string | null; offset: number; top: number; height: number }

function ChatRoomContent({ threadId }: { threadId: number | null }) {
  const nav = useNavigate()
  const toast = useToast()
  const auth = useAuth()
  const signed = auth.isSigned
  const uid = signed ? auth.user?.uid || '' : ''
  const scope = useRef(new AsyncOwner(`${uid}:${threadId}`))
  scope.current.select(`${uid}:${threadId}`)
  useEffect(() => {
    const off = subscribeImSession(() => {
      scope.current.invalidate()
      resetRoom()
      setRetryTick(tick => tick + 1)
    })
    return () => { off(); scope.current.invalidate() }
  }, [])
  const captureWork = useCallback((lane?: string): ChatWork | null => {
    const session = captureImSession(uid)
    return signed && threadId && session ? { page: lane ? scope.current.begin(lane) : scope.current.capture(), session } : null
  }, [signed, uid, threadId])
  const currentWork = (work: ChatWork) => scope.current.current(work.page) && currentImSession(work.session)

  const [head, setHead] = useState<ThreadRow | null>(null)
  /** 学院群的额外信息（成员数）；非群会话为 null */
  const [groupInfo, setGroupInfo] = useState<CollegeGroup | null>(null)
  const [messages, setMessages] = useState<ChatMessageItem[]>([])
  const messagesRef = useRef<ChatMessageItem[]>([])
  const [olderCursor, setOlderCursor] = useState<number | null>(null)
  const [more, setMore] = useState(false)
  const [moreBusy, setMoreBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  /** 失败态「重试」：自增后让首屏加载 effect 重跑一次 */
  const [retryTick, setRetryTick] = useState(0)
  /** 乐观上屏的发送中队列：发送中 / 失败都在这里，成功后被服务端消息替换 */
  const [outgoing, setOutgoing] = useState<OutgoingMsg[]>([])
  const outgoingSeq = useRef(0)
  /** 图片上传中（乐观气泡里的图片只展示，不发网络请求） */
  const [uploading, setUploading] = useState(false)
  const [panel, setPanel] = useState<'none' | 'emoji'>('none')
  const [preview, setPreview] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const nearBottom = useRef(true)
  const scrollWanted = useRef(false)
  const scrollAnchor = useRef<ScrollAnchor | null>(null)
  const [newMessages, setNewMessages] = useState(0)
  // A send response is an isolated message; it cannot prove that intervening messages were received.
  const receivedEdge = useRef(0)
  const backfill = useRef<{ cursor: number; boundary: number; edge: number } | null>(null)
  const [backfillPending, setBackfillPending] = useState(false)
  const ready = useRef(false)
  const pollBusy = useRef<ChatWork | null>(null)
  const olderBusy = useRef<ChatWork | null>(null)
  const sendBusy = useRef<ChatWork | null>(null)
  const uploadBusy = useRef<ChatWork | null>(null)
  const deliveries = useRef(new Set<number>())
  /** 已经清过未读的最大消息 id：只有真的来了对方的新消息才再打一次 mark_read */
  const lastMarked = useRef(0)

  /** 学院群：kind='group'，没有 user_uid / peer_uid「双方」概念 */
  const isGroup = head?.kind === 'group'

  const list = signed ? messages : []

  function replaceMessages(items: ChatMessageItem[]) {
    messagesRef.current = items
    setMessages(items)
  }

  function resetRoom() {
    setHead(null); setGroupInfo(null); replaceMessages([]); setOutgoing([]); setText(''); setErr('')
    setOlderCursor(null); setMore(false); setMoreBusy(false); setSending(false); setUploading(false)
    setPanel('none'); setPreview(''); setNewMessages(0); setBackfillPending(false)
    ready.current = false; pollBusy.current = null; olderBusy.current = null; sendBusy.current = null; uploadBusy.current = null
    deliveries.current.clear(); receivedEdge.current = 0; backfill.current = null; scrollAnchor.current = null; scrollWanted.current = false
    nearBottom.current = true; lastMarked.current = 0
  }

  function markRead(items: ChatMessageItem[], work: ChatWork) {
    const newest = items[items.length - 1]
    if (!threadId || !newest || newest.id <= lastMarked.current || !currentWork(work)) return
    const previous = lastMarked.current
    lastMarked.current = newest.id
    void chatMarkRead(threadId).then(result => {
      if (currentWork(work) && result.error && lastMarked.current === newest.id) lastMarked.current = previous
    })
  }

  const loadLatest = useCallback(async () => {
    if (!threadId || !ready.current || pollBusy.current) return
    const work = captureWork('latest')
    if (!work) return
    pollBusy.current = work
    try {
      const pendingGap = backfill.current
      const r = pendingGap ? { error: null, data: { items: [] as ChatMessageItem[], has_more: false, next_cursor: null } }
        : await fetchChatMessages(threadId, CHAT_MSG_PAGE_SIZE)
      if (r.error || !currentWork(work)) return
      const incoming = [r.data.items]
      let gap = pendingGap
      const boundary = gap?.boundary ?? receivedEdge.current
      const edge = gap?.edge ?? r.data.items[r.data.items.length - 1]?.id ?? boundary
      if (!gap && boundary && r.data.has_more && r.data.items.length && r.data.items.every(item => item.id > boundary)) {
        gap = { cursor: r.data.next_cursor?.before_id ?? r.data.items[0].id, boundary, edge }
      }
      // More than one page may arrive between polls. Walk back to our known edge in bounded batches.
      for (let page = 0; gap && page < 4; page++) {
        const chunk = await fetchChatMessages(threadId, CHAT_MSG_PAGE_SIZE, gap.cursor)
        if (!currentWork(work)) return
        if (chunk.error) break
        incoming.push(chunk.data.items)
        if (!chunk.data.has_more || chunk.data.items.some(item => item.id <= gap!.boundary)) { gap = null; break }
        const cursor = chunk.data.next_cursor?.before_id ?? chunk.data.items[0]?.id
        if (!cursor || cursor >= gap.cursor) break
        gap = { cursor, boundary: gap.boundary, edge: gap.edge }
      }
      backfill.current = gap
      if (!gap) receivedEdge.current = Math.max(receivedEdge.current, edge)
      setBackfillPending(!!gap)
      const current = messagesRef.current
      const seen = new Set(current.map(item => item.id))
      const next = mergeById([current, ...incoming])
      const added = next.filter(item => item.id > boundary && !seen.has(item.id)).length
      if (nearBottom.current) {
        scrollWanted.current = true
        setNewMessages(0)
        markRead(next, work)
      } else if (added) setNewMessages(count => count + added)
      replaceMessages(next)
    } finally {
      if (pollBusy.current === work) pollBusy.current = null
    }
  }, [threadId, captureWork])

  useEffect(() => {
    if (!threadId || !signed) {
      setHead(null)
      setGroupInfo(null)
      replaceMessages([])
      setOutgoing([])
      setErr(threadId ? '' : '会话链接无效，请返回私信列表')
      setLoading(false)
      return
    }
    const work = captureWork('latest')
    if (!work) return
    ready.current = false
    void (async () => {
      setLoading(true)
      const [headRes, msgRes] = await Promise.all([
        queryRows<ThreadRow>('chat_threads', { id: threadId }, 1),
        fetchChatMessages(threadId, CHAT_MSG_PAGE_SIZE),
      ])
      if (!currentWork(work)) return
      // 被我隐藏过的会话读不到行（RLS），此时消息仍可读，只是话题信息缺失
      setHead(headRes.rows[0] || null)
      if (msgRes.error) {
        setErr(msgRes.error)
      } else {
        setErr('')
        replaceMessages(mergeById([messagesRef.current, msgRes.data.items]))
        receivedEdge.current = msgRes.data.items[msgRes.data.items.length - 1]?.id || 0
        setOlderCursor(msgRes.data.next_cursor?.before_id ?? msgRes.data.items[0]?.id ?? null)
        setMore(msgRes.data.has_more)
        scrollWanted.current = true
        ready.current = true
        markRead(msgRes.data.items, work)
      }
      setLoading(false)
    })()
    return () => scope.current.invalidate()
  }, [threadId, signed, uid, retryTick, captureWork])

  /* 学院群：补一次成员数，用在会话头副标题上 */
  useEffect(() => {
    if (!threadId || !signed || head?.kind !== 'group') {
      setGroupInfo(null)
      return
    }
    let alive = true
    void fetchCollegeGroups().then((groups) => {
      if (!alive) return
      setGroupInfo(groups.find((g) => g.threadId === threadId) ?? null)
    })
    return () => { alive = false }
  }, [threadId, signed, head?.kind])

  useEffect(() => {
    if (!threadId || !signed) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadLatest()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [threadId, signed, loadLatest])

  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    const anchor = scrollAnchor.current
    if (anchor) {
      const node = anchor.id ? el.querySelector<HTMLElement>(`[data-message-id="${anchor.id}"]`) : null
      el.scrollTop = node
        ? el.scrollTop + node.getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.offset
        : anchor.top + el.scrollHeight - anchor.height
      scrollAnchor.current = null
    } else if (scrollWanted.current) {
      el.scrollTop = el.scrollHeight
      setNewMessages(0)
    }
    scrollWanted.current = false
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 64
  }, [messages, outgoing.length])

  function onListScroll() {
    const el = listRef.current
    if (!el) return
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 64
    if (nearBottom.current) {
      setNewMessages(0)
      const work = captureWork()
      if (work) markRead(messagesRef.current, work)
    }
  }

  function showLatest() {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
    nearBottom.current = true
    setNewMessages(0)
    const work = captureWork()
    if (work) markRead(messagesRef.current, work)
  }

  async function loadOlder() {
    if (!threadId || olderBusy.current || olderCursor == null) return
    const work = captureWork('older')
    if (!work) return
    olderBusy.current = work
    setMoreBusy(true)
    const r = await fetchChatMessages(threadId, CHAT_MSG_PAGE_SIZE, olderCursor)
    if (olderBusy.current === work) olderBusy.current = null
    if (!currentWork(work)) return
    setMoreBusy(false)
    if (r.error) {
      toast.err(r.error)
      return
    }
    const el = listRef.current
    if (el) {
      const top = el.getBoundingClientRect().top
      const node = Array.from(el.querySelectorAll<HTMLElement>('[data-message-id]')).find(item => item.getBoundingClientRect().bottom > top)
      scrollAnchor.current = { id: node?.dataset.messageId || null, offset: node ? node.getBoundingClientRect().top - top : 0, top: el.scrollTop, height: el.scrollHeight }
    }
    replaceMessages(mergeById([messagesRef.current, r.data.items]))
    setOlderCursor(r.data.next_cursor?.before_id ?? r.data.items[0]?.id ?? null)
    setMore(r.data.has_more)
  }

  /** 真正的网络投递：成功用服务端回包替换乐观气泡，失败把该条标成可重试 */
  async function deliver(o: OutgoingMsg, work = captureWork()) {
    if (!threadId || !work || !currentWork(work) || deliveries.current.has(o.key)) return
    deliveries.current.add(o.key)
    const isImage = o.kind === 'image' && !!o.mediaUrl
    /* 学院群走 chat_group_send（按 college 校验成员）；私信走 chat_send */
    const r = isGroup
      ? isImage
        ? await sendCollegeGroupImage(threadId, o.mediaUrl || '', 'user')
        : await sendCollegeGroupMessage(threadId, o.body, 'user')
      : isImage
        ? await chatSendImage(threadId, o.mediaUrl || '', 'user')
        : await chatSendMessage(threadId, o.body, 'user')
    deliveries.current.delete(o.key)
    if (!currentWork(work)) return
    if (r.error || !r.data) {
      setOutgoing((prev) => prev.map((x) => (x.key === o.key ? { ...x, state: 'failed' as const } : x)))
      return
    }
    setOutgoing((prev) => prev.filter((x) => x.key !== o.key))
    // The optimistic send already moved us to the end; a late reply must not pull a reader back.
    if (nearBottom.current) scrollWanted.current = true
    replaceMessages(mergeById([messagesRef.current, [r.data.message]]))
  }

  async function send() {
    const body = text.trim()
    if (!body || sendBusy.current) return
    const work = captureWork()
    if (!(await auth.ensureSignedIn('发私信需要先登录')) || !work || !currentWork(work) || sendBusy.current) return
    const key = ++outgoingSeq.current
    setSending(true)
    sendBusy.current = work
    /* 乐观上屏：输入立即清空，发送中 / 失败由气泡自己交代，不默默丢消息 */
    setText('')
    const draft: OutgoingMsg = { key, body, kind: 'text', state: 'sending' }
    scrollWanted.current = true
    setOutgoing((prev) => [...prev, draft])
    await deliver(draft, work)
    if (sendBusy.current === work) sendBusy.current = null
    if (currentWork(work)) setSending(false)
  }

  /** 发图片：先上传到自己的 images 桶，再把 URL 当一条消息发出去（不经过 IM） */
  async function sendImage(file: File) {
    if (!file || uploadBusy.current || !threadId) return
    const work = captureWork()
    if (!(await auth.ensureSignedIn('发私信需要先登录')) || !work || !currentWork(work) || uploadBusy.current) return
    uploadBusy.current = work
    setUploading(true)
    const up = await uploadChatImage(file, uid)
    if (uploadBusy.current === work) uploadBusy.current = null
    if (!currentWork(work)) return
    setUploading(false)
    if (up.error || !up.url) {
      toast.err(up.error || '图片上传失败，请稍后重试')
      return
    }
    await sendImageUrl(up.url, work)
  }

  /** 已有 URL 直接发（表情包走这条，省掉一次上传） */
  async function sendImageUrl(url: string, captured?: ChatWork) {
    if (!url || !threadId) return
    const work = captured || captureWork()
    if (!(await auth.ensureSignedIn('发私信需要先登录')) || !work || !currentWork(work)) return
    const key = ++outgoingSeq.current
    const draft: OutgoingMsg = { key, body: '[图片]', kind: 'image', mediaUrl: url, state: 'sending' }
    scrollWanted.current = true
    setOutgoing((prev) => [...prev, draft])
    await deliver(draft, work)
  }

  /** 失败重试：把该条气泡重新置为发送中，再投递一次 */
  function retryOutgoing(o: OutgoingMsg) {
    const work = captureWork()
    if (!work || deliveries.current.has(o.key)) return
    scrollWanted.current = true
    setOutgoing((prev) => prev.map((x) => (x.key === o.key ? { ...x, state: 'sending' as const } : x)))
    void deliver({ ...o, state: 'sending' }, work)
  }

  /** 在光标处插入表情（没有光标就追加） */
  function insertEmoji(emoji: string) {
    setText((prev) => {
      if (prev.length + emoji.length > 2000) return prev
      const el = inputRef.current
      if (!el) return prev + emoji
      const start = el.selectionStart ?? prev.length
      const end = el.selectionEnd ?? prev.length
      const next = prev.slice(0, start) + emoji + prev.slice(end)
      requestAnimationFrame(() => {
        el.focus()
        const pos = start + emoji.length
        el.setSelectionRange(pos, pos)
      })
      return next
    })
  }

  const otherName = head ? (head.user_uid === uid ? head.peer_name : head.user_name) || '同学' : '同学'
  const topicPath = head ? chatTopicPath(head.topic_type, head.topic_id) : null

  /** 会话头：学院群显示群名 + 成员数，私信显示对方昵称 + 话题 */
  const who = isGroup ? (head.topic_title || `${collegeName(head.college_key)}交流群`) : otherName
  const whoSub = isGroup
    ? (groupInfo ? `学院群 · ${groupInfo.memberCount} 位同学` : '同学院交流群')
    : head
      ? `${chatTopicLabel(head.topic_type)}私信`
      : '私信'

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <button className={styles.back} onClick={() => nav(-1)} aria-label="返回">
          <IconBack />
        </button>
        <div className={styles.who}>
          <b>{who}</b>
          <span>{whoSub}</span>
        </div>
      </header>

      {/* 学院群本身就是话题，不再挂「闲置 / 互助」那张话题卡片 */}
      {signed && head && !isGroup && (head.topic_title || topicPath) ? (
        <div className={styles.topic}>
          <span className={styles.topicTag}>{chatTopicLabel(head.topic_type)}</span>
          {topicPath ? (
            <Link className={styles.topicTitle} to={topicPath}>
              {head.topic_title || '查看话题详情'}
            </Link>
          ) : (
            <span className={styles.topicTitle}>{head.topic_title}</span>
          )}
        </div>
      ) : null}

      <div className={`${styles.list} hide-scroll`} ref={listRef} onScroll={onListScroll}>
        {more ? (
          <div className={styles.moreRow}>
            <button className={styles.moreBtn} onClick={() => void loadOlder()} disabled={moreBusy}>
              {moreBusy ? '加载中…' : '查看更早的消息'}
            </button>
          </div>
        ) : null}

        {loading ? <p className={styles.empty}>正在加载…</p> : null}
        {!loading && err ? (
          <ErrorState
            compact
            title="消息加载失败"
            hint={err}
            action={<button onClick={() => setRetryTick((t) => t + 1)}>重试</button>}
          />
        ) : null}
        {!loading && !err && !list.length ? <p className={styles.empty}>还没有消息，先打个招呼吧</p> : null}
        {!loading && !err && !head ? (
          <p className={styles.empty}>该会话已从你的私信列表移除，对方发来新消息后会重新出现</p>
        ) : null}

        {list.map((m) => (
          <div className={`${styles.row} ${m.is_mine ? styles.me : ''}`} key={m.id} data-message-id={m.id}>
            <div className={styles.wrap}>
              {m.kind === 'image' && m.media_url ? (
                <button
                  type="button"
                  className={`${styles.bubble} ${styles.bubbleImg}`}
                  onClick={() => setPreview(m.media_url || '')}
                  aria-label="查看图片"
                >
                  <img src={m.media_url} alt="图片" loading="lazy" />
                </button>
              ) : (
                <div className={styles.bubble}>{m.body}</div>
              )}
              <span className={styles.time}>{chatBubbleTime(m.created_at)}</span>
            </div>
          </div>
        ))}
        {(signed ? outgoing : []).map((o) => (
          <div className={`${styles.row} ${styles.me} ${o.state === 'sending' ? styles.pending : ''}`} key={`out-${o.key}`}>
            <div className={styles.wrap}>
              {o.kind === 'image' && o.mediaUrl ? (
                <div className={`${styles.bubble} ${styles.bubbleImg} ${o.state === 'failed' ? styles.bubbleFailed : ''}`}>
                  <img src={o.mediaUrl} alt="图片" />
                </div>
              ) : (
                <div className={`${styles.bubble} ${o.state === 'failed' ? styles.bubbleFailed : ''}`}>{o.body}</div>
              )}
              {o.state === 'sending' ? <span className={styles.time}>发送中…</span> : null}
              {o.state === 'failed' ? (
                <button className={styles.resend} onClick={() => retryOutgoing(o)}>发送失败，点此重试</button>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {signed && newMessages > 0 ? <div className={styles.newMessages}>
        <button type="button" onClick={showLatest}>{newMessages > 99 ? '99+' : newMessages} 条新消息 · 回到最新</button>
      </div> : null}
      {signed && backfillPending ? <div className={styles.newMessages}>
        <button type="button" onClick={() => void loadLatest()}>部分新消息待同步，继续加载</button>
      </div> : null}

      {signed && panel === 'emoji' ? (
        <StickerPanel uid={uid} onEmoji={insertEmoji} onSticker={(url) => void sendImageUrl(url)} />
      ) : null}

      {signed && uploading ? <p className={styles.upHint}>图片上传中…</p> : null}

      {signed && threadId ? (
        <form
          className={styles.composer}
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => setPanel((p) => (p === 'emoji' ? 'none' : 'emoji'))}
            aria-label="表情"
            aria-pressed={panel === 'emoji'}
          >
            <IconSmile size={22} />
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            enterKeyHint="enter"
            aria-label="消息内容"
            value={text}
            maxLength={2000}
            placeholder="输入消息…"
            onChange={(e) => setText(e.target.value)}
            onFocus={() => { setPanel('none'); scrollWanted.current = nearBottom.current }}
            onKeyDown={(event) => { if (submitMessageKey(event)) { event.preventDefault(); void send() } }}
          />
          {/* 原生 file input（透明铺满），手指直接点在原生控件上 */}
          <ImagePickButton
            label={<IconImage size={22} />}
            ariaLabel="发送图片"
            disabled={uploading || loading || !!err}
            onPick={(files) => void sendImage(files[0])}
          />
          <button className={styles.send} type="submit" onPointerDown={(event) => event.preventDefault()} disabled={sending || uploading || loading || !!err || !text.trim()} aria-label="发送">
            <span>{sending ? '发送中' : '发送'}</span>
          </button>
        </form>
      ) : (
        <div className={styles.gate}>
          {threadId ? <button onClick={() => void auth.ensureSignedIn('发私信需要先登录')}>登录后即可回复</button>
            : <Link to="/chats">返回私信列表</Link>}
        </div>
      )}

      {signed && preview ? (
        <div className={styles.lightbox} onClick={() => setPreview('')} role="dialog" aria-label="图片预览">
          <img src={preview} alt="图片预览" />
          <button type="button" className={styles.previewClose} aria-label="关闭图片预览" onClick={(event) => { event.stopPropagation(); setPreview('') }}>关闭</button>
        </div>
      ) : null}
    </div>
  )
}
