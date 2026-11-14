import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ComposerKeyboard } from '../../components/ComposerKeyboard'
import { DialogLayer } from '../../components/ui/DialogLayer'
import { PaperPenBox, PaperStrokesView } from '../../components/PaperPenBox'
import { deletePaperLayer, deletePaperLayers, gcPaperLayers, loadPaperLayer, paperSurfaceColor, renderPaperStrokes, savePaperLayer } from '../../lib/paper-layer'
import { emptyPaperLayer, type PaperLayerState, type PaperStroke } from '../../lib/paper-layer-helpers'
import { deleteJournal, enableJournalVault, updateJournalVault, journalVaultExists, unlockJournal, journalId, listJournal, MAX_JOURNAL_PHOTOS, saveJournal, sortJournal, type JournalEntry, type JournalKind, type JournalPhoto } from '../../lib/campus-journal'
import { localDateKey } from '../../lib/chat-fortune'
import { captureMomentPhoto, pickMomentGallery, takeRestoredCampusPhoto } from '../../lib/moment-gallery'
import { normalizeMomentPhoto } from '../../lib/moment-photo'
import { listLocalTodos } from '../../lib/local-todos'
import { getScheduleRowsForDate } from '../../lib/schedule-cache'
import { currentFocusRepository } from '../../lib/focus-store'
import { captureQbankSession } from '../../lib/qbank'
import { readLocalCampusCheckins } from '../../lib/campus-map-local'
import styles from './CampusLifePage.module.css'

const PhotoEditor = lazy(() => import('../moments/MomentPhotoEditor').then(module => ({ default: module.MomentPhotoEditor })))
const KIND_LABEL = { journal: '随手记', diary: '日记' }

