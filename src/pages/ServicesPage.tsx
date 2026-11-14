import { useEffect, useLayoutEffect, useState } from 'react'
import { Link, useNavigationType, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { IconSearch } from '../components/Icons'
import { StudentServiceArtwork } from '../components/brand/StudentServiceArtwork'
import { MessageEntry } from '../components/MessageEntry'
import { EnabledPluginFeatures } from '../components/EnabledPluginFeatures'
import { FocusThemeToggle } from '../components/focus/FocusInteractions'
import { FoxInline } from '../components/fox/FoxInline'
import { FoxPaw } from '../components/fox/FoxMarks'
import { ExpressTrackSheet } from '../components/ExpressTrackSheet'
import { SERVICE_ACCESS_COPY, SERVICE_CATALOG, SERVICE_CATEGORIES, SERVICE_GROUPS, findCampusService, type CampusService, type ServiceAccess, type ServiceCategory } from '../lib/service-catalog'
import { defaultServicePins, resolveServicePresentation, useServiceLayoutPreferences } from '../lib/service-layout'
import { RECENT_SERVICE_EVENT, readRecentServices, recentServiceKey, recordRecentService } from '../lib/service-recent'
import { openExternalUrl } from '../lib/campus-links'
import { fadeUp } from '../lib/animations'
import { useUiMotion } from '../lib/motion-pref'
import { isFoxFreeVariant, useUiVariant } from '../lib/ui-variant'
import { useAuth } from '../lib/auth'
import { useEntryTrack } from '../lib/entry-track'
import s from './services.module.css'

const CATEGORIES = [['all', '全部'], ...SERVICE_CATEGORIES] as const
const SERVICE_BY_ID = new Map(SERVICE_CATALOG.map(item => [item.id, item]))
type Category = ServiceCategory | 'all'
type EntryKind = 'tile' | 'quick' | 'result'
function accessOf(item: CampusService): ServiceAccess { return item.access || 'ohu' }

function ServiceEntry({ item, kind = 'tile', onUse }: {
  item: CampusService; kind?: EntryKind; onUse: (item: CampusService) => void
}) {
  const content = <>
    <span className={s.entryArt} aria-hidden="true"><StudentServiceArtwork id={item.id} fallback={item.artwork} /></span>
    <span className={s.entryCopy}><b>{item.title}</b>{kind === 'result' ? <small>{item.desc}</small> : null}</span>
    {kind === 'result' || kind === 'tile' ? <span className={s.access}>{SERVICE_ACCESS_COPY[accessOf(item)]}</span> : null}
  </>
  const className = `${s.entry} ${s[kind]}`
  const label = `${item.title}，${item.desc}，${SERVICE_ACCESS_COPY[accessOf(item)]}`
  return item.action === 'express' || item.action === 'external'
    ? <button type="button" className={className} aria-label={label} onClick={() => onUse(item)}>{content}</button>
    : <Link to={item.to} className={className} aria-label={label} onClick={() => onUse(item)}>{content}</Link>
}

export function ServicesPage() {
  const auth = useAuth()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  /** TASK-A6：社工端隐藏学生专属（教务类）服务入口，只藏按钮不删路由 */
  const social = useEntryTrack() === 'social'
  const visibleToTrack = (item: CampusService) => !(social && item.studentOnly)
  const variant = useUiVariant()
  const showFox = !isFoxFreeVariant(variant)
  const handdrawn = variant === 'handdrawn'
  const ink = variant === 'ink'
  const classic = variant === 'classic'
  const preferences = useServiceLayoutPreferences(variant)
  const presentation = resolveServicePresentation(variant, preferences.mode)
  const [params, setParams] = useSearchParams()
  const navigationType = useNavigationType()
  const queryParam = params.get('q') || ''
  const [q, setQuery] = useState(queryParam)
  useLayoutEffect(() => {
    if (navigationType === 'POP') setQuery(queryParam)
  }, [navigationType, queryParam])
  const category = CATEGORIES.find(([id]) => id === params.get('category'))?.[0] ?? 'all'
  const [expressOpen, setExpressOpen] = useState(false)
  const quickView = params.get('quick')
  const hasQuickView = quickView === 'pinned' || quickView === 'recent'
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
  const recentItems = recent.uid === uid && uid ? recent.rows.map(findCampusService).filter((item): item is CampusService => !!item).filter(visibleToTrack).slice(0, 6) : []
  const pinnedItems = (preferences.pinned ?? defaultServicePins(variant)).flatMap(id => {
    const item = SERVICE_BY_ID.get(id)
    return item && visibleToTrack(item) ? [item] : []
  })
  const showRecent = !!uid && (quickView === 'recent' || (!hasQuickView && !preferences.pinned && recentItems.length > 0))
  const quickItems = showRecent ? recentItems : pinnedItems
  const searchKey = q.trim().toLocaleLowerCase('zh-CN')
  const browsing = !searchKey && category === 'all'
  const notebook = presentation === 'handdrawn'
  const showGroups = !searchKey && (category === 'all' || notebook)
  const groups = category === 'all' ? SERVICE_GROUPS : SERVICE_GROUPS.filter(group => group.category === category)
  const list = SERVICE_CATALOG.filter(item => (category === 'all' || item.category === category)
    && (!searchKey || `${item.title} ${item.desc} ${item.artwork} ${item.keywords || ''}`.toLocaleLowerCase('zh-CN').includes(searchKey))
    && visibleToTrack(item))
  function updateView(values: { q?: string; category?: Category; quick?: 'pinned' | 'recent' }) {
    if (values.q !== undefined) setQuery(values.q)
    const nextParams = new URLSearchParams(params)
    for (const [key, value] of Object.entries(values)) {
      if (value && !(key === 'category' && value === 'all')) nextParams.set(key, value)
      else nextParams.delete(key)
    }
    if (nextParams.toString() !== params.toString()) setParams(nextParams, { replace: true })
  }
  function used(item: CampusService) {
    if (item.action === 'express' && !auth.isSigned) { auth.openLogin('使用取件与查物流需要先登录哦狐'); return }
    recordRecentService(uid, item.to)
    if (item.action === 'express') setExpressOpen(true)
    if (item.action === 'external' && item.externalUrl) openExternalUrl(item.externalUrl)
  }
  return <motion.div className={s.page} data-service-layout={presentation} data-service-skin={variant} {...fadeUp(reduce)}>
    <header className={s.header}>
      {ink ? <div className={s.inkHeading}>
        <h1>校园服务</h1>
        <img src="/brand/ink/ink-fox.svg" alt="" width={46} height={38} data-ink-fox />
      </div>
        : classic ? <div className={s.classicTitle}>
          <Link to="/" className={s.wordmark} aria-label="哦狐首页"><img src="/brand/ohu-original/ohu-wordmark-transparent.png" width="197" height="114" alt="" /></Link>
          <h1 className={s.simpleTitle}>校园服务</h1>
        </div>
        : <h1 className={s.simpleTitle}>{handdrawn ? '校园索引' : variant === 'pure' ? '服务' : '校园服务'}</h1>}
      <form role="search" className={s.search} onSubmit={event => { event.preventDefault(); updateView({ q: q.trim() }) }}>
        <IconSearch size={20} color="currentColor" />
        <input type="search" aria-label="搜索校园服务" placeholder="搜索服务，如「查分」「课程表」" value={q} onChange={event => updateView({ q: event.target.value })} />
      </form>
      <div className={s.headerActions}><FocusThemeToggle /><MessageEntry /></div>
    </header>
    {browsing && showFox && !handdrawn && !ink ? <div className={s.banner}><img src="/ohu-v4-assets/services-campus-banner.webp" width="863" height="261" alt="和哦狐一起探索校园服务" fetchPriority="high" /></div> : null}
    {browsing ? <>
      <section className={ink ? s.panel + " " + s.inkQuickPanel : s.panel} aria-labelledby="services-recent-title">
        <div className={s.panelHead}><h2 id="services-recent-title">{handdrawn ? '常用书签' : '快捷直达'}</h2><Link className={s.layoutLink} to="/settings?section=appearance">布局设置</Link>{handdrawn ? <img className={s.panelFox} src="/brand/handdrawn/fox-greeting.png" alt="" aria-hidden="true" /> : null}</div>
        {uid ? <div className={s.quickTabs} role="group" aria-label="快捷入口视图">
          <button type="button" aria-pressed={!showRecent} onClick={() => updateView({ quick: 'pinned' })}>常用入口</button>
          <button type="button" aria-pressed={showRecent} onClick={() => updateView({ quick: 'recent' })}>最近使用</button>
        </div> : null}
        {quickItems.length > 0
          ? <nav className={s.quickGrid} aria-label={showRecent ? '最近使用' : '常用入口'}>{quickItems.map(item => <ServiceEntry key={item.id} item={item} kind="quick" onUse={used} />)}</nav>
          : <p className={s.quickEmpty}>还没有使用记录。打开一个校园服务后，就会出现在这里。</p>}
      </section>
      <section className={`${s.panel} ${s.pluginMarket}`} aria-labelledby="services-plugin-market-title">
        <div className={s.pluginMarketCopy}>
          <span className={s.pluginMarketIcon} aria-hidden="true">{showFox ? <FoxPaw size={23} /> : '✦'}</span>
          <div><h2 id="services-plugin-market-title">哦狐插件</h2><p>轻量学习工具与趣味玩法 · 审核后随版本更新</p></div>
        </div>
        <Link className={s.pluginMarketLink} to="/plugins">逛插件商城 <span aria-hidden="true">›</span></Link>
      </section>
    </> : null}
    <div className={s.filters} role="group" aria-label="筛选服务分类">{CATEGORIES.map(([id, title]) => <button key={id} type="button" aria-pressed={category === id} onClick={() => updateView({ category: id })}>{title}</button>)}</div>
    <p className={s.results} role="status">{q.trim() ? `「${q.trim()}」` : CATEGORIES.find(([id]) => id === category)![1]} · {list.length} 项服务</p>
    {showGroups ? <div className={s.groups}>{groups.map(group => {
      const items = group.ids.flatMap(id => {
        const item = SERVICE_BY_ID.get(id)
        return item && visibleToTrack(item) ? [item] : []
      })
      if (!items.length) return null
      const content = <>
        <div className={s.groupHead}>
          <span className={s.groupMark} aria-hidden="true"><StudentServiceArtwork id={items[0].id} fallback={items[0].artwork} size={34} /></span>
          <div><h2>{group.title}</h2></div>
          <small>{items.length} 项</small>
        </div>
        <div className={s.groupGrid}>{items.map(item => <ServiceEntry key={item.id} item={item} onUse={used} />)}</div>
      </>
      if (browsing && group.id === 'map-checkin') return <div key={group.id} className={s.mapPluginPair}>
        <section className={s.panel} aria-label={group.title}>{content}</section>
        <EnabledPluginFeatures />
      </div>
      return <section key={group.id} className={s.panel} aria-label={group.title}>
        {content}
      </section>
    })}</div> : list.length ? <div className={s.resultGrid}>{list.map(item => <ServiceEntry key={item.id} item={item} kind="result" onUse={used} />)}</div>
      : <div className={s.empty}><FoxInline variant="empty" size={48} text={q.trim() ? `没有「${q.trim()}」相关服务` : '当前分类没有服务'} sub="试试其他关键词，或清除筛选查看全部。" action={{ label: '查看全部服务', onClick: () => updateView({ q: '', category: 'all' }) }} /></div>}
    {expressOpen ? <ExpressTrackSheet onClose={() => setExpressOpen(false)} /> : null}
  </motion.div>
}
