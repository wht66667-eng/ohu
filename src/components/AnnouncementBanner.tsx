import { useEffect, useState, type FocusEvent } from 'react'
import { Link } from 'react-router-dom'
import { fetchNews, type News } from '../lib/bulletin'
import { infoTargetPath } from '../lib/info-target'
import { useUiVariant } from '../lib/ui-variant'
import styles from './AnnouncementBanner.module.css'

type BannerNews = Pick<News, 'id' | 'title' | 'summary' | 'cover'>
export function AnnouncementBanner({ fallback, preview }: { fallback: string; preview?: BannerNews }) {
  const simple = useUiVariant() === 'pure' && !preview
  const [items, setItems] = useState<BannerNews[]>([])
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (preview) return
    let active = true
    const load = () => { void fetchNews().then(result => { if (active && !result.error) setItems(result.rows) }).catch(() => {}) }
    load()
    const timer = window.setInterval(load, 60000)
    return () => { active = false; window.clearInterval(timer) }
  }, [preview])
  const rows = preview ? [preview] : items
  const selected = rows[index % (rows.length || 1)]
  useEffect(() => {
    if (paused || rows.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setInterval(() => setIndex(value => (value + 1) % rows.length), 5000)
    return () => window.clearInterval(timer)
  }, [paused, rows.length])
  function resumeAfterFocusLeaves(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false)
  }
  const interactionProps = {
    onMouseEnter: () => setPaused(true),
    onMouseLeave: () => setPaused(false),
    onFocusCapture: () => setPaused(true),
    onBlurCapture: resumeAfterFocusLeaves,
  }
  if (simple) {
    if (!selected) return null
    return <div className={styles.simpleBanner} aria-label="校园公告" {...interactionProps}>
      <Link to={infoTargetPath('news', selected.id)} aria-label={`查看公告：${selected.title}`}>
        <span>校园公告</span><strong>{selected.title || '公告标题'}</strong>
        {selected.summary ? <span>{selected.summary}</span> : null}<span aria-hidden="true">›</span>
      </Link>
      {rows.length > 1 ? <div className={styles.simpleDots} role="group" aria-label="选择公告">{rows.map((item, i) => <button key={item.id} type="button" aria-label={`查看第 ${i + 1} 条公告`} aria-current={i === index % rows.length ? 'true' : undefined} onClick={() => setIndex(i)} />)}</div> : null}
    </div>
  }
  const content = <><img src={selected?.cover || fallback} width="800" height="317" alt="" style={{ objectFit: 'cover' }} onError={event => { if (event.currentTarget.src !== new URL(fallback, location.href).href) event.currentTarget.src = fallback }} />{selected ? <span className={styles.caption}><small>校园公告</small><strong>{selected.title || '公告标题'}</strong>{selected.summary ? <span>{selected.summary}</span> : null}</span> : null}</>
  return <div className={styles.banner} aria-label={preview ? '公告横幅预览' : selected ? '校园公告' : '校园生活插画'} {...interactionProps}>
    {selected && !preview ? <Link to={infoTargetPath('news', selected.id)} aria-label={`查看公告：${selected.title}`}>{content}</Link> : <div>{content}</div>}
    {rows.length > 1 ? <div className={styles.dots} role="group" aria-label="选择公告">{rows.map((item, i) => <button key={item.id} type="button" aria-label={`查看第 ${i + 1} 条公告`} aria-current={i === index % rows.length ? 'true' : undefined} onClick={() => setIndex(i)} />)}</div> : null}
  </div>
}
