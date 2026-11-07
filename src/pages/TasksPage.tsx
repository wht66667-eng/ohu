import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { TaskSheet } from '../components/TaskSheet'
import { TaskImageThumb } from '../components/TaskImageGallery'
import { SegmentedTabs } from '../components/ui/motion-ui'
import { Avatar } from '../components/Thumbs'
import { IconClock, IconPin } from '../components/Icons'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateViews'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../lib/auth'
import { campusOf, placeOf } from '../lib/campus'
import { claimLegacyFavs, useFavIds, useHasClaimableLegacyFavs, toggleFav } from '../lib/favorites'
import { usePollingRows } from '../lib/hooks'
import {
  TASK_KINDS,
  TASK_STATUS_TEXT,
  fetchMyTasks,
  fetchRowsByIds,
  fetchTasksPage,
  fmtTime,
  queryRows,
  TASK_PAGE_SIZE,
  type Task,
  type TaskStatus,
} from '../lib/market'
import styles from './campus.module.css'

const TABS = ['任务大厅', '我的收藏', '我的发布'] as const
const KINDS = ['全部', ...TASK_KINDS] as const

/** 状态胶囊配色：全部取自 token + color-mix，浅/深色自动适配 */
function statusTone(status: TaskStatus | string): CSSProperties {
  if (status === 'open') return { color: 'var(--green-text)', background: 'var(--green-soft)' }
  if (status === 'doing') {
    return {
      color: 'var(--orange)',
      background: 'color-mix(in srgb, var(--orange) 14%, var(--card))',
    }
  }
  return {
    color: 'var(--text-3)',
    background: 'color-mix(in srgb, var(--text-3) 14%, var(--card))',
  }
}

