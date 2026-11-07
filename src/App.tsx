import { Component, Suspense, lazy, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { BrowserRouter, HashRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import { getAppShell, shellHomePath } from './lib/app-shell'
import { IS_NATIVE } from './lib/platform'
import { CampusGate } from './components/CampusGate'
import { PhoneShell } from './components/PhoneShell'
import { BootGate } from './components/BootGate'
import { SimpleHomePage } from './pages/SimpleHomePage'
import { AdminWorkspace } from './components/AdminWorkspace'
import { AdminNotificationRuntime } from './components/AdminNotificationRuntime'
import { adminScopedPath, isAdminWorkspacePath, shouldOpenDesktopAdmin } from './lib/client-surface'
import { clientPath } from './lib/client-navigation'
import { confirmOtaAppReady } from './ota-ready'

import { RouteLoading, RouteEntryMotion } from './components/RouteLoading'
import { PublicMeetShell } from './components/meet/PublicMeetShell'

type ScreenLoader = () => Promise<{ default: ComponentType }>
const SECONDARY_ROUTES: ReadonlyArray<readonly [string, ScreenLoader]> = [
  ['/services', () => import('./pages/ServicesPage').then((module) => ({ default: module.ServicesPage }))],
  ['/plugins', () => import('./pages/PluginMarketplacePage').then((module) => ({ default: module.PluginMarketplacePage }))],
  ['/plugins/:pluginId', () => import('./pages/plugins/PluginFeaturePage').then((module) => ({ default: module.PluginFeaturePage }))],
  ['/plugins/fox-safety', () => import('./pages/plugins/FoxSafetyPage').then((module) => ({ default: module.FoxSafetyPage }))],
  ['/contacts', () => import('./pages/ContactsPage').then((module) => ({ default: module.ContactsPage }))],
  ['/contacts/add', () => import('./pages/AddFriendPage').then((module) => ({ default: module.AddFriendPage }))],
  ['/contacts/requests', () => import('./pages/FriendRequestsPage').then((module) => ({ default: module.FriendRequestsPage }))],
  ['/discover', () => import('./pages/DiscoverPage').then((module) => ({ default: module.DiscoverPage }))],
  ['/moments', () => import('./pages/moments/MomentsPage').then((module) => ({ default: module.MomentsPage }))],
  ['/tasks', () => import('./pages/TasksPage').then((module) => ({ default: module.TasksPage }))],
  ['/market', () => import('./pages/MarketPage').then((module) => ({ default: module.MarketPage }))],
  ['/info', () => import('./pages/InfoPage').then((module) => ({ default: module.InfoPage }))],
  ['/profile', () => import('./pages/ProfilePage').then((module) => ({ default: module.ProfilePage }))],
  ['/study/focus', () => import('./pages/study/StudyFocusPage').then((module) => ({ default: module.StudyFocusPage }))],
  ['/study/chaoxing', () => import('./pages/study/ChaoxingBridgePage').then((module) => ({ default: module.ChaoxingBridgePage }))],
  ['/study/pu', () => import('./pages/study/PocketUniPage').then((module) => ({ default: module.PocketUniPage }))],
  ['/study/quality', () => import('./pages/study/QualityPage').then((module) => ({ default: module.QualityPage }))],
  ['/grades', () => import('./pages/GradesHubPage').then((module) => ({ default: module.GradesHubPage }))],
  ['/grades/public', () => import('./pages/study/PublicElectivePage').then((module) => ({ default: module.PublicElectivePage }))],
  ['/grades/courses', () => import('./pages/study/CourseGradesPage').then((module) => ({ default: module.CourseGradesPage }))],
  ['/study/oneclick', () => import('./pages/study/OneClickPage').then((module) => ({ default: module.OneClickPage }))],
  ['/study/goals', () => import('./pages/study/EnergyGoalsPage').then((module) => ({ default: module.EnergyGoalsPage }))],
  ['/study/plan', () => import('./pages/study/StudyGoalsPage').then((module) => ({ default: module.StudyGoalsPage }))],
  ['/words', () => import('./pages/words/WordsPage').then((module) => ({ default: module.WordsPage }))],
  ['/words/duel', () => import('./pages/words/WordDuelPage').then((module) => ({ default: module.WordDuelPage }))],
  ['/words/endless', () => import('./pages/words/WordEndlessPage').then((module) => ({ default: module.WordEndlessPage }))],
  ['/english', () => import('./pages/english/EnglishHubPage').then((module) => ({ default: module.EnglishHubPage }))],
  ['/english/practice', () => Promise.resolve({ default: () => <Navigate to="/words?downloads=1" replace /> })],
  ['/english/bank', () => import('./pages/english/BankPage').then((module) => ({ default: module.BankPage }))],
  ['/english/exam/:paperId', () => import('./pages/english/ExamPage').then((module) => ({ default: module.ExamPage }))],
  ['/chat', () => import('./pages/ChatPage').then((module) => ({ default: module.ChatPage }))],
  ['/chats', () => import('./pages/ChatListPage').then((module) => ({ default: module.ChatListPage }))],
  ['/chats/:id', () => import('./pages/ChatRoomPage').then((module) => ({ default: module.ChatRoomPage }))],
  ['/schedule', () => import('./pages/schedule/ScheduleHome').then((module) => ({ default: module.ScheduleHome }))],
  ['/calendar', () => import('./pages/AcademicCalendarPage').then((module) => ({ default: module.AcademicCalendarPage }))],
  ['/schedule/guide', () => import('./pages/schedule/SchoolScheduleGuide').then((module) => ({ default: module.SchoolScheduleGuidePage }))],
  ['/meet', () => import('./pages/meet/MeetPage').then((module) => ({ default: module.MeetPage }))],
  ['/meet/:code', () => import('./pages/meet/MeetPage').then((module) => ({ default: module.MeetPage }))],
  ['/study', () => import('./pages/study/StudyHubPage').then((module) => ({ default: module.StudyHubPage }))],
  ['/zhongce', () => import('./pages/study/ZhongcePage').then((module) => ({ default: module.ZhongcePage }))],
  ['/plaza', () => import('./pages/plaza/PlazaPage').then((module) => ({ default: module.PlazaPage }))],
  ['/campus-map', () => import('./pages/CampusMapPage').then((module) => ({ default: module.CampusMapPage }))],
  ['/sports/teams', () => import('./pages/MorningTeamsPage').then((module) => ({ default: module.MorningTeamsPage }))],
  ['/sports', () => import('./pages/SportsPage').then((module) => ({ default: module.SportsPage }))],
  ['/sports/results', () => import('./pages/SportsResultsPage').then((module) => ({ default: module.SportsResultsPage }))],
  ['/todo', () => import('./pages/TodoPage').then((module) => ({ default: module.TodoPage }))],
  ['/contact', () => import('./pages/ContactPage').then((module) => ({ default: module.ContactPage }))],
  ['/messages', () => import('./pages/MessagesPage').then((module) => ({ default: module.MessagesPage }))],
  ['/notify', () => import('./pages/NotifyPage').then((module) => ({ default: module.NotifyPage }))],
  ['/settings', () => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage }))],
  ['/admin/members', () => import('./pages/AdminMembersPage').then((module) => ({ default: module.AdminMembersPage }))],
  ['/admin/content', () => import('./pages/AdminContentPage').then((module) => ({ default: module.AdminContentPage }))],
  ['/admin/news', () => import('./pages/AdminNewsPage').then((module) => ({ default: module.AdminNewsPage }))],
  ['/admin/reports', () => import('./pages/AdminReportsPage').then((module) => ({ default: module.AdminReportsPage }))],
  ['/admin/messages', () => import('./pages/AdminMessagesPage').then((module) => ({ default: module.AdminMessagesPage }))],
  ['/admin/notify', () => import('./pages/AdminNotifyPage').then((module) => ({ default: module.AdminNotifyPage }))],
  ['/admin/settings', () => import('./pages/AdminSettingsPage').then((module) => ({ default: module.AdminSettingsPage }))],
  ['/item/:id', () => import('./pages/ItemDetailPage').then((module) => ({ default: module.ItemDetailPage }))],
  ['/task/:id', () => import('./pages/TaskDetailPage').then((module) => ({ default: module.TaskDetailPage }))],
]

class PageBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return <section className="route-state" role="alert">
      <h1>页面暂时无法打开</h1>
      <p>请检查网络后重新加载。若仍打不开，可以刷新应用。</p>
      <div className="route-actions">
        <button type="button" onClick={this.props.onRetry}>重新加载</button>
        <button type="button" onClick={() => window.location.reload()}>刷新应用</button>
        <Link to={clientPath('/')}>返回首页</Link>
      </div>
    </section>
  }
}

function DeferredPage({ load }: { load: ScreenLoader }) {
  const [attempt, setAttempt] = useState(0)
  const Page = useMemo(() => lazy(load), [load, attempt])
  return <PageBoundary key={attempt} onRetry={() => setAttempt((value) => value + 1)}>
    <Suspense fallback={<RouteLoading />}><ReadyPage><Page /></ReadyPage></Suspense>
  </PageBoundary>
}

function ReadyPage({ children }: { children: ReactNode }) {
  useEffect(() => { void confirmOtaAppReady() }, [])
  return <><RouteEntryMotion />{children}</>
}

function ApplicationShell({ children }: { children: ReactNode }) {
  const location = useLocation()
  const isMeetRoute = location.pathname === '/meet' || location.pathname.startsWith('/meet/')
  const explicitStudent = new URLSearchParams(location.search).get('view') === 'student'
  let adminContext = false
  let studentPreview = explicitStudent
  try {
    studentPreview ||= sessionStorage.getItem('ohhu.web.student-preview') === '1'
    adminContext = sessionStorage.getItem('ohhu.web.admin-context') === '1'
  } catch { /* private browsing */ }
  useEffect(() => {
    try {
      if (explicitStudent) {
        sessionStorage.setItem('ohhu.web.student-preview', '1')
        sessionStorage.removeItem('ohhu.web.admin-context')
      } else if (isAdminWorkspacePath(location.pathname)) {
        sessionStorage.removeItem('ohhu.web.student-preview')
        sessionStorage.setItem('ohhu.web.admin-context', '1')
      }
    } catch { /* private browsing */ }
  }, [explicitStudent, location.pathname])
  // Existing shared screens keep their own routes and business logic. When
  // opened from this workspace, normalize their URL into its protected scope.
  // Invitation links are independently readable in a fresh mobile browser.
  // Joining a public activity still requires the normal account login.
  if (!IS_NATIVE && location.pathname.startsWith('/meet/')) return <PublicMeetShell>{children}</PublicMeetShell>
  if (!IS_NATIVE && !isMeetRoute && adminContext && !explicitStudent && !isAdminWorkspacePath(location.pathname)) {
    return <Navigate to={adminScopedPath(location.pathname, '/admin', false) + location.search + location.hash} replace />
  }
  if (!isMeetRoute && shouldOpenDesktopAdmin({ native: IS_NATIVE, pathname: location.pathname, width: window.innerWidth, studentPreview })) {
    return <Navigate to="/admin/content" replace />
  }
  if (!IS_NATIVE && !explicitStudent && isAdminWorkspacePath(location.pathname)) return <AdminWorkspace><AdminNotificationRuntime />{children}</AdminWorkspace>
  return <CampusGate><PhoneShell>{children}</PhoneShell></CampusGate>
}

