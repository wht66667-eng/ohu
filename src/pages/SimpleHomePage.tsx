import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CampusIcon } from '../components/CampusIcon'
import { IconGear } from '../components/Icons'
import { QuickRecordSheet } from '../components/QuickRecordSheet'
import { useAuth } from '../lib/auth'
import { markBootReady } from '../lib/boot'
import { localDateKey } from '../lib/chat-fortune'
import { listLifeRecordsByDay, summarizeLifeRecords, formatCents, LIFE_RECORDS_CHANGED_EVENT, type LifeRecord, type LifeRecordKind } from '../lib/life-records'
import { getNextClass, getScheduleRowsForDate } from '../lib/schedule-cache'
import { isBackgroundSyncRunning } from '../lib/background-sync'
import { loadLocalIdentity } from '../lib/local-identity'
import { useSchool } from '../store/school'
import { useEntryTrack } from '../lib/entry-track'
import { SocialSharedScheduleSection, SocialSpaceCard } from '../components/SocialHomeSections'
import { useUiMotion } from '../lib/motion-pref'
import { useUiVariant } from '../lib/ui-variant'
import { HomeLayoutDialog } from './home/HomeLayoutDialog'
import { HOME_SHORTCUTS, readHomeSkinLayout, saveHomeSkinLayout, type HomeSkinLayout } from './home/home-skin-layout'
import styles from './SimpleHomePage.module.css'
import opening from '../components/HomeOpening.module.css'

const simpleGlyphs: Partial<Record<HomeSkinLayout['shortcuts'][number], string>> = {
  schedule: '课', grades: '绩', exams: '考', todo: '办', calendar: '历', oneclick: '更',
}

/** TASK-A6：社工端隐藏的学生专属快捷入口（课表/成绩/考试/校历/更新校园数据）；待办等通用入口保留 */
const STUDENT_ONLY_SHORTCUTS = new Set<HomeSkinLayout['shortcuts'][number]>(['schedule', 'grades', 'exams', 'calendar', 'oneclick'])


function daysUntil(dateTime: string): number | null {
  const time = Date.parse(dateTime.replace(' ', 'T'))
  if (!Number.isFinite(time)) return null
  return Math.ceil((time - Date.now()) / 86_400_000)
}

