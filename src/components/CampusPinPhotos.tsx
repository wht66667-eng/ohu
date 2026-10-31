import { useEffect, useState } from 'react'
import { ImagePickButton } from './ImageUploadField'
import { MAX_PIN_PHOTOS, readPinPhotos } from '../lib/campus-map-photos'
import type { CampusPoi } from '../lib/campus-map'
import s from './CampusPinPhotos.module.css'

export function PinPhotoPicker({ files, onChange, disabled }: { files: File[]; onChange: (files: File[]) => void; disabled: boolean }) {
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => { const next = files.map(f => URL.createObjectURL(f)); setUrls(next); return () => next.forEach(u => URL.revokeObjectURL(u)) }, [files])
  return <div className={s.picker}><div className={s.heading}><b>地点照片</b><span>{files.length}/{MAX_PIN_PHOTOS} · 选填</span></div><div className={s.photos}>{urls.map((url, i) => <div className={s.thumb} key={url}><img src={url} alt={`待保存照片 ${i + 1}`} /><button type="button" disabled={disabled} aria-label={`移除照片 ${i + 1}`} onClick={() => onChange(files.filter((_, n) => n !== i))}>×</button></div>)}</div><div className={s.actions}><ImagePickButton label="从相册选择" ariaLabel="选择地点照片" multiple disabled={disabled || files.length >= MAX_PIN_PHOTOS} onPick={added => onChange([...files, ...added].slice(0, MAX_PIN_PHOTOS))} /><ImagePickButton label="拍一张" ariaLabel="拍摄地点照片" capture="environment" disabled={disabled || files.length >= MAX_PIN_PHOTOS} onPick={added => onChange([...files, ...added].slice(0, MAX_PIN_PHOTOS))} /></div><small>本机保存不会上传照片；提交审核时，照片会随地点一起上传。</small></div>
}
export function PinPhotoGallery({ urls }: { urls: string[] }) {
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => { setPreview(null) }, [urls])
  return <><div className={s.photos}>{urls.map((url, i) => <button className={s.photoButton} key={`${url}-${i}`} type="button" aria-label={`查看地点照片 ${i + 1}`} onClick={() => setPreview(url)}><img src={url} alt={`地点照片 ${i + 1}`} loading="lazy" /></button>)}</div>{preview ? <div className={s.lightbox} role="dialog" aria-modal="true" aria-label="地点照片大图" onClick={() => setPreview(null)} onKeyDown={e => { if (e.key === 'Escape') setPreview(null) }}><button type="button" autoFocus aria-label="关闭照片" onClick={() => setPreview(null)}>×</button><img src={preview} alt="地点照片大图" /></div> : null}</>
}
export function LocalPinPhotoGallery({ poi, uid }: { poi: CampusPoi; uid: string }) {
  const [urls, setUrls] = useState<string[]>([]), [error, setError] = useState('')
  useEffect(() => {
    let live = true; const objectUrls: string[] = []; setUrls([]); setError('')
    if (poi.local_photo_count) void readPinPhotos(uid, poi.id).then(files => { if (live) { objectUrls.push(...files.map(f => URL.createObjectURL(f))); setUrls(objectUrls) } }).catch(() => { if (live) setError('本机照片暂时无法读取') })
    return () => { live = false; objectUrls.forEach(url => URL.revokeObjectURL(url)) }
  }, [uid, poi.id, poi.local_photo_count])
  return <>{error ? <p role="status">{error}</p> : null}<PinPhotoGallery urls={urls} /></>
}
