import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ToastProvider } from '../context/ToastContext'
import { useAuth } from '../lib/auth'
import { AuthSheets } from '../lib/auth-ui'
import { ADMIN_NAVIGATION, activeAdminNavigation, type AdminNavigationIcon } from '../lib/admin-navigation'
import { Toaster } from '../lib/toast'
import { DeniedState, ErrorState, LoadingState } from './ui/StateViews'
import styles from './AdminWorkspace.module.css'

function NavigationIcon({ kind }: { kind: AdminNavigationIcon }) {
  const paths: Record<AdminNavigationIcon, ReactNode> = {
    content: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 9h8M8 13h8M8 17h5" /></>,
    news: <><path d="m4 10 13-5v14L4 14v-4ZM7 15l1 5h3l-1-4M20 9v6" /></>,
    reports: <><path d="M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4Z" /><path d="M12 8v5m0 3h.01" /></>,
    members: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2" /></>,
    messages: <><path d="M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z" /><path d="M7 10h8M7 14h5" /></>,
    settings: <><path d="m10 3-.6 3-2.7 1.5-3-.9-2 3.4 2.3 2v3l-2.3 2 2 3.4 3-.9 2.7 1.5.6 3h4l.6-3 2.7-1.5 3 .9 2-3.4-2.3-2v-3l2.3-2-2-3.4-3 .9L14.6 6 14 3h-4Z" transform="translate(1 -1) scale(.92)" /><circle cx="12" cy="12" r="3" /></>,
  }
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>
}

class WorkspaceBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <div className={styles.pageError}><ErrorState title="这个管理页面暂时无法打开" hint="可以重新加载页面；已经保存的内容不会受影响。" action={<button type="button" className={styles.primaryButton} onClick={this.props.onRetry}>重新加载页面</button>} /></div> : this.props.children
  }
}

