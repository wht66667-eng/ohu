import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { useAuth } from '../lib/auth'
import { useToast } from '../context/ToastContext'
import { usePollingRows } from '../lib/hooks'
import {
  COMMENT_SOURCE_ORDER,
  COMMENT_SOURCE_TEXT,
  GOODS_SOURCE_ORDER,
  GOODS_SOURCE_TEXT,
  POST_SOURCE_ICON,
  POST_SOURCE_ORDER,
  POST_SOURCE_TEXT,
  canReplyComment,
  canToggleGoods,
  deleteComment,
  deleteGoods,
  deletePost,
  fetchCommentsPage,
  fetchGoodsPage,
  fetchPostsPage,
  fetchModerationStats,
  goodsStatusText,
  goodsStatusTone,
  nextGoodsStatus,
  postStatusText,
  postStatusTone,
  replyComment,
  setGoodsStatus,
} from '../lib/moderation'
import type {
  CommentSource,
  GoodsSource,
  ModComment,
  ModGoods,
  ModPost,
  ModQueryRes,
  PostSource,
  PostsPageCursor,
  CommentPageCursor,
  GoodsPageCursor,
} from '../lib/moderation'
import { AdminPlazaPane } from './AdminPlazaPane'
import { AdminCampusMapPane } from './AdminCampusMapPane'
import { DeniedState, EmptyState, ErrorState, LoadingState } from '../components/ui/StateViews'
import work from './work.module.css'
import s from './AdminContentPage.module.css'

type Tab = 'goods' | 'comments' | 'posts' | 'plaza' | 'campus'
type GoodsSrc = GoodsSource | 'all'
type CmtSrc = CommentSource | 'all'
type PostSrc = PostSource | 'all'
type StatusFilter = 'all' | 'on' | 'off'

