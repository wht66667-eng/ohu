import { Component, Suspense, lazy, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { BrowserRouter, HashRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { IS_NATIVE } from './lib/platform'
import { initNativeShell } from './lib/native'
import { isFirstRunComplete } from './lib/first-run'
import { AdminWorkspace } from './components/AdminWorkspace'
import { AdminFirstRunHost } from './components/AdminFirstRunHost'
import { BootGate } from './components/BootGate'
import { AdminNotificationRuntime } from './components/AdminNotificationRuntime'
import { OtaUpdateHost } from './components/OtaUpdateHost'
import { FoxLoader } from './components/fox/FoxLoader'
import { confirmOtaAppReady } from './ota-ready'

type Loader = () => Promise<{ default: ComponentType }>
const ROUTES: ReadonlyArray<readonly [string, Loader]> = [
  ['/admin/content', () => import('./pages/AdminContentPage').then((m) => ({ default: m.AdminContentPage }))],
  ['/admin/news', () => import('./pages/AdminNewsPage').then((m) => ({ default: m.AdminNewsPage }))],
  ['/admin/reports', () => import('./pages/AdminReportsPage').then((m) => ({ default: m.AdminReportsPage }))],
  ['/admin/members', () => import('./pages/AdminMembersPage').then((m) => ({ default: m.AdminMembersPage }))],
  ['/admin/messages', () => import('./pages/AdminMessagesPage').then((m) => ({ default: m.AdminMessagesPage }))],
  ['/admin/notify', () => import('./pages/AdminNotifyPage').then((m) => ({ default: m.AdminNotifyPage }))],
  ['/admin/settings', () => import('./pages/AdminSettingsPage').then((m) => ({ default: m.AdminSettingsPage }))],
  ['/admin/chats', () => import('./pages/ChatListPage').then((m) => ({ default: m.AdminChatListPage }))],
  ['/admin/chats/:id', () => import('./pages/ChatRoomPage').then((m) => ({ default: m.ChatRoomPage }))],
  ['/admin/contacts', () => import('./pages/ContactsPage').then((m) => ({ default: m.ContactsPage }))],
  ['/admin/contacts/add', () => import('./pages/AddFriendPage').then((m) => ({ default: m.AddFriendPage }))],
  ['/admin/contacts/requests', () => import('./pages/FriendRequestsPage').then((m) => ({ default: m.FriendRequestsPage }))],
]

class AdminPageBoundary extends Component<{ children: ReactNode; retry: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <section className="route-state" role="alert"><h1>管理页面暂时无法打开</h1><p>请检查网络后重新加载。</p><button type="button" onClick={this.props.retry}>重新加载</button><Link to="/admin/content">返回管理台</Link></section> : this.props.children
  }
}
function Ready({ children }: { children: ReactNode }) {
  useEffect(() => { void confirmOtaAppReady() }, [])
  return <>{children}</>
}
function AdminPage({ load }: { load: Loader }) {
  const [attempt, setAttempt] = useState(0)
  const Page = useMemo(() => lazy(load), [load, attempt])
  return <AdminPageBoundary key={attempt} retry={() => setAttempt((value) => value + 1)}><Suspense fallback={<div className="route-state"><FoxLoader label="正在打开管理页面…" /></div>}><Ready><Page /></Ready></Suspense></AdminPageBoundary>
}
function LegacyAdminRoute() {
  const location = useLocation()
  if (/^\/(?:messages|notify|settings|chats|contacts)(?:\/|$)/.test(location.pathname)) return <Navigate to={`/admin${location.pathname}${location.search}${location.hash}`} replace />
  return <Navigate to="/admin/content" replace />
}
function AdminSurface() {
  const auth = useAuth()
  const [consented, setConsented] = useState(() => isFirstRunComplete('admin'))
  const allowed = auth.isSigned && !!(auth.profile?.isAdmin || auth.profile?.isSuperAdmin)
  useEffect(() => { if (auth.phase !== 'booting' && (!allowed || !consented)) void confirmOtaAppReady() }, [auth.phase, allowed, consented])
  useEffect(() => { if (IS_NATIVE) void initNativeShell(() => ['/admin/content', '/admin/messages'].includes(window.location.hash.slice(1).split('?')[0])) }, [])
  return <div data-admin-app="" data-native={IS_NATIVE ? '' : undefined}>
    <AdminWorkspace>{consented ? <><AdminNotificationRuntime /><Routes>
      {ROUTES.map(([path, load]) => <Route key={path} path={path} element={<AdminPage key={path} load={load} />} />)}
      <Route path="*" element={<LegacyAdminRoute />} />
    </Routes></> : null}</AdminWorkspace>
    {!consented ? <AdminFirstRunHost onDone={() => setConsented(true)} /> : null}
    {IS_NATIVE ? <OtaUpdateHost /> : null}
  </div>
}

/** Dedicated administrator entry: no student pages, course runtime, or publish sheet. */
export default function AdminApp() {
  const Router = IS_NATIVE ? HashRouter : BrowserRouter
  return <AuthProvider><BootGate /><Router><AdminSurface /></Router></AuthProvider>
}