function newEntry(owner: string, kind: JournalKind): JournalEntry {
  return { owner, id: journalId(), kind, createdAt: Date.now(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, day: localDateKey(), title: '', body: '', mood: '', photos: [], pinned: false, updatedAt: Date.now() }
}

function JournalPhotoImage({ file, alt, large = false }: { file: File; alt: string; large?: boolean }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    const url = URL.createObjectURL(file)
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  return src ? <img className={large ? styles.photo : styles.journalThumb} src={src} alt={alt} loading={large ? 'eager' : 'lazy'} /> : null
}

function photoData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function CampusJournal({ owner, compose }: { owner: string; compose: string | null }) {
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [vault, setVault] = useState(false)
  const [unlocked, setUnlocked] = useState(false)
  const [passwordDialog, setPasswordDialog] = useState<'enable' | 'unlock' | 'change' | 'disable' | null>(null)
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
    const [paperMaterial, setPaperMaterial] = useState<'default' | 'kraft' | 'sketch'>(() => { try { return (localStorage.getItem('ohu.paper-material') as 'default' | 'kraft' | 'sketch') || 'default' } catch { return 'default' } })
const [draftStatus, setDraftStatus] = useState('')
  const historyEpoch = useRef(0)
  const writes = useRef<Promise<unknown>>(Promise.resolve())
  const draftRef = useRef<JournalEntry | null>(null)
  const lastQueued = useRef<JournalEntry | null>(null)
  const completing = useRef<string | null>(null)
  const initialDraft = useRef<JournalEntry | null>(null)
  const [reading, setReading] = useState<string | null>(null)
  const [direction, setDirection] = useState(1)
  const [draft, setDraft] = useState<JournalEntry | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState<'all' | JournalKind>('all')
  const [query, setQuery] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [editing, setEditing] = useState<JournalPhoto | null>(null)
  const [preview, setPreview] = useState<{ photos: JournalPhoto[]; index: number } | null>(null)
  const [remove, setRemove] = useState<JournalEntry | null>(null)
  const [discard, setDiscard] = useState(false)
  const [references, setReferences] = useState<string[] | null>(null)
  // 彩笔附页层（ohu-paper-layers）：宿主页持有笔迹与撤销/重做栈，PaperPenBox 负责交互。
  const [layer, setLayer] = useState<PaperLayerState>(emptyPaperLayer)
  const layerRef = useRef(layer)
  const paperHost = useRef<HTMLDivElement | null>(null)
  const layerDirty = useRef(false)
  const layerAspect = useRef(0.75)
  // 纸页=日记写作视图；笔迹层是明文附页，日记锁启用时日记不开放彩笔（防加密内容旁路）。
  const paper = draft?.kind === 'diary'
  const penReady = paper && !vault
  const swipeStart = useRef<{ x: number; y: number } | null>(null)
  const journalText = useRef<HTMLTextAreaElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const active = useRef(true)
  const lock = useRef(false)

  useEffect(() => {
    active.current = true
    let current = true
    setReading(null)
    setLoading(true)
    // 切号隔离：笔迹附页按 [owner, entryId] 存取，换账号即清空内存层，不读他号数据。
    layerDirty.current = false
    setLayer(emptyPaperLayer())
    setPageStrokes([])
    void Promise.all([journalVaultExists(owner), listJournal(owner)]).then(([enabled, rows]) => {
      if (current) { setVault(enabled); setEntries(rows) }
      // 挂载时回收孤儿附页（此时尚无打开的草稿，笔迹层只属于既有记录与草稿影子）
      void gcPaperLayers(owner, rows.flatMap(row => row.draftOf ? [row.draftOf, row.id] : [row.id])).then(() => undefined, () => undefined)
    }, () => { if (current) setError('无法读取本机手账。') })
      .finally(() => { if (current) setLoading(false) })
    return () => { active.current = false; current = false }
  }, [owner])

  useEffect(() => {
    if (compose === 'camera' || compose === 'journal' || compose === 'diary' || compose === 'restored') {
      setDraft(previous => previous ?? newEntry(owner, compose === 'diary' ? 'diary' : 'journal'))
    }
  }, [compose, owner])

  useEffect(() => {
    if (compose !== 'restored') return
    const file = takeRestoredCampusPhoto(owner)
    if (!file) return
    let current = true
    void normalizeMomentPhoto(file).then(photo => {
      if (!current) return
      const restored = { id: journalId(), file: photo }
      setDraft(previous => {
        const entry = previous ?? newEntry(owner, 'journal')
        return entry.photos.length < MAX_JOURNAL_PHOTOS ? { ...entry, photos: [...entry.photos, restored] } : entry
      })
    }, () => { if (current) setError('无法恢复刚刚拍摄的照片，请重试。') })
    return () => { current = false }
  }, [compose, owner])

  function queueWrite<T>(task: () => Promise<T>) {
    const next = writes.current.then(task)
    writes.current = next.catch(() => {})
    return next
  }

  function measurePaperAspect() {
    const rect = paperHost.current?.getBoundingClientRect()
    if (rect && rect.width > 4 && rect.height > 4) layerAspect.current = rect.width / rect.height
  }

  function savePaperLayerNow(entryId: string, strokes = layerRef.current.strokes) {
    if (!strokes.length) return
    measurePaperAspect()
    void queueWrite(() => savePaperLayer(owner, entryId, strokes, layerAspect.current)).then(() => undefined, () => undefined)
  }

  /** 关闭/完成纸页时立即落盘笔迹，不等防抖。 */
  function flushPaperLayer() {
    const entryId = draftRef.current?.id
    if (!entryId || !penReady || !layerRef.current.strokes.length) return
    layerDirty.current = false
    savePaperLayerNow(entryId)
  }

  function commitLayer(next: PaperLayerState) {
    layerDirty.current = true
    setLayer(next)
  }

  function storeDraft(entry: JournalEntry | null) {
    if (entry?.kind !== 'diary' || completing.current === entry.id || entry === initialDraft.current || entry === lastQueued.current ||
        !(entry.body.trim() || entry.title.trim() || entry.mood || entry.photos.length)) return
    lastQueued.current = entry
    setDraftStatus('正在保存草稿…')
    const epoch = historyEpoch.current
    const shadow = { ...entry, id: 'draft-' + entry.id, draftOf: entry.id, updatedAt: Date.now() }
    void queueWrite(() => saveJournal(shadow)).then(() => {
      if (active.current && draftRef.current === entry && historyEpoch.current === epoch) setDraftStatus('草稿已保存')
    }, () => {
      if (lastQueued.current === entry) lastQueued.current = null
      if (active.current && draftRef.current === entry && historyEpoch.current === epoch) setDraftStatus('草稿保存失败，请重试。')
    })
  }

  draftRef.current = draft
  layerRef.current = layer

  useEffect(() => {
    const timer = window.setTimeout(() => storeDraft(draft), 450)
    return () => window.clearTimeout(timer)
  }, [draft])

  // 彩笔附页：按 entryId 从本机库还原笔迹（重开一致；日记锁账号的日记不出笔盒）。
  const draftId = draft?.id ?? null
  useEffect(() => {
    if (!draftId || !penReady) return
    let current = true
    void loadPaperLayer(owner, draftId).then(record => {
      if (!current) return
      layerAspect.current = record?.aspect ?? 0.75
      layerDirty.current = false
      setLayer(record?.strokes.length ? { strokes: record.strokes, undo: [], redo: [] } : emptyPaperLayer())
    }, () => { if (current) setLayer(emptyPaperLayer()) })
    return () => { current = false }
  }, [draftId, penReady, owner])

  // 笔迹只在未启用日记锁的日记纸页可用：一旦不可用立即清空并删除附页，避免加密日记的笔迹明文旁路。
  useEffect(() => {
    if (penReady || !draftId || !layerRef.current.strokes.length) return
    setLayer(emptyPaperLayer())
    void queueWrite(() => deletePaperLayer(owner, draftId)).then(() => undefined, () => undefined)
  }, [penReady, draftId, owner])

  // 落笔后防抖保存；完成/关闭纸页时 flushPaperLayer 立即落盘。
  useEffect(() => {
    if (!draftId || !penReady || !layerDirty.current) return
    const timer = window.setTimeout(() => {
      layerDirty.current = false
      savePaperLayerNow(draftId)
    }, 500)
    return () => window.clearTimeout(timer)
  }, [layer, draftId, penReady, owner])

  /** 日记锁启用后清除本账号全部日记笔迹（附页层是明文，防加密日记旁路）。 */
  function purgeDiaryPaperLayers(extraIds: string[] = []) {
    const ids = [...new Set([
      ...entries.filter(row => row.kind === 'diary').flatMap(row => row.draftOf ? [row.draftOf, row.id] : [row.id]),
      ...extraIds,
    ])]
    if (!ids.length) return
    void queueWrite(() => deletePaperLayers(owner, ids)).then(() => undefined, () => undefined)
  }

  function closePassword() {
    setPasswordDialog(null)
    setPassword('')
    setNewPassword('')
    setConfirmation('')
    setShowPassword(false)
    setError('')
  }

  function lockHistory() {
    historyEpoch.current++
    setUnlocked(false)
    setEntries(rows => rows.filter(row => row.kind !== 'diary'))
    setReading(null)
    setPreview(null)
    setEditing(null)
    setRemove(null)
    setDiscard(false)
    setQuery('')
    if (draftRef.current?.kind === 'diary') {
      storeDraft(draftRef.current)
      closeDraft()
    }
    closePassword()
  }

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return
      if (vault) lockHistory()
      else { storeDraft(draftRef.current); flushPaperLayer() }
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [vault])

  useEffect(() => {
    if (!vault || !unlocked) return
    let timer: number
    const reset = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(lockHistory, 5 * 60 * 1000)
    }
    reset()
    window.addEventListener('pointerdown', reset)
    window.addEventListener('keydown', reset)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerdown', reset)
      window.removeEventListener('keydown', reset)
    }
  }, [vault, unlocked])

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel('ohu-diary-vault')
    channel.onmessage = event => {
      if (event.data?.owner !== owner) return
      lockHistory()
      if (event.data.enabled === true) purgeDiaryPaperLayers()
      setVault(event.data.enabled === true)
      if (event.data.enabled === false) {
        const epoch = historyEpoch.current
        void listJournal(owner).then(rows => {
          if (active.current && epoch === historyEpoch.current) setEntries(rows)
        }, () => { if (active.current) setError('无法读取本机手账。') })
      }
    }
    return () => channel.close()
  }, [owner])

  function notifyOtherPages(enabled: boolean) {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel('ohu-diary-vault')
    channel.postMessage({ owner, enabled })
    channel.close()
  }

  const passwordTitle = passwordDialog === 'enable' ? '设置日记锁' : passwordDialog === 'change'
    ? '修改日记密码' : passwordDialog === 'disable' ? '关闭日记锁' : '输入日记密码'
  const nextPassword = passwordDialog === 'change' ? newPassword : password

  function submitPassword() {
    if (!passwordDialog || !password) return
    if ((passwordDialog === 'enable' || passwordDialog === 'change') && (nextPassword.length < 8 || nextPassword !== confirmation)) {
      setError(nextPassword.length < 8 ? '请设置至少 8 个字符的密码。' : '两次输入的密码不同。')
      return
    }
    const epoch = historyEpoch.current
    void run(async () => {
      if (passwordDialog === 'enable') {
        await queueWrite(() => enableJournalVault(owner, password))
        notifyOtherPages(true)
        if (active.current) {
          lockHistory()
          purgeDiaryPaperLayers() // 先关草稿（笔迹 flush 已入队）再清除，保证删除在保存之后
          setVault(true)
        }
      } else if (passwordDialog === 'change' || passwordDialog === 'disable') {
        const enabled = passwordDialog === 'change'
        await queueWrite(() => updateJournalVault(owner, password, enabled ? newPassword : undefined))
        notifyOtherPages(enabled)
        if (active.current) {
          lockHistory()
          setVault(enabled)
          if (!enabled) {
            const disabledEpoch = historyEpoch.current
            const rows = await listJournal(owner)
            if (active.current && historyEpoch.current === disabledEpoch) setEntries(rows)
          }
        }
      } else {
        const key = await unlockJournal(owner, password)
        const rows = await listJournal(owner, key)
        if (active.current && historyEpoch.current === epoch) {
          setEntries(rows)
          setUnlocked(true)
          closePassword()
          setReading(rows.find(row => row.kind === 'diary' && !row.draftOf)?.id ?? null)
        }
      }
    })
  }

  function update(values: Partial<Pick<JournalEntry, 'kind' | 'title' | 'day' | 'body' | 'mood' | 'photos'>>) {
    setDraft(current => current && { ...current, ...values })
  }

  function openDraft(entry: JournalEntry) {
    setError('')
    setStatus('')
    setReferences(null)
    initialDraft.current = entry
    setDraftStatus('')
    setDraft(entry)
  }

  function closeDraft() {
    flushPaperLayer()
    draftRef.current = null
    setDraft(null)
    setDraftStatus('')
    setReferences(null)
    setError('')
  }

  async function run(operation: () => Promise<void>) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    setStatus('')
    try { await operation() }
    catch (reason) { if (active.current) setError(reason instanceof Error ? reason.message : '操作失败，请重试。') }
    finally {
      lock.current = false
      if (active.current) setBusy(false)
    }
  }

  async function appendPhotos(files: File[], entry: JournalEntry) {
    if (!files.length) return
    const available = MAX_JOURNAL_PHOTOS - entry.photos.length
    const photos: JournalPhoto[] = []
    let failed = 0
    for (const file of files.slice(0, available)) {
      try { photos.push({ id: journalId(), file: await normalizeMomentPhoto(file) }) }
      catch { failed++ }
      if (!active.current) return
    }
    setDraft(current => current?.id === entry.id ? { ...current, photos: [...current.photos, ...photos] } : current)
    const skipped = Math.max(0, files.length - available)
    if (failed || skipped) {
      setError([failed ? failed + ' 张照片无法读取。请选择 JPG、PNG 或 WebP 图片。' : '',
        skipped ? '每篇最多 ' + MAX_JOURNAL_PHOTOS + ' 张，已跳过超出的照片。' : ''].filter(Boolean).join(' '))
    }
  }

  function addFromCamera() {
    if (!draft || draft.photos.length >= MAX_JOURNAL_PHOTOS || lock.current) return
    void run(async () => {
      const file = await captureMomentPhoto(owner, () => cameraInput.current?.click())
      if (file && active.current) await appendPhotos([file], draft)
    })
  }

  function addFromGallery() {
    if (!draft || draft.photos.length >= MAX_JOURNAL_PHOTOS || lock.current) return
    void run(async () => {
      const files = await pickMomentGallery(MAX_JOURNAL_PHOTOS - draft.photos.length)
      if (!active.current) return
      if (files === null) fileInput.current?.click()
      else await appendPhotos(files, draft)
    })
  }

  function movePhoto(index: number, offset: number) {
    if (!draft || busy) return
    const target = index + offset
    if (target < 0 || target >= draft.photos.length) return
    const photos = [...draft.photos]
    const [photo] = photos.splice(index, 1)
    photos.splice(target, 0, photo)
    update({ photos })
  }

  function openReferences() {
    if (!draft || !draft.day) return
    const uid = owner === 'guest' ? '' : owner.slice(5)
    if ((captureQbankSession().uid || '') !== uid) { setReferences([]); return }
    const date = new Date(draft.day + 'T12:00:00')
    const courses = getScheduleRowsForDate(date).map(row => '上课：' + row.name)
    const tasks = listLocalTodos().filter(row => row.done && row.done_at && localDateKey(new Date(row.done_at)) === draft.day).map(row => '完成待办：' + row.title)
    const repository = currentFocusRepository()
    const focusScope = owner === 'guest' ? 'guest' : owner.slice(5)
    const focus = repository.scope === focusScope ? repository.read().stats[draft.day] : undefined
    const checkins = readLocalCampusCheckins(uid).filter(row => localDateKey(new Date(row.created_at)) === draft.day).map(row => '到访：' + row.poi_name)
    setReferences([...new Set([...courses, ...tasks, ...checkins, ...(focus?.minutes ? ['专注：' + focus.minutes + ' 分钟'] : [])])])
  }

  function replaceEntry(entry: JournalEntry) {
    setEntries(rows => sortJournal([entry, ...rows.filter(row => row.id !== entry.id)]))
  }

  const canSave = !!draft?.day && !!(draft.title.trim() || draft.body.trim() || draft.mood || draft.photos.length)

  function save() {
    if (!draft || !canSave) return
    void run(async () => {
      const saved = { ...draft, title: draft.title.trim(), body: draft.body.trim(), updatedAt: Date.now() }
      const epoch = historyEpoch.current
      completing.current = saved.id
      flushPaperLayer()
      try { await queueWrite(() => saveJournal(saved, 'draft-' + saved.id)) }
      finally { completing.current = null }
      if (active.current && historyEpoch.current === epoch) {
        setEntries(rows => rows.filter(row => row.draftOf !== saved.id))
        if (!vault || unlocked || saved.kind !== 'diary') replaceEntry(saved)
        setFilter(current => current === 'all' ? current : saved.kind)
        setQuery('')
        setDateFilter('')
        closeDraft()
        setStatus('已保存在此设备。')
      }
    })
  }

  function pin(entry: JournalEntry) {
    void run(async () => {
      const epoch = historyEpoch.current
      const next = { ...entry, pinned: !entry.pinned, updatedAt: Date.now() }
      await saveJournal(next)
      if (active.current && historyEpoch.current === epoch) { replaceEntry(next); setStatus(next.pinned ? '已置顶。' : '已取消置顶。') }
    })
  }

  function exportEntry(entry: JournalEntry) {
    void run(async () => {
      const epoch = historyEpoch.current
      const photos: { name: string; data: string }[] = []
      for (const { file } of entry.photos) photos.push({ name: file.name, data: await photoData(file) })
      // 导出才合成：笔迹此刻渲染成纸面合成图，随 JSON 一起导出（锁定日记不合成附页）。
      let paper: { image: string; strokes: number } | undefined
      if (!(vault && entry.kind === 'diary')) {
        const record = await loadPaperLayer(owner, entry.id)
        if (record?.strokes.length) {
          try {
            paper = { image: renderPaperStrokes(record.strokes, record.aspect, { background: paperSurfaceColor('#ffffff') }), strokes: record.strokes.length }
          } catch { /* 合成失败不阻塞导出，笔迹数据仍随源数据留存本机 */ }
        }
      }
      if (!active.current || historyEpoch.current !== epoch) return
      const content = JSON.stringify({ version: 2, type: entry.kind, date: entry.day, title: entry.title, mood: entry.mood, text: entry.body, photos, ...(paper ? { paper } : {}) }, null, 2)
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = '哦狐' + KIND_LABEL[entry.kind] + '-' + entry.day + '.json'
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    })
  }

  const keyword = query.trim().normalize('NFKC').toLocaleLowerCase()
  const readable = vault && !unlocked ? entries.filter(entry => entry.kind !== 'diary') : entries
  const visible = readable.filter(entry => !entry.draftOf && (filter === 'all' || entry.kind === filter) && (!dateFilter || entry.day === dateFilter) &&
    (!keyword || [entry.title, entry.body, entry.mood, entry.day].some(value => value.normalize('NFKC').toLocaleLowerCase().includes(keyword))))

  const diary = readable.filter(entry => entry.kind === 'diary' && !entry.draftOf).sort((a, b) =>
    b.day.localeCompare(a.day) || (b.createdAt ?? b.updatedAt) - (a.createdAt ?? a.updatedAt))
  const pageIndex = diary.findIndex(entry => entry.id === reading)
  const page = diary[pageIndex]
  const recoveredDraft = readable.find(entry => !!entry.draftOf)

  // 翻阅日记读页：只读还原笔迹（锁定日记不读附页层）。
  const [pageStrokes, setPageStrokes] = useState<PaperStroke[]>([])
  const readerPageId = page?.id ?? null
  const readerPageKind = page?.kind ?? null
  useEffect(() => {
    if (!readerPageId || readerPageKind !== 'diary' || vault) { setPageStrokes([]); return }
    let current = true
    void loadPaperLayer(owner, readerPageId).then(record => {
      if (current) setPageStrokes(record?.strokes ?? [])
    }, () => { if (current) setPageStrokes([]) })
    return () => { current = false }
  }, [readerPageId, readerPageKind, vault, owner])

  function turnPage(offset: number) {
    const next = diary[pageIndex + offset]
    if (!next) return
    setDirection(offset)
    setReading(next.id)
  }

  const weekday = paper && draft.day ? new Date(draft.day + 'T12:00:00').toLocaleDateString('zh-CN', { weekday: 'long' }) : ''

  return <div className={styles.journal}>
    {vault && !unlocked ? <section className={styles.lockedDiary}>
      <div className={styles.diaryCover} aria-hidden="true"><span>我的手账</span></div>
      <h2>日记已锁定</h2>
      <div className={styles.actions}>
        <button type="button" disabled={loading || busy} onClick={() => openDraft(newEntry(owner, 'diary'))}>写今天</button>
        <button type="button" disabled={busy} onClick={() => setPasswordDialog('unlock')}>解锁日记</button>
      </div>
    </section> : null}
    <div className={styles.journalHeader}>
      <span>仅保存在此设备</span>
      <div className={styles.actions}>
        {!vault || unlocked ? <button type="button" disabled={loading || busy} onClick={() => openDraft(newEntry(owner, 'diary'))}>写日记</button> : null}
        {!vault || unlocked ? <button type="button" disabled={busy || !diary.length} onClick={() => setReading(diary[0].id)}>翻阅日记</button> : null}
        <button type="button" disabled={busy} onClick={() => openDraft(newEntry(owner, 'journal'))}>随手记</button>
      </div>
    </div>
    <div className={styles.actions}>
      {!loading && !vault ? <button type="button" onClick={() => setPasswordDialog('enable')}>设置日记锁</button> : null}
      {unlocked ? <>
        <button type="button" onClick={() => { lockHistory(); notifyOtherPages(true) }}>立即锁定</button>
        <button type="button" onClick={() => setPasswordDialog('change')}>修改日记密码</button>
        <button type="button" onClick={() => setPasswordDialog('disable')}>关闭日记锁</button>
      </> : null}
      {recoveredDraft?.draftOf ? <button type="button" onClick={() => {
        const { draftOf, ...entry } = recoveredDraft
        if (draftOf) openDraft({ ...entry, id: draftOf })
      }}>继续写草稿</button> : null}
    </div>
    <div className={styles.journalTools}>
      <input type="search" aria-label="搜索手账" placeholder="搜标题、内容或日期" value={query} onChange={event => setQuery(event.target.value)} />
      {(!vault || unlocked || filter !== 'diary') ? <div className={styles.actions}>
        <label>按日期查找<input type="date" value={dateFilter} onChange={event => setDateFilter(event.target.value)} /></label>
        {dateFilter ? <button type="button" onClick={() => setDateFilter('')}>清除日期</button> : null}
      </div> : null}
      <div className={styles.actions} aria-label="手账类型">
        {(['all', 'diary', 'journal'] as const).map(type => <button key={type} type="button" aria-pressed={filter === type} onClick={() => setFilter(type)}>{type === 'all' ? '全部' : KIND_LABEL[type]}</button>)}
      </div>
    </div>
    {!draft && error && !remove && !passwordDialog ? <p role="alert">{error}</p> : null}
    {status ? <p role="status">{status}</p> : null}
    {loading ? <p role="status">正在读取手账…</p> : visible.length === 0 ?
      <p>{readable.length ? '没有找到符合条件的记录。' : '从今天的一句话或一张照片开始。'}</p> : null}
    {visible.map(entry => <article className={styles.entry} key={entry.id}>
      <div className={styles.entryMeta}><time dateTime={entry.day}>{entry.day}</time><span>{KIND_LABEL[entry.kind]}</span>{entry.mood ? <span>{entry.mood}</span> : null}{entry.pinned ? <span>已置顶</span> : null}</div>
      {entry.kind === 'diary' ? <div className={styles.actions}><button type="button" onClick={() => setReading(entry.id)}>阅读日记</button></div> : null}
      {entry.title ? <h2>{entry.title}</h2> : null}
      {entry.body ? <p>{entry.body}</p> : null}
      {entry.photos.length ? <div className={styles.journalGallery} aria-label="手账照片">{entry.photos.map((photo, index) =>
        <button type="button" key={photo.id} aria-label={'查看第 ' + (index + 1) + ' 张照片'} onClick={() => setPreview({ photos: entry.photos, index })}><JournalPhotoImage file={photo.file} alt="" /></button>
      )}</div> : null}
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={() => openDraft(entry)}>编辑</button>
        <button type="button" disabled={busy} onClick={() => pin(entry)}>{entry.pinned ? '取消置顶' : '置顶'}</button>
        <button type="button" disabled={busy} onClick={() => exportEntry(entry)}>导出</button>
        <button type="button" disabled={busy} onClick={() => { setRemove(entry); setError('') }}>删除</button>
      </div>
    </article>)}
    {passwordDialog ? <DialogLayer title={passwordTitle} onClose={closePassword} allowClose={!busy} className={styles.dialog}>
      <form className={styles.draft} onSubmit={event => { event.preventDefault(); submitPassword() }}>
        <h2>{passwordTitle}</h2>
        {passwordDialog === 'enable' ? <p>密码与校园账号独立。忘记密码将无法找回加密日记。</p> : null}
        <label>日记密码<input type={showPassword ? 'text' : 'password'} autoComplete={passwordDialog === 'enable' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} /></label>
        {passwordDialog === 'disable' ? <p>关闭后，此设备上的日记将恢复为可直接查看的普通本机记录。</p> : null}
        {passwordDialog === 'change' ? <label>新密码<input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} /></label> : null}
        {passwordDialog === 'enable' || passwordDialog === 'change' ? <label>确认密码<input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label> : null}
        {error ? <p role="alert">{error}</p> : null}
        <div className={styles.actions}>
          <button type="button" onClick={() => setShowPassword(value => !value)}>{showPassword ? '隐藏密码' : '显示密码'}</button>
          <button type="button" disabled={busy} onClick={closePassword}>取消</button>
          <button type="submit" disabled={busy || !password}>{passwordDialog === 'enable' ? '启用日记锁' : passwordDialog === 'unlock' ? '解锁' : '确认'}</button>
        </div>
      </form>
    </DialogLayer> : null}
    {page && !draft ? <DialogLayer title="翻阅日记" onClose={() => setReading(null)} className={styles.paperDialog}>
      <div className={styles.draft}>
        <div className={styles.materialBar} role="group" aria-label="纸张材质">
          {(['default', 'kraft', 'sketch'] as const).map(m => (
            <button key={m} type="button" className={styles.materialBtn} aria-pressed={paperMaterial === m}
              onClick={() => { setPaperMaterial(m); try { localStorage.setItem('ohu.paper-material', m) } catch {} }}>
              {{ default: '米白纸', kraft: '牛皮纸', sketch: '白画纸' }[m]}
            </button>
          ))}
        </div>
        <article key={page.id} className={styles.paperPage} data-direction={direction} data-material={paperMaterial} aria-label={'日记 ' + page.day}
          onPointerDown={event => {
            if (event.pointerType === 'touch' && !(event.target instanceof Element && event.target.closest('button'))) {
              swipeStart.current = { x: event.clientX, y: event.clientY }
            }
          }}
          onPointerCancel={() => { swipeStart.current = null }}
          onPointerUp={event => {
            const start = swipeStart.current
            swipeStart.current = null
            if (!start || event.pointerType !== 'touch') return
            const dx = event.clientX - start.x
            if (Math.abs(dx) >= 55 && Math.abs(dx) > 1.5 * Math.abs(event.clientY - start.y)) turnPage(dx < 0 ? -1 : 1)
          }}>
          <time dateTime={page.day}>{page.day.replaceAll('-', '.')}</time>
          {page.title ? <h2>{page.title}</h2> : null}
          <p className={styles.paperText}>{page.body}</p>
          {page.photos.length ? <div className={styles.journalGallery}>{page.photos.map((photo, index) =>
            <button type="button" key={photo.id} aria-label={'查看第 ' + (index + 1) + ' 张照片'} onClick={() => setPreview({ photos: page.photos, index })}><JournalPhotoImage file={photo.file} alt="" /></button>
          )}</div> : null}
          {pageStrokes.length && !vault ? <PaperStrokesView strokes={pageStrokes} /> : null}
        </article>
        <div className={styles.paperNavigation}>
          <button type="button" disabled={pageIndex >= diary.length - 1} onClick={() => turnPage(1)}>上一篇</button>
          <span role="status">{page.day}</span>
          <button type="button" disabled={pageIndex <= 0} onClick={() => turnPage(-1)}>下一篇</button>
        </div>
      </div>
    </DialogLayer> : null}
    {draft ? <DialogLayer title={draft.kind === 'diary' ? '写日记' : '写手账'} onClose={closeDraft}
      full={paper} beforeClose={() => { setDiscard(true); return false }} allowClose={!busy && !editing} className={paper ? styles.paperWriter : styles.dialog}>
      <div className={styles.draft}>
        <div className={styles.paperDate}><h2>{paper ? '写日记' : '写手账'}</h2>{paper ? <span role="status">{draftStatus}</span> : null}</div>
        {paper ? <div className={styles.materialBar} role="group" aria-label="纸张材质">
          {(['default', 'kraft', 'sketch'] as const).map(m => (
            <button key={m} type="button" className={styles.materialBtn} aria-pressed={paperMaterial === m}
              onClick={() => { setPaperMaterial(m); try { localStorage.setItem('ohu.paper-material', m) } catch {} }}>
              {{ default: '米白纸', kraft: '牛皮纸', sketch: '白画纸' }[m]}
            </button>
          ))}
        </div> : null}
        {paper ? <div className={styles.paperPage} ref={paperHost}>
          <div className={styles.paperDate}><time dateTime={draft.day}>{draft.day.replaceAll('-', '.')}</time><span>{weekday}</span></div>
          <textarea ref={journalText} aria-label="日记正文" placeholder="今天发生了什么？" rows={7} maxLength={4000} value={draft.body} disabled={busy} onChange={event => update({ body: event.target.value })} />
          {penReady ? <PaperPenBox key={draft.id} entryId={draft.id} layer={layer} onLayer={commitLayer} hostRef={paperHost} /> : null}
        </div> : null}
        <details key={draft.id + ':' + draft.kind} className={`${styles.paperOptions} folio`} open={!paper || undefined}>
          <summary>{paper ? '日期、标题与心情' : '随手记详情'}</summary>
          <div className={styles.toolContent}>
            <div className={styles.journalFields}>
              <label>类型<select value={draft.kind} disabled={busy || (vault && paper)} onChange={event => update({ kind: event.target.value as JournalKind })}><option value="journal">随手记</option><option value="diary">日记</option></select></label>
              <label>日期<input type="date" value={draft.day} disabled={busy} onChange={event => { update({ day: event.target.value }); setReferences(null) }} /></label>
            </div>
            <label>标题（选填）<input value={draft.title} maxLength={60} disabled={busy} onChange={event => update({ title: event.target.value })} /></label>
            <label>心情<select value={draft.mood} disabled={busy} onChange={event => update({ mood: event.target.value })}>
              <option value="">不填写</option><option>开心</option><option>平静</option><option>有点累</option><option>想放松</option>
            </select></label>
          </div>
        </details>
        {!paper ? <label>今天想记下什么<textarea ref={journalText} rows={4} maxLength={4000} value={draft.body} disabled={busy} onChange={event => update({ body: event.target.value })} /></label> : null}
        <ComposerKeyboard field={journalText} value={draft.body} onChange={body => update({ body })} disabled={busy} />
        <div className={styles.actions}><button type="button" aria-expanded={references !== null} disabled={busy || !draft.day} onClick={() => {
          if (references !== null) setReferences(null)
          else openReferences()
        }}>引用学习记录</button></div>
        {references !== null ? <div className={styles.actions} aria-label="可引用学习记录">
          {references.length ? references.map(reference => <button type="button" key={reference} onClick={() => {
            update({ body: [draft.body.trimEnd(), reference].filter(Boolean).join('\n').slice(0, 4000) })
            setReferences(null)
          }}>{reference}</button>) : <p>这一天没有可引用的本机学习记录。</p>}
          <button type="button" onClick={() => setReferences(null)}>收起</button>
        </div> : null}
        <details key={draft.id + ':photos:' + draft.kind} className={`${styles.paperOptions} folio`} open={!paper || undefined}>
          <summary>照片 <small>{draft.photos.length}/{MAX_JOURNAL_PHOTOS}</small></summary>
          <section aria-label="添加图片" className={`${styles.journalAttachments} ${styles.toolContent}`}>
              <div className={styles.actions}>
                <button type="button" disabled={busy || draft.photos.length >= MAX_JOURNAL_PHOTOS} onClick={addFromCamera}>拍照</button>
                <button type="button" disabled={busy || draft.photos.length >= MAX_JOURNAL_PHOTOS} onClick={addFromGallery}>添加图片</button>
                <button type="button" disabled={busy || draft.photos.length >= MAX_JOURNAL_PHOTOS} onClick={() => fileInput.current?.click()}>从文件选图</button>
              </div>
              {draft.photos.map((photo, index) => <div className={styles.journalAttachment} key={photo.id}>
                <JournalPhotoImage file={photo.file} alt={'第 ' + (index + 1) + ' 张照片'} />
                <div className={styles.actions}>
                  <button type="button" disabled={busy} onClick={() => setEditing(photo)} aria-label={'编辑第 ' + (index + 1) + ' 张照片'}>编辑</button>
                  <button type="button" disabled={busy || index === 0} onClick={() => movePhoto(index, -1)} aria-label={'将第 ' + (index + 1) + ' 张前移'}>前移</button>
                  <button type="button" disabled={busy || index === draft.photos.length - 1} onClick={() => movePhoto(index, 1)} aria-label={'将第 ' + (index + 1) + ' 张后移'}>后移</button>
                  <button type="button" disabled={busy} onClick={() => update({ photos: draft.photos.filter(item => item.id !== photo.id) })} aria-label={'移除第 ' + (index + 1) + ' 张照片'}>移除</button>
                </div>
              </div>)}
          </section>
        </details>
        <input ref={cameraInput} hidden type="file" accept="image/*" capture="environment" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void run(() => appendPhotos(files, draft)) }} />
        <input ref={fileInput} hidden type="file" accept="image/*" multiple onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void run(() => appendPhotos(files, draft)) }} />
        {error ? <p role="alert">{error}</p> : null}
        <div className={styles.actions} data-input-actions=""><button type="button" disabled={busy} onClick={() => setDiscard(true)}>取消</button>{draftStatus.includes('失败') ? <button type="button" onClick={() => storeDraft(draft)}>重试保存草稿</button> : null}<button type="button" disabled={busy || !canSave} onClick={save}>{paper ? '完成' : '保存随手记'}</button></div>
      </div>
      {editing ? <Suspense fallback={<p role="status">正在打开图片编辑器…</p>}><PhotoEditor key={owner + ':' + editing.id} owner={owner} file={editing.file} availableFiles={draft.photos.map(photo => photo.file)} startWithFilters onClose={() => setEditing(null)} onSave={file => {
        update({ photos: draft.photos.map(photo => photo.id === editing.id ? { ...photo, file } : photo) })
        setEditing(null)
      }} /></Suspense> : null}
    </DialogLayer> : null}
    {preview ? <DialogLayer title="查看手账照片" onClose={() => setPreview(null)} className={styles.dialog}><div className={styles.draft}>
      <JournalPhotoImage file={preview.photos[preview.index].file} alt={'第 ' + (preview.index + 1) + ' 张手账照片'} large />
      <div className={styles.actions}>
        <button type="button" disabled={preview.index === 0} onClick={() => setPreview({ ...preview, index: preview.index - 1 })}>上一张</button>
        <span>{preview.index + 1}/{preview.photos.length}</span>
        <button type="button" disabled={preview.index === preview.photos.length - 1} onClick={() => setPreview({ ...preview, index: preview.index + 1 })}>下一张</button>
        <button type="button" onClick={() => setPreview(null)}>关闭</button>
      </div>
    </div></DialogLayer> : null}
    {discard ? <DialogLayer title="放弃本次编辑？" onClose={() => setDiscard(false)} className={styles.dialog}><div className={styles.draft}><h2>放弃本次编辑？</h2><div className={styles.actions}><button type="button" onClick={() => setDiscard(false)}>继续编辑</button><button type="button" onClick={() => void run(async () => {
      if (draft?.kind === 'diary') {
        lastQueued.current = draft
        const id = draft.id
        await queueWrite(() => deleteJournal(owner, 'draft-' + id))
        if (active.current) setEntries(rows => rows.filter(row => row.draftOf !== id))
        // 先清内存再删附页：防止 closeDraft 的 flush 把笔迹回存
        layerDirty.current = false
        layerRef.current = emptyPaperLayer()
        setLayer(emptyPaperLayer())
        await deletePaperLayer(owner, id)
      }
      if (active.current) { setDiscard(false); closeDraft() }
    })}>放弃</button></div></div></DialogLayer> : null}
    {remove ? <DialogLayer title="删除这条手账？" onClose={() => setRemove(null)} allowClose={!busy} className={styles.dialog}><div className={styles.draft}><h2>删除这条手账？</h2><div className={styles.actions}><button type="button" disabled={busy} onClick={() => setRemove(null)}>取消</button><button type="button" disabled={busy} onClick={() => void run(async () => {
      await deleteJournal(owner, remove.id)
      await deletePaperLayer(owner, remove.id) // 附页笔迹随记录一起删除
      if (active.current) { setEntries(rows => rows.filter(row => row.id !== remove.id)); setRemove(null) }
    })}>删除</button></div>{error ? <p role="alert">{error}</p> : null}</div></DialogLayer> : null}
  </div>
}
