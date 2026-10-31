import { FoxSheetPose } from '../components/fox/FoxSheetPose'
import { AnnouncementBanner } from '../components/AnnouncementBanner'
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { IconGear, IconSearch, IconPin } from '../components/Icons'
import { CampusIcon } from '../components/CampusIcon'
import { FocusThemeToggle } from '../components/focus/FocusInteractions'
import { OhuHeadingArtwork } from '../components/brand/OhuArtwork'
import { StudentServiceArtwork } from '../components/brand/StudentServiceArtwork'
import { RowSkeleton } from '../components/ui/Skeleton'
import { usePollingRows } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { useQbankRevision } from '../lib/useQbankRevision'
import { markBootReady } from '../lib/boot'
import { applyTheme, getStoredTheme, type Theme } from '../lib/theme'
import { fetchItems, fetchTasks, fmtTime, ITEM_STATUS_TEXT, TASK_STATUS_TEXT, type Item, type Task } from '../lib/market'
import { fetchTodos, todoRemindScan, type TodoRow, type TodoScanRes } from '../lib/todo'
import { getNextClass, getTodayTimeline, loadScheduleCache, scheduleStudentIdForSnapshot, SCHEDULE_CACHE_EVENT, validateScheduleSnapshot, type ScheduleSnapshotStatus } from '../lib/schedule-cache'
import { loadSavedStuid } from '../lib/schedule-credentials'
import { CAMPUSES, type Campus } from '../lib/campus'
import { recordRecentService } from '../lib/service-recent'
import { MessageEntry } from '../components/MessageEntry'
import { DialogLayer } from '../components/ui/DialogLayer'
import { fadeUp } from '../lib/animations'
import { formatListingPrice } from '../lib/listing-price'
import { HOME_SERVICE_OPTIONS, DEFAULT_HOME_SERVICE_IDS, loadHomePreferences, saveHomePreferences, type HomeServiceId } from './home/home-preferences'
import { loadCampusHighlights, nearestOpenTodo } from './home/home-data'
import { fetchCampusWeather, type WeatherNow } from '../lib/weather'
import styles from './HomePage.module.css'

function localDayKey() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function boundScheduleStudentId() {
  try { return loadSavedStuid() } catch { return '' }
}

const SCHEDULE_STATE_COPY: Record<Exclude<ScheduleSnapshotStatus, 'ready'>, { title: string; detail: string }> = {
  unbound: { title: '绑定课表，安排更清楚', detail: '绑定校园账号并同步课程，即可查看上课时间和教室。' },
  missing: { title: '课表还未同步', detail: '同步后，在这里查看下一节课。' },
  invalid: { title: '课表需要重新同步', detail: '本机课表暂时无法读取，请到课表页重新同步。' },
  'owner-unverified': { title: '课表需要重新同步', detail: '旧课表尚未确认归属，请在当前 App 账号下重新同步。' },
  'owner-mismatch': { title: '课表需要重新同步', detail: '已存课表属于其他账号，请同步当前账号的课表。' },
  'term-mismatch': { title: '课表需要重新同步', detail: '已存课表的学期与当前学期不同，请重新同步。' },
  'before-term': { title: '当前学期尚未开始', detail: '可以先查看周课表，提前安排学习。' },
  'outside-coverage': { title: '请核对当前课表', detail: '已超出本机课表的课程周次，请查看或重新同步。' },
}

/** 提醒弹窗里的到期时间：今天 20:30 / 明天 09:00 / MM-dd HH:mm */
function fmtTodoTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const now = new Date()
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, now)) return `今天 ${hm}`
  if (sameDay(d, new Date(now.getTime() + 86400000))) return `明天 ${hm}`
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
}

