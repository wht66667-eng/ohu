import { HomeServiceIcon } from '../../components/HomeServiceIcon'
import { FoxSheetPose } from '../../components/fox/FoxSheetPose'
import { AnnouncementBanner } from '../../components/AnnouncementBanner'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { resolveAvatar } from '../../data/images'
import { IconImage, IconSmile } from '../../components/Icons'
import { MessageEntry } from '../../components/MessageEntry'
import { FocusThemeToggle } from '../../components/focus/FocusInteractions'
import { ImagePickButton } from '../../components/ImageUploadField'
import { DialogLayer } from '../../components/ui/DialogLayer'
import { isImeComposing, submitMessageKey } from '../../lib/keyboard-viewport'
import { onAppRefresh } from '../../lib/native'
import { PostCardSkeleton, RowSkeleton } from '../../components/ui/Skeleton'
import { StickerPanel } from '../../components/StickerPanel'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../lib/auth'
import { uploadImages } from '../../lib/market'
import { uploadPlazaImage } from '../../lib/chat-image'
import { openDmThread } from '../../lib/dm-entry'
import { AsyncOwner, type OwnerTicket } from '../../lib/async-owner'
import { captureImSession, currentImSession, imSessionUid, subscribeImSession } from '../../lib/im-session'
import { collegeName, fetchMyCollegeGroup, type CollegeGroup } from '../../lib/college-group'
/**
 * 大厅气泡的展示结构：服务端 plaza_messages 是「创建者 + ISO 时间」，
 * 渲染要的是「昵称 + 毫秒时间」，在这里一次性折好，避免渲染层再做时区推算。
 */
interface LobbyMsg {
  id: string
  body: string
  kind: 'text' | 'image'
  mediaUrl: string
  from: string
  nick: string
  avatar: string
  at: number
  iso: string
  isMine: boolean
}

function toLobbyMsg(row: PlazaMessage, uid: string): LobbyMsg {
  const at = new Date(row.created_at).getTime() || Date.now()
  const kind = row.kind === 'image' ? 'image' : 'text'
  return {
    id: `pg-${row.id}`,
    body: kind === 'image' ? row.body || '[图片]' : row.body,
    kind,
    mediaUrl: kind === 'image' ? String(row.media_url || '') : '',
    from: String(row.creator_uid || ''),
    nick: String(row.creator_name || '同学'),
    avatar: String(row.creator_avatar || ''),
    at,
    iso: String(row.created_at || ''),
    isMine: String(row.creator_uid || '') === uid,
  }
}
import {
  PLAZA_MSG_LIMIT,
  PLAZA_POLL_MS,
  PLAZA_TAGS,
  createPlazaPost,
  deletePlazaPost,
  fetchHotPosts,
  fetchOlderPlazaPosts,
  fetchLikedPostIds,
  fetchPlazaMessages,
  fetchPlazaPosts,
  fetchTopLikedPosts,
  fmtPlazaTime,
  incrPostView,
  searchPlazaPosts,
  sendPlazaImage,
  sendPlazaMessage,
  togglePostLike,
  type PlazaMessage,
  type PlazaPost,
  type PlazaTag,
} from '../../lib/plaza'
import { fetchPlazaGate, type PlazaGate } from '../../lib/sanctions'
import styles from './PlazaPage.module.css'

type TabKey = 'lobby' | 'feed' | 'hot'
type PlazaTicket = OwnerTicket & { session: OwnerTicket | null }
const PLAZA_RANKING_LIMIT = 8

/** 消息/动态头像：有自定义头像显示图片，否则按 uid 分配预设动物头像 */
function AvatarFace({
  url,
  name,
  seed,
  as,
  title,
  onClick,
}: {
  url?: string
  name: string
  seed?: string
  as?: 'button' | 'span'
  title?: string
  onClick?: () => void
}) {
  const inner = (
    <img
      src={resolveAvatar(url, seed || name)}
      alt=""
      referrerPolicy="no-referrer"
      onError={(e) => {
        e.currentTarget.style.display = 'none'
      }}
    />
  )
  if (as === 'span') {
    return <span className={styles.avatar}>{inner}</span>
  }
  return (
    <button type="button" className={styles.avatar} title={title} onClick={onClick}>
      {inner}
    </button>
  )
}

function tabFromSearch(sp: URLSearchParams): TabKey {
  if (sp.get('compose') === '1') return 'feed'
  if (sp.get('tab') === 'hot') return 'hot'
  if (sp.get('tab') === 'feed') return 'feed'
  return sp.get('tab') === 'lobby' ? 'lobby' : 'feed'
}

function captureVisiblePostAnchor(container: HTMLElement | null): { id: number; offsetTop: number } | null {
  const scrollContainer = document.getElementById('main-content')
  if (!container || !scrollContainer || scrollContainer.scrollTop <= 0) return null
  const containerTop = scrollContainer.getBoundingClientRect().top
  const containerBottom = scrollContainer.getBoundingClientRect().bottom
  const cards = container.querySelectorAll<HTMLElement>('[data-post-id]')
  for (const card of cards) {
    const rect = card.getBoundingClientRect()
    if (rect.bottom <= containerTop || rect.top >= containerBottom) continue
    const id = Number(card.dataset.postId)
    return Number.isSafeInteger(id) && id > 0 ? { id, offsetTop: rect.top - containerTop } : null
  }
  return null
}

