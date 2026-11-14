import { Link } from 'react-router-dom'
import styles from '../../components/PluginMarketplace.module.css'

export function AppearanceWorkshop({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return <div className={styles.actions}>
    <button type="button" className={enabled ? styles.enabled : styles.enable} onClick={onToggle} aria-pressed={enabled}>{enabled ? '使用中 · 停用' : '未使用 · 启用'}</button>
    {enabled ? <Link className={styles.open} to="/settings?section=appearance">打开外观工坊</Link> : null}
  </div>
}
