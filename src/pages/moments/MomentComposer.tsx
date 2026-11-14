import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ComposerKeyboard } from '../../components/ComposerKeyboard'
import { DialogLayer } from '../../components/ui/DialogLayer'
import { useToast } from '../../context/ToastContext'
import { captureImSession, currentImSession } from '../../lib/im-session'
import { uploadImages } from '../../lib/market'
import { createMoment, momentsModerationBlock } from '../../lib/moments'
import { normalizeMomentPhoto, photoCanvas, canvasPhotoFile } from '../../lib/moment-photo'
import { pickMomentGallery } from '../../lib/moment-gallery'
import type { MomentEditState } from './MomentPhotoEditor'
import styles from './MomentComposer.module.css'

const MomentPhotoEditor = lazy(() => import('./MomentPhotoEditor').then(module => ({ default: module.MomentPhotoEditor })))
type PhotoDraft = { id: string; file: File; original: File; url: string; edit?: MomentEditState }

/** 白图只在用户勾选后、正式发表时生成，不污染编辑草稿。 */
async function blankTile(index: number): Promise<File> {
  const canvas = photoCanvas(480, 480), context = canvas.getContext('2d')!
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, 480, 480)
  return canvasPhotoFile(canvas, `white-grid-${index + 1}.jpg`)
}