export function PlazaPage() {
  const nav = useNavigate()
  const toast = useToast()
  const auth = useAuth()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const sessionScope = useSyncExternalStore(subscribeImSession, () => uid ? `${uid}:${captureImSession(uid)?.revision ?? 'pending'}` : '', () => '')
  const [sp, setSp] = useSearchParams()
  const tab = tabFromSearch(sp)
  const [msgs, setMsgs] = useState<LobbyMsg[]>([])
  const [posts, setPosts] = useState<PlazaPost[]>([])
  const postsRef = useRef<PlazaPost[]>([])
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [olderError, setOlderError] = useState('')
  const [hasOlderPosts, setHasOlderPosts] = useState(true)
  const hasOlderPostsRef = useRef(true)
  const olderLoadLock = useRef(false)
  const olderLoadRequest = useRef(0)
  const feedRefreshLock = useRef(false)
  const feedRefreshRequest = useRef(0)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [feedError, setFeedError] = useState('')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [composeOpen, setComposeOpen] = useState(() => sp.get('compose') === '1')
  const [composeBody, setComposeBody] = useState('')
  const [composeTag, setComposeTag] = useState<PlazaTag>('吐槽')
  const [composeImages, setComposeImages] = useState<string[]>([])
  const [composeUploading, setComposeUploading] = useState(false)
  const [syncLobby, setSyncLobby] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [gate, setGate] = useState<PlazaGate | null>(null)
  /** 大厅输入区：表情/表情包面板、选图弹层、图片预览 */
  const [lobbyPanel, setLobbyPanel] = useState<'none' | 'emoji'>('none')
  const [lobbyUploading, setLobbyUploading] = useState(false)
  const [preview, setPreview] = useState<{ urls: string[]; index: number } | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const [hotViews, setHotViews] = useState<PlazaPost[]>([])
  const [hotLikes, setHotLikes] = useState<PlazaPost[]>([])
  const [hotViewsOffset, setHotViewsOffset] = useState(0)
  const [hotLikesOffset, setHotLikesOffset] = useState(0)
  const [hotViewsHasMore, setHotViewsHasMore] = useState(false)
  const [hotLikesHasMore, setHotLikesHasMore] = useState(false)
  const [hotViewsLoadingMore, setHotViewsLoadingMore] = useState(false)
  const [hotLikesLoadingMore, setHotLikesLoadingMore] = useState(false)
  const [hotViewsMoreError, setHotViewsMoreError] = useState('')
  const [hotLikesMoreError, setHotLikesMoreError] = useState('')
  const [hotError, setHotError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [searchRes, setSearchRes] = useState<PlazaPost[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchHasMore, setSearchHasMore] = useState(false)
  const [searchingMore, setSearchingMore] = useState(false)
  const [searchMoreError, setSearchMoreError] = useState('')
  const [likedSet, setLikedSet] = useState<Set<number>>(new Set())
  const [likedError, setLikedError] = useState('')
  const [likedLoading, setLikedLoading] = useState(false)
  const [showBackTop, setShowBackTop] = useState(false)
  const lobbyList = useRef<HTMLDivElement | null>(null)
  const feedListRef = useRef<HTMLDivElement | null>(null)
  const feedAnchorRef = useRef<{ id: number; offsetTop: number } | null>(null)
  const lobbyMessages = useRef<LobbyMsg[]>([])
  const nearLobbyBottom = useRef(true)
  const [newLobbyMessages, setNewLobbyMessages] = useState(0)
  const viewedRef = useRef<Set<number>>(new Set())
  const owner = useRef(new AsyncOwner(uid))
  owner.current.select(uid)
  const mounted = useRef(true)
  const tabRef = useRef(tab)
  tabRef.current = tab
  const keywordRef = useRef(keyword)
  keywordRef.current = keyword
  const composeRevision = useRef(0)
  const uploadLock = useRef(false)
  /** 我所属学院的交流群；未登录或未填学院时为 null */
  const [myGroup, setMyGroup] = useState<CollegeGroup | null>(null)
  const [collegeBusy, setCollegeBusy] = useState(false)
  const lobbyUploadLock = useRef(false)
  const sendLock = useRef(false)
  const likeLocks = useRef(new Set<number>())
  const [stateOwner, setStateOwner] = useState(sessionScope)
  const capture = (lane?: string): PlazaTicket => ({ ...(lane ? owner.current.begin(lane) : owner.current.capture()), session: captureImSession(uid) })
  const current = (ticket: PlazaTicket) => mounted.current && owner.current.current(ticket) && (ticket.owner ? currentImSession(ticket.session) : !imSessionUid())
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; owner.current.invalidate() }
  }, [])
  useEffect(() => {
    composeRevision.current++
    uploadLock.current = false; lobbyUploadLock.current = false; sendLock.current = false; likeLocks.current.clear()
    olderLoadRequest.current++
    olderLoadLock.current = false
    feedRefreshRequest.current++
    feedRefreshLock.current = false
    setLoadingOlder(false)
    setFeedError('')
    setStateOwner(sessionScope); setGate(null); setLikedSet(new Set()); setLikedError(''); setLikedLoading(false); setMsgs([])
    lobbyMessages.current = []; nearLobbyBottom.current = true; setNewLobbyMessages(0)
    setText(''); setSending(false); setComposeUploading(false); setLobbyUploading(false)
    setComposeBody(''); setComposeImages([])
    setPreview(null); setLobbyPanel('none'); setBusyId(''); setSearchRes([]); setSearching(false); setSearched(false); setSearchError(''); setSearchHasMore(false); setSearchingMore(false); setSearchMoreError('')
  }, [uid, sessionScope])
  const isAdmin = auth.isSigned && !!(auth.profile?.isAdmin || auth.profile?.isSuperAdmin)
  const displayName = auth.profile?.username || '同学'
  const avatarUrl = auth.user?.avatarUrl || ''

  function mergeLobbyMessages(rows: PlazaMessage[]) {
    const previous = lobbyMessages.current
    const known = new Map(previous.map(message => [message.id, message]))
    const snapshotIds = rows.map(row => Number(row.id)).filter(id => Number.isSafeInteger(id) && id > 0)
    const snapshotMin = Math.min(...snapshotIds)
    const present = new Set(rows.map(row => `pg-${row.id}`))
    // The latest window is authoritative; preserve older history without resurrecting
    // messages removed from the currently returned window.
    for (const message of previous) {
      const id = Number(message.id.slice(3))
      if (!rows.length || id >= snapshotMin && !present.has(message.id)) known.delete(message.id)
    }
    let added = 0
    for (const row of rows) {
      const message = toLobbyMsg(row, uid)
      if (!known.has(message.id)) added++
      known.set(message.id, message)
    }
    const next = [...known.values()].sort((a, b) => a.at - b.at || Number(a.id.slice(3)) - Number(b.id.slice(3)))
    lobbyMessages.current = next
    setMsgs(next)
    if (previous.length && added && !nearLobbyBottom.current) setNewLobbyMessages(count => count + added)
  }

  function showLatestLobby() {
    nearLobbyBottom.current = true
    setNewLobbyMessages(0)
    const list = lobbyList.current
    if (list) list.scrollTop = list.scrollHeight
  }

  const loadFeed = useCallback(async () => {
    if (feedRefreshLock.current) return
    feedRefreshLock.current = true
    const refreshId = ++feedRefreshRequest.current
    // A newer first-page refresh invalidates an in-flight older-page request.
    // Reset synchronously so its stale finally block cannot strand the spinner.
    olderLoadRequest.current++
    olderLoadLock.current = false
    setLoadingOlder(false)
    const ticket = capture('feed')
    try {
      const r = await fetchPlazaPosts()
      if (!current(ticket) || tabRef.current !== 'feed') return
      if (r.error) {
        setFeedError(r.error)
        return
      }
      setFeedError('')
      if (r.rows.length === 0) {
        feedAnchorRef.current = null
        postsRef.current = []
        setPosts([])
        hasOlderPostsRef.current = false
        setHasOlderPosts(false)
        return
      }
      const currentPosts = postsRef.current
      const loadedOlder = currentPosts.filter(post => post.id < Math.min(...r.rows.map(row => row.id)))
      const newest = new Map(r.rows.map(post => [post.id, post]))
      for (const post of loadedOlder) if (!newest.has(post.id)) newest.set(post.id, post)
      const merged = [...newest.values()].sort((a, b) => b.id - a.id)
      feedAnchorRef.current = keywordRef.current.trim() ? null : captureVisiblePostAnchor(feedListRef.current)
      postsRef.current = merged
      setPosts(merged)
      const more = loadedOlder.length > 0 ? hasOlderPostsRef.current : !!r.hasMore
      hasOlderPostsRef.current = more
      setHasOlderPosts(more)
    } finally {
      if (feedRefreshRequest.current === refreshId) feedRefreshLock.current = false
    }
  }, [uid, sessionScope])

  useLayoutEffect(() => {
    const anchor = feedAnchorRef.current
    feedAnchorRef.current = null
    if (!anchor || tab !== 'feed' || keyword.trim()) return
    const container = feedListRef.current
    const card = container?.querySelector<HTMLElement>(`[data-post-id="${anchor.id}"]`)
    if (!container || !card) return
    const scrollContainer = document.getElementById('main-content')
    if (!scrollContainer) return
    const containerTop = scrollContainer.getBoundingClientRect().top
    const nextOffset = card.getBoundingClientRect().top - containerTop
    scrollContainer.scrollTop += nextOffset - anchor.offsetTop
  }, [posts, tab, keyword])

  const loadOlderPosts = useCallback(async () => {
    if (feedRefreshLock.current || olderLoadLock.current || loadingOlder || !hasOlderPosts || postsRef.current.length === 0) return
    olderLoadLock.current = true
    const requestId = ++olderLoadRequest.current
    const ticket = capture('feed')
    const beforeId = Math.min(...postsRef.current.map(post => post.id))
    setLoadingOlder(true)
    setOlderError('')
    try {
      const result = await fetchOlderPlazaPosts(beforeId)
      if (!current(ticket) || tabRef.current !== 'feed') return
      if (result.error) { setOlderError(result.error); return }
      setPosts(currentPosts => {
        const ids = new Set(currentPosts.map(post => post.id))
        const added = result.rows.filter(post => !ids.has(post.id))
        const merged = [...currentPosts, ...added]
        postsRef.current = merged
        return merged
      })
      hasOlderPostsRef.current = !!result.hasMore
      setHasOlderPosts(!!result.hasMore)
    } catch (error) {
      if (current(ticket)) setOlderError(error instanceof Error ? error.message : '加载失败，请重试')
    } finally {
      if (olderLoadRequest.current === requestId) {
        olderLoadLock.current = false
        if (current(ticket)) setLoadingOlder(false)
      }
    }
  }, [uid, sessionScope, loadingOlder, hasOlderPosts])

  useEffect(() => {
    const scrollContainer = document.getElementById('main-content')
    if (!scrollContainer || tab === 'lobby') {
      setShowBackTop(false)
      return
    }
    const onScroll = () => {
      setShowBackTop(scrollContainer.scrollTop > 320)
      if (tab === 'feed' && !keywordRef.current.trim() && scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < 220) {
        void loadOlderPosts()
      }
    }
    scrollContainer.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => scrollContainer.removeEventListener('scroll', onScroll)
  }, [tab, loadOlderPosts, posts.length, loadingOlder, hasOlderPosts])

  function scrollToTop() {
    const scrollContainer = document.getElementById('main-content')
    if (!scrollContainer) return
    scrollContainer.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }

  const loadHot = useCallback(async () => {
    const ticket = capture('hot')
    setHotViewsLoadingMore(false); setHotLikesLoadingMore(false)
    try {
      const [v, l] = await Promise.all([fetchHotPosts(PLAZA_RANKING_LIMIT, 0), fetchTopLikedPosts(PLAZA_RANKING_LIMIT, 0)])
      if (!current(ticket) || tabRef.current !== 'hot') return
      if (!v.error) { setHotViews(v.rows); setHotViewsOffset(v.rows.length); setHotViewsHasMore(!!v.hasMore); setHotViewsMoreError('') }
      if (!l.error) { setHotLikes(l.rows); setHotLikesOffset(l.rows.length); setHotLikesHasMore(!!l.hasMore); setHotLikesMoreError('') }
      setHotError([
        v.error ? `浏览量榜：${v.error}` : '',
        l.error ? `点赞榜：${l.error}` : '',
      ].filter(Boolean).join('；'))
    } catch (error) {
      if (current(ticket) && tabRef.current === 'hot') setHotError((error as Error).message || '热门榜加载失败，请重试')
    }
  }, [uid, sessionScope])

  const loadMoreHot = useCallback(async (kind: 'views' | 'likes') => {
    const rows = kind === 'views' ? hotViews : hotLikes
    const offset = kind === 'views' ? hotViewsOffset : hotLikesOffset
    const more = kind === 'views' ? hotViewsHasMore : hotLikesHasMore
    const busy = kind === 'views' ? hotViewsLoadingMore : hotLikesLoadingMore
    if (!more || busy || rows.length === 0) return
    const ticket = capture('hot')
    const setBusy = kind === 'views' ? setHotViewsLoadingMore : setHotLikesLoadingMore
    const setError = kind === 'views' ? setHotViewsMoreError : setHotLikesMoreError
    const setHasMore = kind === 'views' ? setHotViewsHasMore : setHotLikesHasMore
    const setRows = kind === 'views' ? setHotViews : setHotLikes
    setBusy(true)
    setError('')
    try {
      const result = kind === 'views'
        ? await fetchHotPosts(PLAZA_RANKING_LIMIT, offset)
        : await fetchTopLikedPosts(PLAZA_RANKING_LIMIT, offset)
      if (!current(ticket) || tabRef.current !== 'hot') return
      if (result.error) { setError(result.error); return }
      setRows(currentRows => {
        const known = new Set(currentRows.map(post => post.id))
        return [...currentRows, ...result.rows.filter(post => !known.has(post.id))]
      })
      if (kind === 'views') setHotViewsOffset(offset + result.rows.length)
      else setHotLikesOffset(offset + result.rows.length)
      setHasMore(!!result.hasMore)
    } catch (error) {
      if (current(ticket)) setError(error instanceof Error ? error.message : '加载失败，请重试')
    } finally {
      if (current(ticket)) setBusy(false)
    }
  }, [uid, sessionScope, hotViews, hotLikes, hotViewsOffset, hotLikesOffset, hotViewsHasMore, hotLikesHasMore, hotViewsLoadingMore, hotLikesLoadingMore])

  useEffect(() => {
    if (tab === 'lobby') return
    return onAppRefresh(tab === 'hot' ? loadHot : loadFeed)
  }, [tab, loadFeed, loadHot])

  const runSearch = useCallback(async (kw: string) => {
    const k = kw.trim()
    if (k.length < 2) return
    const ticket = capture('search')
    const active = () => current(ticket) && keywordRef.current.trim() === k
    setSearching(true)
    setSearched(true)
    setSearchRes([])
    setSearchError('')
    setSearchHasMore(false)
    setSearchMoreError('')
    try {
      const r = await searchPlazaPosts(k)
      if (!active()) return
      if (r.error) { setSearchError(r.error); toast.err(r.error); setSearchRes([]) }
      else { setSearchRes(r.rows); setSearchHasMore(!!r.hasMore) }
    } catch (error) {
      if (active()) {
        const message = (error as Error).message || '搜索失败，请重试'
        setSearchError(message)
        toast.err(message)
        setSearchRes([])
      }
    } finally { if (active()) setSearching(false) }
  }, [uid, sessionScope, toast])

  const loadMoreSearchResults = useCallback(async () => {
    const k = keywordRef.current.trim()
    const beforeId = searchRes[searchRes.length - 1]?.id
    if (k.length < 2 || !searchHasMore || searchingMore || !beforeId) return
    const ticket = capture('search')
    const active = () => current(ticket) && keywordRef.current.trim() === k
    setSearchingMore(true)
    setSearchMoreError('')
    try {
      const r = await searchPlazaPosts(k, 40, beforeId)
      if (!active()) return
      if (r.error) {
        setSearchMoreError(r.error)
        toast.err(r.error)
        return
      }
      setSearchRes((previous) => {
        const seen = new Set(previous.map((post) => post.id))
        return [...previous, ...r.rows.filter((post) => !seen.has(post.id))]
      })
      setSearchHasMore(!!r.hasMore)
    } catch (error) {
      if (active()) {
        const message = (error as Error).message || '加载搜索结果失败，请重试'
        setSearchMoreError(message)
        toast.err(message)
      }
    } finally {
      if (active()) setSearchingMore(false)
    }
  }, [searchRes, searchHasMore, searchingMore, uid, sessionScope, toast])

  const likePost = useCallback(
    async (id: number) => {
      if (likeLocks.current.has(id)) return
      const ticket = capture()
      likeLocks.current.add(id)
      try {
      if (!(await auth.ensureSignedIn('点赞需要先登录'))) return
      if (!current(ticket)) return
      setBusyId(`like-${id}`)
      const r = await togglePostLike(id)
      if (!current(ticket)) return
      if (r.error) {
        toast.err(r.error)
        return
      }
      setLikedSet((prev) => {
        const next = new Set(prev)
        if (r.liked) next.add(id)
        else next.delete(id)
        return next
      })
      const apply = (list: PlazaPost[]) =>
        list.map((p) => (p.id === id ? { ...p, likes: r.likes } : p))
      setPosts(apply)
      setSearchRes(apply)
      setHotViews(apply)
      setHotLikes((list) =>
        list
          .map((p) => (p.id === id ? { ...p, likes: r.likes } : p))
          .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0)),
      )
      } catch (error) { if (current(ticket)) toast.err((error as Error).message || '点赞未完成，请重试') }
      finally { if (current(ticket)) { likeLocks.current.delete(id); setBusyId(previous => previous === `like-${id}` ? '' : previous) } }
    },
    [auth, toast, uid, sessionScope],
  )

  /**
   * 进入大厅：拉门禁 + 拉 plaza_messages 历史。
   *
   * 这里不再连腾讯 IM 直播群——IM 按 MAU 计费，而大厅本来就在把每条消息镜像写进
   * plaza_messages（“mirror”），等于同一条消息存了两份。去掉 IM 后只留 PG 一张表，
   * 实时性靠轮询补齐（见下面的 PLAZA_POLL_MS 定时器）。
   */
  const bootLobby = useCallback(async () => {
    const ticket = capture('lobby')
    const active = () => current(ticket) && tabRef.current === 'lobby'
    if (!uid) {
      /* 大厅不再有连接态，门禁失败即不展示输入区 */
      setErr('登录后即可进入大厅')
      setLoading(false)
      return
    }
    const g = await fetchPlazaGate(uid)
    if (!active()) return
    setGate(g)
    if (g.hall || g.account) {
      /* 大厅不再有连接态，门禁失败即不展示输入区 */
      setMsgs([])
      lobbyMessages.current = []
      setLoading(false)
      setErr('')
      return
    }
    setLoading(true)
    setErr('')
    const r = await fetchPlazaMessages(PLAZA_MSG_LIMIT)
    if (!active()) return
    if (r.error) {
      setErr(r.error)
      /* 大厅不再有连接态，门禁失败即不展示输入区 */
    } else {
      mergeLobbyMessages(r.rows)
      setErr('')

    }
    setLoading(false)
  }, [uid, sessionScope])

  useEffect(() => {
    if (!uid) return
    const ticket = capture('gate')
    void fetchPlazaGate(uid).then(g => { if (current(ticket)) setGate(g) })
  }, [uid, sessionScope])

  useEffect(() => {
    if (tab !== 'lobby') return
    void bootLobby()
  }, [tab, bootLobby])

  useEffect(() => {
    if (tab !== 'feed') return
    let alive = true
    void (async () => {
      setLoading(true)
      await loadFeed()
      if (alive) setLoading(false)
    })()
    return () => {
      alive = false
      feedRefreshRequest.current++
      feedRefreshLock.current = false
      olderLoadRequest.current++
      olderLoadLock.current = false
    }
  }, [tab, loadFeed])

  useEffect(() => {
    if (tab !== 'feed') return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadFeed()
    }, PLAZA_POLL_MS)
    return () => window.clearInterval(timer)
  }, [tab, loadFeed])

  /* 浏览量统计：feed 中首次出现的帖子记一次浏览（会话内不重复）。
   * 不做本地 +1，避免轮询覆盖时重复累加；计数在下次轮询（≤4s）从服务端回填。 */
  useEffect(() => {
    if (tab !== 'feed') return
    const fresh = posts.filter((p) => !viewedRef.current.has(p.id))
    if (fresh.length === 0) return
    fresh.forEach((p) => {
      viewedRef.current.add(p.id)
      void incrPostView(p.id)
    })
  }, [posts, tab])

  useEffect(() => {
    if (tab !== 'hot') return
    let alive = true
    void (async () => {
      setLoading(true)
      await loadHot()
      if (alive) setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [tab, loadHot])

  const loadLikedState = useCallback(async () => {
    if (!uid) {
      setLikedSet(new Set())
      setLikedError('')
      setLikedLoading(false)
      return
    }
    const ticket = capture('likes')
    setLikedLoading(true)
    const result = await fetchLikedPostIds(uid)
    if (!current(ticket)) return
    if (result.error) {
      setLikedError(result.error)
    } else {
      setLikedSet(result.ids)
      setLikedError('')
    }
    setLikedLoading(false)
  }, [uid, sessionScope])

  useEffect(() => {
    void loadLikedState()
  }, [loadLikedState])

  /* 大厅轮询：只在「大厅页可见」时跑，退后台/切 Tab 立刻停，省 PG 调用次数 */
  useEffect(() => {
    if (tab !== 'lobby' || !uid || !gate || gate.hall || gate.account) return
    let alive = true
    let pending = false
    const pull = async () => {
      if (!alive || pending || document.visibilityState !== 'visible') return
      pending = true
      try {
        const ticket = capture('lobby')
        const r = await fetchPlazaMessages(PLAZA_MSG_LIMIT)
        if (!alive || !current(ticket)) return
        if (r.error) {
          setErr(r.error)
          return
        }
        mergeLobbyMessages(r.rows)
        setErr('')
      } catch (error) {
        if (alive) setErr((error as Error)?.message || '大厅消息暂时无法更新，请重试')
      } finally {
        pending = false
      }
    }
    const timer = window.setInterval(() => void pull(), PLAZA_POLL_MS)
    document.addEventListener('visibilitychange', pull)
    return () => {
      alive = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', pull)
    }
  }, [tab, uid, sessionScope, gate?.hall, gate?.account])

  useEffect(() => {
    if (tab === 'lobby' && nearLobbyBottom.current) showLatestLobby()
  }, [tab, msgs.length])

  useEffect(() => {
    if (sp.get('compose') === '1') {
      setComposeOpen(true)
      const next = new URLSearchParams(sp)
      next.delete('compose')
      next.set('tab', 'feed')
      setSp(next, { replace: true })
    }
  }, [sp, setSp])

  function switchTab(next: TabKey) {
    const q = new URLSearchParams(sp)
    q.set('tab', next)
    setSp(q, { replace: true })
  }

  /**
   * 大厅入口用：登录且已填学院时，查一次「我所属学院的群」，
   * 拿到 threadId 供「进入群聊」跳转；未填学院则保持 null（按钮变成「去填写」）。
   */
  useEffect(() => {
    const key = auth.profile?.college || ''
    if (!auth.isSigned || !uid || !key) {
      setMyGroup(null)
      setCollegeBusy(false)
      return
    }
    let alive = true
    setCollegeBusy(true)
    void fetchMyCollegeGroup(uid).then((g) => {
      if (!alive) return
      setMyGroup(g)
      setCollegeBusy(false)
    })
    return () => {
      alive = false
    }
  }, [auth.isSigned, uid, auth.profile?.college])
  function closeCompose() {
    if (sendLock.current) return
    composeRevision.current++
    uploadLock.current = false
    setComposeUploading(false); setComposeOpen(false)
  }
  function openCompose() {
    composeRevision.current++
    setComposeOpen(true)
  }

  async function sendLobby() {
    const body = text.trim()
    if (!body || sendLock.current) return
    const ticket = capture('lobby-send')
    sendLock.current = true; setSending(true)
    try {
    if (!(await auth.ensureSignedIn('发大厅消息需要先登录')) || !current(ticket) || !uid) return
    if (gate?.hall || gate?.account || gate?.mute) {
      toast(gate.reason || (gate.hall ? '你已被限制进入大厅' : '你已被禁言'))
      return
    }
    /* sendPlazaMessage 内部已做敏感词与门禁（禁言 / 限制进大厅）校验 */
    const r = await sendPlazaMessage(body, uid, displayName, avatarUrl)
    if (!current(ticket)) return
    if (r.error) {
      toast.err(r.error)
      return
    }
    setText(previous => previous.trim() === body ? '' : previous)
    nearLobbyBottom.current = true; setNewLobbyMessages(0)
    void bootLobby()
    } catch (error) { if (current(ticket)) toast.err((error as Error).message || '消息发送失败，请重试') }
    finally { if (current(ticket)) { sendLock.current = false; setSending(false) } }
  }

  /** 大厅发图：先上传到 images 桶 plaza/{uid}/，再把 URL 落一条图片消息 */
  async function sendLobbyImage(file: File) {
    if (!file || lobbyUploadLock.current || sendLock.current || !uid) return
    lobbyUploadLock.current = true
    setLobbyUploading(true)
    try {
      if (!(await auth.ensureSignedIn('发大厅图片需要先登录'))) return
      const up = await uploadPlazaImage(file, uid)
      if (up.error || !up.url) {
        toast.err(up.error || '图片上传失败，请稍后重试')
      return
    }
    await sendLobbyImageUrl(up.url)
    } catch (error) { toast.err((error as Error).message || '图片上传失败，请重试') }
    finally {
      /* 无条件复位，避免 uploading 卡死导致发布按钮永久禁用 */
      lobbyUploadLock.current = false
      setLobbyUploading(false)
    }
  }

  /** 已有 URL 直接发（表情包走这条，省掉一次上传） */
  async function sendLobbyImageUrl(url: string) {
    if (!url || !uid || sendLock.current) return
    const ticket = capture('lobby-send')
    sendLock.current = true
    setSending(true)
    try {
    if (!(await auth.ensureSignedIn('发大厅图片需要先登录')) || !current(ticket)) return
    const r = await sendPlazaImage(url, uid, displayName, avatarUrl)
    if (!current(ticket)) return
    if (r.error) {
      toast.err(r.error)
      return
    }
    nearLobbyBottom.current = true; setNewLobbyMessages(0)
    void bootLobby()
    } catch (error) { if (current(ticket)) toast.err((error as Error).message || '图片发送失败，请重试') }
    finally { if (current(ticket)) { sendLock.current = false; setSending(false) } }
  }

  /** 发帖选图：上传到 images 桶 plaza-post/{uid}/，最多 3 张 */
  const MAX_POST_IMAGES = 3
  async function pickComposeImages(picked: File[]) {
    if (!picked.length || uploadLock.current || sendLock.current) return
    if (composeImages.length >= MAX_POST_IMAGES) {
      toast(`最多 ${MAX_POST_IMAGES} 张图片`)
      return
    }
    /* 与 submitPost 同一套护栏：账号切换 / 关闭重开发布框（composeRevision 递增）后，
       上一张图的上传结果不能再写回草稿，也不能提前解掉新一张图的「上传中」。 */
    const ticket = capture('compose-upload'), draft = composeRevision.current
    const active = () => current(ticket) && draft === composeRevision.current
    uploadLock.current = true
    setComposeUploading(true)
    try {
      if (!(await auth.ensureSignedIn('发图需要先登录')) || !active() || !uid) {
        toast.err('请先登录后再发图')
        return
      }
      const room = MAX_POST_IMAGES - composeImages.length
      if (room <= 0) return
      const res = await uploadImages(picked.slice(0, room), 'plaza-post')
      if (!active()) return
      if (res.error) {
        toast.err(res.error)
        return
      }
      if (res.urls.length) setComposeImages((list) => [...list, ...res.urls].slice(0, MAX_POST_IMAGES))
    } catch (error) {
      if (active()) toast.err((error as Error).message || '图片上传失败，请重试')
    } finally {
      /* 只复位自己那一次：过期上传不能清掉当前这张图的上传中状态 */
      if (active()) {
        uploadLock.current = false
        setComposeUploading(false)
      }
    }
  }

  /** 输入框随内容长高，最多约 4 行；发完变空时自动收回单行 */
  const autoGrow = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`
  }, [])

  useEffect(() => {
    autoGrow()
  }, [autoGrow, text])

  /** 在光标处插入表情（没有光标就追加） */
  function insertEmoji(emoji: string) {
    setText((prev) => {
      if (prev.length + emoji.length > 500) return prev
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

  async function submitPost() {
    const body = composeBody.trim()
    if ((!body && composeImages.length === 0) || sendLock.current || uploadLock.current || composeUploading) return
    const ticket = capture('compose-send'), draft = composeRevision.current
    const active = () => current(ticket) && draft === composeRevision.current
    sendLock.current = true
    setSending(true)
    let published = false
    try {
    if (!(await auth.ensureSignedIn('发广场动态需要先登录')) || !active() || !uid) return
    if (gate?.mute || gate?.account) {
      toast(gate.reason || '你已被禁言')
      return
    }
    const r = await createPlazaPost(body || '（图片动态）', composeTag, uid, displayName, avatarUrl, composeImages)
    if (!active()) return
    if (r.error) {
      toast.err(r.error)
      return
    }
    published = true
    const mirrorRequested = syncLobby && !gate?.hall
    let mirrorFailed = false
    if (mirrorRequested) {
      const preview = `【${composeTag}】${body}`.slice(0, 200)
      let mirrored: { error: string | null }
      try { mirrored = await sendPlazaMessage(preview, uid, displayName, avatarUrl) }
      catch { mirrored = { error: '同步失败' } }
      if (!active()) return
      if (mirrored.error) mirrorFailed = true
      if (composeImages[0]) {
        let img: { error: string | null }
        try { img = await sendPlazaImage(composeImages[0], uid, displayName, avatarUrl) }
        catch { img = { error: '同步失败' } }
        if (!active()) return
        if (img.error) mirrorFailed = true
      }
    }
    setComposeBody('')
    setComposeImages([])
    setComposeOpen(false)
    if (mirrorFailed) toast.warn('动态已发布；同步到大厅未全部完成，请到大厅查看。不要重复发布动态。')
    else toast(mirrorRequested ? '已发动态，并同步到大厅' : '已发到广场动态')
    switchTab('feed')
    await loadFeed()
    } catch (error) {
      if (!active()) return
      if (published) {
        setComposeBody(''); setComposeImages([]); setComposeOpen(false); switchTab('feed')
        toast.warn('动态已发布；列表刷新失败，请刷新查看。不要重复发布动态。')
      } else toast.err((error as Error).message || '发布未完成，请重试')
    }
    finally { if (active()) { sendLock.current = false; setSending(false) } }
  }

  function startDm(peerUid: string, peerName: string, hint?: string) {
    // 用原始 uid，不再按 IM 的字符集裁剪——会话线按真实 uid 建，裁剪会导致对不上号
    const peer = String(peerUid || '').trim()
    if (!peer) {
      toast('暂时联系不上这位同学')
      return
    }
    if (peer === uid) {
      toast('这是你自己，不用私聊啦')
      return
    }
    const ticket = capture('private-entry')
    void (async () => {
      if (!(await auth.ensureSignedIn('私聊需要先登录'))) return
      if (!current(ticket)) return
      const r = await openDmThread({
        peerUid: peer,
        peerName: peerName || '同学',
        topicTitle: hint ? `广场 · ${hint}` : undefined,
      })
      if (!current(ticket)) return
      if (r.error) {
        toast.err(r.error)
        return
      }
      nav(r.path)
    })()
  }

  async function removePost(id: number) {
    const ticket = capture(`delete-${id}`)
    setBusyId(`p-${id}`)
    try {
      const r = await deletePlazaPost(id)
      if (!current(ticket)) return
      if (r.error) toast.err(r.error)
      else await loadFeed()
    } catch (error) { if (current(ticket)) toast.err((error as Error).message || '删除未完成，请重试') }
    finally { if (current(ticket)) setBusyId(previous => previous === `p-${id}` ? '' : previous) }
  }

  async function reportHint(targetId?: string | number, kind: 'plaza_post' | 'plaza_message' = 'plaza_post') {
    const ticket = capture()
    if (!uid) {
      toast.warn('请先登录再举报')
      return
    }
    const { submitReport } = await import('../../lib/reports')
    if (!current(ticket)) return
    const r = await submitReport({
      reporterUid: uid,
      targetType: kind,
      targetId: String(targetId || ''),
      reason: '广场内容举报',
      detail: '用户在校园广场点击举报',
    })
    if (!current(ticket)) return
    if (r.error) toast.err(r.error)
    else toast.ok('举报已提交，管理员将收到提醒')
  }

  const emptyHint = useMemo(() => {
    if (loading) return '连接中…'
    if (tab === 'lobby') return err || '大厅还很安静，先打个招呼吧'
    if (tab === 'hot') return '暂无排行数据，多逛逛广场就有啦'
    if (feedError) return feedError
    if (keyword.trim() && searched) return searching ? '搜索中…' : `没有找到包含「${keyword.trim()}」的帖子`
    return '还没有动态，发一条吐槽试试'
  }, [loading, err, feedError, tab, keyword, searching, searched])

  const renderPostCard = (p: PlazaPost) => {
    const mine = p.creator_uid === uid
    const liked = likedSet.has(p.id)
    return (
      <article key={p.id} data-post-id={p.id} className={styles.card}>
        <div className={styles.cardTop}>
          <button type="button" className={styles.author} onClick={() => { if (!mine) startDm(p.creator_uid, p.creator_name, p.body.slice(0, 40)) }} aria-label={mine ? '我发布的动态' : `联系${p.creator_name || '这位同学'}`}>
            <span className={styles.authorAvatar}><img src={resolveAvatar(p.creator_avatar, p.creator_uid || p.creator_name || '')} width="43" height="43" alt="" loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.style.display = 'none' }} /></span>
            <span className={styles.authorMeta}><b>{p.creator_name || '同学'}</b><time dateTime={p.created_at}>{fmtPlazaTime(p.created_at)}</time></span>
          </button>
          <span className={styles.tag}>{p.tag || '吐槽'}</span>
        </div>
        <p className={styles.cardBody}>{p.body}</p>
        {p.media_urls && p.media_urls.length > 0 ? (
          <div className={`${styles.postImages} ${p.media_urls.length === 1 ? styles.single : ''}`}>
            {p.media_urls.map((url, i) => (
              <button type="button" className={styles.postImageButton} key={url} onClick={() => setPreview({ urls: p.media_urls ?? [], index: i })} aria-label={`查看动态配图 ${i + 1}`}>
              <img
                className={styles.postImg}
                src={url}
                alt=""
                loading="lazy"
              />
              </button>
            ))}
          </div>
        ) : null}
        <div className={styles.cardFoot}>
          <div className={styles.cardActs}>
            <button
              type="button"
              className={liked ? styles.likeOn : styles.likeBtn}
              aria-pressed={liked}
              aria-label={`${liked ? '取消点赞' : '点赞'}，${p.likes ?? 0} 个赞`}
              onClick={() => void likePost(p.id)}
              disabled={busyId === `like-${p.id}` || likedLoading || !!likedError}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true"><path d="M12 21 3.5 12A5.3 5.3 0 0 1 12 5a5.3 5.3 0 0 1 8.5 7Z" /></svg> {p.likes ?? 0}
            </button>
            <span className={styles.views} aria-label={`${p.views ?? 0} 次浏览`}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg> {p.views ?? 0}</span>
            {!mine ? (
              <button
                type="button"
                className={styles.dm}
                onClick={() => startDm(p.creator_uid, p.creator_name, p.body.slice(0, 40))}
              >
                私聊楼主
              </button>
            ) : null}
            <button type="button" onClick={() => void reportHint(p.id)}>
              举报
            </button>
            {mine || isAdmin ? (
              <button type="button" disabled={busyId === `p-${p.id}`} onClick={() => void removePost(p.id)}>
                删除
              </button>
            ) : null}
          </div>
        </div>
      </article>
    )
  }

  return (
    <div className={`${styles.page} ${tab === 'lobby' ? styles.chatPage : ''}`}>
      <header className={styles.head}>
        <div className={styles.titleBlock}>
          <span className={styles.eyebrow}>OHU · CAMPUS COMMUNITY ✦</span>
          <h1>校园广场<span aria-hidden="true">✦</span></h1>
          <span>分享校园里的每个好消息</span>
        </div>
        <div className={styles.headActions}><FocusThemeToggle /><MessageEntry /><Link to="/moments" aria-label="好友朋友圈" className={styles.momentsAction}><svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M12 21 3.5 12A5.3 5.3 0 0 1 12 5a5.3 5.3 0 0 1 8.5 7Z" /></svg></Link></div>
      </header>

      {tab !== 'lobby' ? <>
      <div className={styles.communityScene}><AnnouncementBanner fallback="/ohu-v7-assets/community-campus-scene.webp" intro={{ eyebrow: '和哦狐一起 · 记录闪光日常 ✦', title: '发现校园新鲜事 ♥', summary: '学习 · 生活 · 朋友 · 成长', actionLabel: '＋ 发布动态', onAction: openCompose, artwork: <FoxSheetPose pose="waving" title="哦狐狐狸吉祥物" /> }} /></div>
      <nav className={styles.communityLinks} aria-label="校园社区快捷入口"><Link to="/campus-map">⌖ 地图打卡</Link><Link to="/moments">♡ 好友朋友圈</Link></nav></> : null}

      <div className={styles.tabs}>
        <button type="button" aria-pressed={tab === 'feed'} className={tab === 'feed' ? styles.tabOn : styles.tab} onClick={() => switchTab('feed')}>
          <HomeServiceIcon title="校园信息站" decorated={false} size={20} />校园动态
        </button>
        <button type="button" aria-pressed={tab === 'lobby'} className={tab === 'lobby' ? styles.tabOn : styles.tab} onClick={() => switchTab('lobby')}>
          <HomeServiceIcon title="校园广场" decorated={false} size={20} />公共聊天
        </button>
        <button type="button" aria-pressed={tab === 'hot'} className={tab === 'hot' ? styles.tabOn : styles.tab} onClick={() => switchTab('hot')}>
          <HomeServiceIcon title="综测加分" decorated={false} size={20} />热门榜
        </button>
      </div>

      {tab !== 'lobby' && uid && likedError ? (
        <div className={styles.searchError} role="alert">
          <span>点赞状态暂时无法同步，当前无法确认你是否已点过赞。</span>
          <button type="button" disabled={likedLoading} onClick={() => void loadLikedState()}>
            {likedLoading ? '正在重试…' : '重试同步'}
          </button>
        </div>
      ) : null}

      {tab === 'lobby' ? (
        <>
          {/* 同学院交流群：按 profiles.college 自动归属，未填学院时引导去补 */}
          {auth.isSigned ? (
            <div className={styles.banner}>
              <span>
                {auth.profile?.college
                  ? myGroup
                    ? `${collegeName(auth.profile.college)}交流群 · ${myGroup.memberCount} 位同学`
                    : '正在载入本学院群…'
                  : '填写「所属学院」后，即可进入同学院交流群'}
              </span>
              <button
                type="button"
                disabled={collegeBusy}
                onClick={() => {
                  if (auth.profile?.college && myGroup) {
                    nav(`/chats/${myGroup.threadId}`)
                    return
                  }
                  auth.openProfile()
                }}
              >
                {auth.profile?.college ? (collegeBusy ? '载入中…' : '进入群聊') : '去填写'}
              </button>
            </div>
          ) : null}
          {gate?.hall || gate?.account ? (
            <div className={styles.banner}>
              <span>{gate.reason || (gate.account ? '账号已被限制发言' : '你已被限制进入大厅，仍可以看广场动态')}</span>
            </div>
          ) : null}
          {gate?.lookupError && !(gate.hall || gate.account) ? (
            <div className={styles.banner} role="status">
              <span>暂时无法核验大厅权限状态，当前仍可访问；请稍后重新检查。</span>
              <button type="button" onClick={() => void bootLobby()}>
                重新检查
              </button>
            </div>
          ) : null}
          {err && !(gate?.hall || gate?.account) ? (
            <div className={styles.banner}>
              <span>{err}</span>
              <button type="button" onClick={() => void bootLobby()}>
                重新连接
              </button>
            </div>
          ) : null}
          {gate?.hall || gate?.account ? null : (
          <div className={styles.lobbyList} ref={lobbyList} onScroll={(event) => {
            const list = event.currentTarget
            nearLobbyBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 72
            if (nearLobbyBottom.current) setNewLobbyMessages(0)
          }}>
            {loading && msgs.length === 0 ? <PostCardSkeleton count={3} /> : null}
            {!loading && msgs.length === 0 && !err ? <div className={styles.empty}>{emptyHint}</div> : null}
            {(stateOwner === sessionScope ? msgs : []).map((m) => {
              const mine = m.isMine
              return (
                <div key={m.id} className={`${styles.bubbleRow} ${mine ? styles.mine : ''}`}>
                  {mine ? (
                    <AvatarFace as="span" url={m.avatar} name={m.nick} seed={m.from} />
                  ) : (
                    <AvatarFace
                      url={m.avatar}
                      name={m.nick}
                      seed={m.from}
                      title="私聊这位同学"
                      onClick={() => startDm(m.from, m.nick)}
                    />
                  )}
                  <div className={`${styles.bubble} ${m.kind === 'image' && m.mediaUrl ? styles.bubbleImg : ''}`}>
                    <div className={styles.meta}>
                      <button
                        type="button"
                        className={styles.nameBtn}
                        onClick={() => {
                          if (!mine) startDm(m.from, m.nick)
                        }}
                      >
                        {m.nick || '同学'}
                      </button>
                      <span>{fmtPlazaTime(m.iso)}</span>
                    </div>
                    {m.kind === 'image' && m.mediaUrl ? (
                      <button type="button" className={styles.postImageButton} aria-label="查看聊天图片" onClick={() => setPreview({ urls: [m.mediaUrl], index: 0 })}><img src={m.mediaUrl} alt={m.body || '图片'} loading="lazy" /></button>
                    ) : (
                      <p>{m.body}</p>
                    )}
                    <div className={styles.rowActs}>
                      {!mine ? (
                        <button type="button" onClick={() => startDm(m.from, m.nick)}>
                          私聊
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void reportHint(m.id || m.from, 'plaza_message')}
                      >
                        举报
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          )}
          {gate?.hall || gate?.account ? null : (
          <>
          {newLobbyMessages > 0 ? <div className={styles.newMessages}><button type="button" onClick={showLatestLobby}>{newLobbyMessages > 99 ? '99+' : newLobbyMessages} 条新消息 · 回到最新</button></div> : null}
          {lobbyPanel === 'emoji' ? (
            <StickerPanel uid={uid} onEmoji={insertEmoji} onSticker={(url) => void sendLobbyImageUrl(url)} />
          ) : null}
          {lobbyUploading ? <p role="status" className={styles.upHint}><span className={styles.spinner} aria-hidden="true" />图片上传中…</p> : null}
          <div className={styles.composer}>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => setLobbyPanel((p) => (p === 'emoji' ? 'none' : 'emoji'))}
              disabled={!uid}
              aria-label="表情"
              aria-pressed={lobbyPanel === 'emoji'}
            >
              <IconSmile size={22} />
            </button>
            <textarea
              ref={inputRef}
              value={text}
              rows={1}
              enterKeyHint="enter"
              onChange={(e) => {
                setText(e.target.value)
                autoGrow()
              }}
              placeholder={uid ? '说点校园闲聊…' : '登录后发言'}
              maxLength={500}
              disabled={!uid}
              onFocus={() => setLobbyPanel('none')}
              onKeyDown={(e) => {
                if (!submitMessageKey(e)) return
                e.preventDefault()
                void sendLobby()
              }}
            />
            {/* 原生 file input（透明铺满），手指直接点在原生控件上 */}
            <ImagePickButton
              label={<IconImage size={22} />}
              ariaLabel="发送图片"
              disabled={!uid || lobbyUploading || sending || !!gate?.mute}
              onPick={(files) => void sendLobbyImage(files[0])}
            />
            {/* 仅发送键锁焦点：连着发消息时系统键盘不要一收一弹（微信同款）。
                表情 / 图片键不加，它们要让键盘让位好展示面板与选图层。 */}
            <button type="button" aria-label={sending ? '正在发送' : '发送消息'} className={styles.send} disabled={sending || !text.trim() || !uid || !!gate?.mute} onPointerDown={(e) => e.preventDefault()} onClick={() => void sendLobby()}>
              {sending ? <span className={styles.spinner} aria-hidden="true" /> : '发送'}
            </button>
          </div>
          </>
          )}
        </>
      ) : tab === 'hot' ? (
        <div className={styles.feedList}>
          {loading && hotViews.length === 0 && hotLikes.length === 0 ? <RowSkeleton count={5} /> : null}
          {hotError ? (
            <div className={styles.searchError} role="alert">
              <span>{hotError}</span>
              <button type="button" onClick={() => void loadHot()}>重试加载热门榜</button>
            </div>
          ) : null}
          {!loading && !hotError && hotViews.length === 0 && hotLikes.length === 0 ? (
            <div className={styles.empty}>{emptyHint}</div>
          ) : null}
          {hotViews.length > 0 ? (
            <div className={styles.rankSection}>
              <div className={styles.rankHead}>
                <span>🔥 浏览量榜</span>
                <small>累计浏览 · 展示前 {hotViews.length} 条</small>
              </div>
              {hotViews.map((p, i) => (
                <div key={p.id} className={styles.rankItem}>
                  <span className={styles.rankNo}>{i + 1}</span>
                  <div className={styles.rankBody}>
                    <b>{p.body}</b>
                    <span className={styles.rankMeta}>
                      <i>{p.creator_name || '同学'}</i>
                      <i className={styles.rankStat}>👁 {p.views ?? 0}</i>
                    </span>
                  </div>
                </div>
              ))}
              {hotViewsMoreError ? <div className={styles.loadMoreError} role="alert">{hotViewsMoreError}</div> : null}
              {hotViewsHasMore ? <button type="button" className={styles.loadMore} disabled={hotViewsLoadingMore} onClick={() => void loadMoreHot('views')}>
                {hotViewsLoadingMore ? '正在加载…' : hotViewsMoreError ? '重试加载浏览量榜' : '加载更多浏览量排名'}
              </button> : hotViews.length ? <p className={styles.endOfList}>浏览量榜已到底</p> : null}
            </div>
          ) : null}
          {hotLikes.length > 0 ? (
            <div className={styles.rankSection}>
              <div className={styles.rankHead}>
                <span>❤️ 点赞榜</span>
                <small>累计获赞 · 展示前 {hotLikes.length} 条</small>
              </div>
              {hotLikes.map((p, i) => (
                <div key={p.id} className={styles.rankItem}>
                  <span className={styles.rankNo}>{i + 1}</span>
                  <div className={styles.rankBody}>
                    <b>{p.body}</b>
                    <span className={styles.rankMeta}>
                      <i>{p.creator_name || '同学'}</i>
                      <i className={styles.rankStat}>♥ {p.likes ?? 0}</i>
                    </span>
                  </div>
                </div>
              ))}
              {hotLikesMoreError ? <div className={styles.loadMoreError} role="alert">{hotLikesMoreError}</div> : null}
              {hotLikesHasMore ? <button type="button" className={styles.loadMore} disabled={hotLikesLoadingMore} onClick={() => void loadMoreHot('likes')}>
                {hotLikesLoadingMore ? '正在加载…' : hotLikesMoreError ? '重试加载点赞榜' : '加载更多点赞排名'}
              </button> : hotLikes.length ? <p className={styles.endOfList}>点赞榜已到底</p> : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className={styles.feedList} ref={feedListRef}>
          {loading && posts.length === 0 ? <PostCardSkeleton count={3} /> : null}
          <div className={styles.searchBox}>
            <input
              value={keyword}
              onChange={(e) => {
                owner.current.begin('search')
                keywordRef.current = e.target.value
                setKeyword(e.target.value)
                setSearched(false)
                setSearching(false)
                setSearchError('')
                setSearchHasMore(false)
                setSearchingMore(false)
                setSearchMoreError('')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isImeComposing(e)) void runSearch(keyword)
              }}
              placeholder="搜索广场帖子内容…（至少 2 字）"
              aria-label="搜索广场帖子"
              maxLength={40}
            />
            <button type="button" className={styles.searchBtn} aria-label="搜索帖子" onClick={() => void runSearch(keyword)} disabled={keyword.trim().length < 2}>
              {searching ? <span className={styles.spinner} aria-label="正在搜索" /> : '搜'}
            </button>
            {keyword.trim() ? (
              <button
                type="button"
                className={styles.clearBtn}
                onClick={() => {
                  owner.current.begin('search'); keywordRef.current = ''
                  setKeyword('')
                  setSearchRes([])
                  setSearched(false)
                  setSearching(false)
                  setSearchError('')
                  setSearchHasMore(false)
                  setSearchingMore(false)
                  setSearchMoreError('')
                }}
                aria-label="清除搜索"
              >
                ✕
              </button>
            ) : null}
          </div>
          {keyword.trim() && searched ? (
            <>
              {!searching && searchError ? (
                <div className={styles.searchError} role="alert">
                  <span>{searchError}</span>
                  <button type="button" onClick={() => void runSearch(keyword)}>重试搜索</button>
                </div>
              ) : null}
              {!searching && !searchError && searchRes.length === 0 ? <div className={styles.empty}>没有找到包含「{keyword.trim()}」的帖子</div> : null}
              {searchRes.map(renderPostCard)}
              {searchMoreError ? (
                <div className={styles.searchError} role="status">
                  <span>{searchMoreError}</span>
                  <button type="button" disabled={searchingMore} onClick={() => void loadMoreSearchResults()}>重试加载</button>
                </div>
              ) : null}
              {searchHasMore ? (
                <button type="button" className={styles.loadMore} disabled={searchingMore} onClick={() => void loadMoreSearchResults()}>
                  {searchingMore ? '正在加载…' : '加载更多搜索结果'}
                </button>
              ) : searchRes.length > 0 ? <p className={styles.endOfList}>已经到底啦</p> : null}
            </>
          ) : (
            <>
              {!loading && !feedError && posts.length === 0 ? <div className={styles.empty}>{emptyHint}</div> : null}
              {feedError ? (
                <div className={styles.searchError} role="alert">
                  <span>{feedError}</span>
                  <button type="button" onClick={() => void loadFeed()}>重试加载动态</button>
                </div>
              ) : null}
              {posts.map(renderPostCard)}
              {olderError ? <p className={styles.loadMoreError} role="status">{olderError}</p> : null}
              {posts.length > 0 && hasOlderPosts ? <button type="button" className={styles.loadMore} disabled={loadingOlder} onClick={() => void loadOlderPosts()}>
                {loadingOlder ? '正在加载…' : olderError ? '重试加载' : '加载更早动态'}
              </button> : null}
            </>
          )}
        </div>
      )}

      {tab !== 'lobby' && showBackTop ? <button type="button" className={styles.backTop} onClick={scrollToTop} aria-label="回到页面顶部"><span aria-hidden="true">↑</span>回顶部</button> : null}

      {composeOpen && stateOwner === sessionScope ? (
        <DialogLayer title="发广场动态" onClose={closeCompose} allowClose={!sending} className={styles.sheet}>
            <div className={styles.handle} />
            <div className={styles.sheetTitle}>发广场动态</div>
            <div className={styles.tagRow}>
              {PLAZA_TAGS.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={composeTag === t ? styles.tagOn : styles.tagChip}
                  disabled={sending}
                  onClick={() => setComposeTag(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <textarea
              value={composeBody}
              disabled={sending}
              aria-label="动态内容"
              onChange={(e) => setComposeBody(e.target.value)}
              placeholder="吐槽、交友、求助…一句话就够"
              maxLength={500}
              rows={4}
            />
            <div className={styles.composeImgs}>
              {composeImages.map((url, i) => (
                <div className={styles.composeImgWrap} key={url}>
                  <img src={url} alt={`配图 ${i + 1}`} />
                  <button
                    type="button"
                    className={styles.composeImgRemove}
                    aria-label="移除图片"
                    disabled={sending}
                    onClick={() => setComposeImages((list) => list.filter((_, idx) => idx !== i))}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {composeImages.length < MAX_POST_IMAGES ? (
                <button
                  type="button"
                  className={styles.addImgBtn}
                  disabled={sending || composeUploading || !uid || !!gate?.mute || composeImages.length >= MAX_POST_IMAGES}
                >
                  {composeUploading ? <><span className={styles.spinner} aria-hidden="true" />上传中</> : '+ 配图'}
                  {/* 原生 file input 透明铺满整个按钮，点击即唤起系统选择器 */}
                  <input
                    className={styles.addImgInput}
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={sending || composeUploading || !uid || !!gate?.mute || composeImages.length >= MAX_POST_IMAGES}
                    onChange={(e) => {
                      const picked = e.target.files ? Array.from(e.target.files) : []
                      if (e.target) e.target.value = ''
                      if (picked.length) void pickComposeImages(picked)
                    }}
                  />
                </button>
              ) : null}
            </div>
            <label className={styles.syncRow}>
              <input type="checkbox" disabled={sending} checked={syncLobby} onChange={(e) => setSyncLobby(e.target.checked)} />
              同时分享到大厅
            </label>
            <button type="button" data-input-actions="" className={styles.publish} disabled={sending || composeUploading || (!composeBody.trim() && composeImages.length === 0)} onClick={() => void submitPost()}>
              {sending || composeUploading ? <><span className={styles.spinner} aria-hidden="true" />{composeUploading ? '等待图片上传' : '发布中…'}</> : '发布到动态'}
            </button>
          <p role="status" className={styles.upHint}>{composeUploading ? '图片上传完成后即可发布。取消会忽略本次尚未完成的上传。' : ''}</p>
          <button type="button" className={styles.cancel} disabled={sending} onClick={(event) => event.currentTarget.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))}>
            取消
          </button>
        </DialogLayer>
      ) : null}

      {preview ? (
        <DialogLayer full className={styles.lightbox} title="图片预览" onClose={() => setPreview(null)}>
          <button type="button" className={styles.previewClose} aria-label="关闭图片预览" onClick={(event) => event.currentTarget.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))}>关闭</button>
          {preview.urls.length > 1 ? (
            <>
              <button
                type="button"
                className={styles.previewNav}
                style={{ left: 8 }}
                aria-label="上一张"
                disabled={preview.index <= 0}
                onClick={() => setPreview((v) => (v && v.index > 0 ? { ...v, index: v.index - 1 } : v))}
              >
                ‹
              </button>
              <button
                type="button"
                className={styles.previewNav}
                style={{ right: 8 }}
                aria-label="下一张"
                disabled={preview.index >= preview.urls.length - 1}
                onClick={() => setPreview((v) => (v && v.index < v.urls.length - 1 ? { ...v, index: v.index + 1 } : v))}
              >
                ›
              </button>
              <span className={styles.previewCount}>{preview.index + 1} / {preview.urls.length}</span>
            </>
          ) : null}
          <img src={preview.urls[preview.index]} alt="图片预览" />
        </DialogLayer>
      ) : null}
    </div>
  )
}