export function SimpleHomePage() {
  const skin = useUiVariant()
  const ink = skin === 'ink'
  const classic = skin === 'classic'
  const handdrawn = skin === 'handdrawn'
  const simple = skin === 'pure'
  const reducedMotion = useUiMotion()
  const [journalTurn, setJournalTurn] = useState(0)
  const auth = useAuth()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const [params, setParams] = useSearchParams()
  const [layoutOverride, setLayoutOverride] = useState<{ uid: string; skin: typeof skin; value: HomeSkinLayout } | null>(null)
  const [layoutMessage, setLayoutMessage] = useState('')
  const layout = layoutOverride?.uid === uid && layoutOverride.skin === skin
    ? layoutOverride.value
    : readHomeSkinLayout(uid, skin)
  const editing = params.get('customize') === 'home'
  /** TASK-A6：社工端复用学生端壳——social track 隐藏教务区块/入口，并加社工专属区块 */
  const social = useEntryTrack() === 'social'
  const rows = useSchool((state) => state.schedule)
  const exams = useSchool((state) => state.exams)
  const todos = useSchool((state) => state.todos)
  useEffect(() => { markBootReady('home') }, [])

  function toggleLayout(open: boolean) {
    const nextParams = new URLSearchParams(params)
    if (open) nextParams.set('customize', 'home')
    else nextParams.delete('customize')
    setParams(nextParams, { replace: true, preventScrollReset: true })
  }

  const next = useMemo(() => getNextClass(rows), [rows])
  const upcoming = useMemo(() => {
    for (let index = 1; index <= 7; index += 1) {
      const date = new Date()
      date.setDate(date.getDate() + index)
      const items = getScheduleRowsForDate(date, rows)
      if (items.length) {
        const label = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()]
        const row = items[0]
        return { name: row.name, room: row.room, teacher: row.teacher, label, firstSection: row.sections[0], timeLabel: `${label} ${row.sections[0]}-${row.sections[row.sections.length - 1]}节` }
      }
    }
    return null
  }, [rows])
  const hero = next.name ? next : upcoming
  const nearest = useMemo(() => {
    const heroLabel = next.name ? '今天' : upcoming?.label
    const heroName = next.name ? next.name : upcoming?.name
    const heroFirst = next.name ? next.start : upcoming?.firstSection
    const list: Array<{ key: string; label: string; name: string; room: string; teacher: string; sections: number[] }> = []
    for (let index = 0; index <= 7 && list.length < 5; index += 1) {
      const date = new Date()
      date.setDate(date.getDate() + index)
      const label = index === 0 ? '今天' : index === 1 ? '明天' : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()]
      const items = getScheduleRowsForDate(date, rows).slice().sort((a, b) => a.sections[0] - b.sections[0])
      for (const row of items) {
        if (list.length >= 5) break
        list.push({ key: `${date.toDateString()}-${row.name}-${row.sections[0]}`, label, name: row.name, room: row.room, teacher: row.teacher, sections: row.sections })
      }
    }
    return list.filter(item => !heroName || item.label !== heroLabel || item.name !== heroName || item.sections[0] !== heroFirst).slice(0, 4)
  }, [rows, next, upcoming])
  const identity = loadLocalIdentity()
  const [syncing, setSyncing] = useState(() => isBackgroundSyncRunning())
  useEffect(() => {
    const update = () => setSyncing(isBackgroundSyncRunning())
    update()
    const timer = window.setInterval(update, 1200)
    window.addEventListener('ohu-background-sync-done', update)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('ohu-background-sync-done', update)
    }
  }, [])
  const lifeOwner = uid ? `user:${uid}` : 'guest'
  const lifeDay = localDateKey()
  const [lifeRecords, setLifeRecords] = useState<LifeRecord[]>([])
  const [quickKind, setQuickKind] = useState<LifeRecordKind | null>(null)
  const refreshLife = useCallback(async () => { setLifeRecords(await listLifeRecordsByDay(lifeOwner, lifeDay)) }, [lifeOwner, lifeDay])
  useEffect(() => {
    refreshLife()
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ owner: string; day: string }>).detail
      if (detail?.owner === lifeOwner && detail?.day === lifeDay) refreshLife()
    }
    window.addEventListener(LIFE_RECORDS_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(LIFE_RECORDS_CHANGED_EVENT, onChanged)
  }, [refreshLife, lifeOwner, lifeDay])
  const lifeSummary = summarizeLifeRecords(lifeRecords)
  const date = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date())
  const todayCourses = classic ? getScheduleRowsForDate(new Date(), rows).slice().sort((a, b) => a.sections[0] - b.sections[0]) : []
  const pending = handdrawn ? todos.filter(todo => !todo.done) : todos
  const upcomingExams = exams
    .filter((exam) => Date.parse(exam.datetime.replace(' ', 'T')) > Date.now())
    .sort((a, b) => Date.parse(a.datetime.replace(' ', 'T')) - Date.parse(b.datetime.replace(' ', 'T')))
    .slice(0, 2)
  // M3-②：阿狐建议——确定性规则，全部来自本机数据，不接模型、可解释。
  const advice = useMemo(() => {
    if (social) return { text: '今天没有硬日程，喝口水、记一笔，都是好日子。', to: '/todo', action: '记一笔' }
    if (syncing) return { text: '正在读取校园数据，读完就给你排今天的重点。', to: '/study/oneclick', action: '查看进度' }
    if (!rows.length) return { text: '先花两分钟同步课表，我就能提醒你下一节课。', to: '/study/oneclick', action: '去读取' }
    if (next.status === 'now') return { text: `正在上《${next.name}》${next.room ? `，在 ${next.room}` : ''}。`, to: '/schedule', action: '看课表' }
    if (next.status === 'soon') return { text: `${next.timeLabel || '下一节'}有《${next.name}》${next.room ? ` @${next.room}` : ''}，现在出发正好。`, to: '/schedule', action: '看课表' }
    const urgentTodo = pending.find(todo => !todo.done)
    if (urgentTodo) return { text: `先把《${urgentTodo.title}》勾掉，今天就有了第一步。`, to: '/todo', action: '去待办' }
    if (upcomingExams.length) {
      const days = daysUntil(upcomingExams[0].datetime)
      if (days !== null && days >= 0) return { text: `距《${upcomingExams[0].name}》还有 ${days} 天，翻一页资料就是复习。`, to: '/study?tab=exams', action: '去复习' }
    }
    return { text: '今天没有硬日程，喝口水、记一笔，都是好日子。', to: '/todo', action: '记一笔' }
  }, [syncing, rows.length, next, pending, upcomingExams, social])

  const sections: Record<HomeSkinLayout['sections'][number], ReactNode> = {
    // TASK-A6：社工 track 用「来自同学的课表」+「双人空间」入口卡替换课表 hero（整段隐藏）
    schedule: social ? <>
      <SocialSharedScheduleSection key="social-shared" />
      <SocialSpaceCard key="social-space" />
    </> : <section key="schedule" className={styles.hero} aria-labelledby="ohu-home-next-class">
      <div className={styles.heroCopy}>
        <span className={styles.eyebrow}>
          {rows.length ? (classic ? `共 ${todayCourses.length} 节课` : next.status === 'now' ? '正在上课' : '下节课') : (syncing ? '正在后台读取' : '课表未同步')}
          {!ink ? <span aria-hidden="true">✦</span> : null}
        </span>
        <h2 id="ohu-home-next-class">{classic ? '今日课表' : rows.length ? (hero?.name || '本周没有课') : (syncing ? '正在读取校园数据…' : '先读取课表与成绩')}</h2>
        {classic && rows.length ? (todayCourses.length ? <ul className={styles.classicSchedule}>
          {todayCourses.slice(0, 3).map((course, index) => <li key={`${course.name}-${course.sections.join('-')}-${index}`}
            aria-current={(next.status === 'now' || next.status === 'soon') && next.start === course.sections[0] && next.name === course.name ? 'time' : undefined}>
            <span>{course.sections[0]}–{course.sections.at(-1)}节</span>
            <div><strong>{course.name}</strong><small>{course.room || '教室待定'}</small></div>
          </li>)}
        </ul> : <p>今天没有课程。</p>) : (
        <p>
          {rows.length
            ? `${hero?.timeLabel || upcoming?.timeLabel || '本周末没有安排'}${(hero?.room ?? upcoming?.room) ? ` · ${hero?.room ?? upcoming?.room}` : ''}`
            : syncing ? '读完会自动显示在这里，不用重复点。' : '学号 + 校园网 + 统一认证，在本机读取。'}
        </p>
        )}
        <Link className={`${styles.heroLink} ${rows.length ? styles.heroSecondary : styles.heroPrimary}`} to={rows.length ? '/schedule' : '/study/oneclick'}>
          {rows.length ? '查看完整课表' : syncing ? '查看读取进度' : '去读取校园数据'}
        </Link>
      </div>
      <div className={styles.heroArt} data-home-fox={classic ? '' : undefined}>
        <img src={ink ? '/brand/ink/ink-fox.svg' : handdrawn ? '/brand/handdrawn/fox-reading-scene.png' : '/brand/ohu-original/fox-grades-transparent.png'} data-ink-fox={ink ? '' : undefined} alt="" width={104} height={90} />
        {!ink ? <span aria-hidden="true">✦</span> : null}
      </div>
    </section>,
    focus: <section key="focus" className={styles.focusCard} aria-labelledby="ohu-home-focus">
      <div className={styles.focusHead}>
        <span className={styles.cardIcon} aria-hidden="true">✦</span>
        <b id="ohu-home-focus">今日重点</b>
        <small>来自你的课表与待办，规则可解释</small>
      </div>
      <ul className={styles.focusList}>
        <li>
          <span className={styles.focusAdvice}>{advice.text}</span>
          <Link to={advice.to}>{advice.action}</Link>
        </li>
        {pending.find(todo => !todo.done) ? <li>
          <span className={styles.focusAdvice}>待办最急：{pending.find(todo => !todo.done)!.title}</span>
          <Link to="/todo">去完成</Link>
        </li> : null}
        {upcomingExams.length ? <li>
          <span className={styles.focusAdvice}>最近考试：{upcomingExams[0].name}{daysUntil(upcomingExams[0].datetime) !== null ? `（还有 ${daysUntil(upcomingExams[0].datetime)} 天）` : ''}</span>
          <Link to="/study?tab=exams">去准备</Link>
        </li> : null}
      </ul>
    </section>,
    shortcuts: <section key="shortcuts" className={styles.shortcutsSection} aria-label={simple ? "常用功能" : undefined} aria-labelledby={simple ? undefined : "ohu-home-shortcuts"}>
      {!simple ? <div className={styles.shortcutsHead}><h2 id="ohu-home-shortcuts">常用功能</h2><button type="button" onClick={() => toggleLayout(true)}>调整首页</button></div> : null}
      <nav className={styles.shortcuts} aria-label="常用功能" data-home-shortcuts="">
        {layout.shortcuts.filter(id => !(social && STUDENT_ONLY_SHORTCUTS.has(id))).map(id => {
          const item = HOME_SHORTCUTS.find(option => option.id === id)
          if (!item) return null
          return <Link key={id} to={item.to} className={styles.shortcut} data-home-shortcut="" aria-label={simple && id === 'oneclick' ? item.label : undefined}>
            <span className={styles.shortcutGlyph} aria-hidden="true">{(simple && simpleGlyphs[id]) || <CampusIcon name={item.icon === 'card' ? 'wallet' : item.icon} size={22} />}</span>
            <span>{simple && id === 'oneclick' ? '更新' : item.label}</span>
          </Link>
        })}
      </nav>
    </section>,
    exams: social ? null : <section key="exams" className={styles.card} aria-labelledby="ohu-home-exams">
      <div className={styles.cardHead}>
        <span className={styles.cardIcon} aria-hidden="true">考</span>
        <b id="ohu-home-exams">最近考试</b>
        <Link to="/study?tab=exams">全部</Link>
      </div>
      {upcomingExams.length ? <ul className={styles.rowList}>
        {upcomingExams.map((exam) => {
          const days = daysUntil(exam.datetime)
          return <li className={styles.infoRow} key={`${exam.code}-${exam.datetime}`}>
            <span className={`${styles.dateBadge}${days !== null && days <= 3 ? ` ${styles.urgent}` : ''}`}>
              <b>{exam.datetime.slice(5, 10)}</b>
              <small>{exam.datetime.slice(11, 16)}</small>
            </span>
            <span className={styles.rowMain}>
              <b>{exam.name}</b>
              <small>{exam.room || '考场待定'}</small>
            </span>
            <em className={`${styles.countdown}${days !== null && days <= 3 ? ` ${styles.urgent}` : ''}`}>
              {days === null ? '' : days <= 0 ? '今天' : `${days} 天后`}
            </em>
          </li>
        })}
      </ul> : <p className={styles.emptyText}>{rows.length ? '暂无近期考试' : '同步成绩与考试后，这里会显示最近考试。'}</p>}
    </section>,
    courses: social ? null : <section key="courses" className={styles.card} aria-labelledby="ohu-home-nearest">
      <div className={styles.cardHead}>
        <span className={styles.cardIcon} aria-hidden="true">课</span>
        <b id="ohu-home-nearest">最近课程</b>
        <Link to="/schedule">全部</Link>
      </div>
      {nearest.length ? <ul className={styles.rowList}>
        {nearest.map((item) => <li className={styles.infoRow} key={item.key}>
          <span className={styles.sectionBadge}>{item.label}<br />{item.sections[0]}-{item.sections[item.sections.length - 1]}节</span>
          <span className={styles.rowMain}><b>{item.name}</b><small>{item.teacher || '教师待定'}</small></span>
          <span className={styles.dueText}>{item.room}</span>
        </li>)}
      </ul> : <p className={styles.emptyText}>{rows.length ? '本周没有课' : '去课表同步后显示最近课程'}</p>}
    </section>,
    todo: <section key="todo" className={`${styles.card} ${handdrawn ? styles.journal : ''}`} aria-labelledby="ohu-home-todo" data-home-journal={handdrawn ? '' : undefined}>
      <div className={styles.cardHead}>
        <span className={styles.cardIcon} aria-hidden="true">✓</span>
        <b id="ohu-home-todo">{handdrawn ? '今日待办' : '待办'}</b>
        {handdrawn && !reducedMotion ? <button type="button" className={styles.journalTurn} data-click-sound="on" onClick={() => setJournalTurn(value => value + 1)}>重播翻页</button> : null}
        <Link to="/todo">全部</Link>
      </div>
      {handdrawn && todos.length ? <div className={styles.journalProgress}>
        <span>已完成 {todos.length - pending.length} / {todos.length} 项待办</span>
        <progress aria-label="待办完成进度" value={todos.length - pending.length} max={todos.length} />
      </div> : null}
      {pending.length ? <ul className={styles.rowList}>
        {pending.slice(0, 3).map((todo) => <li className={styles.infoRow} key={todo.id}>
          {handdrawn ? <span className={styles.journalBox} aria-hidden="true" /> : <span className={styles.sectionBadge}>{todo.done ? '已完成' : '待办'}</span>}
          <span className={styles.rowMain}><b>{todo.title}</b><small>{todo.note || '未设置备注'}</small></span>
          <span className={styles.dueText}>{todo.due_at ? todo.due_at.slice(5, 16).replace('T', ' ') : '无截止'}</span>
        </li>)}
      </ul> : <p className={styles.emptyText}>{todos.length ? '待办已全部完成。' : '暂无待办，可在待办页新建一条。'}</p>}
      {handdrawn ? <span key={journalTurn} className={opening.journalLeaf} data-journal-leaf="" data-replay={journalTurn > 0 || undefined} aria-hidden="true" /> : null}
    </section>,
    meet: <section key="meet" className={styles.meetBanner} aria-labelledby="ohu-home-meet">
      <div>
        <b id="ohu-home-meet">碰个空</b>
        <p>找同学一起自习、吃饭、运动，填一下空闲时间就能组局。</p>
      </div>
      <Link to="/meet">去碰个空</Link>
    </section>,
    life: <section key="life" className={styles.card} aria-labelledby="ohu-home-life">
      <div className={styles.cardHead}>
        <span className={styles.cardIcon} aria-hidden="true">活</span>
        <b id="ohu-home-life">今天生活</b>
      </div>
      <div className={styles.lifeStats} role="group" aria-label="今日生活记录，点按补录">
        <button type="button" className={styles.lifeStat} onClick={() => setQuickKind('water')}>
          <b>{lifeSummary.waterMl}</b><small>喝水 mL</small>
        </button>
        <button type="button" className={styles.lifeStat} onClick={() => setQuickKind('meal')}>
          <b>{lifeSummary.mealCount}</b><small>餐食</small>
        </button>
        <button type="button" className={styles.lifeStat} onClick={() => setQuickKind('expense')}>
          <b>¥{formatCents(lifeSummary.expenseOutCents)}</b><small>支出</small>
        </button>
      </div>
      <p className={styles.emptyText}>点按任一项补录今天，只记在本机。</p>
    </section>,
  }

  return <div className={styles.page} data-fox-home="true" data-home-skin={skin}>
    <header className={styles.header}>
      {classic || handdrawn || ink ? <img className={styles.avatar} src={ink ? '/brand/ink/ink-fox.svg' : handdrawn ? '/brand/handdrawn/fox-avatar.png' : '/brand/ohu-original/fox-avatar.webp'} data-ink-fox={ink ? '' : undefined} data-home-stamp={handdrawn ? '' : undefined} alt="" width={48} height={48} /> : null}
      <div className={styles.greeting}>
        <small>{date}</small>
        <h1 data-home-heading="">{ink ? '今天' : identity ? `${identity.studentId.slice(-4)} 同学，你好` : '同学，你好'}</h1>
      </div>
      <div className={styles.actions}>
        <button type="button" aria-label="打开菜单" onClick={() => window.dispatchEvent(new Event('ohu-open-menu'))}>☰</button>
        <Link to="/settings" aria-label="设置">{simple ? '⚙' : <IconGear size={21} color="currentColor" />}</Link>
      </div>
    </header>
    {layoutMessage ? <p className={styles.layoutMessage} role="status">{layoutMessage}</p> : null}
    {layout.sections.map(section => sections[section])}
    {editing ? <HomeLayoutDialog key={`${uid}:${skin}`} skin={skin} initial={layout} onClose={() => toggleLayout(false)} onSave={value => {
      const saved = saveHomeSkinLayout(uid, skin, value)
      setLayoutOverride({ uid, skin, value })
      setLayoutMessage(saved ? '首页布局已保存' : '本次已应用布局。当前设备无法保存，刷新后可能恢复。')
      toggleLayout(false)
    }} /> : null}
    {quickKind ? <QuickRecordSheet key={lifeOwner} owner={lifeOwner} initialKind={quickKind} onClose={() => setQuickKind(null)} /> : null}
  </div>
}
