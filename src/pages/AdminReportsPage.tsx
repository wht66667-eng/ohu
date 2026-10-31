import { useCallback, useEffect, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { useAuth } from '../lib/auth'
import { useToast } from '../context/ToastContext'
import {
  fetchReportsPage,
  resolveReport,
  type ReportRow,
  type ReportStatus,
} from '../lib/reports'
import { deletePlazaMessage, deletePlazaPost, fetchPlazaMessageById, fetchPlazaPostById } from '../lib/plaza'
import { applySanction } from '../lib/sanctions'
import { fetchCampusPostById, setCampusPostStatus } from '../lib/campus-map'
import { captureImSession, currentImSession } from '../lib/im-session'
import { useImSessionVersion } from '../lib/use-im-session-version'
import { DeniedState, EmptyState, ErrorState, LoadingState } from '../components/ui/StateViews'
import styles from './AdminReportsPage.module.css'

const STATUS_TEXT: Record<ReportStatus, string> = {
  pending: '待处理',
  done: '已处理',
  rejected: '已驳回',
}

export function AdminReportsPage() {
  const auth = useAuth()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const revision = useImSessionVersion(uid)
  const allowed = !!(auth.isSigned && (auth.profile?.isAdmin || auth.profile?.isSuperAdmin))
  return <ReportsForAccount key={`${uid}:${revision}:${allowed}`} />
}

function ReportsForAccount() {
  const auth = useAuth()
  const isAdmin = auth.isSigned && !!(auth.profile?.isAdmin || auth.profile?.isSuperAdmin)
  const toast = useToast()
  const [tab, setTab] = useState<ReportStatus | 'all'>('pending')
  const [rows, setRows] = useState<ReportRow[]>([])
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [nextBeforeId, setNextBeforeId] = useState<number | null>(null)
  const [actionId, setActionId] = useState<number | null>(null)
  const request = useRef(0)
  const alive = useRef(true)
  const mutation = useRef(false)
  const uid = auth.user?.uid || ''
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current++ } }, [])

  const reload = useCallback(async () => {
    const owner = captureImSession(uid)
    if (!isAdmin || !owner) return
    const ticket = ++request.current
    setBusy(true)
    setLoadingMore(false)
    setLoadError(null)
    setPageError(null)
    let r: Awaited<ReturnType<typeof fetchReportsPage>>
    try { r = await fetchReportsPage({ status: tab === 'all' ? undefined : tab }) }
    catch (error) { r = { rows: [], nextBeforeId: null, hasMore: false, error: error instanceof Error ? error.message : '举报列表读取失败，请重试' } }
    if (!alive.current || ticket !== request.current || !currentImSession(owner)) return
    setBusy(false)
    if (r.error) {
      toast.err(r.error)
      setLoadError(r.error)
      return
    }
    setLoadError(null)
    setRows(r.rows)
    setHasMore(r.hasMore)
    setNextBeforeId(r.nextBeforeId)
  }, [tab, toast, uid, isAdmin])

  const loadMore = useCallback(async () => {
    const owner = captureImSession(uid)
    if (!isAdmin || !owner || busy || loadingMore || !hasMore || nextBeforeId === null) return
    const ticket = ++request.current
    setLoadingMore(true)
    setPageError(null)
    let r: Awaited<ReturnType<typeof fetchReportsPage>>
    try {
      r = await fetchReportsPage({ status: tab === 'all' ? undefined : tab, beforeId: nextBeforeId })
    } catch (error) {
      r = { rows: [], nextBeforeId: null, hasMore: false, error: error instanceof Error ? error.message : '加载更早举报失败，请重试' }
    }
    if (!alive.current || ticket !== request.current || !currentImSession(owner)) return
    setLoadingMore(false)
    if (r.error) {
      setPageError(r.error)
      return
    }
    setRows((current) => {
      const seen = new Set(current.map((row) => row.id))
      return [...current, ...r.rows.filter((row) => !seen.has(row.id))]
    })
    setHasMore(r.hasMore)
    setNextBeforeId(r.nextBeforeId)
  }, [busy, hasMore, isAdmin, loadingMore, nextBeforeId, tab, uid])

  useEffect(() => {
    if (!isAdmin) return
    void reload()
    return () => { request.current++ }
  }, [isAdmin, reload])

  async function operate(id: number, run: (valid: () => boolean) => Promise<void>) {
    const owner = captureImSession(uid)
    if (!isAdmin || !owner || mutation.current || busy || loadingMore) return
    mutation.current = true
    setActionId(id)
    const valid = () => alive.current && currentImSession(owner)
    try { await run(valid) }
    catch (error) { if (valid()) toast.err(error instanceof Error ? error.message : '处理失败，请重试') }
    finally { mutation.current = false; if (valid()) setActionId(null) }
  }

  async function authorOf(r: ReportRow): Promise<{ uid: string; name: string } | null> {
    const id = Number(r.target_id)
    if (!Number.isFinite(id) || id <= 0) return null
    if (r.target_type === 'plaza_message') {
      const result = await fetchPlazaMessageById(id)
      if (result.error) throw new Error(result.error)
      const row = result.row
      return row ? { uid: row.creator_uid, name: row.creator_name } : null
    }
    if (r.target_type === 'plaza_post') {
      const result = await fetchPlazaPostById(id)
      if (result.error) throw new Error(result.error)
      const row = result.row
      return row ? { uid: row.creator_uid, name: row.creator_name } : null
    }
    if (r.target_type === 'campus_post') {
      const result = await fetchCampusPostById(id)
      if (result.error) throw new Error(result.error)
      const row = result.row
      return row ? { uid: row.author_uid, name: row.author_name } : null
    }
    return null
  }

  async function dropTarget(r: ReportRow) {
    await operate(r.id, async (valid) => {
    const id = Number(r.target_id)
    if (!id) {
      toast('这条举报没有关联原文')
      return
    }
    const res =
      r.target_type === 'plaza_message'
        ? await deletePlazaMessage(id)
          : r.target_type === 'campus_post'
            ? await setCampusPostStatus(id, 'hidden')
            : r.target_type === 'plaza_post'
              ? await deletePlazaPost(id)
          : { error: '当前只能从举报里删除广场大厅或帖子' }
    if (!valid()) return
    if (res.error) {
      toast.err(res.error)
      return
    }
    const closed = await resolveReport(r.id, true, '已删除原文')
    if (!valid()) return
    if (closed.error) {
      toast.err(`原文已删除，但举报结案失败：${closed.error}`)
      void reload()
      return
    }
    toast.ok('已删除原文并结案')
    void reload()
    })
  }

  async function punish(r: ReportRow, kind: 'mute' | 'hall_ban', hours: number | null, label: string) {
    await operate(r.id, async (valid) => {
    const author = await authorOf(r)
    if (!valid()) return
    if (!author?.uid) {
      toast.err('找不到发布者，无法处罚')
      return
    }
    const res = await applySanction({
      uid: author.uid,
      kind,
      hours,
      reason: `${label} · 举报#${r.id}`,
      actorUid: auth.user?.uid || '',
    })
    if (!valid()) return
    if (res.error) {
      toast.err(res.error)
      return
    }
    const closed = await resolveReport(r.id, true, label)
    if (!valid()) return
    if (closed.error) {
      toast.err(`${label}已生效，但举报结案失败：${closed.error}`)
      void reload()
      return
    }
    toast.ok(`${label}已生效`)
    void reload()
    })
  }

  async function handle(id: number, ok: boolean) {
    await operate(id, async (valid) => {
    const note = ok ? '已处理' : '证据不足，已驳回'
    const res = await resolveReport(id, ok, note)
    if (!valid()) return
    if (res.error) {
      toast.err(res.error)
      return
    }
    toast(ok ? '已标记处理' : '已驳回')
    void reload()
    })
  }

  if (!isAdmin) {
    return (
      <div className={styles.page}>
        <PageHeader title="举报处理" />
        <DeniedState title="暂无权限" hint="需要管理员权限才能处理举报。" />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <PageHeader title="举报处理" />
      <p className={styles.lead}>
        广场大厅和帖子的举报可以直接删原文、禁言或封大厅。其他类型仍只更新处理状态。
      </p>

      <div className={styles.summary}>
        <div>
          <b>{busy || loadError ? '—' : rows.length}</b>
          <span>已加载举报</span>
        </div>
        <div>
          <b>{tab === 'pending' && !busy && !loadError ? rows.length : '—'}</b>
          <span>已加载待处理</span>
        </div>
      </div>

      <div className={styles.tabs}>
        {(['pending', 'done', 'rejected', 'all'] as const).map((t) => (
          <button
            key={t}
            type="button"
            disabled={actionId !== null}
            className={tab === t ? styles.tabOn : styles.tab}
            onClick={() => { if (tab !== t) { request.current++; setRows([]); setBusy(true); setLoadError(null); setPageError(null); setHasMore(false); setNextBeforeId(null); setTab(t) } }}
          >
            {t === 'all' ? '全部' : STATUS_TEXT[t]}
          </button>
        ))}
      </div>

      {busy ? <LoadingState compact title="正在同步举报…" /> : null}
      {actionId !== null ? <p role="status">正在处理举报 #{actionId}…</p> : null}
      {!busy && loadError ? (
        <ErrorState
          compact
          title="举报列表加载失败"
          hint={`${loadError}${rows.length ? '；下方保留最近一次成功读取的记录，当前状态未确认，暂不可操作。' : ''}`}
          action={
            <button type="button" onClick={() => void reload()}>
              重试
            </button>
          }
        />
      ) : null}
      {!busy && !loadError && !rows.length ? (
        <EmptyState compact title="暂无举报" hint="当前分类下还没有内容，换个筛选看看。" />
      ) : null}

      <ul className={styles.list}>
        {(!busy ? rows : []).map((r) => (
          <li key={r.id} className={styles.card}>
            <div className={styles.head}>
              <b>
                {r.reason} · {r.target_type}
              </b>
              <span className={styles.pill}>{STATUS_TEXT[r.status]}</span>
            </div>
            <p className={styles.meta}>
              #{r.id} · 目标 {r.target_id || '—'} · {new Date(r.created_at).toLocaleString()}
            </p>
            {r.detail ? <p className={styles.detail}>{r.detail}</p> : null}
            {r.status === 'pending' ? (
              <div className={styles.actions}>
                {r.target_type === 'plaza_message' || r.target_type === 'plaza_post' || r.target_type === 'campus_post' ? (
                  <>
                    <button type="button" disabled={actionId !== null || loadError !== null || loadingMore} className={styles.chip} onClick={() => void dropTarget(r)}>
                      {r.target_type === 'campus_post' ? '隐藏动态' : '删除原文'}
                    </button>
                    {r.target_type !== 'campus_post' ? <>
                    <button type="button" disabled={actionId !== null || loadError !== null || loadingMore} className={styles.chip} onClick={() => void punish(r, 'mute', 24, '禁言 1 天')}>
                      禁言 1 天
                    </button>
                    <button type="button" disabled={actionId !== null || loadError !== null || loadingMore} className={styles.chip} onClick={() => void punish(r, 'mute', 168, '禁言 7 天')}>
                      禁言 7 天
                    </button>
                    <button type="button" disabled={actionId !== null || loadError !== null || loadingMore} className={styles.chip} onClick={() => void punish(r, 'hall_ban', null, '封禁大厅')}>
                      封大厅
                    </button>
                    </> : null}
                  </>
                ) : null}
                <button type="button" disabled={actionId !== null || loadError !== null || loadingMore} className={styles.ok} onClick={() => void handle(r.id, true)}>
                  仅结案
                </button>
                <button type="button" disabled={actionId !== null || loadError !== null || loadingMore} className={styles.no} onClick={() => void handle(r.id, false)}>
                  驳回
                </button>
              </div>
            ) : r.admin_note ? (
              <p className={styles.meta}>备注：{r.admin_note}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {!busy && pageError ? (
        <p className={styles.pageError} role="alert">
          加载更早的举报失败：{pageError}
          <button type="button" onClick={() => void loadMore()}>重试</button>
        </p>
      ) : null}
      {!busy && hasMore ? (
        <button type="button" className={styles.loadMore} disabled={loadingMore} onClick={() => void loadMore()}>
          {loadingMore ? '正在加载…' : '加载更早举报'}
        </button>
      ) : null}
    </div>
  )
}
