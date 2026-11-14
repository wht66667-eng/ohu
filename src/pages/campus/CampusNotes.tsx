import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { DialogLayer } from '../../components/ui/DialogLayer'
import { ComposerKeyboard } from '../../components/ComposerKeyboard'
import { useAuth } from '../../lib/auth'
import { cbAuth } from '../../lib/cb'
import { captureImSession, currentImSession, imSessionUid, subscribeImSession } from '../../lib/im-session'
import { closeCampusNote, listCampusNotes, NOTE_CATEGORIES, publishCampusNote, reportCampusNote, type CampusNote, type CampusNoteCategory } from '../../lib/campus-notes'
import styles from './CampusLifePage.module.css'

function LocalNoteLink() {
  return <Link to="/campus-life?section=journal&compose=journal">写一张本机便签</Link>
}

const STATUS = { open: '展示中', expired: '已过期', resolved: '已解决', withdrawn: '已撤下', hidden: '已隐藏' }

export function CampusNotes({ startComposing = false }: { startComposing?: boolean }) {
  const auth = useAuth()
  const uid = useSyncExternalStore(subscribeImSession, imSessionUid, () => '')
  if (auth.phase === 'booting') return <p className={styles.message} role="status">正在打开便签墙…</p>
  const owner = auth.user?.uid || 'guest'
  return <NoteBoard key={owner + ':' + uid + ':' + startComposing} uid={uid}
    ensureGuest={auth.ensureGuest} startComposing={startComposing} />
}

