import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { goBack } from '../lib/back'
import { studyBackHistory } from '../lib/study-back-history'
import { ToastProvider } from '../context/ToastContext'
/* 学生端使用学号登录，资料编辑独立挂载。 */
import { initNativeShell } from '../lib/native'
import { IS_NATIVE } from '../lib/platform'
import { Toaster } from '../lib/toast'
import { PublishSheet } from './PublishSheet'
import { TabBar } from './TabBar'
import { listenForCampusCameraRestore } from '../lib/moment-gallery'
import { StudentManagementTools } from './StudentManagementTools'
import { FoxgirlCompanion } from './fox/FoxgirlCompanion'
import { usePullRefresh } from './usePullRefresh'
import { WorkAccessGate, WorkPhoneGate } from './WorkPhoneGate'
import { RemindHost } from './RemindHost'
import { TodoReminderSyncHost } from './TodoReminderSyncHost'
import { useFoxCodexProgress } from './fox/useFoxCodexProgress'
import { FirstRunHost } from './FirstRunHost'
import { OtaUpdateHost } from './OtaUpdateHost'
import { AwayLoginHost } from './AwayLoginHost'
import { ShellNotifyHost } from './ShellNotifyHost'
import { ShellRouteGuard } from './ShellRouteGuard'
import { useAuth } from '../lib/auth'
import { getAppShell, initAppShell, isWorkShell } from '../lib/app-shell'
import { isFirstRunComplete } from '../lib/first-run'
import { hasWorkAccess } from '../lib/work-access'
import { loadScheduleCache } from '../lib/schedule-cache'
import { runAutoSync } from '../lib/auto-sync'
import { touchActive } from '../lib/engagement'
import { foxLocalDay, refreshFoxV1Summary } from '../lib/fox-v1'
import { isFocusImmersive } from '../services/focus'
import { FocusTimerProvider, FocusTimerBar } from '../context/FocusTimerContext'
import styles from './PhoneShell.module.css'
import { getUiVariant, restoreUiVariant, useUiVariant } from '../lib/ui-variant'
import { ensureFontDownload, ensureHanddrawnFonts, getFontFamilyPref, restoreFontPref } from '../lib/font-pref'
import { useKeyboardInset } from '../lib/use-keyboard-inset'
import { confirmOtaAppReady } from '../ota-ready'
import { installStudentHaptics } from '../lib/student-haptics'
import { installSoundManager, playSound, SoundEvent } from '../lib/sound'
import { useQbankRevision } from '../lib/useQbankRevision'
import { refreshScheduleWidgets } from '../lib/schedule-widget'
import { TODO_DATA_CHANGED_EVENT } from '../lib/todo-data-events'
import { isWidgetShortcut, WIDGET_SHORTCUTS_CHANGED_EVENT } from '../lib/widget-shortcuts'
import { ProfileEditHost } from '../lib/auth-ui'
import { StudentLoginSheet } from './StudentLoginSheet'
import { AppSidebar } from './AppSidebar'
import { AppUpdateNotice } from './AppUpdateNotice'
import { PageTransition } from './PageTransition'
import { useHomeOpening } from './useHomeOpening'
import openingStyles from './HomeOpening.module.css'
import { refreshSchool } from '../store/school'

const TAB_ROUTES = new Set([
  '/',
  '/services',
  '/schedule',
  '/tasks',
  '/market',
  '/info',
  '/messages',
  '/plaza',
  '/campus-life',
  '/profile',
  '/contact',
  '/settings',
  '/admin/content',
  '/admin/news',
  '/admin/members',
  '/admin/reports',
])
const FILL_ROUTES = new Set(['/chat'])

const ROOT_ROUTES = new Set([
  '/',
  '/services',
  '/messages',
  '/plaza',
  '/campus-life',
  '/profile',
  '/settings',
  '/admin/content',
  '/admin/news',
])