export function MomentComposer({ uid, textOnly = false, onClose, onPublished }: { uid: string; textOnly?: boolean; onClose: () => void; onPublished: () => void }) {
  const toast = useToast()
  const [body, setBody] = useState(''), [photos, setPhotos] = useState<PhotoDraft[]>([])
  const [fillWithWhite, setFillWithWhite] = useState(false), [editingId, setEditingId] = useState('')
  const [visibility, setVisibility] = useState<'friends_only' | 'private'>('friends_only')
  const [busy, setBusy] = useState(false), [picking, setPicking] = useState(false), [error, setError] = useState('')
  const [preview, setPreview] = useState<number | null>(null), [discard, setDiscard] = useState(false), [dragging, setDragging] = useState('')
  const bodyField = useRef<HTMLTextAreaElement>(null)
  const input = useRef<HTMLInputElement>(null), lock = useRef(false), pickLock = useRef(false), live = useRef(true)
  const objectUrls = useRef(new Set<string>())
  useEffect(() => {
    live.current = true; const urls = objectUrls.current
    return () => { live.current = false; urls.forEach(url => URL.revokeObjectURL(url)); urls.clear() }
  }, [])
  const current = (session: ReturnType<typeof captureImSession>) => live.current && !!session && currentImSession(session)
  function newUrl(file: File) { const url = URL.createObjectURL(file); objectUrls.current.add(url); return url }
  function releaseUrl(url: string) { URL.revokeObjectURL(url); objectUrls.current.delete(url) }
  function close() { if (!busy && !picking) { if (body.trim() || photos.length) setDiscard(true); else onClose() } }

  /** 每张照片顺序解码，防止同时解码九张大图；账号变化时放弃结果。 */
  async function pick(files: File[]) {
    if (lock.current || pickLock.current || !files.length) return
    const session = captureImSession(uid); if (!session) return
    const room = Math.max(0, 9 - photos.length); if (!room) return
    pickLock.current = true; setPicking(true); setError('')
    const accepted: PhotoDraft[] = [], rejected: string[] = []
    let committed = false
    try {
      for (const file of files.slice(0, room)) {
        try {
          const normalized = await normalizeMomentPhoto(file)
          if (!current(session)) return
          accepted.push({ id: crypto.randomUUID(), file: normalized, original: file, url: newUrl(normalized) })
        } catch (reason) { rejected.push(reason instanceof Error ? reason.message : '有图片无法读取') }
      }
      if (!current(session)) return
      setPhotos(previous => [...previous, ...accepted]); committed = true
      setError([files.length > room ? `最多9张，本次只添加前${room}张。` : '', rejected.length ? `${rejected.length}张未添加：${rejected[0]}` : ''].filter(Boolean).join(' '))
    } finally { if (!committed) accepted.forEach(photo => releaseUrl(photo.url)); pickLock.current = false; if (live.current) setPicking(false) }
  }
  async function chooseGallery() {
    if (busy || picking || pickLock.current) return
    const session = captureImSession(uid); if (!session) return
    pickLock.current = true; setPicking(true); setError('')
    let files: File[] | null = null
    try { files = await pickMomentGallery(9 - photos.length) }
    catch (reason) { if (current(session)) setError(reason instanceof Error ? reason.message : '相册暂时不可用') }
    finally { pickLock.current = false; if (live.current) setPicking(false) }
    if (!current(session)) return
    if (files === null) input.current?.click()
    else await pick(files)
  }
  function removePhoto(id: string) {
    if (busy || picking) return
    const item = photos.find(photo => photo.id === id); if (item) releaseUrl(item.url)
    setPhotos(previous => previous.filter(photo => photo.id !== id))
  }
  function applyEdit(id: string, file: File, edit?: MomentEditState) {
    const item = photos.find(photo => photo.id === id); if (!item || !live.current) return
    releaseUrl(item.url); const url = newUrl(file)
    setPhotos(previous => previous.map(photo => photo.id === id ? { ...photo, file, url, edit } : photo))
    setEditingId(''); setError('')
  }
  async function resetPhoto(id: string) {
    const item = photos.find(photo => photo.id === id); if (!item || picking || busy) return
    const session = captureImSession(uid); if (!session) return
    setPicking(true); pickLock.current = true
    try { const original = await normalizeMomentPhoto(item.original); if (current(session)) applyEdit(id, original) }
    catch (reason) { if (current(session)) setError(reason instanceof Error ? reason.message : '恢复原图失败') }
    finally { pickLock.current = false; if (live.current) setPicking(false) }
  }
  function movePhoto(id: string, targetId: string) {
    if (busy || picking || id === targetId) return
    setPhotos(previous => {
      const from = previous.findIndex(photo => photo.id === id), to = previous.findIndex(photo => photo.id === targetId)
      if (from < 0 || to < 0) return previous
      const next = [...previous], [item] = next.splice(from, 1); next.splice(to, 0, item); return next
    })
  }
  async function publish() {
    if (lock.current || pickLock.current) return
    if (textOnly && photos.length) { setError('当前入口仅支持文字动态。'); return }
    const validation = body.trim() ? momentsModerationBlock(body) : photos.length ? null : '写一段文字或添加图片后再发表'
    if (validation) { setError(validation); return }
    const session = captureImSession(uid); if (!session) return
    lock.current = true; setBusy(true); setError('')
    try {
      const queue = photos.map(photo => photo.file)
      if (fillWithWhite && photos.length) for (let i = photos.length; i < 9; i++) queue.push(await blankTile(i))
      if (!current(session)) return
      let urls: string[] = []
      if (queue.length) {
        const uploaded = await uploadImages(queue, `moments/${uid}`)
        if (!current(session)) return
        if (uploaded.error || uploaded.urls.length !== queue.length) throw new Error(uploaded.error || '图片未全部上传成功，请重试')
        urls = uploaded.urls
      }
      const result = await createMoment(body, urls, 'image', visibility)
      if (!current(session)) return
      if (result.error) setError(result.error)
      else { toast('动态已发表'); onPublished() }
    } catch (reason) { if (current(session)) setError(reason instanceof Error ? reason.message : '发表失败，请重试') }
    finally { lock.current = false; if (current(session)) setBusy(false) }
  }
  const editingPhoto = photos.find(photo => photo.id === editingId), disabled = busy || picking
  return <DialogLayer title="发布朋友圈动态" full className={styles.surface} onClose={onClose} beforeClose={() => { if (body.trim() || photos.length) { setDiscard(true); return false }; return true }} allowClose={!disabled}>
    <div className={styles.composer}>
      <header className={styles.header}><button type="button" onClick={close} disabled={disabled}>取消</button><h2>发表动态</h2><button type="button" className={styles.publish} onClick={() => void publish()} disabled={disabled || (!body.trim() && !photos.length)}>{busy ? '发表中…' : '发表'}</button></header>
      <div className={styles.body}>
        <textarea ref={bodyField} className={styles.text} aria-label="这一刻的想法" placeholder="这一刻的想法…" value={body} maxLength={1000} disabled={disabled} onChange={event => setBody(event.target.value)} rows={4} />
        <ComposerKeyboard field={bodyField} value={body} onChange={setBody} disabled={disabled} />
        {body.length > 800 ? <p className={styles.count}>{body.length}/1000</p> : null}
        {textOnly ? <p className={styles.hint}>当前入口可发布文字，照片可保存在本机手账。</p> : <>
        <p className={styles.hint}>点照片编辑，拖动左上角手柄调整顺序</p>
        <div className={styles.grid} aria-label="待发布图片">{photos.map((photo, index) => <div className={`${styles.photo} ${dragging === photo.id ? styles.dragging : ''}`} data-photo-id={photo.id} key={photo.id}>
          <button type="button" className={styles.image} disabled={disabled} onClick={() => setEditingId(photo.id)} aria-label={`编辑第${index + 1}张图片`}><img src={photo.url} alt={`第${index + 1}张待发布图片`} draggable={false} /></button>
          <button type="button" className={styles.handle} disabled={disabled} aria-label={`拖动第${index + 1}张排序`} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setDragging(photo.id) }} onPointerMove={event => { if (!dragging) return; const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-photo-id]')?.dataset.photoId; if (hit) movePhoto(photo.id, hit) }} onPointerUp={event => { setDragging(''); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} onPointerCancel={() => setDragging('')} onLostPointerCapture={() => setDragging('')}>⠿</button>
          <button type="button" className={styles.remove} aria-label={`移除第${index + 1}张图片`} disabled={disabled} onClick={() => removePhoto(photo.id)}>×</button>
          <div className={styles.photoActions}><button type="button" disabled={disabled} onClick={() => setPreview(index)}>预览</button><button type="button" aria-label={`第${index + 1}张前移`} disabled={disabled || index === 0} onClick={() => movePhoto(photo.id, photos[index - 1].id)}>‹</button><button type="button" aria-label={`第${index + 1}张后移`} disabled={disabled || index === photos.length - 1} onClick={() => movePhoto(photo.id, photos[index + 1].id)}>›</button></div>
          {photo.edit ? <button type="button" className={styles.reset} disabled={disabled} onClick={() => void resetPhoto(photo.id)}>恢复原图</button> : null}
        </div>)}{fillWithWhite && photos.length ? Array.from({ length: 9 - photos.length }, (_, i) => <div className={styles.white} key={`white-${i}`} aria-label="白色补位图">白图</div>) : null}{photos.length < 9 ? <button type="button" className={styles.add} disabled={disabled} onClick={() => void chooseGallery()} aria-label="从相册添加照片">＋</button> : null}</div>
        <div className={styles.albumRow}><span>{photos.length}/9 张</span><button type="button" disabled={disabled || photos.length >= 9} onClick={() => input.current?.click()}>从文件选图</button></div>
        {photos.length ? <label className={styles.whiteOption}><input type="checkbox" disabled={disabled} checked={fillWithWhite} onChange={event => setFillWithWhite(event.target.checked)} />白图补齐九宫格</label> : null}
        </>}
        <label className={styles.visibility}><span>谁可以看</span><select aria-label="谁可以看" value={visibility} disabled={disabled} onChange={event => setVisibility(event.target.value as typeof visibility)}><option value="friends_only">好友可见</option><option value="private">仅自己</option></select></label>
        {!textOnly ? <p className={styles.hint}>选图与编辑只在本机完成，点击发表后才上传。编辑导出最长边1600像素，发布还会按上传限制压缩。</p> : null}
        {picking ? <p role="status">正在读取所选图片…</p> : null}{busy ? <p role="status">正在上传并发表，请稍候…</p> : null}{error ? <p className={styles.error} role="alert">{error}</p> : null}
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={event => { const files = [...(event.target.files || [])]; event.target.value = ''; void pick(files) }} />
    </div>
    {editingPhoto ? <Suspense fallback={<div className={styles.opening} role="status">正在打开编辑器…</div>}><MomentPhotoEditor key={uid + ':' + editingPhoto.id} owner={'user:' + uid} file={editingPhoto.file} initialState={editingPhoto.edit} availableFiles={photos.map(photo => photo.file)} onClose={() => setEditingId('')} onSave={(file, state) => applyEdit(editingPhoto.id, file, state)} /></Suspense> : null}
    {preview !== null && photos[preview] ? <DialogLayer title="图片预览" full className={styles.previewSurface} onClose={() => setPreview(null)}><div className={styles.preview}><header><button type="button" onClick={() => setPreview(null)}>返回</button><span>{preview + 1}/{photos.length}</span><button type="button" onClick={() => { setEditingId(photos[preview].id); setPreview(null) }}>编辑</button></header><img src={photos[preview].url} alt={`预览第${preview + 1}张`} /><footer><button type="button" disabled={preview === 0} onClick={() => setPreview(preview - 1)}>上一张</button><button type="button" disabled={preview === photos.length - 1} onClick={() => setPreview(preview + 1)}>下一张</button></footer></div></DialogLayer> : null}
    {discard ? <DialogLayer title="放弃这次编辑？" onClose={() => setDiscard(false)}><div className={styles.discard}><h3>放弃这次编辑？</h3><p>未发表的文字和图片不会保留。</p><button type="button" onClick={() => setDiscard(false)}>继续编辑</button><button type="button" onClick={onClose}>放弃</button></div></DialogLayer> : null}
  </DialogLayer>
}
