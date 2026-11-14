import { useCallback, useEffect, useRef, useState } from 'react'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateViews'
import { useToast } from '../context/ToastContext'
import { cbRdb } from '../lib/cb'
import { NOTE_CATEGORIES, type CampusNoteCategory } from '../lib/campus-notes'
import { captureImSession, currentImSession } from '../lib/im-session'
import styles from './AdminReportsPage.module.css'

type NoteReport = {
  id: number
  school_id: string | null
  category: CampusNoteCategory
  body: string
  status: string
  report_count: number | string
}

const STATUS: Record<string, string> = { open: '待审核', hidden: '已隐藏', resolved: '已解决', withdrawn: '已撤回' }
const PAGE_SIZE = 30

function noteReportRpc(name: 'campus_notes_review' | 'campus_notes_moderate', args: Record<string, number | null>) {
  const client = cbRdb() as unknown as { rpc: (name: string, args: Record<string, number | null>) => PromiseLike<{ data?: unknown; error?: unknown }> }
  return client.rpc(name, args)
}

export function CampusNoteReportList({ uid }: { uid: string }) {
  const toast = useToast()
  const [rows, setRows] = useState<NoteReport[]>([])
  const [before, setBefore] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const request = useRef(0)
  const inFlight = useRef(false)

  const load = useCallback(async (cursor: number | null) => {
    const owner = captureImSession(uid)
    if (!owner || inFlight.current) return
    inFlight.current = true
    const ticket = ++request.current
    const valid = () => ticket === request.current && currentImSession(owner)
    setError('')
    setLoading(true)
    try {
      const response = await noteReportRpc('campus_notes_review', { p_before: cursor })
      if (!valid()) return
      if (response.error || !Array.isArray(response.data)) throw new Error('Invalid review response')
      const all = (response.data as NoteReport[]).map(row => ({ ...row, id: Number(row.id) }))
      if (all.some(row => !Number.isSafeInteger(row.id) || row.id <= 0)) throw new Error('Invalid review cursor')
      const page = all.slice(0, PAGE_SIZE)
      setRows(current => cursor === null ? page : [...current, ...page])
      setBefore(all.length > PAGE_SIZE ? page[page.length - 1].id : null)
    } catch {
      if (valid()) setError('便签举报暂时无法读取，请重试。')
    } finally {
      if (valid()) { inFlight.current = false; setLoading(false) }
    }
  }, [uid])

  const cancel = useCallback(() => { request.current++; inFlight.current = false }, [])
  useEffect(() => {
    let mounted = true
    queueMicrotask(() => { if (mounted) void load(null) })
    return () => { mounted = false; cancel() }
  }, [cancel, load])

  async function hide(id: number) {
    const owner = captureImSession(uid)
    if (!owner || inFlight.current) return
    inFlight.current = true
    const ticket = ++request.current
    const valid = () => ticket === request.current && currentImSession(owner)
    setSaving(true)
    try {
      const response = await noteReportRpc('campus_notes_moderate', { p_id: id })
      if (!valid()) return
      if (response.error) throw new Error('Moderation write failed')
      if (response.data !== true) {
        setSelected(null)
        toast.err('便签已更新或当前账号无权操作，请重读列表。')
        return
      }
      setRows(current => current.map(row => row.id === id ? { ...row, status: 'hidden' } : row))
      setSelected(null)
      toast.ok('便签已隐藏')
    } catch {
      if (valid()) toast.err('隐藏便签失败，请重试。')
    } finally {
      if (valid()) { inFlight.current = false; setSaving(false) }
    }
  }

  return <>
    <p className={styles.lead}>审核被举报的便签。确认隐藏后，便签将从墙上移除，举报记录会保留。</p>
    <button type="button" className={styles.loadMore} disabled={loading || saving} onClick={() => void load(null)}>刷新便签举报</button>
    {loading ? <LoadingState compact title="正在读取便签举报…" /> : null}
    {error ? <ErrorState compact title="便签举报加载失败" hint={error} action={<button type="button" onClick={() => void load(before)}>重试</button>} /> : null}
    {!loading && !error && !rows.length ? <EmptyState compact title="暂无便签举报" hint="有举报时会在这里显示。" /> : null}
    <ul className={styles.list}>
      {rows.map(row => <li key={row.id} className={styles.card}>
        <div className={styles.head}>
          <b>{NOTE_CATEGORIES[row.category] ?? '便签'} · {row.report_count} 次举报</b>
          <span className={styles.pill}>{STATUS[row.status] ?? '状态未知'}</span>
        </div>
        <p className={styles.meta}>#{row.id} · {row.school_id ?? '公开便签'}</p>
        <p className={styles.detail} style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{row.body}</p>
        {row.status === 'open' ? <div className={styles.actions}>
          <button type="button" className={styles.no} disabled={loading || saving || !!error} onClick={() => setSelected(row.id)}>隐藏便签</button>
        </div> : null}
      </li>)}
    </ul>
    {before !== null && !error ? <button type="button" className={styles.loadMore} disabled={loading || saving} onClick={() => void load(before)}>加载更早举报</button> : null}
    {selected !== null ? <ConfirmSheet title="隐藏这张便签？" desc="隐藏后，其他同学将无法在便签墙上看到它。" danger busy={saving} confirmText="确认隐藏" onClose={() => setSelected(null)} onConfirm={() => void hide(selected)} /> : null}
  </>
}
