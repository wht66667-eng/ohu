import { useState } from 'react'
import { taskImageUrls } from '../lib/task-images'
import { DialogLayer } from './ui/DialogLayer'
import styles from './TaskImages.module.css'

export function TaskImageThumb({ images }: { images?: unknown }) {
  const urls = taskImageUrls(images)
  if (!urls.length) return null
  return <div className={styles.listThumb}>
    <img src={urls[0]} alt={`任务附图，共 ${urls.length} 张`} loading="lazy" />
    {urls.length > 1 ? <span>{urls.length} 张</span> : null}
  </div>
}

export function TaskImageGallery({ images }: { images?: unknown }) {
  const urls = taskImageUrls(images)
  const [active, setActive] = useState<number | null>(null)
  const [failed, setFailed] = useState<string[]>([])
  if (!urls.length) return null
  const selected = active === null ? '' : urls[active] || ''
  const error = (url: string) => setFailed((list) => list.includes(url) ? list : [...list, url])
  return <section aria-label="任务图片" className={styles.gallery}>
    <h2 className={styles.galleryTitle}>任务图片 <span>点击查看大图</span></h2>
    <div className={styles.galleryRow}>
      {urls.map((url, index) => <button key={url} type="button" className={styles.galleryImage} aria-label={`查看任务图片 ${index + 1}`} onClick={() => setActive(index)}>
        {failed.includes(url) ? <span>图片暂时无法加载</span> : <img src={url} alt={`任务图片 ${index + 1}`} loading="lazy" onError={() => error(url)} />}
      </button>)}
    </div>
    {selected ? <DialogLayer title={`任务图片 ${(active || 0) + 1}/${urls.length}`} full onClose={() => setActive(null)} className={styles.viewer}>
      <div className={styles.viewerHead}><span>{(active || 0) + 1} / {urls.length}</span><button type="button" onClick={() => setActive(null)}>关闭</button></div>
      <div className={styles.viewerBody}>
        {failed.includes(selected) ? <div className={styles.imageFailure}><p>图片暂时无法加载</p><button type="button" onClick={() => setFailed((list) => list.filter((url) => url !== selected))}>重新加载</button></div> : <img src={selected} alt={`任务图片 ${(active || 0) + 1}`} onError={() => error(selected)} />}
      </div>
      {urls.length > 1 ? <div className={styles.viewerNav}><button type="button" disabled={active === 0} onClick={() => setActive((index) => Math.max(0, (index || 0) - 1))}>上一张</button><button type="button" disabled={active === urls.length - 1} onClick={() => setActive((index) => Math.min(urls.length - 1, (index || 0) + 1))}>下一张</button></div> : null}
    </DialogLayer> : null}
  </section>
}