function NoteBoard({ uid, ensureGuest, startComposing }: {
  uid: string
  ensureGuest: () => Promise<void>
  startComposing: boolean
}) {
  const [access, setAccess] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [notes, setNotes] = useState<CampusNote[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [mine, setMine] = useState(false)
  const [category, setCategory] = useState<CampusNoteCategory>('help')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [compose, setCompose] = useState(startComposing)
  const [readingId, setReadingId] = useState<number | null>(null)
  const reading = notes.find(note => note.id === readingId)
  const field = useRef<HTMLTextAreaElement>(null)
  const requestId = useRef('')
  const action = useRef(false)
  const live = useRef(true)

  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  useEffect(() => {
    const session = captureImSession(uid)
    let current = true
    const valid = () => current && (uid ? currentImSession(session) : !imSessionUid())
    setAccess('loading')
    setError('')
    setNotes([])
    setHasMore(false)
    void (async () => {
      try {
        const { data } = await cbAuth().getSession()
        if (!valid()) return
        if (!data?.session) {
          await ensureGuest()
          if (!(await cbAuth().getSession()).data?.session) throw new Error('便签墙连接失败，请重试。')
        }
        if (!valid()) return
        const page = await listCampusNotes(mine)
        if (!valid()) return
        setNotes(page.rows)
        setHasMore(page.hasMore)
        setAccess('ready')
      } catch (reason) {
        if (valid()) { setAccess('failed'); setError(reason instanceof Error ? reason.message : '便签加载失败。') }
      }
    })()
    return () => { current = false }
  }, [ensureGuest, mine, refresh, uid])

  async function run(operation: (isCurrent: () => boolean) => Promise<void>) {
    if (action.current || access !== 'ready') return
    const session = captureImSession(uid)
    const valid = () => live.current && (uid ? currentImSession(session) : !imSessionUid())
    if (!valid()) return
    action.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try { await operation(valid) }
    catch (reason) { if (valid()) setError(reason instanceof Error ? reason.message : '操作失败，请重试。') }
    finally { action.current = false; if (valid()) setBusy(false) }
  }

  function publish() {
    if (!body.trim()) return
    void run(async valid => {
      // getRandomValues also works on a local network preview served over HTTP.
      if (!requestId.current) {
        const bytes = crypto.getRandomValues(new Uint8Array(16))
        const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
        requestId.current = [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
      }
      await publishCampusNote(category, body, requestId.current)
      if (!valid()) return
      setBody('')
      setCompose(false)
      requestId.current = ''
      setNotice('便签已发布')
      setRefresh(value => value + 1)
    })
  }

  return <section className={styles.board} aria-label="便签墙">
    {access === 'loading' ? <p role="status">正在读取公开便签…</p> : null}
    {access === 'failed' ? <div><p role="alert">{error}</p><button type="button" onClick={() => setRefresh(value => value + 1)}>重试</button> <LocalNoteLink /></div> : null}
    {reading && access === 'ready' ? <DialogLayer full title="便签详情" onClose={() => setReadingId(null)} className={styles.paperDialog}>
      <article className={styles.paperPage}>
        <button type="button" onClick={() => setReadingId(null)}>关闭便签</button>
        <h2>{NOTE_CATEGORIES[reading.category]}</h2>
        <p className={styles.paperText}>{reading.body}</p>
        <small>{STATUS[reading.status]}</small>
      </article>
    </DialogLayer> : null}
    {access === 'ready' ? <>
      <div className={styles.actions}>
        <button type="button" aria-pressed={!mine} disabled={busy} onClick={() => { setMine(false); setReadingId(null); setNotice('') }}>公开便签</button>
        <button type="button" aria-pressed={mine} disabled={busy} onClick={() => { setMine(true); setReadingId(null); setNotice('') }}>我发布的</button>
        <button type="button" aria-expanded={compose} disabled={busy} onClick={() => setCompose(value => !value)}>贴便签</button>
      </div>
      {compose ? <details className={`${styles.draft} folio`} open={compose} onToggle={event => setCompose((event.target as HTMLDetailsElement).open)}><summary>写一张新便签</summary><form onSubmit={event => { event.preventDefault(); publish() }}>
        <label>类型<select disabled={busy} value={category} onChange={event => { setCategory(event.target.value as CampusNoteCategory); requestId.current = '' }}>
          {Object.entries(NOTE_CATEGORIES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select></label>
        <p>发布后，任何人都可查看。</p>
        <label>便签内容<textarea ref={field} disabled={busy} value={body} maxLength={280} rows={3} onChange={event => { setBody(event.target.value); requestId.current = '' }} /></label>
        <ComposerKeyboard field={field} value={body} onChange={value => { setBody(value); requestId.current = '' }} disabled={busy} />
        <div className={styles.actions}><button type="submit" disabled={busy || !body.trim()}>公开发布</button></div>
        </form>
      </details> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {!notes.length ? <p>{mine ? '你还没有发过便签。' : '还没有正在展示的便签。'}</p> : null}
      {notes.map(note => <article className={styles.entry} key={note.id}>
        <strong>{NOTE_CATEGORIES[note.category]}</strong>
        <p className={styles.noteExcerpt}>{note.body}</p>
        <button type="button" className={styles.noteRead} onClick={() => setReadingId(note.id)}>展开便签<span className={styles.noteReadLabel}>：{note.body.slice(0, 24)}</span></button>
        <small>{STATUS[note.status]}{note.status === 'open' ? ' · ' + new Date(note.expires_at).toLocaleDateString('zh-CN') + '到期' : ''}</small>
        {note.status === 'open' ? <div className={styles.actions}>
          {note.mine ? <>
            <button type="button" disabled={busy} onClick={() => void run(async valid => {
              await closeCampusNote(note.id, 'resolved')
              if (valid()) { setNotice('已标记为解决'); setRefresh(value => value + 1) }
            })}>标记已解决</button>
            <button type="button" disabled={busy} onClick={() => void run(async valid => {
              await closeCampusNote(note.id, 'withdrawn')
              if (valid()) { setNotice('便签已撤下'); setRefresh(value => value + 1) }
            })}>撤下</button>
          </> : <button type="button" disabled={busy} onClick={() => void run(async valid => {
            await reportCampusNote(note.id)
            if (valid()) { setNotice('已提交举报，并为你隐藏这条便签'); setNotes(current => current.filter(item => item.id !== note.id)) }
          })}>举报并隐藏</button>}
        </div> : null}
      </article>)}
      {hasMore && notes.length ? <div className={styles.actions}><button type="button" disabled={busy} onClick={() => void run(async valid => {
        const page = await listCampusNotes(mine, notes.at(-1)?.id)
        if (valid()) { setNotes(current => [...current, ...page.rows]); setHasMore(page.hasMore) }
      })}>加载更多</button></div> : null}
    </> : null}
  </section>
}
