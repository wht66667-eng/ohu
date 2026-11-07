import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { Avatar } from '../components/Thumbs'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { ExpressTrackSheet } from '../components/ExpressTrackSheet'
import { TaskImageGallery } from '../components/TaskImageGallery'
import { DeniedState, EmptyState, ErrorState, LoadingState } from '../components/ui/StateViews'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../lib/auth'
import { IconClock, IconPin } from '../components/Icons'
import { openDmThread } from '../lib/dm-entry'
import { deletePost } from '../lib/moderation'
import { AsyncOwner, positiveRecordId, type OwnerTicket } from '../lib/async-owner'
import { subscribeImSession } from '../lib/im-session'
import {
  TASK_STATUS_TEXT,
  fmtTime,
  queryRows,
  setTaskStatus,
  type Task,
  type TaskStatus,
} from '../lib/market'
import styles from './TaskDetailPage.module.css'

export function TaskDetailPage() {
  const { id } = useParams()
  const auth = useAuth()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  return <TaskDetailContent key={`${id || 'invalid'}:${uid}`} />
}

function TaskDetailContent() {
  const { id } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const auth = useAuth()
  const authRef = useRef(auth)
  authRef.current = auth
  const [task, setTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [contactState, setContact] = useState({ uid: '', value: '' })
  const [busy, setBusy] = useState(false)
  const [ownerBusy, setOwnerBusy] = useState(false)
  const idNum = positiveRecordId(id)
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const contact = uid && contactState.uid === uid ? contactState.value : ''
  const scope = useRef(new AsyncOwner(`${id}:${uid}`))
  scope.current.select(`${id}:${uid}`)
  useEffect(() => subscribeImSession(() => scope.current.invalidate()), [])
  const chatFlight = useRef<{ ticket: OwnerTicket } | null>(null)
  const writeFlight = useRef<OwnerTicket | null>(null)
  const mounted = useRef(false)
  const isAdmin = auth.isSigned && !!(auth.profile?.isAdmin || auth.profile?.isSuperAdmin)
  const [delOpen, setDelOpen] = useState(false)
  const [delBusy, setDelBusy] = useState(false)
  const [expressOpen, setExpressOpen] = useState(false)

  const load = useCallback(async () => {
    const ticket = scope.current.begin('load')
    setLoading(true)
    setErr('')
    setTask(null)
    if (!idNum) { setErr('这条任务不存在'); setLoading(false); return }
    const res = await queryRows<Task>('v_tasks_public', { id: idNum }, 1)
    if (!scope.current.current(ticket)) return
    if (res.error) setErr(res.error)
    else if (!res.rows.length || Number(res.rows[0].id) !== idNum) setErr('这条任务可能已删除')
    else setTask(res.rows[0])
    setLoading(false)
  }, [idNum, uid])

  useEffect(() => {
    mounted.current = true
    setContact({ uid: '', value: '' })
    setBusy(false)
    setOwnerBusy(false)
    setDelBusy(false)
    setDelOpen(false)
    setExpressOpen(false)
    void load()
    return () => { mounted.current = false; scope.current.invalidate() }
  }, [load])

  const retry = useCallback(() => {
    setLoading(true)
    setErr('')
    void load()
  }, [load])

  /** 视图行带 creator_uid 时可判定本人；拿不到则按访客处理，不影响既有鉴权 */
  const isOwner = !!task && !!uid && task.creator_uid === uid
  const active = task?.status === 'open'

  const showContact = useCallback(async () => {
    if (!task || !active) return
    const before = scope.current.capture()
    if (!(await auth.ensureSignedIn('查看联系方式需要登录'))) return
    if (!mounted.current || (uid && !scope.current.current(before)) || !authRef.current.isSigned) return
    const ticket = scope.current.begin('contact')
    const res = await queryRows<Task>('tasks', { id: Number(task.id) }, 1)
    if (!scope.current.current(ticket)) return
    if (res.error) { toast.err(res.error); return }
    const row = res.rows.find((row) => Number(row.id) === Number(task.id))
    if (!row || row.status !== 'open') { toast('这条任务已不可联系'); void load(); return }
    setContact({ uid: authRef.current.user?.uid || '', value: row.contact || '联系方式已保护，请点击“发私信”联系发布者' })
  }, [auth, active, task, uid, load, toast])

  /** 发私信：走腾讯云 IM 单聊（与广场统一） */
  const startChat = useCallback(async () => {
    if (!task || !active || (chatFlight.current && scope.current.current(chatFlight.current.ticket))) return
    const pending = { ticket: scope.current.begin('chat') }
    chatFlight.current = pending
    if (!(await auth.ensureSignedIn('发私信需要先登录'))) { if (chatFlight.current === pending) chatFlight.current = null; return }
    if (!mounted.current || chatFlight.current !== pending || (uid && !scope.current.current(pending.ticket)) || !authRef.current.isSigned) return
    pending.ticket = scope.current.begin('chat')
    setBusy(true)
    const res = await queryRows<Task>('tasks', { id: Number(task.id) }, 1)
    if (chatFlight.current === pending) chatFlight.current = null
    if (!scope.current.current(pending.ticket)) return
    if (res.error) {
      setBusy(false)
      toast.err(res.error)
      return
    }
    const row = res.rows.find((row) => Number(row.id) === Number(task.id))
    if (!row || row.status !== 'open') { setBusy(false); toast('这条任务已不可联系'); void load(); return }
    const peerUid = row.creator_uid || task.creator_uid || ''
    if (!peerUid) {
      setBusy(false)
      toast('暂时联系不上这位发布者')
      return
    }
    // 用原始 uid 比较：会话线按真实 uid 建，按 IM 字符集裁剪会对不上号
    if (peerUid === (authRef.current.user?.uid || '')) {
      setBusy(false)
      toast('这是你自己发布的任务，不用发私信啦')
      return
    }
    setBusy(false)
    void (async () => {
      const r = await openDmThread({
        peerUid,
        peerName: task?.creator_name || '同学',
        topicType: 'task',
        topicId: idNum,
        topicTitle: task?.title || '互助',
      })
      if (r.error) toast.err(r.error)
      else nav(r.path)
    })()
  }, [auth, active, uid, nav, task, load, toast])

  /** 发布者本人：下架（关闭）/ 重新开放，复用数据层既有 setTaskStatus */
  const toggleOwner = useCallback(async () => {
    if (!task || !isOwner || task.status === 'done' || (writeFlight.current && scope.current.current(writeFlight.current))) return
    const ticket = scope.current.begin('write')
    writeFlight.current = ticket
    const next: TaskStatus = task.status === 'cancelled' ? 'open' : 'cancelled'
    setOwnerBusy(true)
    const res = await setTaskStatus(Number(task.id), next)
    if (writeFlight.current === ticket) writeFlight.current = null
    if (!scope.current.current(ticket)) return
    setOwnerBusy(false)
    if (res.error) {
      toast.err(res.error)
      return
    }
    toast.ok(next === 'cancelled' ? '任务已下架关闭' : '任务已重新开放')
    setTask({ ...task, status: next })
  }, [task, isOwner, toast])

  /**
   * 管理员当场删除违规任务。
   * 越权拦截由 tasks_delete_own（creator_uid = auth.uid() OR is_admin_user()）兜底，
   * 前端 isAdmin 只决定这个区块挂不挂载；删除后这条任务已不存在，直接回任务列表。
   */
  const removeTask = useCallback(async () => {
    if (!task || !isAdmin || !uid || (writeFlight.current && scope.current.current(writeFlight.current))) return
    const ticket = scope.current.begin('write')
    writeFlight.current = ticket
    setDelBusy(true)
    const r = await deletePost('tasks', Number(task.id))
    if (writeFlight.current === ticket) writeFlight.current = null
    if (!scope.current.current(ticket)) return
    setDelBusy(false)
    if (r.error) {
      toast.err(r.error)
      return
    }
    toast.ok('已删除该任务')
    setDelOpen(false)
    nav('/tasks')
  }, [task, isAdmin, uid, nav, toast])

  const backToList = (
    <button type="button" onClick={() => nav('/tasks')}>
      返回任务大厅
    </button>
  )

  const notFound = !!err && /已删除|已下架|不存在/.test(err)
  const denied = !!err && /42501|permission denied|权限/i.test(err)

  return (
    <div className={styles.page}>
      <PageHeader title="任务详情" />

      {loading ? <LoadingState title="正在加载任务…" hint="阿狐马上就好" /> : null}
      {!loading && notFound ? (
        <EmptyState title="任务不存在" hint={err} action={backToList} />
      ) : null}
      {!loading && denied ? (
        <DeniedState title="暂无权限查看" hint="当前账号还看不到这条任务" action={backToList} />
      ) : null}
      {!loading && err && !notFound && !denied ? (
        <ErrorState hint={err} action={<button type="button" onClick={retry}>重试</button>} />
      ) : null}

      {!loading && !err && task ? (
        <>
          <article className={styles.card}>
            <div className={styles.body}>
              <div className={styles.tagRow}>
                <span className={styles.tag}>{task.kind || '互助'}</span>
                <span
                  className={`${styles.badge} ${
                    task.status === 'open'
                      ? styles.badgeGreen
                      : task.status === 'doing'
                        ? styles.badgeOrange
                        : styles.badgeMuted
                  }`}
                >
                  {TASK_STATUS_TEXT[task.status] || task.status}
                </span>
              </div>

              {task.status === 'doing' ? (
                <div className={`${styles.banner} ${styles.bannerWarn}`}>
                  任务已被接单，正在进行中，暂时无法再接单
                </div>
              ) : null}
              {task.status === 'done' ? (
                <div className={`${styles.banner} ${styles.bannerOff}`}>任务已完成，感谢关注</div>
              ) : null}
              {task.status === 'cancelled' ? (
                <div className={`${styles.banner} ${styles.bannerOff}`}>任务已关闭（下架），暂时无法接单</div>
              ) : null}

              <h1 className={styles.title}>{task.title}</h1>
              <div className={styles.priceRow}>
                <span className={styles.price}>¥{task.reward || '面议'}</span>
                <span className={styles.priceLabel}>任务报酬</span>
              </div>

              <div className={styles.meta}>
                <span className={styles.metaItem}>
                  <IconPin size={14} />
                  <span>{task.location || '校园'}</span>
                </span>
                <span className={styles.metaItem}>
                  <IconClock size={14} />
                  <span>{task.deadline || fmtTime(task.created_at)}</span>
                </span>
              </div>

              <div className={styles.seller}>
                <Avatar name={task.creator_name || '同学'} seed={task.creator_name || '同学'} />
                <span className={styles.sellerInfo}>
                  <b>{task.creator_name || '同学'}</b>
                  <small>发布者 · {fmtTime(task.created_at)}</small>
                </span>
              </div>

              {contact ? (
                <div className={styles.contactBox}>
                  <span>联系方式</span>
                  <b>{contact}</b>
                </div>
              ) : null}

              <p className={styles.sectionLabel}>任务描述</p>
              <p className={styles.desc}>{task.description || '发布者没有填写更多描述'}</p>
              <TaskImageGallery images={task.images} />

              {/* 快递代取类任务：提供单号识别 + 跳转官方 App / H5 查物流入口（合规，不爬取页面） */}
              {(task.kind || '').includes('代取') || (task.title || '').includes('快递') ? (
                <button type="button" className={styles.expressBtn} onClick={() => {
                  if (!auth.isSigned) { auth.openLogin('使用取件与查物流需要先登录哦狐'); return }
                  setExpressOpen(true)
                }}>
                  查快递物流
                </button>
              ) : null}
            </div>
          </article>

          {/* 管理员操作区：学生视角完全不挂载 */}
          {isAdmin ? (
            <section className={styles.adminCard}>
              <div className={styles.adminTitle}>
                <span>🛡</span>管理员操作
              </div>
              <p className={styles.adminHint}>
                删除后学生端不再展示这条任务，发布者预留的联系方式会随记录一并消失，且不可恢复。仅在内容违规时使用。
              </p>
              <div className={styles.adminRow}>
                <button type="button" className={styles.adminDel} onClick={() => setDelOpen(true)} disabled={delBusy}>
                  删除该任务
                </button>
              </div>
            </section>
          ) : null}

          {/* 底部固定主操作栏：访客联系发布者；发布者本人显示橙色下架/重开 */}
          <div className={styles.bottomBar}>
            {isOwner ? (
              <button
                type="button"
                className={styles.ownerBtn}
                onClick={() => void toggleOwner()}
                disabled={ownerBusy || task.status === 'done'}
              >
                {ownerBusy
                  ? '处理中…'
                  : task.status === 'done'
                    ? '任务已完成'
                    : task.status === 'cancelled'
                      ? '重新开放任务'
                      : '下架任务'}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => void showContact()}
                  disabled={!active}
                >
                  {contact
                    ? '已显示联系方式'
                    : task.status === 'doing'
                      ? '任务进行中'
                      : task.status === 'done'
                        ? '任务已完成'
                        : task.status === 'cancelled'
                          ? '任务已关闭'
                          : '查看联系方式'}
                </button>
                <button
                  type="button"
                  className={styles.ghostBtn}
                  onClick={() => void startChat()}
                  disabled={busy || !active}
                >
                  {busy ? '正在打开…' : '发私信'}
                </button>
              </>
            )}
          </div>

          {expressOpen ? <ExpressTrackSheet onClose={() => setExpressOpen(false)} /> : null}
        </>
      ) : null}

      {delOpen && isAdmin && !!uid && task ? (
        <ConfirmSheet
          danger
          title="删除该任务？"
          desc={`「${task?.title || '这条任务'}」将被永久删除且无法恢复，发布者预留的联系方式会一并消失。仅涉及内容违规时再使用。`}
          confirmText="确认删除"
          busy={delBusy}
          onConfirm={removeTask}
          onClose={() => setDelOpen(false)}
        />
      ) : null}
    </div>
  )
}