function timeText(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function stars(score: number | null): string {
  if (score == null) return ''
  const n = Math.max(0, Math.min(5, Math.round(score)))
  return '★'.repeat(n) + '☆'.repeat(5 - n)
}

/** 状态胶囊色调到 work.module.css 类名 */
function toneClass(tone: 'ok' | 'off' | 'warn' | 'bad'): string {
  if (tone === 'ok') return work.pillOk
  if (tone === 'off') return work.pillOff
  if (tone === 'warn') return work.pillWarn
  return work.pillBad
}

type Pending =
  | { kind: 'goods'; id: number; source: GoodsSource; title: string }
  | { kind: 'comment'; id: number; source: CommentSource; title: string }
  | { kind: 'post'; id: number; source: PostSource; title: string }

/** 删除确认弹层标题（分类文案集中在此，避免 JSX 里嵌套三元） */
function pendingTitle(p: Pending): string {
  if (p.kind === 'goods') return '删除该商品？'
  if (p.kind === 'comment') return '删除该评论？'
  return p.source === 'tasks' ? '删除该任务？' : '删除该求助？'
}

/** 删除确认弹层说明：商品是「下架 vs 删除」的取舍，帖子是「连联系方式一起失效」的后果 */
function pendingDesc(p: Pending): string {
  if (p.kind === 'goods') {
    return `「${p.title}」将被永久删除且无法恢复。如果只是暂时不想展示，建议改用「下架」。`
  }
  if (p.kind === 'comment') {
    return `这条来自「${p.title}」的内容将被永久删除且无法恢复。`
  }
  /* tasks / help_items 都没有「接单方 / 响应方」字段，删除只会让这条记录与其联系方式一起消失 */
  return p.source === 'tasks'
    ? `「${p.title}」将被永久删除且无法恢复，学生端不再展示这条任务，预留的联系方式会随记录一并消失。仅涉及内容违规时再使用。`
    : `「${p.title}」将被永久删除且无法恢复，互助墙不再展示这条求助，预留的联系方式会随记录一并消失。仅涉及内容违规时再使用。`
}

/** 管理员内容治理台：商品下架/删除 + 评论删除/回复 + 任务/求助删除，写操作均走服务端行级安全兜底 */
export function AdminContentPage() {
  const auth = useAuth()
  const toast = useToast()
  const nav = useNavigate()
  const isAdmin = auth.isSigned && !!(auth.profile?.isAdmin || auth.profile?.isSuperAdmin)

  const [tab, setTab] = useState<Tab>('goods')
  const [goodsSrc, setGoodsSrc] = useState<GoodsSrc>('all')
  const [cmtSrc, setCmtSrc] = useState<CmtSrc>('all')
  const [postSrc, setPostSrc] = useState<PostSrc>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [kw, setKw] = useState('')
  const [busy, setBusy] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [replyFor, setReplyFor] = useState<ModComment | null>(null)
  const [replyText, setReplyText] = useState('')
  const [stats, setStats] = useState<Awaited<ReturnType<typeof fetchModerationStats>>>(
    { goods: null, comments: null, offGoods: null, goodsAtLeast: false, commentsAtLeast: false, offGoodsAtLeast: false },
  )

  useEffect(() => {
    if (!isAdmin) return
    let alive = true
    void fetchModerationStats().then((v) => {
      if (alive) setStats(v)
    })
    return () => {
      alive = false
    }
  }, [isAdmin])

  const enabled = isAdmin
  const goodsCache = useRef<ModQueryRes<ModGoods>>({ rows: [], error: null })
  const goodsCursor = useRef<GoodsPageCursor>({ secondhand_items: null, ebike_items: null })
  const goodsHasMore = useRef({ secondhand_items: false, ebike_items: false })
  const [goodsMoreLoading, setGoodsMoreLoading] = useState(false)
  const goods = usePollingRows<ModGoods>(
    async () => {
      if (!enabled) return { rows: [], error: null }
      const r = await fetchGoodsPage()
      if (r.error) return { rows: [], error: r.error }
      for (const source of GOODS_SOURCE_ORDER) {
        const alreadyLoaded = goodsCache.current.rows.some((row) => row.source === source)
        if (!alreadyLoaded) {
          goodsCursor.current[source] = r.cursor[source]
          goodsHasMore.current[source] = r.hasMore[source]
        }
      }
      const merged = new Map<string, ModGoods>()
      for (const row of goodsCache.current.rows) merged.set(`${row.source}-${row.id}`, row)
      for (const row of r.rows) merged.set(`${row.source}-${row.id}`, row)
      const rows = Array.from(merged.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
      goodsCache.current = { rows, error: null }
      return { rows, error: null, hasMore: Object.values(goodsHasMore.current).some(Boolean) }
    },
    [enabled],
    30000,
  )
  const commentsCache = useRef<ModQueryRes<ModComment>>({ rows: [], error: null })
  const commentsCursor = useRef<CommentPageCursor>({ secondhand_item_comments: null, feedbacks: null, secondhand_evaluations: null })
  const commentsHasMore = useRef({ secondhand_item_comments: false, feedbacks: false, secondhand_evaluations: false })
  const [commentsMoreLoading, setCommentsMoreLoading] = useState(false)
  const comments = usePollingRows<ModComment>(
    async () => {
      if (!enabled) return { rows: [], error: null }
      const r = await fetchCommentsPage()
      if (r.error) return { rows: [], error: r.error }
      for (const source of COMMENT_SOURCE_ORDER) {
        const alreadyLoaded = commentsCache.current.rows.some((row) => row.source === source)
        if (!alreadyLoaded) {
          commentsCursor.current[source] = r.cursor[source]
          commentsHasMore.current[source] = r.hasMore[source]
        }
      }
      const merged = new Map<string, ModComment>()
      for (const row of commentsCache.current.rows) merged.set(`${row.source}-${row.id}`, row)
      for (const row of r.rows) merged.set(`${row.source}-${row.id}`, row)
      const rows = Array.from(merged.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
      commentsCache.current = { rows, error: null }
      return { rows, error: null, hasMore: Object.values(commentsHasMore.current).some(Boolean) }
    },
    [enabled],
    30000,
  )
  /**
   * 任务/求助只在「管理员 + 帖子标签页激活」时拉取：两张表各 30 行审核字段，
   * 挂在商品/评论页时每 30 秒拉一遍纯属浪费。非激活时沿用上次结果，
   * 这样切走再切回不会闪空态、角标也能保留上次的数量。
   */
  const postsCache = useRef<ModQueryRes<ModPost>>({ rows: [], error: null })
  const postsCursor = useRef<PostsPageCursor>({ tasks: null, help_items: null })
  const postsHasMore = useRef({ tasks: false, help_items: false })
  const [postsMoreLoading, setPostsMoreLoading] = useState(false)
  const postsActive = enabled && tab === 'posts'
  /** 进入帖子页时同步置位，避免「请求还没回来」的那一帧先闪「没有匹配的任务或求助」 */
  const [postsEntering, setPostsEntering] = useState(false)
  const posts = usePollingRows<ModPost>(
    async () => {
      if (!postsActive) {
        setPostsEntering(false)
        return postsCache.current
      }
      try {
        const r = await fetchPostsPage({ tasks: null, help_items: null })
        for (const source of ['tasks', 'help_items'] as const) {
          const alreadyLoadedSource = postsCache.current.rows.some((row) => row.source === source)
          if (!alreadyLoadedSource && !postsCursor.current[source]) {
            postsCursor.current[source] = r.cursor[source]
            postsHasMore.current[source] = r.hasMore[source]
          }
        }
        const merged = new Map<string, ModPost>()
        for (const row of postsCache.current.rows) merged.set(`${row.source}-${row.id}`, row)
        for (const row of r.rows) merged.set(`${row.source}-${row.id}`, row)
        const rows = Array.from(merged.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
        const result = { rows, error: r.error }
        postsCache.current = result
        return { ...result, hasMore: postsHasMore.current.tasks || postsHasMore.current.help_items }
      } finally {
        setPostsEntering(false)
      }
    },
    [postsActive],
    30000,
  )

  const key = kw.trim().toLowerCase()

  const shownGoods = useMemo(() => {
    return goods.rows.filter((g) => {
      if (goodsSrc !== 'all' && g.source !== goodsSrc) return false
      if (status === 'on' && g.status !== 'on') return false
      if (status === 'off' && g.status !== 'off' && g.status !== 'sold') return false
      if (key && !`${g.title} ${g.ownerName} ${g.parentLabel}`.toLowerCase().includes(key)) return false
      return true
    })
  }, [goods.rows, goodsSrc, status, key])

  const shownComments = useMemo(() => {
    return comments.rows.filter((c) => {
      if (cmtSrc !== 'all' && c.source !== cmtSrc) return false
      if (key && !`${c.content} ${c.authorName} ${c.parentLabel}`.toLowerCase().includes(key)) return false
      return true
    })
  }, [comments.rows, cmtSrc, key])

  const shownPosts = useMemo(() => {
    return posts.rows.filter((p) => {
      if (postSrc !== 'all' && p.source !== postSrc) return false
      if (key && !`${p.title} ${p.body} ${p.kindText} ${p.authorName}`.toLowerCase().includes(key)) return false
      return true
    })
  }, [posts.rows, postSrc, key])

  function reloadAll() {
    goodsCache.current = { rows: [], error: null }
    goodsCursor.current = { secondhand_items: null, ebike_items: null }
    goodsHasMore.current = { secondhand_items: false, ebike_items: false }
    commentsCache.current = { rows: [], error: null }
    commentsCursor.current = { secondhand_item_comments: null, feedbacks: null, secondhand_evaluations: null }
    commentsHasMore.current = { secondhand_item_comments: false, feedbacks: false, secondhand_evaluations: false }
    goods.reload()
    comments.reload()
    postsCache.current = { rows: [], error: null }
    postsCursor.current = { tasks: null, help_items: null }
    postsHasMore.current = { tasks: false, help_items: false }
    posts.reload()
    void fetchModerationStats().then(setStats)
  }

  async function loadMoreGoods() {
    if (goodsMoreLoading || !Object.values(goodsHasMore.current).some(Boolean)) return
    setGoodsMoreLoading(true)
    try {
      const r = await fetchGoodsPage(goodsCursor.current)
      if (r.error) { toast.err(r.error); return }
      goodsCursor.current = r.cursor
      goodsHasMore.current = r.hasMore
      const merged = new Map<string, ModGoods>()
      for (const row of goodsCache.current.rows) merged.set(`${row.source}-${row.id}`, row)
      for (const row of r.rows) merged.set(`${row.source}-${row.id}`, row)
      goodsCache.current = { rows: Array.from(merged.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id), error: null }
      goods.reload()
    } finally { setGoodsMoreLoading(false) }
  }

  async function loadMoreComments() {
    if (commentsMoreLoading || !Object.values(commentsHasMore.current).some(Boolean)) return
    setCommentsMoreLoading(true)
    try {
      const r = await fetchCommentsPage(commentsCursor.current)
      if (r.error) { toast.err(r.error); return }
      commentsCursor.current = r.cursor
      commentsHasMore.current = r.hasMore
      const merged = new Map<string, ModComment>()
      for (const row of commentsCache.current.rows) merged.set(`${row.source}-${row.id}`, row)
      for (const row of r.rows) merged.set(`${row.source}-${row.id}`, row)
      commentsCache.current = { rows: Array.from(merged.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id), error: null }
      comments.reload()
    } finally { setCommentsMoreLoading(false) }
  }

  async function loadMorePosts() {
    if (postsMoreLoading || (!postsHasMore.current.tasks && !postsHasMore.current.help_items)) return
    setPostsMoreLoading(true)
    try {
      const r = await fetchPostsPage(postsCursor.current)
      if (r.error) {
        toast.err(r.error)
        return
      }
      postsCursor.current = {
        tasks: r.cursor.tasks || postsCursor.current.tasks,
        help_items: r.cursor.help_items || postsCursor.current.help_items,
      }
      postsHasMore.current = r.hasMore
      const merged = new Map<string, ModPost>()
      for (const row of postsCache.current.rows) merged.set(`${row.source}-${row.id}`, row)
      for (const row of r.rows) merged.set(`${row.source}-${row.id}`, row)
      postsCache.current = {
        rows: Array.from(merged.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id),
        error: null,
      }
      posts.reload()
    } finally {
      setPostsMoreLoading(false)
    }
  }

  async function toggleGoods(g: ModGoods) {
    if (busy) return
    setBusy(`g${g.source}${g.id}`)
    const next = nextGoodsStatus(g.status)
    const r = await setGoodsStatus(g.source, g.id, next)
    setBusy('')
    if (r.error) {
      toast.err(r.error)
      return
    }
    toast(next === 'off' ? '已下架，学生端不再展示' : '已恢复上架')
    reloadAll()
  }

  async function confirmDelete() {
    if (!pending || busy) return
    setBusy(`d${pending.source}${pending.id}`)
    const r =
      pending.kind === 'goods'
        ? await deleteGoods(pending.source as GoodsSource, pending.id)
        : pending.kind === 'comment'
          ? await deleteComment(pending.source as CommentSource, pending.id)
          : await deletePost(pending.source as PostSource, pending.id)
    setBusy('')
    if (r.error) {
      toast.err(r.error)
      return
    }
    const doneText =
      pending.kind === 'goods'
        ? '已删除该商品'
        : pending.kind === 'comment'
          ? '已删除该条评论'
          : pending.source === 'tasks'
            ? '已删除该任务'
            : '已删除该求助'
    toast(doneText)
    setPending(null)
    reloadAll()
  }

  async function submitReply() {
    if (!replyFor || busy) return
    const text = replyText.trim()
    if (text.length < 2) {
      toast('回复至少 2 个字')
      return
    }
    setBusy(`r${replyFor.source}${replyFor.id}`)
    const r = await replyComment(replyFor.source, replyFor.id, text)
    setBusy('')
    if (r.error) {
      toast.err(r.error)
      return
    }
    toast.ok('回复已送达')
    setReplyFor(null)
    setReplyText('')
    reloadAll()
  }

  if (!isAdmin) {
    return (
      <div className={work.page}>
        <PageHeader title="内容管理" />
        <DeniedState
          title="仅管理员可访问"
          hint="内容下架、评论删除、任务与求助删除均属于运营权限。如果你是运营同学，请联系超管在后台添加权限。"
          action={
            <button type="button" className={`${work.btn} ${work.btnP}`} onClick={() => nav('/settings')}>
              返回设置
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div className={work.page}>
      <PageHeader title="内容管理" right={<span className={`${work.pill} ${work.pillOk}`}>管理员</span>} />

      <div className={work.wrap}>
        <div className={s.statRow}>
          <div>
            <b>{stats.goods == null ? '—' : `${stats.goodsAtLeast ? '≥' : ''}${stats.goods}`}</b>
            <span>商品总数</span>
          </div>
          <div>
            <b>{stats.offGoods == null ? '—' : `${stats.offGoodsAtLeast ? '≥' : ''}${stats.offGoods}`}</b>
            <span>已下架 / 已出</span>
          </div>
          <div>
            <b>{stats.comments == null ? '—' : `${stats.commentsAtLeast ? '≥' : ''}${stats.comments}`}</b>
            <span>评论总数</span>
          </div>
        </div>

        <div className={work.seg} style={{ paddingTop: 0 }}>
          <button
            type="button"
            className={`${work.segBtn} ${tab === 'goods' ? work.segOn : ''}`}
            onClick={() => setTab('goods')}
          >
            商品
            {goods.rows.length ? <em className={work.segBadge}>{goods.hasMore ? `≥${goods.rows.length}` : goods.rows.length}</em> : null}
          </button>
          <button
            type="button"
            className={`${work.segBtn} ${tab === 'comments' ? work.segOn : ''}`}
            onClick={() => setTab('comments')}
          >
            评论
            {comments.rows.length ? <em className={work.segBadge}>{comments.hasMore ? `≥${comments.rows.length}` : comments.rows.length}</em> : null}
          </button>
          <button
            type="button"
            className={`${work.segBtn} ${tab === 'posts' ? work.segOn : ''}`}
            onClick={() => {
              if (tab !== 'posts') setPostsEntering(true)
              setTab('posts')
            }}
          >
            任务/求助
            {posts.rows.length ? <em className={work.segBadge}>{posts.rows.length}</em> : null}
          </button>
          <button
            type="button"
            className={`${work.segBtn} ${tab === 'plaza' ? work.segOn : ''}`}
            onClick={() => setTab('plaza')}
          >
            广场
          </button>
          <button
            type="button"
            className={`${work.segBtn} ${tab === 'campus' ? work.segOn : ''}`}
            onClick={() => setTab('campus')}
          >
            校园地图
          </button>
        </div>

        {tab === 'plaza' ? <AdminPlazaPane /> : null}
        {tab === 'campus' ? <AdminCampusMapPane /> : null}

        {tab !== 'plaza' && tab !== 'campus' ? (
        <>
        <div className={s.filters}>
          <div className={s.searchRow}>
            <span>🔍</span>
            <input
              value={kw}
              onChange={(e) => setKw(e.target.value)}
              placeholder={
                tab === 'goods'
                  ? '搜索商品名 / 店铺 / 发布者'
                  : tab === 'comments'
                    ? '搜索评论正文 / 作者 / 所属对象'
                    : '搜索任务 / 求助标题 / 正文 / 发布者'
              }
              aria-label="搜索"
            />
            {kw ? (
              <button type="button" className={s.clearBtn} onClick={() => setKw('')} aria-label="清空搜索">
                ✕
              </button>
            ) : null}
          </div>

          {tab === 'goods' ? (
            <>
              <div className={s.chips}>
                <button type="button" className={`${s.chip} ${goodsSrc === 'all' ? s.chipOn : ''}`} onClick={() => setGoodsSrc('all')}>
                  全部来源
                </button>
                {GOODS_SOURCE_ORDER.map((v) => (
                  <button key={v} type="button" className={`${s.chip} ${goodsSrc === v ? s.chipOn : ''}`} onClick={() => setGoodsSrc(v)}>
                    {GOODS_SOURCE_TEXT[v]}
                  </button>
                ))}
              </div>
              <div className={s.chips}>
                {(['all', 'on', 'off'] as const).map((v) => (
                  <button key={v} type="button" className={`${s.chip} ${status === v ? s.chipOn : ''}`} onClick={() => setStatus(v)}>
                    {v === 'all' ? '全部状态' : v === 'on' ? '在售中' : '已下架'}
                  </button>
                ))}
              </div>
            </>
          ) : tab === 'comments' ? (
            <div className={s.chips}>
              <button type="button" className={`${s.chip} ${cmtSrc === 'all' ? s.chipOn : ''}`} onClick={() => setCmtSrc('all')}>
                全部来源
              </button>
              {COMMENT_SOURCE_ORDER.map((v) => (
                <button key={v} type="button" className={`${s.chip} ${cmtSrc === v ? s.chipOn : ''}`} onClick={() => setCmtSrc(v)}>
                  {COMMENT_SOURCE_TEXT[v]}
                </button>
              ))}
            </div>
          ) : (
            <div className={s.chips}>
              <button type="button" className={`${s.chip} ${postSrc === 'all' ? s.chipOn : ''}`} onClick={() => setPostSrc('all')}>
                全部来源
              </button>
              {POST_SOURCE_ORDER.map((v) => (
                <button key={v} type="button" className={`${s.chip} ${postSrc === v ? s.chipOn : ''}`} onClick={() => setPostSrc(v)}>
                  {POST_SOURCE_TEXT[v]}
                </button>
              ))}
            </div>
          )}
        </div>

        {tab === 'goods' ? <p className={work.hint}>商品按发布时间倒序分页；搜索覆盖已加载记录，可继续加载更早商品。</p> : null}
        {tab === 'comments' ? <p className={work.hint}>评论按发布时间倒序分页；搜索覆盖已加载记录，可继续加载更早评论。</p> : null}

        {tab === 'goods' ? (
          goods.loading ? (
            <LoadingState compact title="正在同步商品…" />
          ) : goods.error ? (
            <ErrorState
              compact
              title="商品加载失败"
              hint={goods.error}
              action={
                <button type="button" onClick={() => goods.reload()}>
                  重试
                </button>
              }
            />
          ) : shownGoods.length ? (
            <div className={work.card}>
              {shownGoods.map((g) => (
                <div className={s.gRow} key={`${g.source}-${g.id}`}>
                  <span className={s.thumb}>
                    {g.image ? <img src={g.image} alt="" loading="lazy" /> : '📦'}
                  </span>
                  <span className={s.gGrow}>
                    <span className={s.gTitle}>
                      <b>{g.title}</b>
                      <span className={`${work.pill} ${toneClass(goodsStatusTone(g.status))}`}>
                        {goodsStatusText(g.status)}
                      </span>
                    </span>
                    <span className={s.gMeta}>
                      <span className={s.srcTag}>{GOODS_SOURCE_TEXT[g.source]}</span>
                      {` `}
                      <span className={s.price}>¥{g.price}</span>
                      {g.parentLabel ? ` · ${g.parentLabel}` : ''}
                      {g.ownerName ? ` · ${g.ownerName}` : ''}
                      {g.createdAt ? ` · ${timeText(g.createdAt)}` : ''}
                    </span>
                    <span className={s.acts}>
                      {canToggleGoods(g.status) ? (
                        <button
                          type="button"
                          className={`${work.btn} ${work.btnSm} ${g.status === 'on' ? work.btnN : work.btnG}`}
                          onClick={() => toggleGoods(g)}
                          disabled={busy === `g${g.source}${g.id}`}
                        >
                          {g.status === 'on' ? '下架' : '恢复上架'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={`${work.btn} ${work.btnSm} ${work.btnD}`}
                        onClick={() => setPending({ kind: 'goods', id: g.id, source: g.source, title: g.title })}
                      >
                        删除
                      </button>
                    </span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="没有匹配的已加载商品" hint={goods.hasMore ? '可以加载更早商品继续搜索，或调整来源、状态与关键词。' : '已加载记录中没有匹配商品，请调整来源、状态或关键词。'} />
          )
        ) : tab === 'comments' ? (
          comments.loading ? (
            <LoadingState compact title="正在同步评论…" />
          ) : comments.error ? (
            <ErrorState
              compact
              title="评论加载失败"
              hint={comments.error}
              action={
                <button type="button" onClick={() => comments.reload()}>
                  重试
                </button>
              }
            />
          ) : shownComments.length ? (
            <div className={work.card}>
              {shownComments.map((c) => (
                <div className={s.cmt} key={`${c.source}-${c.id}`}>
                  <div className={s.cmtHead}>
                    <b>{c.authorName}</b>
                    {c.score != null ? <span className={s.stars}>{stars(c.score)}</span> : null}
                    <span className={s.srcTag}>{COMMENT_SOURCE_TEXT[c.source]}</span>
                  </div>
                  <p className={s.quote}>{c.content || '（无正文）'}</p>
                  {c.reply ? <div className={s.replyBox}>管理员回复：{c.reply}</div> : null}
                  <span className={s.cmtMeta}>
                    {c.parentLabel ? `${c.parentLabel} · ` : ''}
                    {timeText(c.createdAt)}
                  </span>
                  <div className={s.acts}>
                    {canReplyComment(c.source) ? (
                      <button
                        type="button"
                        className={`${work.btn} ${work.btnSm} ${work.btnB}`}
                        onClick={() => {
                          setReplyFor(c)
                          setReplyText(c.reply || '')
                        }}
                      >
                        {c.reply ? '修改回复' : '回复'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={`${work.btn} ${work.btnSm} ${work.btnD}`}
                      onClick={() => setPending({ kind: 'comment', id: c.id, source: c.source, title: COMMENT_SOURCE_TEXT[c.source] })}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="没有匹配的已加载评论" hint={comments.hasMore ? '可以加载更早评论继续搜索，或调整来源与关键词。' : '已加载记录中没有匹配评论。'} />
          )
        ) : (
          <>
            {posts.loading || postsEntering ? (
              <LoadingState compact title="正在同步任务与求助…" />
            ) : posts.error ? (
              <ErrorState
                compact
                title="任务与求助加载失败"
                hint={posts.error}
                action={
                  <button type="button" onClick={() => posts.reload()}>
                    重试
                  </button>
                }
              />
            ) : shownPosts.length ? (
              <div className={work.card}>
                {shownPosts.map((p) => (
                  <div className={s.gRow} key={`${p.source}-${p.id}`}>
                    <span className={s.thumb}>{POST_SOURCE_ICON[p.source]}</span>
                    <div className={s.gGrow}>
                      <div className={s.gTitle}>
                        <b>{p.title}</b>
                        <span className={`${work.pill} ${toneClass(postStatusTone(p.status))}`}>
                          {postStatusText(p.source, p.status)}
                        </span>
                      </div>
                      {p.body ? <p className={s.quote}>{p.body}</p> : null}
                      <div className={s.gMeta}>
                        <span className={s.srcTag}>{POST_SOURCE_TEXT[p.source]}</span>
                        {` ${p.kindText}`}
                        {p.metaText ? ` · ${p.metaText}` : ''}
                        {p.authorName ? ` · ${p.authorName}` : ''}
                        {p.createdAt ? ` · ${timeText(p.createdAt)}` : ''}
                      </div>
                      <div className={s.acts}>
                        <button
                          type="button"
                          className={`${work.btn} ${work.btnSm} ${work.btnD}`}
                          onClick={() => setPending({ kind: 'post', id: p.id, source: p.source, title: p.title })}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                compact
                title="没有匹配的任务或求助"
                hint={postsHasMore.current.tasks || postsHasMore.current.help_items
                  ? '当前已加载内容中没有匹配项，可继续加载更早内容'
                  : '学生发布任务或向互助墙求助后会汇总到这里'}
              />
            )}
            {!posts.loading && !posts.error && (postsHasMore.current.tasks || postsHasMore.current.help_items) ? (
              <div className={s.acts}>
                <button type="button" className={`${work.btn} ${work.btnSm} ${work.btnB}`} onClick={() => void loadMorePosts()} disabled={postsMoreLoading}>
                  {postsMoreLoading ? '正在加载…' : '加载更早内容'}
                </button>
                <span className={work.hint}>已加载 {posts.rows.length} 条，搜索范围为已加载内容</span>
              </div>
            ) : null}
          </>
        )}
        {tab === 'goods' && !goods.loading && !goods.error && goods.hasMore ? (
          <div className={s.acts}>
            <button type="button" className={`${work.btn} ${work.btnSm} ${work.btnB}`} onClick={() => void loadMoreGoods()} disabled={goodsMoreLoading}>
              {goodsMoreLoading ? '正在加载…' : '加载更早商品'}
            </button>
            <span className={work.hint}>已加载 {goods.rows.length} 条；搜索仅覆盖已加载商品</span>
          </div>
        ) : null}
        {tab === 'comments' && !comments.loading && !comments.error && comments.hasMore ? (
          <div className={s.acts}>
            <button type="button" className={`${work.btn} ${work.btnSm} ${work.btnB}`} onClick={() => void loadMoreComments()} disabled={commentsMoreLoading}>
              {commentsMoreLoading ? '正在加载…' : '加载更早评论'}
            </button>
            <span className={work.hint}>已加载 {comments.rows.length} 条；搜索仅覆盖已加载评论</span>
          </div>
        ) : null}
        </>
        ) : null}
      </div>

      {pending ? (
        <ConfirmSheet
          danger
          title={pendingTitle(pending)}
          desc={pendingDesc(pending)}
          confirmText="确认删除"
          busy={busy.startsWith('d')}
          onConfirm={confirmDelete}
          onClose={() => setPending(null)}
        />
      ) : null}

      {replyFor ? (
        <div className={work.mask} onClick={() => setReplyFor(null)} role="presentation">
          <div className={work.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="管理员回复">
            <div className={work.handle} />
            <h4 className={work.sheetTitle}>
              回复{COMMENT_SOURCE_TEXT[replyFor.source]} · {replyFor.authorName}
            </h4>
            <p className={work.hint}>{replyFor.content || '（无正文）'}</p>
            <div className={work.field}>
              <label htmlFor="mod-reply">回复内容</label>
              <textarea
                id="mod-reply"
                className={work.area}
                rows={3}
                maxLength={120}
                placeholder="例如：已收到反馈，我们已核实处理，本周内复查"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
              />
            </div>
            <div className={work.btnRow}>
              <button type="button" className={`${work.btn} ${work.btnBlk} ${work.btnN}`} onClick={() => setReplyFor(null)}>
                取消
              </button>
              <button
                type="button"
                className={`${work.btn} ${work.btnBlk} ${work.btnP}`}
                onClick={submitReply}
                disabled={busy === `r${replyFor.source}${replyFor.id}`}
              >
                {busy === `r${replyFor.source}${replyFor.id}` ? '发送中…' : '发送回复'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