/**
 * 按运行端选择路由模式：
 *  - H5：BrowserRouter，保留干净的路径 URL，配合托管侧 SPA 回退；
 *  - 套壳 App：HashRouter，`capacitor://` 协议下 pushState 深链与冷启动刷新会失效，
 *    hash 路由不依赖服务端回退，始终能落地。
 *
 * useLocation().pathname 在两种 Router 下都只返回 hash 之后的路径段，
 * 因此 TabBar / PhoneShell 里的字符串比较语义完全一致，页面无需改动。
 */
function AppRouter({ children }: { children: ReactNode }) {
  return IS_NATIVE ? <HashRouter>{children}</HashRouter> : <BrowserRouter>{children}</BrowserRouter>
}

/** 多壳 APK：非学生端默认进对应工作台，UI 设计仍共用 */
function ShellHome() {
  const shell = getAppShell()
  const home = shellHomePath(shell)
  if (shell !== 'user' && home !== '/') return <Navigate to={home} replace />
  return <ReadyPage><SimpleHomePage /></ReadyPage>
}

export default function App() {
  return (
    <AuthProvider>
      <BootGate />
      <AppRouter>
        <ApplicationShell>
          <Routes>
            <Route path="/" element={<ShellHome />} />
            <Route path="/admin" element={<Navigate to="/admin/content" replace />} />
            {SECONDARY_ROUTES.map(([path, load]) => <Route key={path} path={path} element={<DeferredPage key={path} load={load} />} />)}
            {SECONDARY_ROUTES.filter(([path]) => !isAdminWorkspacePath(path) && !['/messages', '/notify', '/settings'].includes(path)).map(([path, load]) => <Route key={`admin${path}`} path={`/admin${path}`} element={<DeferredPage key={`admin${path}`} load={load} />} />)}
            {/* 游戏 / 宠物模块已归档，旧链接统一回落首页 */}
            <Route path="/games" element={<Navigate to="/" replace />} />
            <Route
              path="/games/*"
              element={<Navigate to="/" replace />}
            />
            <Route path="/story" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ApplicationShell>
      </AppRouter>
    </AuthProvider>
  )
}
