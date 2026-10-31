import { useEffect, useRef, useState } from 'react'
import { downloadedBankForExam, type WordBankId } from '../../data/words/banks'
import { listExamPacks, type ExamPack } from '../../lib/personal-exam-vocab'
import { getDownloadedExamWords, installDownloadedPack, removeDownloadedPack } from '../../services/words/downloads'
import { useDownloadedWordBanks } from '../../lib/useDownloadedWordBanks'
import styles from './words.module.css'

export function DownloadedWordPacks({ initiallyOpen, onInstalled }: { initiallyOpen: boolean; onInstalled: (bank: WordBankId) => void }) {
  const library = useDownloadedWordBanks()
  const [open, setOpen] = useState(initiallyOpen)
  const [packs, setPacks] = useState<ExamPack[]>([])
  const [attempt, setAttempt] = useState(0)
  const [loadingList, setLoadingList] = useState(false)
  const [listError, setListError] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const operation = useRef<AbortController | null>(null)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; operation.current?.abort() } }, [])
  useEffect(() => {
    if (!open) return
    let active = true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    setLoadingList(true); setListError('')
    void listExamPacks(controller.signal).then(rows => { if (active) setPacks(rows) }).catch(e => { if (active) setListError(controller.signal.aborted ? '词库目录请求超时，可继续背诵已下载词汇。' : e.message) }).finally(() => { clearTimeout(timer); if (active) setLoadingList(false) })
    return () => { active = false; clearTimeout(timer); controller.abort() }
  }, [open, attempt])

  async function download(pack: ExamPack) {
    if (operation.current) return
    const controller = new AbortController(); operation.current = controller
    const timer = setTimeout(() => controller.abort(), 90_000)
    setPending(pack.exam_type); setDownloading(true); setMessage(''); setError('')
    try {
      await installDownloadedPack(pack, controller.signal)
      if (!alive.current) return
      setMessage(`${pack.title}已加入背诵计划，回到上方学习卡即可开始。`)
      onInstalled(downloadedBankForExam(pack.exam_type))
    } catch (e) {
      if (alive.current) setError(controller.signal.aborted ? '下载已取消或超时，现有词库未受影响。' : e instanceof Error ? e.message : '下载失败，请重试。')
    } finally { clearTimeout(timer); operation.current = null; if (alive.current) { setPending(null); setDownloading(false) } }
  }

  async function remove(pack: ExamPack) {
    if (operation.current) return
    operation.current = new AbortController()
    setPending(pack.exam_type); setMessage(''); setError('')
    try {
      await removeDownloadedPack(pack.exam_type)
      if (alive.current) setMessage('已移除下载词库，内置单词、自定义单词和学习进度仍保留。')
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '移除失败，请重试。') }
    finally { operation.current = null; if (alive.current) setPending(null) }
  }

  const installed = getDownloadedExamWords()
  return <section className={styles.downloadSection} aria-label="词库下载">
    <div className={styles.sectionHead}><h2>扩充词库<small>加入现有背诵计划</small></h2><button type="button" className={styles.linkBtn} aria-expanded={open} aria-controls="word-download-list" onClick={() => setOpen(value => !value)}>{open ? '收起' : '下载词库'}</button></div>
    {open && <div id="word-download-list" className={styles.downloadList}>
      <p className={styles.formHint}>按需下载，下载后可离线背诵。重复单词合并，已有学习进度保留。</p>
      {loadingList && !listError && <p role="status">正在加载可下载词库…</p>}
      {listError && <div role="status"><p>{listError}</p><button type="button" className={styles.linkBtn} onClick={() => setAttempt(n => n + 1)}>重试列表</button></div>}
      {library.error && <div role="alert"><p>{library.error}</p><button type="button" className={styles.linkBtn} onClick={library.retry}>重试设备存储</button></div>}
      {packs.map(pack => {
        const exists = installed.some(word => word.exam_type === pack.exam_type)
        return <div key={pack.exam_type} className={styles.downloadRow}><div><b>{pack.title}</b><small>{pack.count.toLocaleString()} 词 · {(pack.bytes / 1024 / 1024).toFixed(1)} MB{exists ? ' · 已加入' : ''}</small></div><button type="button" className={styles.linkBtn} disabled={!library.ready || !!pending} onClick={() => { if (exists) void remove(pack); else void download(pack) }}>{pending === pack.exam_type ? '处理中…' : exists ? '移除下载' : '下载并加入'}</button></div>
      })}
      {pending && downloading && <button type="button" className={styles.linkBtn} onClick={() => operation.current?.abort()}>取消下载</button>}
      {message && <p role="status" className={styles.downloadMessage}>{message}</p>}
      {error && <p role="alert" className={styles.downloadMessage}>{error}</p>}
    </div>}
  </section>
}
