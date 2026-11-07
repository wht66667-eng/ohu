import { FoxSheetPose } from '../../components/fox/FoxSheetPose'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { captureImSession, currentImSession, subscribeImSession } from '../../lib/im-session'
import { positiveRecordId } from '../../lib/async-owner'
import { fetchMoments, type Moment } from '../../lib/moments'
import { cloudIdentityUid } from '../../lib/cloud-identity'
import { MomentCard } from './MomentCard'
import { MomentComposer } from './MomentComposer'
import { MomentDetails } from './MomentDetails'
import styles from './MomentsPage.module.css'

export function MomentsPage() {
  const auth = useAuth()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  // A → B → A can be batched into one React commit; the same UID still starts a new session.
  const sessionRevision = useSyncExternalStore(subscribeImSession, () => captureImSession(uid)?.revision ?? -1, () => -1)
  if (!auth.isSigned || !auth.user) return <div className={styles.page}>
    <header className={styles.header}><h1>朋友圈 <FoxSheetPose pose="waving" className={styles.headerFox} /></h1></header>
    <div className={styles.emptyState}><FoxSheetPose pose="waving" className={styles.emptyFox} /><strong>好友的校园日常都在这里</strong><p>登录后查看好友动态、分享校园生活</p>
      <button type="button" onClick={() => auth.openLogin('登录后使用朋友圈')}>学号登录</button></div>
  </div>
  return <MomentsContent key={`${uid}:${sessionRevision}`} uid={uid} />
}

function MomentsContent({ uid }: { uid: string }) {
  const [params, setParams] = useSearchParams()
  const [moments, setMoments] = useState<Moment[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(0)
  const live = useRef(true)
  const selected = positiveRecordId(params.get('moment'))
  const composing = params.get('compose') === '1'
  const changeOverlay = (key: 'moment' | 'compose', value?: string) => {
    const next = new URLSearchParams(params)
    next.delete('moment'); next.delete('compose')
    if (value) next.set(key, value)
    setParams(next, { replace: !value })
  }
  const load = useCallback(async (refresh = false) => {
    const sequence = ++request.current
    const socialUid = cloudIdentityUid() || uid
    const session = captureImSession(socialUid)
    if (!session) { setLoading(false); setRefreshing(false); setError('朋友圈需要先登录哦狐账号'); return }
    if (refresh) setRefreshing(true); else setLoading(true)
    const result = await fetchMoments()
    if (!live.current || sequence !== request.current || !currentImSession(session)) return
    setError(result.error || '')
    if (!result.error) setMoments(result.rows)
    setLoading(false); setRefreshing(false)
  }, [uid])
  useEffect(() => {
    live.current = true
    void load()
    return () => { live.current = false; request.current++ }
  }, [load])
  const remove = (id: number) => { setMoments(previous => previous.filter(row => row.id !== id)); changeOverlay('moment') }
  const like = (id: number, liked: boolean) => setMoments(previous => previous.map(row => row.id === id ? {
    ...row, liked_by_me: liked, likes_count: Math.max(0, (row.likes_count || 0) + (liked ? 1 : -1)),
  } : row))
  return <div className={styles.page}>
    <header className={styles.header}><div><h1>朋友圈 <FoxSheetPose pose="waving" className={styles.headerFox} /></h1><p className={styles.subtitle}>好友近况与校园生活</p></div>
      <div className={styles.headerActions}><button type="button" className={styles.refreshBtn} onClick={() => void load(true)} disabled={refreshing} aria-label="刷新朋友圈">{refreshing ? '刷新中' : '刷新'}</button>
        <button type="button" className={styles.publishBtn} onClick={() => changeOverlay('compose', '1')}>发布动态</button></div>
    </header>
    <main className={styles.main}>
      {error && <div className={styles.errorState} role="alert"><p>朋友圈暂时未能加载</p><p>{error}</p><button type="button" onClick={() => void load(true)} disabled={refreshing}>重新加载</button></div>}
      {loading ? <div className={styles.loadingState}><div className={styles.spinner} /><p>正在加载动态…</p></div>
        : !error && moments.length === 0 ? <div className={styles.emptyState}><FoxSheetPose pose="waving" className={styles.emptyFox} /><strong>还没有可见动态</strong><p className={styles.emptyHint}>发布近况，或添加好友后查看对方的好友动态。</p><button type="button" onClick={() => changeOverlay('compose', '1')}>发布第一条动态</button></div>
        : <div className={styles.momentsList}>{moments.map(moment => <MomentCard key={moment.id} moment={moment} onDelete={remove} onLikeChange={like} onOpen={() => changeOverlay('moment', String(moment.id))} />)}</div>}
    </main>
    {composing && <MomentComposer uid={uid} onClose={() => changeOverlay('compose')} onPublished={() => { changeOverlay('compose'); void load(true) }} />}
    {selected && <MomentDetails key={selected} uid={uid} id={selected} onClose={() => { changeOverlay('moment'); void load(true) }} onDelete={remove} />}
  </div>
}
