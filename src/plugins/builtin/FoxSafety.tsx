import { Link } from 'react-router-dom'
import styles from '../../components/PluginMarketplace.module.css'

export function FoxSafety({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return <div className={styles.actions}>
    <button type="button" className={enabled ? styles.enabled : styles.enable} aria-pressed={enabled} onClick={onToggle}>{enabled ? '使用中 · 停用' : '启用安全知识插件'}</button>
    {enabled ? <Link className={styles.open} to="/plugins/fox-safety">打开离线题库</Link> : null}
  </div>
}
