import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { useAuth } from '../lib/auth'
import { usePollingRows } from '../lib/hooks'
import { captureImSession, currentImSession, subscribeImSession } from '../lib/im-session'
import { useToast } from '../context/ToastContext'
import { fetchNotificationsPage, notifyMarkRead, notifyMeta, relTime } from '../lib/notify'
import type { NotifyRow } from '../lib/notify'
import { filterNotesForShell, adminNotificationPath } from '../lib/notification-scope'
import { DeniedState, EmptyState, ErrorState, LoadingState } from '../components/ui/StateViews'
import styles from './work.module.css'
import me from './me.module.css'

/** Management inbox marks only visible work notifications; student notices remain unread. */
export function AdminNotifyPage() {
  const auth = useAuth()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const revision = useSyncExternalStore(subscribeImSession, () => captureImSession(uid)?.revision ?? -1, () => -1)
  return <AdminNotifyContent key={`${uid}:${revision}`} />
}

function AdminNotifyContent() {
  const auth = useAuth()
  const toast = useToast()
  const nav = useNavigate()
  const accountUid = auth.isSigned ? auth.user?.uid || '' : ''
  const signed = !!captureImSession(accountUid)
  /* 未登录（含冷启动的匿名会话）不发通知查询：notifications 对 anon 角色完全未授权，查询会 401 */
  const uid = signed ? auth.user?.uid || '' : ''
  const [marking, setMarking] = useState(false)
  const [olderRows, setOlderRows] = useState<NotifyRow[]>([])
  const [nextBeforeId, setNextBeforeId] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [pageError, setPageError] = useState('')
  const [actionError, setActionError] = useState('')
  const mountedOwner = useRef(captureImSession(uid))
  const alive = useRef(true)
  const writing = useRef(false)
  const paging = useRef(false)
  const retry = useRef<(() => Promise<void>) | null>(null)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const { rows, error, loading, reload } = usePollingRows<NotifyRow>(
    async () => {
      if (!uid) return { rows: [], error: null }
      const owner = captureImSession(uid)
      const res = await fetchNotificationsPage(uid, null, 100)
      if (!res.error && owner && currentImSession(owner)) {
        setNextBeforeId(res.nextBeforeId)
        setHasMore(res.hasMore)
      }
      return { rows: res.rows, error: res.error }
    },
    [uid],
  )

  const rowById = new Map<number, NotifyRow>()
  for (const row of [...olderRows, ...rows]) {
    if (row.uid === uid) rowById.set(row.id, row)
  }
  const ownedRows = filterNotesForShell([...rowById.values()].sort((a, b) => b.id - a.id), 'admin')
  const unread = ownedRows.filter((row) => !row.read_at)
  const read = ownedRows.filter((row) => row.read_at)

  async function openRow(row: NotifyRow) {
    const owner = captureImSession(uid)
    if (!alive.current || writing.current || !currentImSession(mountedOwner.current) || !owner || row.uid !== uid) return
    const current = () => alive.current && currentImSession(owner)
    writing.current = true; setMarking(true); setActionError(''); retry.current = null
    try {
      if (!row.read_at) {
        const res = await notifyMarkRead([row.id])
        if (!current()) return
        if (res.error) throw new Error(res.error)
        setOlderRows(currentRows => currentRows.map(item => item.id === row.id ? { ...item, read_at: new Date().toISOString() } : item))
        reload()
      }
      if (current() && row.link) nav(adminNotificationPath(row.link))
    } catch (error) {
      if (current()) {
        const message = (error as Error)?.message || '通知未能标记为已读，请重试。'
        setActionError(message); retry.current = () => openRow(row); toast.err(message)
      }
    } finally {
      writing.current = false
      if (current()) setMarking(false)
    }
  }

  async function markAll() {
    const owner = captureImSession(uid)
    if (!alive.current || writing.current || !currentImSession(mountedOwner.current) || !owner || unread.length === 0) return
    const current = () => alive.current && currentImSession(owner)
    writing.current = true; setMarking(true); setActionError(''); retry.current = null
    try {
      const res = await notifyMarkRead(unread.map((row) => row.id))
      if (!current()) return
      if (res.error) throw new Error(res.error)
      const readAt = new Date().toISOString()
      const markedIds = new Set(unread.map(row => row.id))
      setOlderRows(currentRows => currentRows.map(row => markedIds.has(row.id) ? { ...row, read_at: row.read_at || readAt } : row))
      toast.ok('已全部标记为已读')
      reload()
    } catch (error) {
      if (current()) {
        const message = (error as Error)?.message || '全部标记未完成，请重试。'
        setActionError(message); retry.current = markAll; toast.err(message)
      }
    } finally {
      writing.current = false
      if (current()) setMarking(false)
    }
  }

  async function loadOlder() {
    const owner = captureImSession(uid)
    const cursor = nextBeforeId
    if (!uid || !cursor || !hasMore || paging.current || !owner || !currentImSession(mountedOwner.current)) return
    const current = () => alive.current && currentImSession(owner)
    paging.current = true
    setLoadingOlder(true)
    setPageError('')
    try {
      const res = await fetchNotificationsPage(uid, cursor, 100)
      if (!current()) return
      if (res.error) throw new Error(res.error)
      setOlderRows(currentRows => {
        const known = new Set([...rows, ...currentRows].map(row => row.id))
        return [...currentRows, ...res.rows.filter(row => row.uid === uid && !known.has(row.id))]
      })
      setNextBeforeId(res.nextBeforeId)
      setHasMore(res.hasMore)
    } catch (error) {
      if (current()) setPageError((error as Error)?.message || '历史管理通知加载失败，请重试。')
    } finally {
      paging.current = false
      if (current()) setLoadingOlder(false)
    }
  }

  function renderItem(row: NotifyRow) {
    const meta = notifyMeta(row.kind)
    return (
      <button
        key={row.id}
        type="button"
        className={`${styles.notifyItem} ${row.read_at ? '' : styles.notifyItemUnread}`}
        disabled={marking}
        onClick={() => void openRow(row)}
      >
        <span className={styles.notifyIc}>
          {meta.emoji}
        </span>
        <span className={styles.notifyGrow}>
          <b>
            {row.read_at ? null : <span className={styles.notifyDot} />}
            {row.title}
          </b>
          {row.body ? <p>{row.body}</p> : null}
        </span>
        <span className={styles.notifyTime}>{relTime(row.created_at)}</span>
      </button>
    )
  }

  return (
    <div className={me.page} aria-busy={marking}>
      <PageHeader
        title="管理通知"
        right={
          <button type="button" className={styles.textBtn} onClick={() => void markAll()} disabled={marking || unread.length === 0}>
            {unread.length ? `已读当前列表(${unread.length})` : '已读当前列表'}
          </button>
        }
      />

      <div className={styles.wrap}>
        {!signed ? (
          <DeniedState
            title="登录后查看通知"
            hint="使用管理员账号查看举报与内容治理工作通知"
            action={
              <button
                type="button"
                className={`${styles.btn} ${styles.btnP}`}
                onClick={() => void auth.ensureSignedIn('请使用管理员账号登录查看工作通知')}
              >
                登录管理端
              </button>
            }
          />
        ) : loading && rows.length === 0 ? (
          <LoadingState title="正在同步通知…" />
        ) : (
          <>
            <p className={styles.dateGroupLabel}>默认显示最近 100 条；可继续加载历史。批量标记只处理当前已加载的未读管理通知。</p>
            {actionError ? <ErrorState compact title="通知操作未完成" hint={actionError} action={<button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnP}`} disabled={marking} onClick={() => void retry.current?.()}>重试操作</button>} /> : null}
            {error ? (
              <ErrorState
                compact
                title="通知同步失败"
                hint={error}
                action={
                  <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnP}`} onClick={() => reload()}>
                    重试
                  </button>
                }
              />
            ) : null}

            {unread.length > 0 ? (
              <>
                <div className={styles.dateGroupLabel}>未读 · {unread.length}</div>
                {unread.map(renderItem)}
              </>
            ) : null}

            {read.length > 0 ? (
              <>
                <div className={styles.dateGroupLabel}>已读</div>
                {read.map(renderItem)}
              </>
            ) : null}

            <div className={styles.notifyHistoryNote}>未读数量仅统计当前已加载的管理通知。</div>
            {pageError ? (
              <ErrorState compact title="历史通知加载失败" hint={pageError} action={<button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.btnP}`} disabled={loadingOlder} onClick={() => void loadOlder()}>重试</button>} />
            ) : null}
            {hasMore ? (
              <button type="button" className={`${styles.btn} ${styles.btnSm}`} disabled={loadingOlder} onClick={() => void loadOlder()}>
                {loadingOlder ? '正在加载…' : '加载更早通知'}
              </button>
            ) : null}
            {!hasMore && rowById.size > 100 ? <div className={styles.notifyHistoryEnd}>已显示全部管理通知</div> : null}

            {/* 同步失败时不算「没有通知」：空态只在确实无数据且无错误时出现 */}
            {!error && ownedRows.length === 0 ? (
              <EmptyState
                title="暂时没有新通知"
                hint="新的举报会显示在这里；待处理事项也可到举报处理页查看"
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
