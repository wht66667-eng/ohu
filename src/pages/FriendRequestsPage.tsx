import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { fetchFriendRequests, acceptFriendRequest, rejectFriendRequest, type FriendRequest } from '../lib/friends'
import { AsyncOwner, type OwnerTicket } from '../lib/async-owner'
import { captureImSession, currentImSession, subscribeImSession } from '../lib/im-session'
import { PageHeader } from '../components/PageHeader'
import { Avatar } from '../components/Thumbs'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateViews'
import styles from './FriendRequestsPage.module.css'

type Work = { page: OwnerTicket; session: OwnerTicket }

export function FriendRequestsPage() {
  const auth = useAuth()
  return <FriendRequestsContent key={auth.isSigned ? auth.user?.uid || 'guest' : 'guest'} />
}

function FriendRequestsContent() {
  const nav = useNavigate(), auth = useAuth()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const scope = useRef(new AsyncOwner(uid))
  scope.current.select(uid)
  const operation = useRef<Work | null>(null)
  const [revision, setRevision] = useState(0)
  const [requests, setRequests] = useState<FriendRequest[]>([])
  const [loading, setLoading] = useState(!!uid)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [processing, setProcessing] = useState<number | null>(null)
  const capture = (lane: string): Work | null => {
    const session = captureImSession(uid)
    return session ? { page: scope.current.begin(lane), session } : null
  }
  const current = (work: Work) => scope.current.current(work.page) && currentImSession(work.session)
  useEffect(() => {
    const off = subscribeImSession(() => {
      scope.current.invalidate(); operation.current = null
      setRequests([]); setProcessing(null); setError(''); setActionError(''); setFeedback(''); setRevision(value => value + 1)
    })
    return () => { off(); scope.current.invalidate() }
  }, [])
  const loadRequests = useCallback(async () => {
    const work = capture('load')
    if (!work) { setLoading(false); return }
    setLoading(true)
    try {
      const result = await fetchFriendRequests()
      if (!current(work)) return
      setError(result.error || '')
      if (!result.error) setRequests(result.rows)
    } catch {
      if (current(work)) setError('好友申请暂时无法加载，请重试。')
    } finally {
      if (current(work)) setLoading(false)
    }
  }, [uid])
  useEffect(() => { void loadRequests(); return () => scope.current.invalidate() }, [loadRequests, revision])

  async function processRequest(requestId: number, accept: boolean) {
    if (operation.current) return
    const work = capture('process')
    if (!work) return
    operation.current = work; setProcessing(requestId); setActionError(''); setFeedback('')
    try {
      const result = await (accept ? acceptFriendRequest(requestId) : rejectFriendRequest(requestId))
      if (!current(work)) return
      if (result.error) setActionError(result.error)
      else { setRequests(previous => previous.filter(request => request.id !== requestId)); setFeedback(accept ? '已添加为好友' : '已拒绝好友申请') }
    } catch {
      if (current(work)) setActionError('申请未能处理，请重试。')
    } finally {
      if (operation.current === work) operation.current = null
      if (current(work)) setProcessing(null)
    }
  }

  return <div className={styles.page}>
    <PageHeader title="新的朋友" onBack={() => nav('/contacts')} />
    {!uid ? <EmptyState title="登录后处理好友申请" hint="这里只显示发给当前账号的申请。" action={<button type="button" className={styles.primary} onClick={() => void auth.ensureSignedIn('处理好友申请需要登录')}>去登录</button>} /> : <main className={styles.main}>
      <p className={styles.intro}>发给你的好友申请，接受后即可从通讯录发起私信。</p>
      {actionError ? <p className={styles.error} role="alert">{actionError}</p> : feedback ? <p className={styles.feedback} role="status">{feedback}</p> : null}
      {loading ? <LoadingState title="正在加载申请…" hint="" /> : error ? <ErrorState title="好友申请加载失败" hint={error} action={<button type="button" className={styles.primary} onClick={() => void loadRequests()}>重试</button>} /> : !requests.length ? <EmptyState title="暂无待处理申请" hint="对方可通过你的好友码添加你。" action={<button type="button" className={styles.secondary} onClick={() => nav('/contacts/add')}>查看我的好友码</button>} /> : <ul className={styles.list}>{requests.map(request => <li key={request.id} className={styles.request} aria-busy={processing === request.id}>
        <div className={styles.person}><Avatar name={request.from_name || '同学'} src={request.from_avatar} seed={request.from_uid} /><div className={styles.info}><strong>{request.from_name || '同学'}</strong><span>好友码 {request.from_uid}</span></div></div>
        <p className={styles.message}>{request.message || '希望添加你为好友'}</p>
        <div className={styles.actions}><button type="button" className={styles.secondary} disabled={processing !== null} onClick={() => void processRequest(request.id, false)}>拒绝</button><button type="button" className={styles.primary} disabled={processing !== null} onClick={() => void processRequest(request.id, true)}>{processing === request.id ? '处理中…' : '接受'}</button></div>
      </li>)}</ul>}
    </main>}
  </div>
}
