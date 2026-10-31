import { useCallback, useEffect, useRef, useState } from 'react'
import { DialogLayer } from '../../components/ui/DialogLayer'
import { captureImSession, currentImSession } from '../../lib/im-session'
import { commentMoment, fetchMoment, fetchMomentComments, fmtMomentsTime, type Moment, type MomentComment } from '../../lib/moments'
import { MomentCard } from './MomentCard'
import styles from './MomentsPage.module.css'

export function MomentDetails({ uid, id, onClose, onDelete }: { uid: string; id: number; onClose: () => void; onDelete: (id: number) => void }) {
  const [moment, setMoment] = useState<Moment | null>(null)
  const [comments, setComments] = useState<MomentComment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [commentsError, setCommentsError] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const live = useRef(true), request = useRef(0), lock = useRef(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const load = useCallback(async () => {
    const sequence = ++request.current, session = captureImSession(uid)
    if (!session) return
    setLoading(true); setError(''); setCommentsError('')
    const result = await fetchMoment(id)
    if (!live.current || sequence !== request.current || !currentImSession(session)) return
    if (result.error || !result.rows.length) {
      setMoment(null); setComments([]); setError(result.error || '动态不存在、已删除，或当前账号没有查看权限'); setLoading(false); return
    }
    setMoment(result.rows[0])
    const reply = await fetchMomentComments(id)
    if (!live.current || sequence !== request.current || !currentImSession(session)) return
    setComments(reply.rows); setCommentsError(reply.error || ''); setLoading(false)
  }, [uid, id])
  useEffect(() => { live.current = true; void load(); return () => { live.current = false; request.current++ } }, [load])
  const send = async () => {
    if (lock.current || !body.trim() || !moment) return
    const session = captureImSession(uid)
    if (!session) return
    lock.current = true; setSending(true); setCommentsError('')
    try {
      const result = await commentMoment(id, body)
      if (!live.current || !currentImSession(session)) return
      if (result.error) setCommentsError(result.error)
      else { setBody(''); await load() }
    } finally { if (live.current && currentImSession(session)) { lock.current = false; setSending(false) } }
  }
  return <DialogLayer title="朋友圈动态详情" className={styles.dialogPanel} onClose={onClose} allowClose={!sending}>
    <div className={styles.dialogHead}><h2>动态详情</h2><button type="button" disabled={sending} onClick={onClose}>关闭</button></div>
    {loading && <p role="status">正在加载动态与评论…</p>}
    {error && <div className={styles.errorState} role="alert"><p>{error}</p><button type="button" onClick={() => void load()}>重新加载</button></div>}
    {moment && <><MomentCard moment={moment} onDelete={onDelete} onOpen={() => input.current?.focus()} />
      <section className={styles.commentsSection} aria-label="动态评论"><h3>评论</h3>
        {commentsError && <div className={styles.formError} role="alert">{commentsError}<button type="button" onClick={() => void load()}>重试</button></div>}
        {!loading && !commentsError && !comments.length && <p className={styles.emptyHint}>还没有评论，和同学聊聊吧。</p>}
        {comments.map(comment => <div key={comment.id} className={styles.commentRow}><div><b>{comment.commenter_name || '同学'}</b><time>{fmtMomentsTime(comment.created_at)}</time></div><p>{comment.body}</p></div>)}
      </section>
      <form className={styles.commentForm} data-input-actions="" onSubmit={event => { event.preventDefault(); void send() }}>
        <label className={styles.field}>写评论<textarea ref={input} aria-label="评论内容" rows={2} maxLength={1000} value={body} disabled={sending} onChange={event => setBody(event.target.value)} /></label>
        <button type="submit" className={styles.submitBtn} disabled={sending || !body.trim()}>{sending ? '正在发送…' : '发送评论'}</button>
      </form>
    </>}
  </DialogLayer>
}
