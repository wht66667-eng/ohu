import { useEffect, useRef, useState } from 'react'
import { DialogLayer } from '../../components/ui/DialogLayer'
import { useToast } from '../../context/ToastContext'
import { captureImSession, currentImSession } from '../../lib/im-session'
import { uploadImages } from '../../lib/market'
import { createMoment, momentsModerationBlock } from '../../lib/moments'
import { MomentPhotoEditor } from './MomentPhotoEditor'
import styles from './MomentsPage.module.css'

type PhotoDraft = { id: string; file: File; url: string }

function blankTile(index: number): File {
  const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 480
  const context = canvas.getContext('2d')
  if (context) { context.fillStyle = '#ffffff'; context.fillRect(0, 0, 480, 480) }
  const data = canvas.toDataURL('image/png')
  const binary = atob(data.split(',')[1] || '')
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  return new File([bytes], `white-grid-${index + 1}.png`, { type: 'image/png' })
}

export function MomentComposer({ uid, onClose, onPublished }: { uid: string; onClose: () => void; onPublished: () => void }) {
  const toast = useToast()
  const [body, setBody] = useState('')
  const [photos, setPhotos] = useState<PhotoDraft[]>([])
  const [fillWithWhite, setFillWithWhite] = useState(true)
  const [editingId, setEditingId] = useState('')
  const [visibility, setVisibility] = useState<'friends_only' | 'public' | 'private'>('friends_only')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const lock = useRef(false), live = useRef(true)
  const objectUrls = useRef(new Set<string>())
  useEffect(() => { live.current = true; return () => { live.current = false; objectUrls.current.forEach(url => URL.revokeObjectURL(url)); objectUrls.current.clear() } }, [])
  const current = (session: ReturnType<typeof captureImSession>) => live.current && currentImSession(session)

  const pick = (files: File[]) => {
    if (lock.current || !files.length) return
    if (files.some(file => !/^image\/(jpeg|png|gif|webp|heic|heif|bmp)$/i.test(file.type))) { setError('请选择 JPG、PNG、GIF 或 WebP 图片'); return }
    const room = Math.max(0, 9 - photos.length)
    if (!room) { setError('九宫格最多添加 9 张图片'); return }
    const next = files.slice(0, room).map(file => {
      const url = URL.createObjectURL(file); objectUrls.current.add(url)
      return { id: `photo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, file, url }
    })
    setPhotos(previous => [...previous, ...next])
    setError(files.length > room ? `最多保留 9 张，已添加 ${room} 张` : '')
  }

  function removePhoto(id: string) {
    setPhotos(previous => {
      const removed = previous.find(photo => photo.id === id)
      if (removed) { URL.revokeObjectURL(removed.url); objectUrls.current.delete(removed.url) }
      return previous.filter(photo => photo.id !== id)
    })
  }

  function applyEdit(id: string, file: File) {
    setPhotos(previous => previous.map(photo => {
      if (photo.id !== id) return photo
      URL.revokeObjectURL(photo.url); objectUrls.current.delete(photo.url)
      const url = URL.createObjectURL(file); objectUrls.current.add(url)
      return { ...photo, file, url }
    }))
    setEditingId(''); setError('')
  }

  const publish = async () => {
    if (lock.current) return
    const validation = body.trim() ? momentsModerationBlock(body) : photos.length ? null : '写一段文字或添加图片后再发布'
    if (validation) { setError(validation); return }
    const session = captureImSession(uid)
    if (!session) return
    lock.current = true; setBusy(true); setError('')
    try {
      const uploadQueue = photos.map(photo => photo.file)
      if (fillWithWhite && photos.length) for (let index = photos.length; index < 9; index++) uploadQueue.push(blankTile(index))
      let urls: string[] = []
      if (uploadQueue.length) {
        setUploading(true)
        const uploaded = await uploadImages(uploadQueue, `moments/${uid}`)
        if (!current(session)) return
        if (uploaded.error || uploaded.urls.length !== uploadQueue.length) throw new Error(uploaded.error || '图片没有全部上传成功，请重试')
        urls = uploaded.urls
      }
      if (!current(session)) return
      const result = await createMoment(body, urls, 'image', visibility)
      if (!current(session)) return
      if (result.error) setError(result.error)
      else { toast('动态已发布'); onPublished() }
    } catch (failure) { if (current(session)) setError((failure as Error).message || '发布失败，请重试') }
    finally { if (current(session)) { lock.current = false; setBusy(false); setUploading(false) } }
  }

  const editingPhoto = photos.find(photo => photo.id === editingId)
  const placeholderCount = photos.length && fillWithWhite ? 9 - photos.length : 0
  return <DialogLayer title="发布朋友圈动态" className={styles.dialogPanel} onClose={onClose} allowClose={!busy && !uploading}>
    <div className={styles.dialogHead}><div><h2>发布动态</h2><small>像发朋友圈一样，编辑好图片再分享</small></div><button type="button" onClick={onClose} disabled={busy || uploading}>取消</button></div>
    <form onSubmit={event => { event.preventDefault(); void publish() }}>
      <label className={styles.field}>分享近况<textarea aria-label="动态内容" placeholder="写下想和同学分享的事…" value={body} maxLength={1000} disabled={busy || uploading} onChange={event => setBody(event.target.value)} rows={5} /></label>
      <p className={styles.counter}>{body.length} / 1000</p>
      {photos.length || placeholderCount ? <section className={styles.photoEditor} aria-label="朋友圈九宫格图片">
        <div className={styles.photoEditorHead}><strong>图片排版</strong><span>{photos.length} 张实拍 · {placeholderCount} 张白色占位</span></div>
        <div className={styles.composeImages}>{photos.map((photo, index) => <article key={photo.id}><img src={photo.url} alt={`待发布图片 ${index + 1}`} /><div><button type="button" disabled={busy || uploading} onClick={() => setEditingId(photo.id)}>裁剪 / 贴纸</button><button type="button" aria-label={`移除第 ${index + 1} 张图片`} disabled={busy || uploading} onClick={() => removePhoto(photo.id)}>移除</button></div></article>)}
          {Array.from({ length: placeholderCount }, (_, index) => <div className={styles.whiteSlot} key={`white-${index}`} aria-label="白色九宫格占位图"><span>白图占位</span></div>)}
        </div>
        <label className={styles.whiteOption}><input type="checkbox" checked={fillWithWhite} disabled={busy || uploading} onChange={event => setFillWithWhite(event.target.checked)} /><span>用白色图片补满九宫格</span><small>默认开启；关闭后只发布已选照片</small></label>
      </section> : null}
      <input ref={input} type="file" accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,image/bmp" multiple hidden onChange={event => { const files = [...(event.target.files || [])]; event.target.value = ''; pick(files) }} />
      <button type="button" className={styles.secondaryBtn} disabled={busy || uploading || photos.length >= 9} onClick={() => input.current?.click()}>{uploading ? '正在上传图片…' : `添加图片（${photos.length}/9）`}</button>
      <label className={styles.field}>谁可以看<select aria-label="动态可见范围" value={visibility} disabled={busy || uploading} onChange={event => setVisibility(event.target.value as typeof visibility)}><option value="friends_only">好友可见</option><option value="public">登录用户可见</option><option value="private">仅自己可见</option></select></label>
      {error && <p className={styles.formError} role="alert">{error}</p>}
      <div data-input-actions=""><button type="submit" className={styles.submitBtn} disabled={busy || uploading || (!body.trim() && !photos.length)}>{busy ? '正在发布…' : '发布动态'}</button></div>
    </form>
    {editingPhoto ? <MomentPhotoEditor key={editingPhoto.id} file={editingPhoto.file} availableFiles={photos.map(photo => photo.file)} onClose={() => setEditingId('')} onSave={file => applyEdit(editingPhoto.id, file)} /> : null}
  </DialogLayer>
}
