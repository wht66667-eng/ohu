import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { GoodsPublishSheet } from '../components/GoodsPublishSheet'
import { PageHeader } from '../components/PageHeader'
import { ProductArt } from '../components/Thumbs'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { SharedExpand, SpringStagger, springItem } from '../components/ui/advanced'
import { Collapsible, SegmentedTabs, ViewToggle } from '../components/ui/motion-ui'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateViews'
import { GoodsGridSkeleton } from '../components/ui/Skeleton'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../lib/auth'
import { usePollingRows } from '../lib/hooks'
import {
  ITEM_STATUS_TEXT,
  deleteItem,
  fetchItemsPage,
  fetchMyItems,
  fmtTime,
  queryRows,
  setItemStatus,
  ITEM_PAGE_SIZE,
  type Item,
  type ItemStatus,
} from '../lib/market'
import styles from './campus.module.css'

const FILTERS = ['全部', '教材', '电车', '自行车', '数码', '生活'] as const
const TABS = ['二手集市', '我的发布'] as const

/** 商品状态胶囊配色：全部取自 token + color-mix，浅/深色自动适配 */
function statusTone(status: ItemStatus | string): CSSProperties {
  if (status === 'on') return { color: 'var(--green-text)', background: 'var(--green-soft)' }
  return {
    color: 'var(--text-3)',
    background: 'color-mix(in srgb, var(--text-3) 14%, var(--card))',
  }
}

