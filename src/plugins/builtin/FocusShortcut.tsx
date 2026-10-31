import { Link } from 'react-router-dom'
import styles from '../../components/PluginMarketplace.module.css'

export function FocusShortcut({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return <div className={styles.actions}>
    <button type="button" className={enabled ? styles.enabled : styles.enable} onClick={onToggle} aria-label={enabled ? '停用专注计时插件' : '启用专注计时插件'} aria-pressed={enabled}>{enabled ? '使用中 · 停用' : '未使用 · 启用'}</button>
    {enabled ? <Link className={styles.open} to="/study/focus">开始专注</Link> : null}
  </div>
}
