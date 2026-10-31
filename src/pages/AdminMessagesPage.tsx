import { useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { CampusIcon } from '../components/CampusIcon'
import { useAuth } from '../lib/auth'
import { usePollingRows } from '../lib/hooks'
import { captureImSession, subscribeImSession } from '../lib/im-session'
import { fetchNotifications } from '../lib/notify'
import { fetchReports } from '../lib/reports'
import { filterNotesForShell } from '../lib/notification-scope'
import { ChatInbox } from './ChatListPage'
import styles from './MessagesPage.module.css'

type Summary = { notices: number; reports: number; noticesWindowFull: boolean; reportsWindowFull: boolean }
export function AdminMessagesPage() {
  const auth = useAuth(), uid = auth.isSigned ? auth.user?.uid || '' : ''
  const revision = useSyncExternalStore(subscribeImSession, () => captureImSession(uid)?.revision ?? -1, () => -1)
  return <AdminMessages key={`${uid}:${revision}`} uid={uid} />
}
function AdminMessages({ uid }: { uid: string }) {
  const { rows, error, loading, reload } = usePollingRows<Summary>(async () => {
    if (!captureImSession(uid)) return { rows: [], error: null }
    const [notes, reports] = await Promise.all([fetchNotifications(uid, 100), fetchReports('pending')])
    if (notes.error || reports.error) return { rows: [], error: [notes.error ? `管理通知：${notes.error}` : '', reports.error ? `举报：${reports.error}` : ''].filter(Boolean).join('；') }
    return { rows: [{
      notices: filterNotesForShell(notes.rows.filter((row) => row.uid === uid), 'admin').filter((row) => !row.read_at).length,
      reports: reports.rows.length,
      noticesWindowFull: notes.rows.length >= 100,
      reportsWindowFull: reports.rows.length >= 200,
    }], error: null }
  }, [uid])
  const summary = rows[0]
  const count = (key: 'notices' | 'reports') => {
    if (error) return '数量暂未更新'
    if (loading && !summary) return '正在同步'
    if (!summary) return '暂无待处理'
    if (key === 'notices') return summary.noticesWindowFull ? `最近100条中 ${summary.notices} 条未读` : `${summary.notices} 条未读`
    return summary.reportsWindowFull ? `至少 ${summary.reports} 条待处理` : `${summary.reports} 条待处理`
  }
  return <div className={styles.page}>
    <PageHeader title="管理消息" />
    <nav className={styles.shortcuts} aria-label="管理工作入口">
      <Link to="/admin/reports" className={styles.shortcut}><CampusIcon name="flag" size={22} /><span className={styles.shortcutText}><strong>待处理举报</strong><small>{count('reports')}</small></span></Link>
      <Link to="/admin/notify" className={styles.shortcut}><CampusIcon name="bell" size={22} /><span className={styles.shortcutText}><strong>管理通知</strong><small>{count('notices')}</small></span></Link>
    </nav>
    <nav className={styles.secondary} aria-label="工作联系"><Link to="/admin/contacts">通讯录与工作会话<span aria-hidden="true">›</span></Link><Link to="/admin/settings?section=notifications">管理通知权限<span aria-hidden="true">›</span></Link></nav>
    {error ? <section className={styles.connection} role="status"><span>工作数据同步失败：{error}</span><button type="button" onClick={reload}>重试</button></section> : null}
    <ChatInbox embedded work />
  </div>
}
