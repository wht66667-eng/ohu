import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { studentManagementActions, type StudentManagementAction } from '../lib/student-management'
import styles from './StudentManagementTools.module.css'

/** 同一组链接供学生端和隔离预览复用；不提供测试提权或本机角色覆盖。 */
export function StudentManagementLinks({ actions }: { actions: StudentManagementAction[] }) {
  if (!actions.length) return null
  return <section className={styles.tools} aria-label="管理员快捷操作"><span>管理员操作</span><nav aria-label="当前页面管理">{actions.map(action => <Link key={action.href} to={action.href}>{action.label}<span aria-hidden="true"> ›</span></Link>)}</nav></section>
}
export function StudentManagementTools() {
  const auth = useAuth(), location = useLocation()
  const allowed = auth.isSigned && !!(auth.profile?.isAdmin || auth.profile?.isSuperAdmin)
  return <StudentManagementLinks actions={studentManagementActions(location.pathname, allowed)} />
}
