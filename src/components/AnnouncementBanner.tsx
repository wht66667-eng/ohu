import { useEffect, useState, type FocusEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { fetchNews, type News } from '../lib/bulletin'
import { infoTargetPath } from '../lib/info-target'
import { useUiVariant } from '../lib/ui-variant'
import styles from './AnnouncementBanner.module.css'

type BannerNews = Pick<News, 'id' | 'title' | 'summary' | 'cover'>
type BannerSlide =
  | { kind: 'intro'; id: 'intro' }
  | { kind: 'art'; id: 'art' }
  | ({ kind: 'news' } & BannerNews)
type BannerIntro = { eyebrow: string; title: string; summary: string; actionLabel: string; onAction: () => void; artwork?: ReactNode }

export function AnnouncementBanner({ fallback, preview, intro, rotateWithFallback = false }: { fallback: string; preview?: BannerNews; intro?: BannerIntro; rotateWithFallback?: boolean }) {
  const simple = useUiVariant() === 'pure' && !preview && !intro
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
  const slides: BannerSlide[] = preview
    ? [{ kind: 'news', ...preview }]
    : intro
      ? [{ kind: 'intro', id: 'intro' }, { kind: 'art', id: 'art' }, ...items.map(item => ({ kind: 'news' as const, ...item }))]
      : items.length
        ? [...(rotateWithFallback && !simple ? [{ kind: 'art' as const, id: 'art' as const }] : []), ...items.map(item => ({ kind: 'news' as const, ...item }))]
        : [{ kind: 'art', id: 'art' }]
  const activeIndex = index % slides.length
  const selected = slides[activeIndex]
  useEffect(() => {
    if (paused || slides.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setInterval(() => setIndex(value => (value + 1) % slides.length), 5000)
    return () => window.clearInterval(timer)
  }, [paused, slides.length])
  function resumeAfterFocusLeaves(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false)
  }
  const interactionProps = {
    onFocusCapture: () => setPaused(true),
    onBlurCapture: resumeAfterFocusLeaves,
  }
  if (simple) {
    const news = selected.kind === 'news' ? selected : null
    if (!news) return null
    return <div className={styles.simpleBanner} aria-label="校园公告" {...interactionProps}>
      <Link to={infoTargetPath('news', news.id)} aria-label={`查看公告：${news.title}`}>
        <span>校园公告</span><strong>{news.title || '公告标题'}</strong>
        {news.summary ? <span>{news.summary}</span> : null}<span aria-hidden="true">›</span>
      </Link>
      {slides.length > 1 ? <div className={styles.simpleDots} role="group" aria-label="选择公告">{slides.map((item, i) => <button key={item.id} type="button" aria-label={`查看第 ${i + 1} 条公告`} aria-current={i === activeIndex ? 'true' : undefined} onClick={() => setIndex(i)} />)}</div> : null}
    </div>
  }
  const art = <img src={fallback} width="800" height="317" alt="校园生活插画" style={{ objectFit: 'cover' }} />
  const content = selected.kind === 'intro' && intro ? (
    <div className={styles.introSlide}>
      <div className={styles.introCopy}><span>{intro.eyebrow}</span><strong>{intro.title}</strong><p>{intro.summary}</p><button type="button" onClick={intro.onAction}>{intro.actionLabel}</button></div>
      {intro.artwork ? <span className={styles.introArtwork} aria-hidden="true">{intro.artwork}</span> : null}
    </div>
  ) : selected.kind === 'news' ? (
    <><img src={selected.cover || fallback} width="800" height="317" alt="" style={{ objectFit: 'cover' }} onError={event => { if (event.currentTarget.src !== new URL(fallback, location.href).href) event.currentTarget.src = fallback }} /><span className={styles.caption}><small>校园公告</small><strong>{selected.title || '公告标题'}</strong>{selected.summary ? <span>{selected.summary}</span> : null}</span></>
  ) : art
  const newsSlide = selected.kind === 'news' ? selected : null
  const labeled = selected.kind === 'intro' ? '校园广场介绍' : selected.kind === 'news' ? `校园公告：${selected.title}` : '校园生活插画'
  return <div className={styles.banner} role="region" aria-label={preview ? '公告横幅预览' : labeled} aria-roledescription="轮播" {...interactionProps}>
    {newsSlide && !preview ? <Link to={infoTargetPath('news', newsSlide.id)} aria-label={`查看公告：${newsSlide.title}`}>{content}</Link> : <div>{content}</div>}
    {slides.length > 1 ? <div className={styles.dots} role="group" aria-label="选择轮播内容">{slides.map((item, i) => <button key={item.id} type="button" aria-label={`查看第 ${i + 1} 项`} aria-current={i === activeIndex ? 'true' : undefined} onClick={() => setIndex(i)} />)}</div> : null}
  </div>
}
