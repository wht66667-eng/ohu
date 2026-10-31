import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { useAuth } from '../lib/auth'
import { useToast } from '../context/ToastContext'
import { applyTheme, getStoredTheme, type Theme } from '../lib/theme'
import { IS_NATIVE } from '../lib/platform'
import { getNativeAppVersion, WEB_VERSION } from '../lib/app-version'
import { checkAppUpdate, formatNotes, openUpdateDownload, type UpdateManifest } from '../lib/app-update'
import { currentBundleVersion, diagnoseOta, downloadAndQueueOta, fetchOtaManifest, getOtaCompatibilityError, shouldApplyOta } from '../lib/live-update'
import { ADMIN_NOTIFICATION_CHANNEL, adminNotificationPermission, ensureAdminNotificationChannel } from '../lib/admin-notifications'
import { openChannelSettings, openNotificationSettings } from '../lib/keep-alive'
import { captureImSession, currentImSession, subscribeImSession } from '../lib/im-session'
import styles from './AdminSettingsPage.module.css'

function SettingsRow({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return <div className={styles.row}><div><strong>{title}</strong><p>{detail}</p></div>{children}</div>
}

export function AdminSettingsPage() {
  const auth = useAuth()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const revision = useSyncExternalStore(subscribeImSession, () => captureImSession(uid)?.revision ?? -1, () => -1)
  return <AdminSettings key={`${uid}:${revision}`} />
}
function AdminSettings() {
  const auth = useAuth(), toast = useToast()
  const [params] = useSearchParams()
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme())
  const [permission, setPermission] = useState('正在检查')
  const [version, setVersion] = useState(`界面 v${WEB_VERSION}`)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [available, setAvailable] = useState<UpdateManifest | null>(null)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const mounted = useRef(true), lock = useRef(false)
  const owner = useRef(captureImSession(auth.user?.uid || ''))
  const current = () => mounted.current && currentImSession(owner.current)
  const permissionSequence = useRef(0)
  async function refreshPermission() {
    const sequence = ++permissionSequence.current
    try {
      const status = await adminNotificationPermission()
      if (mounted.current && sequence === permissionSequence.current) setPermission(status === 'granted' ? '已允许通知' : status === 'denied' ? '未允许通知' : status === 'prompt' ? '等待授权' : '当前浏览器不支持')
    } catch { if (mounted.current && sequence === permissionSequence.current) setPermission('读取失败，请重试') }
  }
  useEffect(() => {
    mounted.current = true
    void Promise.all([getNativeAppVersion(), currentBundleVersion()]).then(([native, web]) => {
      if (mounted.current) setVersion(`界面 v${web}${IS_NATIVE ? native ? ` · 安装包 v${native.version}（${native.build}）` : ' · 安装包版本暂不可读' : ' · 电脑管理后台'}`)
    }).catch(() => undefined)
    void refreshPermission()
    const refresh = () => { if (document.visibilityState !== 'hidden') void refreshPermission() }
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    let disposeNative: (() => Promise<void>) | undefined
    if (IS_NATIVE) void import('@capacitor/app').then(async ({ App }) => {
      const listener = await App.addListener('appStateChange', ({ isActive }) => { if (isActive) refresh() })
      if (!mounted.current) await listener.remove(); else disposeNative = () => listener.remove()
    }).catch(() => undefined)
    return () => { mounted.current = false; permissionSequence.current++; window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); void disposeNative?.() }
  }, [])
  async function action(run: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setFailure('')
    try { await run() }
    catch (error) { if (current()) setFailure(error instanceof Error ? error.message : '操作未完成，请重试') }
    finally { lock.current = false; if (current()) setBusy(false) }
  }
  async function checkApk() {
    const result = await checkAppUpdate()
    if (!current()) return
    if (result.status === 'error') throw Error(result.message)
    if (result.status === 'up_to_date') toast(result.verifiedRemote ? '已是最新管理端安装包' : '暂时无法确认线上安装包版本，请稍后重试')
    else setAvailable(result.manifest)
  }
  async function checkInterface() {
    const remote = await fetchOtaManifest()
    if (!current()) return
    if (!remote) throw Error('暂时无法连接管理端更新服务')
    const incompatible = getOtaCompatibilityError(remote)
    if (incompatible) throw Error(incompatible)
    const local = await currentBundleVersion()
    if (!current()) return
    if (!shouldApplyOta(remote, local)) { toast.ok('管理端界面已是最新'); return }
    const result = await downloadAndQueueOta(remote)
    if (!current()) return
    if (!result.ok) throw Error(result.error)
    toast.ok('管理端界面已更新')
  }
  return <div className={styles.page}>
    <PageHeader title="管理设置" />
    <p className={styles.lead}>管理账号、工作通知与管理端更新。</p>
    {failure ? <p className={styles.error} role="alert">{failure}</p> : null}
    <section className={styles.section} id="management-notifications" data-highlighted={params.get('section') === 'notifications' ? '' : undefined}>
      <h2>管理工作通知</h2>
      <p className={styles.hint}>仅接收举报与内容治理消息。工作通知在应用运行期间同步；关闭应用后的云端推送尚未接入。</p>
      <SettingsRow title="通知权限" detail={permission}><button type="button" disabled={busy} onClick={() => void action(async () => { await adminNotificationPermission(true); if (!current()) return; await refreshPermission() })}>检查并授权</button></SettingsRow>
      {IS_NATIVE ? <><SettingsRow title="铃声、震动与锁屏" detail="使用独立的“哦狐管理工作通知”渠道；按手机系统设置生效。"><button type="button" disabled={busy} onClick={() => void action(async () => { await ensureAdminNotificationChannel(); if (!current()) return; const error = await openChannelSettings(ADMIN_NOTIFICATION_CHANNEL); if (error) throw Error(error) })}>手机通知设置</button></SettingsRow><SettingsRow title="应用通知总开关" detail="查看横幅、锁屏与所有通知渠道。"><button type="button" disabled={busy} onClick={() => void action(async () => { const error = await openNotificationSettings(); if (error) throw Error(error) })}>打开</button></SettingsRow></> : null}
    </section>
    <section className={styles.section}><h2>外观</h2><SettingsRow title="界面主题" detail="管理后台与手机管理端均适用。"><select aria-label="界面主题" value={theme} onChange={(event) => { const next = event.target.value as Theme; applyTheme(next); setTheme(next) }}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></SettingsRow></section>
    <section className={styles.section}><h2>账号与安全</h2><SettingsRow title={auth.profile?.username || auth.user?.nickname || '管理账号'} detail={auth.profile?.isSuperAdmin ? '站长权限' : '管理员权限'}><button type="button" onClick={auth.openCred}>{auth.user?.hasPassword ? '修改密码' : '设置密码'}</button></SettingsRow><SettingsRow title="退出当前账号" detail="退出后须重新验证管理权限。"><button type="button" disabled={busy} onClick={() => setLogoutOpen(true)}>退出登录</button></SettingsRow></section>
    <section className={styles.section}><h2>关于与更新</h2><p className={styles.hint}>{version}</p><SettingsRow title="管理端安装包" detail={IS_NATIVE ? '仅下载管理端 APK；不会下载学生端。' : '电脑后台随网页部署更新。'}><button type="button" disabled={busy || !IS_NATIVE} onClick={() => void action(checkApk)}>检查安装包</button></SettingsRow><SettingsRow title={IS_NATIVE ? '管理端界面更新' : '重新加载后台'} detail={IS_NATIVE ? '只检查适用于管理端的界面包。' : '重新载入已部署的管理后台。'}><button type="button" disabled={busy} onClick={() => IS_NATIVE ? void action(checkInterface) : window.location.reload()}>{busy ? '处理中…' : IS_NATIVE ? '检查界面更新' : '重新加载'}</button></SettingsRow><SettingsRow title="更新遇到问题" detail="读取本机与线上管理端的更新状态。"><button type="button" disabled={busy} onClick={() => void action(async () => { const result = await diagnoseOta(); if (!current()) return; if (!result.manifestOk) throw Error('暂时无法读取线上管理端清单，请检查网络'); toast(`本机 ${result.localVersion || '内置包'} · 线上 ${result.remoteVersion || '未知'}${result.compatibilityError ? ` · ${result.compatibilityError}` : ''}`) })}>检查状态</button></SettingsRow></section>
    <Link className={styles.back} to="/admin/content">返回内容管理</Link>
    {available ? <ConfirmSheet title="发现新版管理端" desc={formatNotes(available)} confirmText="下载管理端 APK" onClose={() => setAvailable(null)} onConfirm={() => { if (openUpdateDownload(available)) setAvailable(null); else setFailure('管理端下载地址尚未配置，请联系站长') }} /> : null}
    {logoutOpen ? <ConfirmSheet title="退出管理端？" desc="退出后需要重新登录并验证管理权限。" confirmText="退出" danger onClose={() => setLogoutOpen(false)} onConfirm={async () => { setLogoutOpen(false); await action(async () => { await auth.logout() }) }} /> : null}
  </div>
}
