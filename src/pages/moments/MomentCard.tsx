import { useEffect, useRef, useState } from 'react'
import { type Moment, fmtMomentsTime, likeMoment, unlikeMoment, deleteMoment } from '../../lib/moments'
import { ImageGrid } from './ImageGrid'
import { resolveAvatar } from '../../data/images'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../context/ToastContext'
import { captureImSession, currentImSession } from '../../lib/im-session'
import { DialogLayer } from '../../components/ui/DialogLayer'
import styles from './MomentsPage.module.css'

interface MomentCardProps {
  moment: Moment
  onDelete?: (id: number) => void
  onLikeChange?: (id: number, liked: boolean) => void
  onOpen?: () => void
}

export function MomentCard({ moment, onDelete, onLikeChange, onOpen }: MomentCardProps) {
  const auth = useAuth()
  const toast = useToast()
  const [isLiked, setIsLiked] = useState(moment.liked_by_me || false)
  const [likesCount, setLikesCount] = useState(moment.likes_count || 0)
  const [showActions, setShowActions] = useState(false)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const lock = useRef(false), live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  useEffect(() => { setIsLiked(moment.liked_by_me || false); setLikesCount(moment.likes_count || 0) }, [moment.id, moment.liked_by_me, moment.likes_count])

  const isMine = auth.isSigned && auth.user?.uid === moment.creator_uid

  const handleLike = async () => {
    if (lock.current) return
    if (!auth.isSigned) {
      auth.openLogin('登录后点赞朋友圈动态')
      return
    }

    const session = captureImSession(auth.user?.uid || '')
    if (!session) return
    lock.current = true; setBusy(true)
    const newLiked = !isLiked
    setIsLiked(newLiked)
    setLikesCount(prev => newLiked ? prev + 1 : prev - 1)

    try {
      const res = newLiked ? await likeMoment(moment.id) : await unlikeMoment(moment.id)
      if (!live.current || !currentImSession(session)) return
      if (res.error) {
        toast(res.error)
        setIsLiked(!newLiked)
        setLikesCount(prev => newLiked ? prev - 1 : prev + 1)
      } else {
        onLikeChange?.(moment.id, newLiked)
      }
    } catch {
      if (!live.current || !currentImSession(session)) return
      toast('操作失败')
      setIsLiked(!newLiked)
      setLikesCount(prev => newLiked ? prev - 1 : prev + 1)
    } finally { if (live.current && currentImSession(session)) { lock.current = false; setBusy(false) } }
  }

  const handleDelete = async () => {
    if (lock.current || !isMine) return
    const session = captureImSession(auth.user?.uid || '')
    if (!session) return
    lock.current = true; setBusy(true)

    try {
      const res = await deleteMoment(moment.id)
      if (!live.current || !currentImSession(session)) return
      if (res.error) {
        toast(res.error)
      } else {
        toast('已删除')
        onDelete?.(moment.id)
      }
    } catch {
      if (!live.current || !currentImSession(session)) return
      toast('删除失败')
    } finally { if (live.current && currentImSession(session)) { lock.current = false; setBusy(false); setConfirmDelete(false) } }
  }

  return (
    <div className={styles.momentCard}>
      <div className={styles.momentHeader}>
        <img
          src={resolveAvatar(moment.creator_avatar || '', moment.creator_uid)}
          alt=""
          className={styles.avatar}
        />
        <div className={styles.userInfo}>
          <div className={styles.userName}>{moment.creator_name || '同学'}</div>
          <div className={styles.timeText}>{fmtMomentsTime(moment.created_at)}</div>
        </div>
        {isMine && (
          <button
            type="button"
            className={styles.moreBtn}
            onClick={() => setShowActions(!showActions)}
            aria-label="更多操作"
          >
            ⋯
          </button>
        )}
      </div>

      {showActions && isMine && (
        <div className={styles.actionsMenu}>
          <button type="button" onClick={() => { setShowActions(false); setConfirmDelete(true) }}>
            删除
          </button>
        </div>
      )}

      {onOpen ? <button type="button" className={styles.momentBodyButton} onClick={onOpen} aria-label="查看动态详情"><span className={styles.momentBody}>{moment.body}</span></button> : <div className={styles.momentBody}>{moment.body}</div>}

      {moment.media_urls && moment.media_urls.length > 0 && (
        moment.media_type === 'video' ? <video className={styles.momentVideo} controls preload="metadata" src={moment.media_urls[0]} /> : <ImageGrid images={moment.media_urls} onImageClick={setPreview} />
      )}

      <div className={styles.momentFooter}>
        <button
          type="button"
          className={`${styles.likeBtn} ${isLiked ? styles.liked : ''}`}
          onClick={handleLike}
          disabled={busy}
          aria-label={isLiked ? '取消点赞' : '点赞'}
          aria-pressed={isLiked}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill={isLiked ? 'var(--danger)' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          {likesCount > 0 && <span>{likesCount}</span>}
        </button>
        <button type="button" className={styles.commentBtn} onClick={onOpen} aria-label="查看或发表评论">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {(moment.comments_count || 0) > 0 && <span>{moment.comments_count}</span>}
        </button>
      </div>
      {preview !== null && moment.media_urls?.[preview] && <DialogLayer title="查看动态图片" className={styles.imagePreview} onClose={() => setPreview(null)}><div className={styles.dialogHead}><span>{preview + 1} / {moment.media_urls.length}</span><button type="button" onClick={() => setPreview(null)}>关闭图片</button></div><img src={moment.media_urls[preview]} alt={`动态图片 ${preview + 1}`} /><div className={styles.previewControls}><button type="button" disabled={preview === 0} onClick={() => setPreview(previous => Math.max(0, (previous || 0) - 1))}>上一张</button><button type="button" disabled={preview >= moment.media_urls.length - 1} onClick={() => setPreview(previous => Math.min(moment.media_urls!.length - 1, (previous || 0) + 1))}>下一张</button></div></DialogLayer>}
      {confirmDelete && <DialogLayer title="删除朋友圈动态" className={styles.dialogPanel} onClose={() => setConfirmDelete(false)} allowClose={!busy}><h2>删除这条动态？</h2><p>删除后，动态及其评论将无法恢复。</p><div className={styles.previewControls}><button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>取消</button><button type="button" disabled={busy} onClick={() => void handleDelete()}>{busy ? '正在删除…' : '确认删除'}</button></div></DialogLayer>}
    </div>
  )
}
