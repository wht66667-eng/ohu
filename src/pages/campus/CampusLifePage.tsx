import { lazy, Suspense, useSyncExternalStore } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { captureImSession, subscribeImSession } from '../../lib/im-session'
import { CampusNotes } from './CampusNotes'
import { CampusJournal } from './CampusJournal'
import styles from './CampusLifePage.module.css'

const Moments = lazy(() => import('../moments/MomentsPage').then(module => ({ default: module.MomentsPage })))
const Plaza = lazy(() => import('../plaza/PlazaPage').then(module => ({ default: module.PlazaPage })))

const notes = [
  { title: '找搭子', example: '约同学一起上自习、跑步或吃饭', to: '/meet' },
  { title: '失物招领', example: '找回忘在教室里的水杯', to: '/info?filter=失物招领' },
  { title: '求助', example: '问问选课、作业或校园生活', to: '/info?publish=help' },
  { title: '校园活动', example: '看看本周社团在办什么', to: '/info?filter=活动' },
]

export function CampusLifePage() {
  const [params] = useSearchParams()
  const auth = useAuth()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const owner = uid ? 'user:' + uid : 'guest'
  const revision = useSyncExternalStore(subscribeImSession, () => captureImSession(uid)?.revision ?? -1, () => -1)
  const section = params.get('section')
  const active = section === 'notes' || section === 'journal' ? section : 'feed'
  const friends = params.get('feed') === 'friends'
  return <section className={styles.page} aria-label="校园生活">
    <header className={`${styles.heading} paper-sheet`}>
      <div><p className={styles.campusDate}>{new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}</p><h1>校园生活</h1></div>
      {active === 'feed' && section !== 'publish' ? <div className={styles.headingLinks}>
        <Link to="/campus-life?section=notes">便签墙</Link>
        <Link to="/campus-life?section=journal&compose=diary">写今天</Link>
      </div> : null}
    </header>
    <nav className={styles.tabs} aria-label="校园生活栏目">
      <Link to="/campus-life" aria-current={active === 'feed' ? 'page' : undefined}>动态</Link>
      <Link to="/campus-life?section=notes" aria-current={active === 'notes' ? 'page' : undefined}>便签墙</Link>
      <Link to="/campus-life?section=journal" aria-current={active === 'journal' ? 'page' : undefined}>我的手账</Link>
    </nav>
    {section === 'publish' ? <nav className={styles.filters} aria-label="选择动态受众">
      <Link to="/campus-life?feed=friends&compose=1">好友可见</Link>
      <Link to="/campus-life?compose=1">发布到校园动态</Link>
    </nav> : active === 'feed' ? <>
      <nav className={styles.filters} aria-label="动态范围">
        <Link to="/campus-life" aria-current={!friends ? 'page' : undefined}>校园</Link>
        <Link to="/campus-life?feed=friends" aria-current={friends ? 'page' : undefined}>好友</Link>
        <Link to="/campus-map">地点</Link>
      </nav>
      <Suspense fallback={<p role="status" className={styles.message}>正在打开动态…</p>}>{friends ? <Moments textOnlyComposer /> : <Plaza />}</Suspense>
    </> : active === 'notes' ? <><div className={styles.notes}>
      {notes.map(note => <Link key={note.title} className={styles.note} to={note.to}><strong>{note.title}</strong><span>{note.example}</span></Link>)}
    </div><CampusNotes startComposing={params.get('compose') === 'note'} /></> : auth.phase === 'booting' ? <p role="status" className={styles.message}>正在确认当前账号…</p>
      : <CampusJournal key={owner + ':' + revision} owner={owner} compose={params.get('compose')} />}
  </section>
}
