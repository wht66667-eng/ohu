import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { fetchFriends, fetchFriendRequests, type Friend, type FriendRequest } from '../lib/friends'
import { openDmThread } from '../lib/dm-entry'
import { AsyncOwner, type OwnerTicket } from '../lib/async-owner'
import { captureImSession, currentImSession, subscribeImSession } from '../lib/im-session'
import { PageHeader } from '../components/PageHeader'
import { CampusIcon } from '../components/CampusIcon'
import { Avatar } from '../components/Thumbs'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateViews'
import styles from './ContactsPage.module.css'

type Work = { page: OwnerTicket; session: OwnerTicket }

export function ContactsPage() {
  const auth = useAuth()
  return <ContactsContent key={auth.isSigned ? auth.user?.uid || 'guest' : 'guest'} />
}

function ContactsContent() {
  const nav = useNavigate(), auth = useAuth()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const scope = useRef(new AsyncOwner(uid))
  scope.current.select(uid)
  const opening = useRef<Work | null>(null)
  const [revision, setRevision] = useState(0)
  const [friends, setFriends] = useState<Friend[]>([])
  const [requests, setRequests] = useState<FriendRequest[]>([])
  const [loading, setLoading] = useState(!!uid)
  const [friendError, setFriendError] = useState('')
  const [requestError, setRequestError] = useState('')
  const [openError, setOpenError] = useState('')
  const [openingUid, setOpeningUid] = useState('')
  const capture = (lane: string): Work | null => {
    const session = captureImSession(uid)
    return session ? { page: scope.current.begin(lane), session } : null
  }
  const current = (work: Work) => scope.current.current(work.page) && currentImSession(work.session)

  useEffect(() => {
    const off = subscribeImSession(() => {
      scope.current.invalidate(); opening.current = null
      setFriends([]); setRequests([]); setOpeningUid(''); setOpenError(''); setFriendError(''); setRequestError('')
      setRevision(value => value + 1)
    })
    return () => { off(); scope.current.invalidate() }
  }, [])

  const loadData = useCallback(async () => {
    const work = capture('load')
    if (!work) { setLoading(false); return }
    setLoading(true)
    try {
      const [friendResult, requestResult] = await Promise.all([fetchFriends(), fetchFriendRequests()])
      if (!current(work)) return
      setFriendError(friendResult.error || '')
      setRequestError(requestResult.error || '')
      if (!friendResult.error) setFriends(friendResult.rows)
      if (!requestResult.error) setRequests(requestResult.rows)
    } catch {
      if (current(work)) { setFriendError('好友暂时无法加载，请重试。'); setRequestError('申请暂时无法加载，请重试。') }
    } finally {
      if (current(work)) setLoading(false)
    }
  }, [uid])
  useEffect(() => { void loadData(); return () => scope.current.invalidate() }, [loadData, revision])

  async function openFriend(friend: Friend) {
    if (opening.current) return
    const work = capture('open')
    if (!work) return
    opening.current = work; setOpeningUid(friend.friend_uid); setOpenError('')
    try {
      const result = await openDmThread({ peerUid: friend.friend_uid, peerName: friend.friend_name || '同学' })
      if (!current(work)) return
      if (result.error) setOpenError(result.error)
      else nav(result.path)
    } catch {
      if (current(work)) setOpenError('暂时无法打开私信，请重试。')
    } finally {
      if (opening.current === work) opening.current = null
      if (current(work)) setOpeningUid('')
    }
  }

  return <div className={styles.page}>
    <PageHeader title="通讯录" onBack={() => nav('/messages')} right={uid ? <button type="button" className={styles.headerAction} onClick={() => nav('/contacts/add')}><CampusIcon name="plus" size={19} />添加</button> : null} />
    {!uid ? <EmptyState title="登录后查看好友" hint="通讯录与当前账号关联。" action={<button type="button" className={styles.primary} onClick={() => void auth.ensureSignedIn('查看好友需要登录')}>去登录</button>} /> : <main className={styles.main}>
      <button type="button" className={styles.requestEntry} onClick={() => nav('/contacts/requests')}>
        <span className={styles.entryIcon}><CampusIcon name="partner" /></span>
        <span className={styles.info}><strong>新的朋友</strong><span>{loading ? '正在同步申请…' : requestError ? '申请加载失败，可点开重试' : requests.length ? requests.length + ' 条待处理申请' : '暂无待处理申请'}</span></span>
        {!loading && !requestError && requests.length > 0 ? <span className={styles.badge}>{requests.length}</span> : null}<span aria-hidden="true">›</span>
      </button>
      {requestError ? <div className={styles.inlineError} role="alert"><span>{requestError}</span><button type="button" onClick={() => void loadData()} disabled={loading || !!openingUid}>重试申请</button></div> : null}
      <div className={styles.sectionHeading}><h2>我的好友</h2>{!loading && !friendError ? <span>{friends.length} 位</span> : null}</div>
      {openError ? <p className={styles.inlineError} role="alert">{openError} 请再次点击好友重试。</p> : null}
      {loading ? <LoadingState title="正在加载好友…" hint="" /> : friendError ? <ErrorState title="好友加载失败" hint={friendError} action={<button type="button" className={styles.primary} onClick={() => void loadData()}>重试</button>} /> : !friends.length ? <EmptyState title="还没有好友" hint="交换好友码，添加你认识的同学。" action={<button type="button" className={styles.primary} onClick={() => nav('/contacts/add')}>添加好友</button>} /> : <ul className={styles.list}>{friends.map(friend => <li key={friend.friend_uid}>
        <button type="button" className={styles.friend} disabled={!!openingUid} aria-busy={openingUid === friend.friend_uid} onClick={() => void openFriend(friend)}>
          <Avatar name={friend.friend_name || '同学'} src={friend.friend_avatar} seed={friend.friend_uid} />
          <span className={styles.info}><strong>{friend.remark || friend.friend_name || '同学'}</strong><span>{openingUid === friend.friend_uid ? '正在打开私信…' : friend.remark && friend.friend_name ? friend.friend_name : '好友码 ' + friend.friend_uid}</span></span>
          <CampusIcon name="chat" size={20} />
        </button>
      </li>)}</ul>}
    </main>}
  </div>
}