export function TasksPage() {
  const toast = useToast()
  const auth = useAuth()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const favoriteScope = uid || 'guest'
  const favIds = useFavIds(favoriteScope)
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const [tab, setTab] = useState<(typeof TABS)[number]>(tabParam === 'mine' ? '我的发布' : tabParam === 'favorites' ? '我的收藏' : '任务大厅')
  const [kind, setKind] = useState<(typeof KINDS)[number]>('全部')
  const nav = useNavigate()
  const [publishOpen, setPublishOpen] = useState(false)
  const [claimLegacyOpen, setClaimLegacyOpen] = useState(false)
  const [claimLegacyBusy, setClaimLegacyBusy] = useState(false)
  const [olderRows, setOlderRows] = useState<Task[]>([])
  const [pageCursor, setPageCursor] = useState<{ created_at: string; id: number } | null>(null)
  const [pageHasMore, setPageHasMore] = useState(false)
  const [pageLoading, setPageLoading] = useState(false)
  const [pageError, setPageError] = useState('')
  const kindRef = useRef(kind)
  kindRef.current = kind


  useEffect(() => {
    setTab(tabParam === 'mine' ? '我的发布' : tabParam === 'favorites' ? '我的收藏' : '任务大厅')
  }, [tabParam])

  const hall = usePollingRows<Task>(
    () => fetchTasksPage(kind === '全部' ? undefined : kind),
    [kind],
  )
  const favs = usePollingRows<Task>(
    () => (favIds.length ? fetchRowsByIds<Task>('v_tasks_public', favIds) : Promise.resolve({ rows: [], error: null })),
    [favIds],
  )
  const mine = usePollingRows<Task>(
    () => (uid ? fetchMyTasks(uid) : Promise.resolve({ rows: [], error: null })),
    [uid],
  )

  const wantsPublish = params.get('publish') === '1'
  const firstPageKey = hall.rows.map((row) => `${row.id}:${row.created_at}`).join('|')
  useEffect(() => {
    setOlderRows([])
    const last = hall.rows[hall.rows.length - 1]
    setPageCursor(last ? { created_at: last.created_at, id: last.id } : null)
    setPageHasMore(hall.hasMore)
    setPageError('')
  }, [kind, firstPageKey, hall.hasMore])

  const list = tab === '任务大厅'
    ? [...hall.rows, ...olderRows.filter((row) => !hall.rows.some((first) => first.id === row.id))]
    : tab === '我的收藏' ? favs.rows : mine.rows
  const state = tab === '任务大厅' ? hall : tab === '我的收藏' ? favs : mine
  const hasLegacyFavorites = useHasClaimableLegacyFavs(favoriteScope)

  const loadMore = useCallback(async () => {
    if (pageLoading || !pageHasMore || !pageCursor) return
    const requestedKind = kind
    setPageLoading(true)
    setPageError('')
    try {
      const res = await fetchTasksPage(requestedKind === '全部' ? undefined : requestedKind, pageCursor, TASK_PAGE_SIZE)
      if (kindRef.current !== requestedKind) return
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
      if (kindRef.current === requestedKind) setPageError(error instanceof Error ? error.message : '加载更多任务失败，请重试')
    } finally {
      setPageLoading(false)
    }
  }, [hall.rows, kind, pageCursor, pageHasMore, pageLoading])

  /** 从发布面板「发布任务」进来会带 ?publish=1，直接弹表单 */
  useEffect(() => {
    if (wantsPublish) setPublishOpen(true)
  }, [wantsPublish])

  const closePublish = useCallback(() => {
    setPublishOpen(false)
    if (wantsPublish) { const next = new URLSearchParams(params); next.delete('publish'); setParams(next, { replace: true }) }
  }, [wantsPublish, params, setParams])

  const showContact = useCallback(
    async (id: number) => {
      if (!(await auth.ensureSignedIn('查看联系方式需要登录'))) return
      const res = await queryRows<Task>('tasks', { id }, 1)
      const contact = res.rows[0]?.contact
      if (!contact) { toast('联系方式已保护，请打开任务详情发私信'); return }
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
      发布任务
    </button>
  )

  return (
    <div className={styles.page}>
      <PageHeader
        title="校园任务"
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
          onChange={(t) => {
            const next = new URLSearchParams(params)
            if (t === '我的发布') next.set('tab', 'mine')
            else if (t === '我的收藏') next.set('tab', 'favorites')
            else next.delete('tab')
            setTab(t as (typeof TABS)[number]); setParams(next, { replace: true })
          }}
          id="tasks"
        />
      </div>

      {tab === '任务大厅' ? (
        <div className={`${styles.chips} hide-scroll`}>
          {KINDS.map((k) => (
            <button key={k} className={`${styles.chip} ${kind === k ? styles.on : ''}`} onClick={() => {
              if (k !== kind) {
                setOlderRows([])
                setPageCursor(null)
                setPageHasMore(false)
                setPageError('')
              }
              setKind(k)
            }}>
              {k}
            </button>
          ))}
        </div>
      ) : null}

      {tab === '我的发布' && !uid ? (
        <EmptyState
          title="登录后查看我的发布"
          hint="登录后可以查看和管理你发布的任务"
          action={
            <button type="button" onClick={() => void auth.ensureSignedIn('登录后查看你发布的任务')}>
              去登录
            </button>
          }
        />
      ) : (
        <>
          {tab === '我的收藏' && hasLegacyFavorites ? (
            <aside className={styles.favoriteRecovery}>
              <div><strong>发现这台设备上的旧收藏</strong><span>请确认它们属于当前账号；恢复后会与当前收藏合并。</span></div>
              <button type="button" onClick={() => setClaimLegacyOpen(true)}>检查并恢复</button>
            </aside>
          ) : null}
          {state.loading && list.length === 0 ? (
            <LoadingState title="正在同步任务…" hint="阿狐马上就好" />
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
          {!state.loading && !state.error && list.length === 0 ? (
            tab === '我的收藏' ? (
              <EmptyState title={hasLegacyFavorites ? '旧收藏尚未恢复' : '还没有收藏'} hint={hasLegacyFavorites ? '先确认这批设备旧数据属于当前账号，再恢复查看。' : '在任务大厅看到合适的任务，点 ♡ 收藏起来'} />
            ) : tab === '我的发布' ? (
              <EmptyState title="还没有发布任务" hint="发布一条任务，让同学来帮你吧" action={publishAction} />
            ) : (
              <EmptyState
                title="暂无任务"
                hint="还没有同学发布这类任务，点下方按钮发第一条吧"
                action={publishAction}
              />
            )
          ) : null}

          {list.map((t) => {
            const faved = favIds.includes(t.id)
            const campus = campusOf(t.location)
            const place = placeOf(t.location)
            return (
              <article
                key={t.id}
                className={styles.task}
                onClick={() => nav(`/task/${t.id}`)}
                style={t.status === 'open' ? undefined : { opacity: 0.72 }}
              >
                <div className={styles.taskTop}>
                  <span className={styles.tagRow}>
                    <span className={styles.tag}>{t.kind || '互助'}</span>
                    {campus ? <span className={styles.campus}>{campus}</span> : null}
                  </span>
                  <span className={styles.status} style={statusTone(t.status)}>
                    {TASK_STATUS_TEXT[t.status] || t.status}
                  </span>
                </div>
                <div className={styles.taskBody}>
                  <div>
                    <div className={styles.taskTitle}>{t.title}</div>
                    {t.description ? (
                      <div style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 4 }}>{t.description}</div>
                    ) : null}
                    <div className={styles.price}>¥{t.reward || '面议'}</div>
                    <div className={styles.meta}>
                      <span>
                        <IconPin size={12} /> {place || campus || '校园'}
                      </span>
                      <span>
                        <IconClock size={12} /> {t.deadline || fmtTime(t.created_at)}
                      </span>
                    </div>
                  </div>
                  <TaskImageThumb images={t.images} />
                </div>
                <div className={styles.foot}>
                  <span className={styles.user}>
                    <Avatar name={t.creator_name || '同学'} seed={t.creator_name || '同学'} />
                    {t.creator_name || '同学'} · {fmtTime(t.created_at)}
                  </span>
                  <span style={{ display: 'flex', gap: 8 }}>
                    <button
                      className={styles.chip}
                      onClick={(e) => {
                        e.stopPropagation()
                        try {
                          const on = toggleFav(t.id, favoriteScope)
                          toast(on ? '已收藏' : '已取消收藏')
                        } catch (error) {
                          toast.err(error instanceof Error ? error.message : '收藏未能保存')
                        }
                      }}
                    >
                      {faved ? '♥ 已收藏' : '♡ 收藏'}
                    </button>
                    <button
                      className={styles.chip}
                      onClick={(e) => {
                        e.stopPropagation()
                        void showContact(t.id)
                      }}
                    >
                      联系方式
                    </button>
                  </span>
                </div>
              </article>
            )
          })}
          {tab === '任务大厅' && pageError ? (
            <div role="alert" style={{ margin: '12px 16px', color: 'var(--danger, #b42318)', textAlign: 'center' }}>
              {pageError}
              <button type="button" className={styles.chip} onClick={() => void loadMore()} disabled={pageLoading} style={{ marginLeft: 8 }}>
                重试
              </button>
            </div>
          ) : null}
          {tab === '任务大厅' && pageHasMore ? (
            <div style={{ display: 'grid', placeItems: 'center', padding: '12px 16px 24px' }}>
              <button type="button" className={styles.chip} onClick={() => void loadMore()} disabled={pageLoading}>
                {pageLoading ? '正在加载…' : '加载更多任务'}
              </button>
              <small style={{ color: 'var(--text-3)', marginTop: 8 }}>按发布时间继续查看，每页 {TASK_PAGE_SIZE} 条</small>
            </div>
          ) : tab === '任务大厅' && list.length > 0 ? (
            <div style={{ padding: '12px 16px 24px', color: 'var(--text-3)', textAlign: 'center' }}>已经看到全部任务</div>
          ) : null}
        </>
      )}

      {claimLegacyOpen ? <ConfirmSheet
        title="恢复这台设备上的旧收藏？"
        desc="旧收藏没有账号归属。确认后会并入当前账号，其他账号不能再次导入；旧数据只会在新记录和归属标记均保存成功后清除。"
        confirmText="确认恢复"
        busy={claimLegacyBusy}
        onClose={() => setClaimLegacyOpen(false)}
        onConfirm={() => {
          setClaimLegacyBusy(true)
          void (async () => {
            try {
              const count = await claimLegacyFavs(favoriteScope)
              setClaimLegacyOpen(false)
              toast(count ? `已恢复 ${count} 项旧收藏` : '没有可恢复的旧收藏')
            } catch (error) {
              toast.err(error instanceof Error ? error.message : '恢复失败，旧收藏仍保留')
            } finally {
              setClaimLegacyBusy(false)
            }
          })()
        }}
      /> : null}
      {publishOpen ? (
        <TaskSheet
          onClose={closePublish}
          onDone={() => {
            closePublish()
            setTab('我的发布')
            mine.reload()
            hall.reload()
          }}
        />
      ) : null}
    </div>
  )
}
