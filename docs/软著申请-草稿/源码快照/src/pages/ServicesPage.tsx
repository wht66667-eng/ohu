import { FoxSheetPose } from '../components/fox/FoxSheetPose'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { IconSearch } from '../components/Icons'
import { StudentServiceArtwork } from '../components/brand/StudentServiceArtwork'
import { MessageEntry } from '../components/MessageEntry'
import { FocusThemeToggle } from '../components/focus/FocusInteractions'
import { FoxInline } from '../components/fox/FoxInline'
import { ExpressTrackSheet } from '../components/ExpressTrackSheet'
import { useAuth } from '../lib/auth'
import { SERVICE_CATALOG, SERVICE_CATEGORIES, SERVICE_GROUPS, findCampusService, type CampusService, type ServiceCategory } from '../lib/service-catalog'
import { RECENT_SERVICE_EVENT, readRecentServices, recentServiceKey, recordRecentService } from '../lib/service-recent'
import { fadeUp } from '../lib/animations'
import { useUiMotion } from '../lib/motion-pref'
import { isFoxFreeVariant, useUiVariant } from '../lib/ui-variant'
import s from './services.module.css'

const CATEGORIES = [['all', '全部'], ...SERVICE_CATEGORIES] as const
const QUICK_IDS = ['schedule', 'todo', 'map', 'nearby-food', 'ai', 'bus']
const FEATURED_IDS = ['schedule', 'grades', 'todo', 'campus-card']
const GROUP_COPY: Readonly<Record<string, string>> = {
  coursework: '学习更有安排', english: '每天进步一点', 'campus-life': '校园日常，一键直达',
  'map-checkin': '探索身边的好地方', 'peer-help': '同学们都在这里', 'ai-tools': '你的学习工具箱',
}
type Category = ServiceCategory | 'all'
type EntryKind = 'tile' | 'quick' | 'featured' | 'result'

function ServiceEntry({ item, kind = 'tile', artIndex, onUse }: {
  item: CampusService; kind?: EntryKind; artIndex?: number; onUse: (item: CampusService) => void
}) {
  const content = <>
    <span className={s.entryArt} aria-hidden="true">{kind === 'featured' && artIndex != null
      ? <FoxSheetPose pose={(['reading','cheering','studying','phone'] as const)[artIndex % 4]} />
      : <StudentServiceArtwork id={item.id} fallback={item.artwork} />}</span>
    <span className={s.entryCopy}><b>{item.title}</b>{kind === 'featured' || kind === 'result' ? <small>{item.desc}</small> : null}</span>
    {kind === 'result' && item.official ? <span className={s.official}>官方入口</span> : null}
  </>
  const className = `${s.entry} ${s[kind]}`
  const label = `${item.title}，${item.desc}${item.official ? '，官方平台入口' : ''}`
  return item.action === 'express'
    ? <button type="button" className={className} aria-label={label} onClick={() => onUse(item)}>{content}</button>
    : <Link to={item.to} className={className} aria-label={label} onClick={() => onUse(item)}>{content}</Link>
}