/** Browser-only management layout. Mount inside the existing AuthProvider and Router. */
export function AdminWorkspace({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const location = useLocation()
  const routeOwner = `${auth.user?.uid || ''}:${location.pathname}`
  const [menuOwner, setMenuOwner] = useState<string | null>(null)
  const menuOpen = menuOwner === routeOwner
  const [leaving, setLeaving] = useState(false)
  const [actionFailure, setActionFailure] = useState<{ owner: string; text: string } | null>(null)
  const actionError = actionFailure?.owner === routeOwner ? actionFailure.text : ''
  const [retry, setRetry] = useState(0)
  const menuButton = useRef<HTMLButtonElement>(null)
  const mounted = useRef(true)
  const logoutPending = useRef(false)
  const currentUid = useRef(auth.user?.uid || '')
  const main = useRef<HTMLElement>(null)
  const active = activeAdminNavigation(location.pathname)
  const title = active?.label || '管理后台'
  const allowed = auth.isSigned && !!(auth.profile?.isAdmin || auth.profile?.isSuperAdmin)
  const name = auth.profile?.username || auth.user?.nickname || auth.user?.loginName || '管理员'
  const role = auth.profile?.isSuperAdmin ? '站长' : '管理员'

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => { currentUid.current = auth.user?.uid || '' }, [auth.user?.uid])
  useEffect(() => {
    const before = document.title
    document.title = `${title} · 哦狐管理后台`
    return () => { document.title = before }
  }, [title])
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setMenuOwner(null)
      menuButton.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  async function logout() {
    if (logoutPending.current) return
    const owner = currentUid.current
    logoutPending.current = true
    setLeaving(true)
    setActionFailure(null)
    try {
      await auth.logout()
    } catch (error) {
      if (mounted.current && currentUid.current === owner) setActionFailure({ owner: routeOwner, text: error instanceof Error ? error.message : '退出未完成，请重试。' })
    } finally {
      logoutPending.current = false
      if (mounted.current) setLeaving(false)
    }
  }

  function selectDestination() {
    setMenuOwner(null)
    main.current?.focus()
  }

  let gate: ReactNode = null
  if (auth.phase === 'booting') {
    gate = <><h1>正在确认管理账号</h1><LoadingState title="正在恢复登录状态" hint="确认账号权限后，继续进入管理后台。" /><button type="button" className={styles.secondaryButton} onClick={() => window.location.reload()}>重新检查</button></>
  } else if (!auth.isSigned) {
    gate = <><span className={styles.eyebrow}>哦狐 · 校园运营</span><h1>管理校园日常</h1><p className={styles.gateLead}>从公告发布到内容治理，在一个工作台完成。</p><div className={styles.gateFeatures}><span>内容与广场</span><span>公告与消息</span><span>成员与权限</span></div><button type="button" className={styles.primaryButton} onClick={() => auth.openLogin('请使用已获授权的管理员账号登录哦狐管理后台。')}>登录管理后台 <span aria-hidden="true">→</span></button><p className={styles.gateNote}>使用现有账号登录，管理权限由站长授予。</p></>
  } else if (!auth.profile) {
    gate = <><h1>管理员权限尚未确认</h1><ErrorState title="暂时无法读取账号权限" hint="请重新检查。若仍无法确认，可以退出并更换账号。" action={<button type="button" className={styles.primaryButton} onClick={() => window.location.reload()}>重新检查权限</button>} /><button type="button" className={styles.secondaryButton} disabled={leaving} onClick={() => void logout()}>{leaving ? '正在退出…' : '退出并更换账号'}</button></>
  } else if (!allowed) {
    gate = <><h1>当前账号没有管理权限</h1><DeniedState title="请联系站长开通权限" hint="学生账号需要获得管理员授权后，才能进入电脑后台和手机管理端。" /><div className={styles.gateActions}><button type="button" className={styles.primaryButton} onClick={() => window.location.reload()}>重新检查权限</button><button type="button" className={styles.secondaryButton} disabled={leaving} onClick={() => void logout()}>{leaving ? '正在退出…' : '退出并更换账号'}</button></div></>
  }

  return <ToastProvider>
    <div className={styles.workspace} data-admin-workspace="" data-app-shell="admin">
      <a className={styles.skipLink} href="#admin-main">跳到管理内容</a>
      {gate ? <div className={styles.gate}>
        <Link className={styles.brand} to="/admin" aria-label="哦狐管理后台"><span className={styles.brandMark} aria-hidden="true">狐</span><span><strong>哦狐</strong><small>管理后台</small></span></Link>
        <main id="admin-main" tabIndex={-1} className={styles.gateCard}>{gate}{actionError ? <p className={styles.actionError} role="alert">{actionError}</p> : null}</main>
        <p className={styles.gateFooter}>电脑后台 · 手机管理端 · 学生端</p>
      </div> : <>
        <aside id="admin-navigation" className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ''}`}>
          <Link className={styles.brand} to="/admin" onClick={selectDestination} aria-label="哦狐管理后台"><span className={styles.brandMark} aria-hidden="true">狐</span><span><strong>哦狐</strong><small>管理后台</small></span></Link>
          <nav aria-label="后台主导航" className={styles.navigation}>
            {(['operations', 'account'] as const).map((group) => <div key={group} className={styles.navGroup}><p className={styles.groupLabel}>{group === 'operations' ? '校园运营' : '工作与账号'}</p>{ADMIN_NAVIGATION.filter((item) => item.group === group).map((item) => <Link key={item.path} to={item.path} onClick={selectDestination} aria-current={active?.path === item.path ? 'page' : undefined} className={`${styles.navLink} ${active?.path === item.path ? styles.navSelected : ''}`}><NavigationIcon kind={item.icon} /><span>{item.label}</span>{active?.path === item.path ? <i className={styles.navIndicator} aria-hidden="true" /> : null}</Link>)}</div>)}
          </nav>
          <div className={styles.sidebarAccount}><span className={styles.avatar} aria-hidden="true">{name.slice(0, 1)}</span><div><strong>{name}</strong><span>{role}</span></div><button type="button" className={styles.logout} disabled={leaving} onClick={() => void logout()}>{leaving ? '退出中' : '退出'}</button></div>
        </aside>
        <div className={styles.surface}>
          <header className={styles.topbar}>
            <button ref={menuButton} type="button" className={styles.menuButton} aria-controls="admin-navigation" aria-expanded={menuOpen} onClick={() => setMenuOwner(menuOpen ? null : routeOwner)}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d={menuOpen ? 'M6 6l12 12M18 6 6 18' : 'M4 6h16M4 12h16M4 18h16'} /></svg>{menuOpen ? '收起' : '导航'}</button>
            <div className={styles.breadcrumb}><span>校园运营</span><span aria-hidden="true">/</span><strong>{title}</strong></div>
            <span className={styles.role}>{role}</span>
          </header>
          {actionError ? <div className={styles.errorBanner} role="alert">{actionError}<button type="button" className={styles.secondaryButton} disabled={leaving} onClick={() => void logout()}>重试退出</button></div> : null}
          <main ref={main} id="admin-main" className={styles.content} tabIndex={-1} data-app-page="" data-app-body="" data-app-shell="admin">
            <div className={styles.routeDescription}>{active?.description || '处理校园运营事项'}</div>
            <WorkspaceBoundary key={`${auth.user?.uid}:${location.pathname}:${retry}`} onRetry={() => setRetry((value) => value + 1)}><div key={auth.user?.uid} className={styles.pageContent}>{children}</div></WorkspaceBoundary>
          </main>
        </div>
      </>}
      <AuthSheets />
      <Toaster />
    </div>
  </ToastProvider>
}