function ListingPicture({ src, kind }: { src?: string; kind: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  return src && !failed
    ? <img src={src} alt="" width={76} height={76} loading="lazy" decoding="async" onError={() => setFailed(true)} />
    : <CampusIcon name={kind === 'box' ? 'box' : 'bag'} size={24} />
}

export function HomePage() {
  const auth = useAuth()
  const identityRevision = useQbankRevision()
  const navigate = useNavigate()
  const reduceMotion = useReducedMotion()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const uidRef = useRef(uid)
  uidRef.current = uid
  const tasks = usePollingRows<Task>(() => fetchTasks(), [], 30000)
  const items = usePollingRows<Item>(() => fetchItems(), [], 30000)
  const todos = usePollingRows<TodoRow & { ownerUid: string }>(async () => {
    const ownerUid = uidRef.current
    if (!ownerUid) return { rows: [], error: null }
    const result = await fetchTodos()
    return { rows: result.rows.map((item) => ({ ...item, ownerUid })), error: result.error }
  }, [uid], 30000)
  const campusFeed = usePollingRows<Awaited<ReturnType<typeof loadCampusHighlights>>>(async () => ({ rows: [await loadCampusHighlights()], error: null }), [], 60000)
  const [preferences, setPreferences] = useState(() => ({ ownerUid: uid, ...loadHomePreferences(uid) }))
  const currentPreferences = preferences.ownerUid === uid ? preferences : { ownerUid: uid, ...loadHomePreferences(uid) }
  const [campusOpen, setCampusOpen] = useState(false)
  const [servicesOpen, setServicesOpen] = useState(false)
  const [serviceDraft, setServiceDraft] = useState<HomeServiceId[]>([...DEFAULT_HOME_SERVICE_IDS])
  const [preferenceMessage, setPreferenceMessage] = useState('')
  const [serviceMessage, setServiceMessage] = useState('')
  const [todoTip, setTodoTip] = useState<TodoScanRes | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const quickDestination = useRef<string | null>(null)
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme())
  const snoozeTimer = useRef(0)
  const [schedTick, setSchedTick] = useState(0)
  const [weather, setWeather] = useState<WeatherNow | null>(null)
  const scheduleCache = useMemo(() => loadScheduleCache(), [schedTick, uid, identityRevision])
  const boundStuid = scheduleStudentIdForSnapshot(scheduleCache, boundScheduleStudentId(), uid)
  const scheduleView = useMemo(() => validateScheduleSnapshot(scheduleCache, boundStuid, new Date(), undefined, uid), [scheduleCache, boundStuid, uid, schedTick])
  const nextClass = useMemo(() => getNextClass(scheduleView.rows), [scheduleView])
  const laterClasses = useMemo(() => getTodayTimeline(scheduleView.rows).filter(item => item.state === 'future' && !(item.name === nextClass.name && item.timeLabel === nextClass.timeLabel)).slice(0, 2), [scheduleView, nextClass])
  const hasSynchronizedSchedule = scheduleView.status === 'ready'
  const scheduleBound = !!boundStuid
  const scheduleState = scheduleView.status !== 'ready' ? SCHEDULE_STATE_COPY[scheduleView.status] : null
  const nextTodo = useMemo(() => nearestOpenTodo(todos.rows.filter((item) => item.ownerUid === uid)), [todos.rows, uid])
  const ownedTodos = todos.rows.filter((item) => item.ownerUid === uid)
  const homeTodos = [...ownedTodos].sort((a, b) => Number(a.done) - Number(b.done) || (Date.parse(a.due_at || '') || Infinity) - (Date.parse(b.due_at || '') || Infinity)).slice(0, 3)
  const greeting = new Date().getHours() < 11 ? '早上好' : new Date().getHours() < 14 ? '中午好' : new Date().getHours() < 18 ? '下午好' : '晚上好'
  const selectedServices = currentPreferences.services.map((id) => HOME_SERVICE_OPTIONS.find((item) => item.id === id)!).filter(Boolean)

  useEffect(() => {
    setPreferences({ ownerUid: uid, ...loadHomePreferences(uid) })
    setCampusOpen(false)
    setServicesOpen(false)
    setPreferenceMessage('')
    setTodoTip(null)
  }, [uid])

  function changeCampus(campus: Campus, event: MouseEvent<HTMLButtonElement>) {
    const next = { campus, services: currentPreferences.services }
    const stored = saveHomePreferences(uid, next)
    setPreferences({ ownerUid: uid, ...next })
    setPreferenceMessage(stored ? '' : '校区已切换；本机存储不可用，下次打开需重新选择。')
    event.currentTarget.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))
  }

  function moveService(index: number, offset: number) {
    const target = index + offset
    if (target < 0 || target >= serviceDraft.length) return
    const next = [...serviceDraft]
    ;[next[index], next[target]] = [next[target], next[index]]
    setServiceDraft(next)
    setServiceMessage('')
  }

  function saveServices(event: MouseEvent<HTMLButtonElement>) {
    if (serviceDraft.length < 1 || serviceDraft.length > 6) { setServiceMessage('请选择一至六项常用功能。'); return }
    const next = { campus: currentPreferences.campus, services: serviceDraft }
    const stored = saveHomePreferences(uid, next)
    setPreferences({ ownerUid: uid, ...next })
    setPreferenceMessage(stored ? '' : '常用功能已调整；本机存储不可用，下次打开将恢复默认。')
    event.currentTarget.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))
  }

  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') setSchedTick((n) => n + 1) }, 60_000)
    const onFocus = () => setSchedTick((n) => n + 1)
    const onStorage = (event: StorageEvent) => { if (!event.key || event.key.startsWith('schedule.')) onFocus() }
    const onVisible = () => { if (document.visibilityState === 'visible') onFocus() }
    window.addEventListener('focus', onFocus)
    window.addEventListener(SCHEDULE_CACHE_EVENT, onFocus)
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener(SCHEDULE_CACHE_EVENT, onFocus)
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(() => {
    let alive = true
    void fetchCampusWeather()
      .then((w) => {
        if (alive) setWeather(w)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (auth.phase === 'booting' || !auth.isSigned || !uid) return
    let stop = false
    const dayKey = () => localDayKey()
    const LS_KEY = `todo.reminded:${uid}`
    const SNOOZE_KEY = `todo.snooze:${uid}`

    /** 按条延后：id → 到期时间戳；兼容旧版 {id,until} / {ids,until} */
    type SnoozeMap = Record<string, number>

    function readSnoozeMap(): SnoozeMap {
      try {
        const raw = JSON.parse(localStorage.getItem(SNOOZE_KEY) || 'null')
        if (!raw || typeof raw !== 'object') return {}
        if (raw.map && typeof raw.map === 'object') return raw.map as SnoozeMap
        if (typeof (raw as { id?: number }).id === 'number') {
          const until = Number((raw as { until?: number }).until) || 0
          return until > Date.now() ? { [String((raw as { id: number }).id)]: until } : {}
        }
        if (Array.isArray((raw as { ids?: number[] }).ids)) {
          const until = Number((raw as { until?: number }).until) || 0
          if (until <= Date.now()) return {}
          const out: SnoozeMap = {}
          for (const id of (raw as { ids: number[] }).ids) out[String(id)] = until
          return out
        }
        return {}
      } catch {
        return {}
      }
    }

    function writeSnoozeMap(map: SnoozeMap) {
      const cleaned: SnoozeMap = {}
      const now = Date.now()
      for (const [k, v] of Object.entries(map)) {
        if (v > now) cleaned[k] = v
      }
      try {
        if (Object.keys(cleaned).length) localStorage.setItem(SNOOZE_KEY, JSON.stringify({ map: cleaned }))
        else localStorage.removeItem(SNOOZE_KEY)
      } catch {
        /* ignore */
      }
      return cleaned
    }

    function nextSnoozeWake(map: SnoozeMap): number {
      const vals = Object.values(map)
      if (!vals.length) return 0
      return Math.min(...vals)
    }

    function readSeen(): string[] {
      try {
        const seen = JSON.parse(localStorage.getItem(LS_KEY) || '[]')
        return Array.isArray(seen) ? seen.map(String) : []
      } catch {
        return []
      }
    }

    function unmarkReminded(ids: number[]) {
      const dk = dayKey()
      const drop = new Set(ids.map((id) => `${id}@${dk}`))
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(readSeen().filter((k) => !drop.has(k))))
      } catch {
        /* ignore */
      }
    }

    async function runScan(showTip: boolean) {
      const r = await todoRemindScan()
      if (stop || uidRef.current !== uid) return
      if (r.error || !r.data || !showTip) return

      let map = readSnoozeMap()
      const expiredIds = Object.entries(map)
        .filter(([, until]) => until <= Date.now())
        .map(([id]) => Number(id))
      if (expiredIds.length) {
        unmarkReminded(expiredIds)
        map = writeSnoozeMap(Object.fromEntries(Object.entries(map).filter(([, u]) => u > Date.now())))
      }

      const hide = new Set(
        Object.entries(map)
          .filter(([, until]) => until > Date.now())
          .map(([id]) => Number(id)),
      )
      const due = r.data.due.filter((d) => !hide.has(d.id))

      const wake = nextSnoozeWake(map)
      window.clearTimeout(snoozeTimer.current)
      if (wake > Date.now()) {
        snoozeTimer.current = window.setTimeout(() => void runScan(true).catch(() => undefined), wake - Date.now() + 200)
      }

      if (!due.length) return
      const seen = readSeen()
      const dk = dayKey()
      const fresh = due.filter((d) => !seen.includes(`${d.id}@${dk}`))
      if (fresh.length) setTodoTip({ ...r.data, due: fresh })
    }

    void runScan(true).catch(() => undefined)
    return () => {
      stop = true
      window.clearTimeout(snoozeTimer.current)
    }
  }, [auth.phase, auth.isSigned, uid])

  useEffect(() => {
    if (auth.phase === 'booting') return
    // The mounted frame is ready; each data section owns its network state.
    markBootReady('home')
  }, [auth.phase])

  const latest = useMemo(() => {
    const fromTasks = [...tasks.rows].sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0)).slice(0, 2).map((t) => ({
      key: `t-${t.id}`,
      kind: '任务' as const,
      title: t.title,
      sub: `${t.location || '校园'} · ${fmtTime(t.created_at)}`,
      price: t.reward || '面议',
      status: TASK_STATUS_TEXT[t.status] || '状态待确认',
      active: t.status === 'open',
      createdAt: t.created_at,
      pic: undefined as string | undefined,
      art: 'box',
      to: `/task/${t.id}`,
    }))
    const fromItems = [...items.rows].sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0)).slice(0, 2).map((i) => ({
      key: `i-${i.id}`,
      kind: '二手' as const,
      title: i.title,
      sub: `${i.building || '位置待补充'} · ${i.condition || i.category || '闲置'}`,
      price: i.price,
      status: ITEM_STATUS_TEXT[i.status] || '状态待确认',
      active: i.status === 'on',
      createdAt: i.created_at,
      pic: i.images?.[0] as string | undefined,
      art: 'goods',
      to: `/item/${i.id}`,
    }))
    return [...fromTasks, ...fromItems].sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)).slice(0, 4)
  }, [tasks.rows, items.rows])

  function markTipSeen() {
    if (!todoTip?.due.length) return
    const dayKey = localDayKey()
    const LS_KEY = `todo.reminded:${uid}`
    let seen: string[] = []
    try {
      seen = JSON.parse(localStorage.getItem(LS_KEY) || '[]')
      if (!Array.isArray(seen)) seen = []
    } catch {
      seen = []
    }
    const next = Array.from(new Set([...seen, ...todoTip.due.map((d) => `${d.id}@${dayKey}`)])).slice(-50)
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }

  function dismissTip() {
    markTipSeen()
    setTodoTip(null)
  }

  function snoozeIds(ids: number[]) {
    if (!ids.length) return
    const until = Date.now() + 10 * 60 * 1000
    try {
      const raw = JSON.parse(localStorage.getItem(`todo.snooze:${uid}`) || 'null')
      const map: Record<string, number> =
        raw?.map && typeof raw.map === 'object' ? { ...raw.map } : {}
      for (const id of ids) map[String(id)] = until
      localStorage.setItem(`todo.snooze:${uid}`, JSON.stringify({ map }))
      const dayKey = localDayKey()
      const drop = new Set(ids.map((id) => `${id}@${dayKey}`))
      const seen = JSON.parse(localStorage.getItem(`todo.reminded:${uid}`) || '[]')
      if (Array.isArray(seen)) {
        localStorage.setItem(`todo.reminded:${uid}`, JSON.stringify(seen.filter((k) => !drop.has(String(k)))))
      }
    } catch {
      /* ignore */
    }
    window.clearTimeout(snoozeTimer.current)
    snoozeTimer.current = window.setTimeout(() => {
      void todoRemindScan().then((r) => {
        if (uidRef.current !== uid || r.error || !r.data?.due.length) return
        const dayKey = localDayKey()
        let seen: string[] = []
        try {
          seen = JSON.parse(localStorage.getItem(`todo.reminded:${uid}`) || '[]')
          if (!Array.isArray(seen)) seen = []
        } catch {
          seen = []
        }
        let map: Record<string, number> = {}
        try {
          const raw = JSON.parse(localStorage.getItem(`todo.snooze:${uid}`) || 'null')
          if (raw?.map) map = raw.map
        } catch {
          /* ignore */
        }
        const hide = new Set(
          Object.entries(map)
            .filter(([, u]) => Number(u) > Date.now())
            .map(([id]) => Number(id)),
        )
        const fresh = r.data.due.filter((d) => !hide.has(d.id) && !seen.includes(`${d.id}@${dayKey}`))
        if (fresh.length) setTodoTip({ ...r.data, due: fresh })
      }).catch(() => undefined)
    }, 10 * 60 * 1000 + 200)
  }

  function snoozeOne(id: number) {
    snoozeIds([id])
    setTodoTip((tip) => {
      if (!tip) return null
      const due = tip.due.filter((d) => d.id !== id)
      return due.length ? { ...tip, due } : null
    })
  }

  function snoozeTip() {
    const ids = todoTip?.due.map((d) => d.id) || []
    snoozeIds(ids)
    setTodoTip(null)
  }

  return (
    <motion.div className={styles.page} initial={false} animate={{ opacity: 1 }}>
      <motion.header className={styles.top} {...fadeUp(!!reduceMotion)}>
        <Link to="/profile" className={styles.avatarLink} aria-label="打开我的资料"><FoxSheetPose pose="waving" /></Link>
        <div className={styles.brand}>
          <h1 className={styles.brandLabel}>{greeting}，同学！<span aria-hidden="true">✦</span></h1>
          <p className={styles.greetingNote}>新的一天也要加油呀！</p>
        </div>
        <div className={styles.topActions}>
          <FocusThemeToggle />
          <Link to="/services" className={styles.searchButton} aria-label="搜索校园服务"><IconSearch size={23} color="currentColor" /></Link>
          <MessageEntry />
        </div>
      </motion.header>
      {preferenceMessage ? <p className={styles.inlineHint} role="status">{preferenceMessage}</p> : null}

      <div className={styles.contextRow}>
        <button type="button" className={styles.campusChoice} aria-label={`当前校区：${currentPreferences.campus || '尚未选择'}，点击切换`} aria-expanded={campusOpen} onClick={() => setCampusOpen(true)}><IconPin size={15} /><span>{currentPreferences.campus || '选择校区'}</span><span aria-hidden="true">⌄</span></button>
        {weather ? <span className={styles.weatherBar} aria-label="校园天气">{weather.emoji} {weather.city} · {weather.label} {weather.temp}°<span className={styles.weatherSub}>{weather.low}～{weather.high}°</span></span> : null}
        <button type="button" className={styles.dotsBtn} aria-label="快捷设置" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><IconGear size={18} /></button>
      </div>
      <figure className={styles.campusBanner}><AnnouncementBanner fallback="/brand/ohu-original/home-campus-banner.webp" /></figure>

      <section className={styles.todayCard} aria-labelledby="home-today">
        <div className={styles.todayHeading}>
          <div className={styles.headingTitle}><span className={styles.headingIcon} aria-hidden="true"><OhuHeadingArtwork name="schedule" /></span><h2 id="home-today">今日安排</h2></div>
          <Link to="/schedule" className={styles.more}>{hasSynchronizedSchedule ? '完整课表' : scheduleBound ? '同步课表' : '绑定课表'} <span aria-hidden="true">›</span></Link>
        </div>
        <p className={styles.todayDate}>{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())}</p>
        {nextClass.status === 'now' || nextClass.status === 'soon' ? (
          <Link to="/schedule" className={styles.classPreview}>
            <span className={styles.classStatus} data-status={nextClass.status}>{nextClass.status === 'now' ? '正在上课' : '下一节课'}</span>
            <strong className={styles.classTime}><span>{nextClass.timeLabel.split('-')[0]}</span><small>{nextClass.timeLabel.split('-')[1]}</small></strong>
            <span className={styles.className}>{nextClass.name}</span>
            <span className={styles.classMeta}>{nextClass.room || '教室待补充'} · {nextClass.teacher || `第${nextClass.start}-${nextClass.end}节`}</span>
            {nextClass.hint !== '正在上课' && nextClass.hint !== '下一节课' ? <span className={styles.classHint}>{nextClass.hint}</span> : null}
          </Link>
        ) : hasSynchronizedSchedule ? (
          <div className={styles.scheduleState}><span className={styles.stateIcon} aria-hidden="true"><CampusIcon name="cal" size={22} /></span><div><strong>{nextClass.status === 'done' && nextClass.hint.includes('上完') ? '今天的课程已结束' : '今天没有课程安排'}</strong><p>{nextClass.status === 'holiday' ? nextClass.hint : '查看周课表，提前安排接下来的学习。'}</p></div></div>
        ) : (
          <div className={styles.scheduleState}><span className={styles.stateIcon} aria-hidden="true"><CampusIcon name="cal" size={22} /></span><div><strong>{scheduleState?.title}</strong><p>{scheduleState?.detail}</p></div></div>
        )}
        {laterClasses.length ? <div className={styles.laterClasses}>{laterClasses.map((item, index) => <Link to="/schedule" key={`${item.name}:${item.timeLabel}:${index}`}><time>{item.timeLabel.split('-')[0]}</time><strong>{item.name}</strong><span>{item.room || '教室待补充'}{item.teacher ? ` · ${item.teacher}` : ''}</span></Link>)}</div> : null}
        {hasSynchronizedSchedule && scheduleView.meta?.savedAt ? <p className={styles.cacheLabel}>课表更新于 {fmtTodoTime(scheduleView.meta.savedAt)}</p> : null}
      </section>

      <section className={`${styles.block} ${styles.taskCard}`} aria-labelledby="home-tasks">
        <div className={styles.blockHead}><div className={styles.headingTitle}><span className={styles.headingIcon} aria-hidden="true"><OhuHeadingArtwork name="tasks" /></span><h2 id="home-tasks">今日任务</h2>{auth.isSigned && !todos.loading && !todos.error && ownedTodos.length ? <span className={styles.taskCount}>{ownedTodos.filter(item => item.done).length}/{ownedTodos.length}</span> : null}</div><Link to="/todo" className={styles.more}>全部待办 <span aria-hidden="true">›</span></Link></div>
        <div className={styles.taskLayout}><div className={styles.taskList}>
          {!auth.isSigned ? <Link className={styles.taskEmpty} to="/todo"><strong>记下今天的小目标</strong><span>登录后查看作业与计划 ›</span></Link> : todos.loading && !nextTodo ? <p className={styles.sectionState} role="status">正在同步待办…</p> : todos.error ? <div className={styles.sectionFailure} role="status"><p>待办暂时无法同步</p><button type="button" onClick={todos.reload}>重试</button></div> : homeTodos.length ? homeTodos.map(item => <Link to="/todo" key={item.id} className={styles.taskRow} data-done={item.done}><span className={styles.checkMark} aria-hidden="true">{item.done ? '✓' : ''}</span><span><strong>{item.title}</strong>{item.due_at ? <small>{fmtTodoTime(item.due_at)}{!item.done && Date.parse(item.due_at) < Date.now() ? ' · 已逾期' : ''}</small> : null}</span></Link>) : <Link className={styles.taskEmpty} to="/todo"><strong>今天从一件小事开始</strong><span>暂无待办，去添加一个 ›</span></Link>}
        </div><FoxSheetPose className={styles.readingFox} pose="reading" /></div>
      </section>

      <section className={styles.block} aria-labelledby="home-services">
        <div className={styles.blockHead}><div className={styles.headingTitle}><span className={styles.headingIcon} aria-hidden="true"><OhuHeadingArtwork name="services" /></span><h2 id="home-services">常用功能</h2></div><div className={styles.sectionActions}><button type="button" className={styles.more} onClick={() => { setServiceDraft([...currentPreferences.services]); setServiceMessage(''); setServicesOpen(true) }}>调整</button><Link to="/services" className={styles.more}>全部服务 <span aria-hidden="true">›</span></Link></div></div>
        <nav className={styles.entryTrack} aria-label="常用功能" data-count={selectedServices.length}>
          {selectedServices.map((service) => <Link key={service.id} to={service.to} className={styles.cell} onClick={() => recordRecentService(uid, service.to)}><span className={styles.icon}><StudentServiceArtwork id={service.id} fallback={service.artwork} home size={46} /></span><span className={styles.cellLabel}>{service.label}</span></Link>)}
        </nav>
      </section>

      <div className={styles.communityGrid}>
      <section className={`${styles.block} ${styles.blockSub}`} aria-labelledby="home-campus-news">
        <div className={styles.blockHead}><div className={styles.headingTitle}><span className={styles.headingIcon} aria-hidden="true"><OhuHeadingArtwork name="news" /></span><h2 id="home-campus-news">校园动态</h2></div><Link to="/info" className={styles.more}>查看全部 <span aria-hidden="true">›</span></Link></div>
        <div className={styles.campusFeed} aria-live="polite">
          {campusFeed.rows[0]?.rows.map((entry) => <Link key={entry.id} to={entry.to} className={styles.campusStory}><span className={styles.storyKind}>{entry.kind}</span><span className={styles.storyBody}><strong>{entry.title}</strong><small>{entry.detail}</small></span><span className={styles.storyArrow} aria-hidden="true">›</span></Link>)}
          {campusFeed.loading && !campusFeed.rows.length ? <RowSkeleton count={3} /> : null}
          {!campusFeed.loading && !campusFeed.error && !campusFeed.rows[0]?.error && !campusFeed.rows[0]?.rows.length ? <p className={styles.sectionState}>暂时没有公告、活动或失物信息。可以到信息站发布。</p> : null}
          {campusFeed.error || campusFeed.rows[0]?.error ? <div className={styles.sectionFailure} role="status"><p>{campusFeed.rows[0]?.error || '校园动态暂时无法同步'}</p><button type="button" onClick={campusFeed.reload}>重新加载</button></div> : null}
        </div>
      </section>

      <section className={`${styles.block} ${styles.blockSub}`} aria-labelledby="home-help">
        <div className={styles.blockHead}><div className={styles.headingTitle}><span className={styles.headingIcon} aria-hidden="true"><OhuHeadingArtwork name="help" /></span><h2 id="home-help">同学互助</h2></div><div className={styles.sectionActions}><Link to="/tasks" className={styles.more}>任务</Link><Link to="/market" className={styles.more}>闲置 <span aria-hidden="true">›</span></Link></div></div>
        <div className={styles.latest} aria-live="polite">
          {latest.length === 0 ? tasks.loading || items.loading ? <RowSkeleton count={2} /> : (
            <div className={styles.latestEmpty} role="status">
              <p>{tasks.error || items.error ? '互助信息暂时无法同步' : '暂时没有新任务或闲置'}</p>
              <span>{tasks.error || items.error ? '检查网络后，再试一次。' : '发布需求或闲置，让同学帮上忙。'}</span>
              {tasks.error || items.error ? <button type="button" onClick={() => { tasks.reload(); items.reload() }}>重新加载</button> : <Link to="/tasks">去任务大厅 <span aria-hidden="true">›</span></Link>}
            </div>
          ) : null}
          {latest.map((listing) => <Link key={listing.key} to={listing.to} className={styles.latestRow}>
            <span className={styles.latestArt}><ListingPicture src={listing.pic} kind={listing.art} /></span>
            <span className={styles.latestBody}><strong><span className={styles.kind}>{listing.kind}</span>{listing.title}</strong><span>{listing.sub}</span></span>
            <span className={styles.listingFooter}><em>{formatListingPrice(listing.price)}</em><span className={styles.listingStatus} data-active={listing.active}>{listing.status}</span></span>
          </Link>)}
        </div>
        {latest.length > 0 && (tasks.error || items.error) ? <div className={styles.sectionFailure} role="status"><p>{[tasks.error && '任务', items.error && '闲置'].filter(Boolean).join('、')}暂时未能同步</p><button type="button" onClick={() => { tasks.reload(); items.reload() }}>重新加载</button></div> : null}
      </section>

      </div>

      {campusOpen ? <DialogLayer title="选择当前校区" className={styles.preferenceSheet} onClose={() => setCampusOpen(false)}><header className={styles.quickHead}><h2>选择当前校区</h2><button type="button" aria-label="关闭校区选择" onClick={(event) => event.currentTarget.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))}>×</button></header><p className={styles.preferenceNote}>选择你当前所在校区，仅在这台设备记住。</p><div className={styles.campusOptions}>{CAMPUSES.map((campus) => <button key={campus} type="button" aria-pressed={currentPreferences.campus === campus} onClick={(event) => changeCampus(campus, event)}>{campus}<span aria-hidden="true">{currentPreferences.campus === campus ? '✓' : '›'}</span></button>)}</div></DialogLayer> : null}

      {servicesOpen ? <DialogLayer title="调整常用功能" className={styles.preferenceSheet} onClose={() => setServicesOpen(false)}>
        <header className={styles.quickHead}><h2>常用功能</h2><button type="button" aria-label="关闭常用功能调整" onClick={(event) => event.currentTarget.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))}>×</button></header>
        <p className={styles.preferenceNote}>选择一至六项，用上下按钮调整顺序。仅保存在本机当前账号下。</p>
        <ol className={styles.serviceOrder}>{serviceDraft.map((id, index) => {
          const service = HOME_SERVICE_OPTIONS.find((item) => item.id === id)!
          return <li key={id}><span>{index + 1}</span><strong>{service.label}</strong><button type="button" disabled={index === 0} aria-label={`将${service.label}上移`} onClick={() => moveService(index, -1)}>↑</button><button type="button" disabled={index === serviceDraft.length - 1} aria-label={`将${service.label}下移`} onClick={() => moveService(index, 1)}>↓</button></li>
        })}</ol>
        <div className={styles.servicePicker} aria-label="选择常用功能">{HOME_SERVICE_OPTIONS.map((service) => <button key={service.id} type="button" aria-pressed={serviceDraft.includes(service.id)} onClick={() => {
          setServiceMessage('')
          if (serviceDraft.includes(service.id)) setServiceDraft(serviceDraft.filter((id) => id !== service.id))
          else if (serviceDraft.length < 6) setServiceDraft([...serviceDraft, service.id])
          else setServiceMessage('最多选择六项，请先取消一项再添加。')
        }}>{service.label}</button>)}</div>
        <p className={styles.serviceFeedback} role="status">{serviceMessage || (serviceDraft.length ? `已选择 ${serviceDraft.length} 项，最多六项` : '请至少选择一项常用功能。')}</p>
        <div className={styles.serviceSave}><button type="button" className={styles.remindGhost} onClick={() => { setServiceDraft([...DEFAULT_HOME_SERVICE_IDS]); setServiceMessage(`已恢复${DEFAULT_HOME_SERVICE_IDS.map(id => HOME_SERVICE_OPTIONS.find(item => item.id === id)!.label).join('、')}，保存后生效。`) }}>恢复默认</button><button type="button" className={styles.remindMain} disabled={serviceDraft.length < 1 || serviceDraft.length > 6} onClick={saveServices}>保存调整</button></div>
      </DialogLayer> : null}

      {menuOpen ? <DialogLayer title="快捷设置" className={styles.quickSettings} onClose={() => {
        setMenuOpen(false)
        const destination = quickDestination.current
        quickDestination.current = null
        if (destination) navigate(destination)
      }}>
        <header className={styles.quickHead}><h2>快捷设置</h2><button type="button" aria-label="关闭快捷设置" onClick={(event) => event.currentTarget.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))}>×</button></header>
        <section className={styles.quickGroup} aria-labelledby="quick-theme"><h3 id="quick-theme">主题模式</h3><div className={styles.quickOptions}>
          {([['light', '浅色'], ['dark', '深色'], ['system', '跟随系统']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={theme === value} onClick={() => { setTheme(value); applyTheme(value) }}>{label}</button>)}
        </div></section>
        <button type="button" className={styles.quickAll} onClick={(event) => { quickDestination.current = '/settings'; event.currentTarget.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true })) }}><IconGear size={20} /><span>全部设置<small>通知、隐私、缓存与账号</small></span><span aria-hidden="true">›</span></button>
      </DialogLayer> : null}

      {todoTip ? (
        <DialogLayer title="待办提醒" onClose={dismissTip}>
            <div className={styles.remindHead}>
              <span className={styles.remindEmoji} aria-hidden="true"><CampusIcon name="task" /></span>
              <div>
                <b>待办提醒</b>
                <span>下面的待办快到期了，可以现在处理。</span>
              </div>
            </div>
            <ul className={styles.remindList}>
              {todoTip.due.map((d) => (
                <li key={d.id}>
                  <span className={styles.remindTitle}>{d.title}</span>
                  <span className={styles.remindDue}>{fmtTodoTime(d.due_at)}</span>
                  <button type="button" className={styles.remindItemSnooze} onClick={() => snoozeOne(d.id)}>
                    延后
                  </button>
                </li>
              ))}
            </ul>
            <div className={styles.remindBtns}>
              <button type="button" className={styles.remindGhost} onClick={(event) => event.currentTarget.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))}>
                知道了
              </button>
              <button type="button" className={styles.remindSnooze} onClick={snoozeTip}>
                全部延后 10 分钟
              </button>
              <button
                type="button"
                className={styles.remindMain}
                onClick={() => {
                  markTipSeen()
                  setTodoTip(null)
                  navigate('/todo')
                }}
              >
                查看待办
              </button>
            </div>
        </DialogLayer>
      ) : null}
    </motion.div>
  )
}
