import { useEffect, useMemo, useRef, useState } from 'react'
import { MapIcon, type MapIconName } from './MapIcons'
import { JOU_OFFICIAL_MAP } from '../../lib/jou-campus-reference'
import s from './CampusBuildingDirectory.module.css'

type Building = { id: string; name: string; short: string; num: number | string; cat: string; zone: string; depts: string; desc: string; floors: number; height: number; planned: boolean; landmark: boolean }
type DirectoryCampus = { id: string; title: string; buildings: Building[] }
type Directory = { source: string; note: string; categories: string[]; campuses: DirectoryCampus[] }

const CATEGORY_ICON: Record<string, MapIconName> = {
  教学科研: 'study', 行政图书: 'book', 静思湖·园林: 'checkin', 体育场馆: 'fun', 餐饮生活: 'food', 学生公寓: 'life',
}
function categoryIcon(cat: string): MapIconName { return CATEGORY_ICON[cat] ?? 'all' }

type Props = { onClose: () => void; initialCampus?: string }

/** Read-only official building directory. Names/numbers/departments only — no surveyed coordinates. */
export function CampusBuildingDirectory({ onClose, initialCampus }: Props) {
  const [data, setData] = useState<Directory | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [campus, setCampus] = useState(initialCampus || 'cangwu')
  const [category, setCategory] = useState('全部')
  const [query, setQuery] = useState('')
  const [attempt, setAttempt] = useState(0)
  const sheetRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/maps/jou-building-directory.json', { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error(`http ${response.status}`); return response.json() as Promise<Directory> })
      .then(directory => { if (!controller.signal.aborted) { setData(directory); setStatus('ready') } })
      .catch(() => { if (!controller.signal.aborted) setStatus('error') })
    return () => controller.abort()
  }, [attempt])

  useEffect(() => {
    sheetRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const activeCampus = data?.campuses.find(c => c.id === campus) ?? data?.campuses[0]
  const results = useMemo(() => {
    if (!activeCampus) return []
    const text = query.trim().toLocaleLowerCase('zh-CN')
    return activeCampus.buildings.filter(b =>
      (category === '全部' || b.cat === category)
      && (!text || `${b.name} ${b.short} ${b.depts} ${b.zone} ${b.desc} ${b.cat} ${b.num}`.toLocaleLowerCase('zh-CN').includes(text)))
  }, [activeCampus, category, query])

  return <div className={s.scrim} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <section className={s.sheet} role="dialog" aria-modal="true" aria-labelledby="directory-title" tabIndex={-1} ref={sheetRef}>
      <header className={s.head}>
        <div><span className={s.eyebrow}>OHU · CAMPUS DIRECTORY</span><h2 id="directory-title">校园建筑目录</h2></div>
        <button type="button" className={s.close} onClick={onClose} aria-label="关闭建筑目录"><MapIcon name="close" /></button>
      </header>
      <p className={s.note}>建筑名称、官方编号、院系与描述整理自学校官方平面示意图（二次开发）。本目录不提供实测坐标，地图位置以现场与公开地图为准。<a href={JOU_OFFICIAL_MAP} target="_blank" rel="noreferrer">官方校园图 ↗</a></p>
      {status === 'loading' ? <div className={s.state} role="status">正在加载建筑目录…</div>
        : status === 'error' ? <div className={s.state} role="alert">建筑目录暂时无法加载，请检查网络后重试。<button type="button" className={s.retry} onClick={() => { setStatus('loading'); setAttempt(a => a + 1) }}>重试</button></div>
        : data ? <>
          <div className={s.tabs} role="group" aria-label="选择校区">{data.campuses.map(c => <button type="button" key={c.id} aria-pressed={c.id === (activeCampus?.id ?? campus)} onClick={() => setCampus(c.id)}>{c.title.replace('主校区', '').replace('校区', '')}<small>{c.buildings.length}</small></button>)}</div>
          <label className={s.search}><MapIcon name="search" /><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索建筑名称、官方编号、院系…" aria-label="搜索校园建筑" />{query ? <button type="button" aria-label="清空建筑搜索" onClick={() => setQuery('')}><MapIcon name="close" /></button> : null}</label>
          <div className={s.cats} role="group" aria-label="建筑分类">{['全部', ...data.categories].map(c => <button type="button" key={c} aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>)}</div>
          <div className={s.count} role="status">{activeCampus?.title} · 共 {activeCampus?.buildings.length ?? 0} 栋{category !== '全部' || query ? ` · 显示 ${results.length} 栋` : ''}</div>
          <ul className={s.list}>
            {results.length ? results.map(b => <li className={s.card} key={b.id}>
              <span className={s.icon}><MapIcon name={categoryIcon(b.cat)} /></span>
              <div className={s.body}>
                <h3 className={s.name}>{b.name}</h3>
                <div className={s.tags}><span className={s.cat}>{b.cat}</span>{b.landmark ? <span className={s.landmark}>地标</span> : null}{b.planned ? <span className={s.planned}>规划/新建</span> : null}{b.zone ? <span className={s.zone}>{b.zone}</span> : null}</div>
                {b.depts ? <p className={s.depts}><b>院系 / 用途</b>{b.depts}</p> : null}
                {b.desc ? <p className={s.desc}>{b.desc}</p> : null}
                {b.floors >= 2 ? <span className={s.floors}>约 {b.floors} 层（示意）</span> : null}
              </div>
            </li>) : <li className={s.state}>没有找到对应建筑，试试其他校区、分类或关键词。</li>}
          </ul>
        </> : null}
    </section>
  </div>
}