import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useToast } from '../context/ToastContext'
import { sendFriendRequest } from '../lib/friends'
import { FriendScanner, MyFriendQr } from '../components/FriendQr'
import { AsyncOwner, type OwnerTicket } from '../lib/async-owner'
import { captureImSession, currentImSession, subscribeImSession } from '../lib/im-session'
import { PageHeader } from '../components/PageHeader'

import { EmptyState } from '../components/ui/StateViews'
import styles from './AddFriendPage.module.css'

type Work = { page: OwnerTicket; session: OwnerTicket }

export function AddFriendPage() {
  const auth = useAuth()
  return <AddFriendContent key={auth.isSigned ? auth.user?.uid || 'guest' : 'guest'} />
}

function AddFriendContent() {
  const nav = useNavigate(), auth = useAuth(), toast = useToast()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const scope = useRef(new AsyncOwner(uid))
  scope.current.select(uid)
  const operation = useRef<Work | null>(null)
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const capture = (lane: string): Work | null => {
    const session = captureImSession(uid)
    return session ? { page: scope.current.begin(lane), session } : null
  }
  const current = (work: Work) => scope.current.current(work.page) && currentImSession(work.session)
  useEffect(() => {
    const off = subscribeImSession(() => {
      scope.current.invalidate(); operation.current = null
      setCode(''); setMessage(''); setBusy(''); setError('')
    })
    return () => { off(); scope.current.invalidate() }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (operation.current) return
    const target = code.trim()
    if (!target) { setError('请粘贴对方的好友码'); return }
    if (target === uid) { setError('不能添加自己为好友'); return }
    const work = capture('send')
    if (!work) { setError('登录状态正在同步，请稍后重试。'); return }
    operation.current = work; setBusy('send'); setError('')
    try {
      const result = await sendFriendRequest(target, message.trim(), {
        motto: auth.user?.profileMotto || '',
        intro: auth.user?.profileIntro || '',
      })
      if (!current(work)) return
      if (result.error) setError(result.error)
      else { toast.ok(result.notice || '好友申请已发送'); nav('/contacts') }
    } catch {
      if (current(work)) setError('申请未能发送，请保留好友码后重试。')
    } finally {
      if (operation.current === work) operation.current = null
      if (current(work)) setBusy('')
    }
  }

  return <div className={styles.page}>
    <PageHeader title="添加好友" onBack={() => nav('/contacts')} />
    {!uid ? <EmptyState title="登录后交换好友码" hint="每个账号都有自己的好友码。" action={<button type="button" className={styles.primary} onClick={() => void auth.ensureSignedIn('添加好友需要登录')}>去登录</button>} /> : <main className={styles.main}>
      <section className={styles.card} aria-labelledby="my-friend-code-title">
        <h2 id="my-friend-code-title">我的好友二维码</h2><p>请同学在哦狐的「添加好友」里扫一扫。</p>
        <MyFriendQr uid={uid} />
      </section>
      <form className={styles.card} onSubmit={event => void submit(event)} aria-busy={busy === 'send'}>
        <h2>添加对方</h2>
        <fieldset disabled={!!busy} style={{border:0,padding:0,margin:0}}><FriendScanner uid={uid} onTarget={id=>{setCode(id); setError('')}} /></fieldset>
        <p className={styles.profilePrivacy}>你设置的个人名言和介绍会随申请展示给对方；如果还没设置，可以到“我的 → 编辑资料”补充。</p>
        <label className={styles.field} htmlFor="friend-message">验证消息 <span>选填</span><textarea id="friend-message" name="friend-message" rows={3} maxLength={200} placeholder="补充说明你是谁，方便对方认出你" value={message} disabled={busy === 'send'} onChange={event => setMessage(event.target.value)} /></label>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <button type="submit" className={styles.primary} disabled={!!busy || !code}>{busy === 'send' ? '正在发送…' : '发送好友申请'}</button>
      </form>
    </main>}
  </div>
}