export function ServicesPage() {
  const auth = useAuth()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const variant = useUiVariant()
  const showFox = !isFoxFreeVariant(variant)
  const [params, setParams] = useSearchParams()
  const q = params.get('q') || ''
  const [category, setCategory] = useState<Category>('all')
  const [expressOpen, setExpressOpen] = useState(false)
  const [recent, setRecent] = useState<{ uid: string; rows: string[] }>(() => ({ uid, rows: readRecentServices(uid) }))
  const reduce = useUiMotion()
  useEffect(() => {
    const load = () => setRecent({ uid, rows: readRecentServices(uid) })
    load()
    const onLocal = (event: Event) => { if ((event as CustomEvent<string>).detail === uid) load() }
    const onStorage = (event: StorageEvent) => { if (event.key === recentServiceKey(uid) || event.key == null) load() }
    window.addEventListener(RECENT_SERVICE_EVENT, onLocal)
    window.addEventListener('storage', onStorage)
    return () => { window.removeEventListener(RECENT_SERVICE_EVENT, onLocal); window.removeEventListener('storage', onStorage) }
  }, [uid])
  const recentItems = recent.uid === uid && uid ? recent.rows.map(findCampusService).filter((item): item is CampusService => !!item).slice(0, 6) : []
  const quickItems = recentItems.length ? recentItems : QUICK_IDS.flatMap(id => SERVICE_CATALOG.filter(item => item.id === id))
  const featured = FEATURED_IDS.flatMap(id => SERVICE_CATALOG.filter(item => item.id === id))
  const browsing = !q.trim() && category === 'all'
  const list = useMemo(() => {
    const key = q.trim().toLocaleLowerCase('zh-CN')
    return SERVICE_CATALOG.filter(item => (category === 'all' || item.category === category)
      && (!key || `${item.title} ${item.desc} ${item.artwork}`.toLocaleLowerCase('zh-CN').includes(key)))
  }, [q, category])
  function search(next: string) {
    const nextParams = new URLSearchParams(params)
    if (next) nextParams.set('q', next)
    else nextParams.delete('q')
    setParams(nextParams, { replace: true })
  }
  function used(item: CampusService) {
    if (item.action === 'express' && !auth.isSigned) { auth.openLogin('使用取件与查物流需要先登录哦狐'); return }
    recordRecentService(uid, item.to)
    if (item.action === 'express') setExpressOpen(true)
  }
  return <motion.div className={s.page} {...fadeUp(reduce)}>
    <h1 className={s.srOnly}>校园服务</h1>
    <header className={s.header}>
      <Link to="/" className={s.wordmark} aria-label="哦狐首页"><img src="/brand/ohu-original/ohu-wordmark-transparent.png" width="197" height="114" alt="哦狐 · OHU CAMPUS APP" /></Link>
      <form role="search" className={s.search} onSubmit={event => { event.preventDefault(); search(q.trim()) }}>
        <IconSearch size={20} color="currentColor" />
        <input type="search" aria-label="搜索校园服务" placeholder="搜索服务、课程、活动…" value={q} onChange={event => search(event.target.value)} />
      </form>
      <div className={s.headerActions}><FocusThemeToggle /><MessageEntry /></div>
    </header>
    {browsing && showFox ? <div className={s.banner}><img src="/ohu-v4-assets/services-campus-banner.webp" width="863" height="261" alt="和哦狐一起探索校园服务" fetchPriority="high" /></div> : null}
    {browsing ? <>
      <section className={s.panel} aria-labelledby="services-recent-title">
        <div className={s.panelHead}><h2 id="services-recent-title"><span aria-hidden="true">✦</span>{recentItems.length ? '最近使用' : '快捷直达'}</h2><span>{recentItems.length ? '本机使用记录' : '常用服务，一键直达'}</span></div>
        <nav className={s.quickGrid} aria-label={recentItems.length ? '最近使用' : '快捷直达'}>{quickItems.map(item => <ServiceEntry key={item.id} item={item} kind="quick" onUse={used} />)}</nav>
      </section>
      {showFox ? <section className={s.panel} aria-labelledby="services-featured-title">
        <div className={s.panelHead}><h2 id="services-featured-title"><span aria-hidden="true">☆</span>常用功能</h2><span>学习与校园生活</span></div>
        <div className={s.featuredGrid}>{featured.map((item, index) => <ServiceEntry key={item.id} item={item} kind="featured" artIndex={index} onUse={used} />)}</div>
      </section> : null}
    </> : null}
    <div className={s.filters} role="group" aria-label="筛选服务分类">{CATEGORIES.map(([id, title]) => <button key={id} type="button" aria-pressed={category === id} onClick={() => setCategory(id)}>{title}</button>)}</div>
    <p className={s.results} role="status">{q.trim() ? `「${q.trim()}」` : CATEGORIES.find(([id]) => id === category)![1]} · {list.length} 项服务</p>
    {browsing ? <div className={s.groups}>{SERVICE_GROUPS.map(group => {
      const items = group.ids.flatMap(id => SERVICE_CATALOG.filter(item => item.id === id))
      return <section key={group.id} className={s.panel} aria-label={group.title}>
        <div className={s.groupHead}><span className={s.groupMark} aria-hidden="true"><StudentServiceArtwork id={items[0].id} fallback={items[0].artwork} size={34} /></span><div><h2>{group.title}</h2><p>{GROUP_COPY[group.id]}</p></div><small>{items.length} 项</small></div>
        <div className={s.groupGrid}>{items.map(item => <ServiceEntry key={item.id} item={item} onUse={used} />)}</div>
      </section>
    })}</div> : list.length ? <div className={s.resultGrid}>{list.map(item => <ServiceEntry key={item.id} item={item} kind="result" onUse={used} />)}</div>
      : <div className={s.empty}><FoxInline variant="empty" size={48} text={q.trim() ? `没有「${q.trim()}」相关服务` : '当前分类没有服务'} sub="试试其他关键词，或清除筛选查看全部。" action={{ label: '查看全部服务', onClick: () => { search(''); setCategory('all') } }} /></div>}
    {expressOpen ? <ExpressTrackSheet onClose={() => setExpressOpen(false)} /> : null}
  </motion.div>
}