export function PhoneShell({ children }: { children: ReactNode }) {
  useUiVariant()
  useKeyboardInset()
  useEffect(() => {
    void restoreUiVariant()
    restoreFontPref()
    const saved = getFontFamilyPref()
    if (saved !== 'default') void ensureFontDownload(saved).catch(() => undefined)
    if (getUiVariant() === 'handdrawn') void ensureHanddrawnFonts()
  }, [])
  const loc = useLocation()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  useLayoutEffect(() => {
    studyBackHistory.record(window.history.state?.idx, loc.pathname, navigationType)
  }, [loc.key, loc.pathname, navigationType])
  useEffect(() => {
    const onStudyBack = (event: Event) => {
      if (loc.pathname !== '/study' && loc.pathname !== '/study/focus') return
      event.preventDefault()
      goBack(navigate)
    }
    window.addEventListener('app-study-back', onStudyBack)
    return () => window.removeEventListener('app-study-back', onStudyBack)
  }, [loc.pathname, navigate])
  useEffect(() => {
    const host = window as Window & { __SC_WIDGET_ROUTE__?: string }
    const openWidget = () => {
      const route = host.__SC_WIDGET_ROUTE__
      if (!isWidgetShortcut(route)) return
      delete host.__SC_WIDGET_ROUTE__
      navigate(route)
    }
    window.addEventListener('native-schedule-widget-open', openWidget)
    openWidget()
    return () => window.removeEventListener('native-schedule-widget-open', openWidget)
  }, [navigate])
  const auth = useAuth()
  const qbankRevision = useQbankRevision()
  const [open, setOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const backAt = useRef(0)
  const [focusMute, setFocusMute] = useState(() => isFocusImmersive())
  const [firstRunOk, setFirstRunOk] = useState(() => isFirstRunComplete())
  const shell = getAppShell()
  const work = isWorkShell(shell)
  useEffect(() => {
    const onBack = (event: Event) => {
      if (loc.pathname === '/') return
      const now = Date.now()
      if (now - backAt.current > 1800) { backAt.current = now; return }
      event.preventDefault()
      backAt.current = 0
      navigate('/')
    }
    window.addEventListener('app-back-nav', onBack)
    return () => window.removeEventListener('app-back-nav', onBack)
  }, [loc.pathname, navigate])
  useEffect(() => {
    const openMenu = () => setSidebarOpen(true)
    window.addEventListener('ohu-open-menu', openMenu)
    return () => window.removeEventListener('ohu-open-menu', openMenu)
  }, [])
  useEffect(() => { refreshSchool() }, [auth.phase, qbankRevision])
  /* 门禁后的后台同步会把缓存写进本机；完成后刷新一次 store，首页不用手动重进。 */
  useEffect(() => {
    const done = () => { refreshSchool() }
    window.addEventListener('ohu-background-sync-done', done)
    return () => window.removeEventListener('ohu-background-sync-done', done)
  }, [])
  useEffect(() => {
    if (work || auth.phase === 'booting') return
    const sync = () => {
      void refreshScheduleWidgets(auth.isSigned ? auth.user?.uid || '' : '')
    }
    sync()
    window.addEventListener('ohhu-schedule-cache', sync)
    window.addEventListener('ohhu-schedule-calendar', sync)
    window.addEventListener(TODO_DATA_CHANGED_EVENT, sync)
    window.addEventListener(WIDGET_SHORTCUTS_CHANGED_EVENT, sync)
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.removeEventListener('ohhu-schedule-cache', sync)
      window.removeEventListener('ohhu-schedule-calendar', sync)
      window.removeEventListener(TODO_DATA_CHANGED_EVENT, sync)
      window.removeEventListener(WIDGET_SHORTCUTS_CHANGED_EVENT, sync)
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [auth.phase, auth.isSigned, auth.user?.uid, qbankRevision, work])
  useEffect(() => work ? undefined : installStudentHaptics(), [work])
  useEffect(() => work ? undefined : installSoundManager(), [work])
  const workOk = hasWorkAccess({
    shell,
    isSigned: auth.isSigned,
    isAdmin: !!auth.profile?.isAdmin,
    isSuperAdmin: !!auth.profile?.isSuperAdmin,
  })
  /*
   * 学生端：**不设登录门**——设置 / 课表 / 广场 / 我的等公开内容直接可看，
   * 具体功能（发布、私信、点赞、报名等）由各页面的 `ensureSignedIn(reason)` 按需唤起登录面板；
   * 工作端：仍要求手机号登录且角色 / 管理员已通过。
   * 两端都必须先过首次免责声明 + 权限引导。
   */
  const gateOk = work ? firstRunOk && workOk : firstRunOk
  const homeOpening = useHomeOpening(gateOk && !work && !focusMute, loc.pathname === '/')
  const lastSoundPath = useRef(loc.pathname)
  useEffect(() => {
    if (lastSoundPath.current === loc.pathname) return
    lastSoundPath.current = loc.pathname
    if (gateOk && !work && !focusMute) playSound(SoundEvent.PageSwitch)
  }, [loc.pathname, gateOk, work, focusMute])
  useFoxCodexProgress(gateOk && !work)
  // Consent and sign-in screens are usable startup surfaces too. Actual pages
  // acknowledge readiness after their lazy module has committed successfully.
  useEffect(() => {
    if (!gateOk && (!firstRunOk || auth.phase !== 'booting')) void confirmOtaAppReady()
  }, [gateOk, firstRunOk, auth.phase])
  const campusCameraOwner = auth.isSigned && auth.user?.uid ? 'user:' + auth.user.uid : 'guest'
  useEffect(() => {
    if (!gateOk || work || focusMute || auth.phase === 'booting') return
    let current = true
    const listener = listenForCampusCameraRestore(campusCameraOwner, () => {
      navigate('/campus-life?section=journal&compose=restored')
    }, () => current).catch(() => undefined)
    return () => {
      current = false
      void listener.then(handle => handle?.remove())
    }
  }, [auth.phase, campusCameraOwner, focusMute, gateOk, navigate, work])
  const withTab =
    !focusMute &&
    (TAB_ROUTES.has(loc.pathname) ||
      loc.pathname.startsWith('/admin/'))
  const search = new URLSearchParams(loc.search)
  const showingCampusFeed = loc.pathname === '/campus-life' && !search.get('section') && search.get('feed') !== 'friends'
  const plazaSearch = loc.pathname === '/plaza' || showingCampusFeed ? search : null
  const plazaChat = plazaSearch?.get('tab') === 'lobby' && plazaSearch.get('compose') !== '1'
  const fill =
    focusMute ||
    FILL_ROUTES.has(loc.pathname) ||
    // Only the conversation needs a fixed viewport. The plaza feed and rankings
    // grow with their content and must use the shell's normal scrolling surface.
    plazaChat ||
    loc.pathname.startsWith('/chats/') ||
    loc.pathname.startsWith('/im/')
  const showPlus = gateOk && withTab && !work && !focusMute

  const pull = usePullRefresh(IS_NATIVE && !fill && gateOk && !focusMute)

  useEffect(() => {
    const onFocusMute = (e: Event) => {
      const on = !!(e as CustomEvent<boolean>).detail
      setFocusMute(on)
    }
    window.addEventListener('pet-focus-immersive', onFocusMute)
    setFocusMute(isFocusImmersive())
    return () => window.removeEventListener('pet-focus-immersive', onFocusMute)
  }, [loc.pathname])

  const pathRef = useRef(loc.pathname)
  pathRef.current = loc.pathname
  useEffect(() => {
    if (!IS_NATIVE) return
    void initNativeShell(() => ROOT_ROUTES.has(pathRef.current))
  }, [])

  useEffect(() => {
    void initAppShell()
  }, [])

  /* 进门 / 登录成功 = 今日打卡；只静默记连击与变脸，不弹打卡条 */
  useEffect(() => {
    if (!gateOk || !auth.isSigned || !auth.user?.uid) return
    /* 变脸与连击仅学生端；工作端不走多邻国式打卡 */
    if (work) return
    const uid = auth.user.uid
    let disposed = false
    let lastTouch = 0
    let removeNative: (() => Promise<void>) | undefined
    const active = () => {
      if (disposed || Date.now() - lastTouch < 1500) return
      lastTouch = Date.now()
      void touchActive(uid, shell).then(() => { if (!disposed) return refreshFoxV1Summary() }).catch(() => undefined)
    }
    const visible = () => { if (document.visibilityState === 'visible') active() }
    active()
    let day = foxLocalDay()
    const midnight = window.setInterval(() => {
      const next = foxLocalDay()
      if (day !== next && document.visibilityState === 'visible') { day = next; active() }
    }, 60_000)
    window.addEventListener('online', active)
    document.addEventListener('visibilitychange', visible)
    if (IS_NATIVE) void import('@capacitor/app').then(async ({ App }) => {
      const listener = await App.addListener('appStateChange', state => { if (state.isActive) active() })
      if (disposed) await listener.remove()
      else removeNative = () => listener.remove()
    }).catch(() => undefined)
    return () => { disposed = true; window.clearInterval(midnight); window.removeEventListener('online', active); document.removeEventListener('visibilitychange', visible); void removeNative?.() }
  }, [gateOk, auth.isSigned, auth.user?.uid, shell, work])

  useEffect(() => {
    if (!gateOk) return
    if (isWorkShell(getAppShell())) return
    // A confirmed empty timetable is already a valid sync result; do not log in
    // to the school again on every cold launch merely because it has zero rows.
    if (loadScheduleCache().meta) return
    const key = 'campus.autosync.quiet.v1'
    if (sessionStorage.getItem(key) === '1') return
    sessionStorage.setItem(key, '1')
    void runAutoSync().catch(() => undefined)
  }, [gateOk])

  return (
    <div className={styles.chrome} data-app-viewport="">
      <div className={styles.phone}>
        <ToastProvider>
          <FocusTimerProvider>
          <div className={styles.body} data-app-body="" data-student-shell={!work ? 'true' : undefined}>
            <a className="skip-link" href="#main-content">跳到主要内容</a>
            {gateOk ? <AppUpdateNotice /> : null}
            {gateOk ? <FocusTimerBar /> : null}
            {IS_NATIVE && gateOk ? (
              <div
                ref={pull.indicatorRef}
                aria-hidden="true"
                className={`${styles.pull} ${pull.armed ? styles.pullArmed : ''} ${
                  pull.refreshing ? styles.pullBusy : ''
                }`}
              >
                <span className={styles.pullPill}>
                  <span className={styles.pullRing} />
                  {pull.refreshing ? '正在刷新…' : pull.armed ? '松开刷新' : '下拉刷新'}
                </span>
              </div>
            ) : null}
            <main
              id="main-content"
              tabIndex={-1}
              ref={pull.containerRef}
              data-app-page=""
              data-app-shell={shell}
              data-home-opening={homeOpening}
              className={`${styles.page} hide-scroll ${withTab && gateOk ? styles.withTab : ''} ${fill ? styles.fill : ''} ${homeOpening ? openingStyles.active : ''}`}
            >
              <ShellRouteGuard />
              {gateOk && work && !focusMute ? <ShellNotifyHost /> : null}
              {gateOk && !work && !focusMute ? <StudentManagementTools /> : null}
              {gateOk ? <PageTransition direction={navigationType === 'POP' ? -1 : 1}>{children}</PageTransition> : null}
            </main>
            {gateOk && !work && !focusMute && withTab && loc.pathname !== '/' ? <FoxgirlCompanion key={loc.pathname} /> : null}
            {gateOk && withTab ? <TabBar onPlus={() => setOpen(true)} /> : null}
            {showPlus && open ? <PublishSheet onClose={() => setOpen(false)} /> : null}
            {!firstRunOk ? <FirstRunHost onDone={() => setFirstRunOk(true)} /> : null}
            {/*
              学生端不再挂开屏注册门（学生端启动直接进 App）。
              登录 / 注册改由 `ensureSignedIn(reason)` 按需唤起 `<AuthSheets />` 的 LoginSheet
              （它本身就带 登录 / 注册 / 忘记密码 三视图与验证码通路），入口在「我的」与「设置 → 账号与安全」。
              `PhoneRegistrationGate` 组件保留在 `./PhoneRegistrationGate`，需要恢复开屏门时一行即可挂回。
            */}
            {firstRunOk && work && !workOk ? auth.phase === 'booting' || auth.isSigned ? <WorkAccessGate key={auth.user?.uid || auth.phase} /> : <WorkPhoneGate /> : null}
            {gateOk && !work && !focusMute ? <RemindHost /> : null}
            {gateOk && !work && !focusMute ? <AwayLoginHost /> : null}
            {gateOk && (work || focusMute) ? <TodoReminderSyncHost /> : null}
            {/* Mascot interaction belongs to the inline FoxTap on home/profile.
                Authentication and reminders stay independent of mascot presentation. */}
            {IS_NATIVE && !focusMute ? <OtaUpdateHost /> : null}
          </div>
          {!focusMute ? <Toaster /> : null}
          {!focusMute ? <StudentLoginSheet /> : null}
          {gateOk && !work && !focusMute ? <ProfileEditHost /> : null}
          {!work && !focusMute ? <>
<AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
          </> : null}
          </FocusTimerProvider>
        </ToastProvider>
      </div>
    </div>
  )
}