export function MarketPage() {
  const toast = useToast()
  const auth = useAuth()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<(typeof TABS)[number]>(params.get('tab') === 'mine' ? '我的发布' : '二手集市')
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('全部')
  const [publishOpen, setPublishOpen] = useState(params.get('publish') === '1')
  /* 列表 ↔ 网格切换；卡片内联展开详情；删除走二次确认 + 防连点 */
  const [view, setView] = useState<'list' | 'grid'>('grid')
  /** 共享元素展开：点图片原地放大看详情 */
  const [zoomId, setZoomId] = useState<number | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [delTarget, setDelTarget] = useState<Item | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [olderRows, setOlderRows] = useState<Item[]>([])
  const [pageCursor, setPageCursor] = useState<{ created_at: string; id: number } | null>(null)
  const [pageHasMore, setPageHasMore] = useState(false)
  const [pageLoading, setPageLoading] = useState(false)
  const [pageError, setPageError] = useState('')
  const filterRef = useRef(filter)
  filterRef.current = filter
  const q = (params.get('q') || '').trim()
  const nav = useNavigate()

  useEffect(() => {
    if (params.get('publish') === '1') {
      setPublishOpen(true)
      const next: Record<string, string> = {}
      if (tab === '我的发布') next.tab = 'mine'
      if (q) next.q = q
      setParams(next, { replace: true })
    }
  }, [params, setParams, tab, q])

  const uid = auth.user?.uid || ''

  const hall = usePollingRows<Item>(
    () => fetchItemsPage(filter === '全部' ? undefined : filter),
    [filter],
  )
  const mine = usePollingRows<Item>(
    () => (uid ? fetchMyItems(uid) : Promise.resolve({ rows: [], error: null })),
    [uid],
  )

  const firstPageKey = hall.rows.map((row) => `${row.id}:${row.created_at}`).join('|')
  useEffect(() => {
    setOlderRows([])
    const last = hall.rows[hall.rows.length - 1]
    setPageCursor(last ? { created_at: last.created_at, id: last.id } : null)
    setPageHasMore(hall.hasMore)
    setPageError('')
  }, [filter, firstPageKey, hall.hasMore])

  const publicRows = [...hall.rows, ...olderRows.filter((row) => !hall.rows.some((first) => first.id === row.id))]
  const rawList = tab === '我的发布' ? mine.rows : publicRows
  const list = useMemo(() => {
    if (!q) return rawList
    const key = q.toLowerCase()
    return rawList.filter(
      (p) =>
        p.title.toLowerCase().includes(key) ||
        (p.category || '').toLowerCase().includes(key) ||
        (p.condition || '').toLowerCase().includes(key),
    )
  }, [rawList, q])
  const state = tab === '我的发布' ? mine : hall

  const loadMore = useCallback(async () => {
    if (pageLoading || !pageHasMore || !pageCursor) return
    const requestedFilter = filter
    setPageLoading(true)
    setPageError('')
    try {
      const res = await fetchItemsPage(requestedFilter === '全部' ? undefined : requestedFilter, pageCursor, ITEM_PAGE_SIZE)
      if (filterRef.current !== requestedFilter) return
      if (res.error) {
        setPageError(res.error)
        return
      }
      setOlderRows((current) => {
        const seen = new Set([...hall.rows, ...current].map((row) => row.id))
        return [...current, ...res.rows.filter((row) => !seen.has(row.id))]
      })
      const last = res.rows[res.rows.length - 1]
      if (last) setPageCursor({ created_at: last.created_at, id: last.id })
      setPageHasMore(!!res.hasMore && res.rows.length > 0)
    } catch (error) {
      if (filterRef.current === requestedFilter) setPageError(error instanceof Error ? error.message : '加载更早闲置失败，请重试')
    } finally {
      setPageLoading(false)
    }
  }, [filter, hall.rows, pageCursor, pageHasMore, pageLoading])

  const switchTab = (t: (typeof TABS)[number]) => {
    setTab(t)
    const next: Record<string, string> = {}
    if (t === '我的发布') next.tab = 'mine'
    if (q) next.q = q
    setParams(next, { replace: true })
  }

  const showContact = useCallback(
    async (id: number) => {
      if (!(await auth.ensureSignedIn('查看卖家联系方式需要登录'))) return
      const res = await queryRows<Item>('secondhand_items', { id }, 1)
      const contact = res.rows[0]?.contact || '卖家未留联系方式'
      try {
        await navigator.clipboard.writeText(contact)
        toast.ok('联系方式已复制到剪贴板')
      } catch {
        toast(contact)
      }
    },
    [auth, toast],
  )

  const publishAction = (
    <button type="button" onClick={() => setPublishOpen(true)}>
      发布闲置
    </button>
  )

  return (
    <div className={styles.page}>
      <PageHeader
        title="校园二手集市"
        right={
          <button className={styles.pub} onClick={() => setPublishOpen(true)}>
            ＋ 发布
          </button>
        }
      />
      <div style={{ margin: '0 16px 12px' }}>
        <SegmentedTabs
          tabs={TABS}
          value={tab}
          onChange={(t) => switchTab(t as (typeof TABS)[number])}
          id="market"
        />
      </div>

      {tab === '二手集市' ? (
        <>
          {/* 与任务大厅一致的横向筛选条 */}
          <div className={`${styles.chips} hide-scroll`}>
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                className={`${styles.chip} ${filter === f ? styles.on : ''}`}
                onClick={() => {
                  if (f !== filter) {
                    setOlderRows([])
                    setPageCursor(null)
                    setPageHasMore(false)
                    setPageError('')
                  }
                  setFilter(f)
                }}
              >
                {f}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '0 16px 12px' }}>
            <ViewToggle value={view} onChange={setView} id="market-view" />
          </div>
        </>
      ) : null}

      {tab === '我的发布' && !uid ? (
        <EmptyState
          title="登录后管理你的闲置"
          hint="登录后可以上架、标记已出或删除你发布的物品"
          action={
            <button type="button" onClick={() => void auth.ensureSignedIn('登录后管理你发布的闲置')}>
              去登录
            </button>
          }
        />
      ) : null}
      {state.loading && list.length === 0 && (uid || tab === '二手集市') ? (
        tab === '二手集市' ? <GoodsGridSkeleton count={6} /> : <LoadingState title="正在同步闲置…" hint="阿狐马上就好" />
      ) : null}
      {state.error ? (
        <ErrorState
          hint={state.error}
          action={
            <button type="button" onClick={state.reload}>
              重试
            </button>
          }
        />
      ) : null}
      {!state.loading && !state.error && list.length === 0 && (uid || tab === '二手集市') ? (
        q ? (
          <EmptyState
            title={`没有找到「${q}」`}
            hint={tab === '二手集市' && pageHasMore ? '当前已加载的闲置里没有匹配项，可以继续查找更早发布的闲置。' : '换个关键词或分类试试'}
            action={tab === '二手集市' && pageHasMore ? (
              <button type="button" onClick={() => void loadMore()} disabled={pageLoading}>
                {pageLoading ? '正在继续搜索…' : '继续搜索更早闲置'}
              </button>
            ) : undefined}
          />
        ) : tab === '我的发布' ? (
          <EmptyState title="还没有发布闲置" hint="把不用的物品挂上来，卖给需要的同学" action={publishAction} />
        ) : (
          <EmptyState title="这里还没有闲置" hint="上架一件闲置，让它遇到新主人" action={publishAction} />
        )
      ) : null}

      <SpringStagger
        className={`${styles.prodGrid} ${view === 'list' ? styles.prodList : ''}`}
        replayKey={`${tab}-${view}-${list.length}`}
      >
        {list.map((p) => {
          const open = openId === p.id
          const busy = busyId === p.id
          return (
            <motion.article
              key={p.id}
              layout
              variants={springItem}
              transition={{ type: 'spring', stiffness: 380, damping: 34 }}
              className={styles.prod}
              onClick={() => setOpenId(open ? null : p.id)}
              style={p.status === 'on' ? undefined : { opacity: 0.7 }}
            >
              <SharedExpand
                id={`mk-${p.id}`}
                open={zoomId === p.id}
                onOpen={() => setZoomId(p.id)}
                onClose={() => setZoomId(null)}
                className={styles.prodPic}
                summary={
                  <>
                    {p.images?.[0] ? (
                      <img src={p.images[0]} alt={p.title} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <ProductArt kind="goods" />
                    )}
                    <span className={styles.prodTag}>{p.category || '闲置'}</span>
                    <span className={styles.status} style={{ position: 'absolute', right: 8, top: 8, ...statusTone(p.status) }}>
                      {ITEM_STATUS_TEXT[p.status] || p.status}
                    </span>
                  </>
                }
                detail={
                  <>
                    {p.images?.[0] ? (
                      <img
                        src={p.images[0]}
                        alt={p.title}
                        style={{ width: '100%', maxHeight: 260, objectFit: 'contain', borderRadius: 14, background: 'var(--mint)' }}
                      />
                    ) : null}
                    <h3 style={{ margin: '12px 0 4px', fontSize: 17 }}>{p.title}</h3>
                    <div className={styles.price} style={{ marginBottom: 8 }}>
                      <span>¥{p.price}</span>
                      <span className={styles.note}>{p.condition || '可议价'}</span>
                    </div>
                    <p className={styles.note} style={{ lineHeight: 1.6 }}>
                      {p.description || '这条闲置还没有描述'}
                    </p>
                    <p className={styles.note} style={{ marginTop: 6 }}>
                      {p.building || '校内'} · {fmtTime(p.created_at)}
                    </p>
                    <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                      <button className={styles.chip} onClick={() => nav(`/item/${p.id}`)}>
                        打开完整页
                      </button>
                      <button className={styles.chip} onClick={() => setZoomId(null)}>
                        收起
                      </button>
                    </div>
                  </>
                }
              />
              <b>{p.title}</b>
              <div className={styles.price}>
                <span>¥{p.price}</span>
                <span className={styles.note}>{p.condition || '可议价'}</span>
              </div>
              <div className={styles.note} style={{ marginTop: 2 }}>
                {p.building || '校内'} · 同学 · {fmtTime(p.created_at)}
                <span style={{ marginLeft: 6 }}>{open ? '收起' : '展开'}</span>
              </div>
              <Collapsible open={open}>
                <div style={{ padding: '8px 10px 12px', borderTop: '1px solid var(--line)' }}>
                  <p className={styles.note}>{p.description || '这条闲置还没有描述'}</p>
                  <p className={styles.note}>成色 {p.condition || '可议价'} · {p.building || '校内'}</p>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {tab === '我的发布' ? (
                      <>
                        <button
                          className={styles.chip}
                          disabled={busy}
                          onClick={async (e) => {
                            e.stopPropagation()
                            const next = p.status === 'on' ? 'sold' : 'on'
                            setBusyId(p.id)
                            const res = await setItemStatus(p.id, next)
                            setBusyId(null)
                            if (res.error) toast.err(res.error)
                            else {
                              toast.ok(`已标记为${ITEM_STATUS_TEXT[next]}`)
                              mine.reload()
                            }
                          }}
                        >
                          {busy ? '处理中…' : `标为${ITEM_STATUS_TEXT[p.status === 'on' ? 'sold' : 'on']}`}
                        </button>
                        <button
                          className={styles.chip}
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation()
                            setDelTarget(p)
                          }}
                        >
                          删除
                        </button>
                      </>
                    ) : (
                      <button
                        className={styles.chip}
                        onClick={(e) => {
                          e.stopPropagation()
                          void showContact(p.id)
                        }}
                      >
                        联系方式
                      </button>
                    )}
                    <button
                      className={styles.chip}
                      onClick={(e) => {
                        e.stopPropagation()
                        nav(`/item/${p.id}`)
                      }}
                    >
                      详情页 ›
                    </button>
                  </div>
                </div>
              </Collapsible>
            </motion.article>
          )
        })}
      </SpringStagger>

      {tab === '二手集市' && pageError ? (
        <div role="alert" style={{ margin: '12px 16px', color: 'var(--danger, #b42318)', textAlign: 'center' }}>
          {pageError}
          <button type="button" className={styles.chip} onClick={() => void loadMore()} disabled={pageLoading} style={{ marginLeft: 8 }}>
            重试
          </button>
        </div>
      ) : null}
      {tab === '二手集市' && pageHasMore ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: '12px 16px 24px' }}>
          <button type="button" className={styles.chip} onClick={() => void loadMore()} disabled={pageLoading}>
            {pageLoading ? '正在加载…' : q ? '继续搜索更早闲置' : '加载更多闲置'}
          </button>
          <small style={{ color: 'var(--text-3)', marginTop: 8 }}>按发布时间继续查看，每页 {ITEM_PAGE_SIZE} 条</small>
        </div>
      ) : tab === '二手集市' && publicRows.length > 0 ? (
        <div style={{ padding: '12px 16px 24px', color: 'var(--text-3)', textAlign: 'center' }}>
          {q ? `已搜索全部闲置，找到 ${list.length} 条匹配结果` : '已经看到全部闲置'}
        </div>
      ) : null}

      {delTarget ? (
        <ConfirmSheet
          title="删除这条闲置？"
          desc={`「${delTarget.title}」删除后不可恢复`}
          confirmText="删除"
          danger
          busy={busyId === delTarget.id}
          onClose={() => setDelTarget(null)}
          onConfirm={async () => {
            const target = delTarget
            setBusyId(target.id)
            const res = await deleteItem(target.id)
            setBusyId(null)
            setDelTarget(null)
            setOpenId(null)
            if (res.error) toast.err(res.error)
            else {
              toast.ok('已删除')
              mine.reload()
            }
          }}
        />
      ) : null}

      {publishOpen ? (
        <GoodsPublishSheet
          onClose={() => setPublishOpen(false)}
          onDone={() => {
            setPublishOpen(false)
            hall.reload()
            mine.reload()
          }}
        />
      ) : null}
    </div>
  )
}
