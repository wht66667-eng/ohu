import { Link } from 'react-router-dom'
import styles from '../../components/PluginMarketplace.module.css'

export function ScheduleReminder({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return <div className={styles.actions}>
    <button type="button" className={enabled ? styles.enabled : styles.enable} onClick={onToggle} aria-label={enabled ? '停用课程提醒插件' : '启用课程提醒插件'} aria-pressed={enabled}>{enabled ? '使用中 · 停用' : '未使用 · 启用'}</button>
    {enabled ? <Link className={styles.open} to="/schedule">查看课表</Link> : null}
  </div>
}
