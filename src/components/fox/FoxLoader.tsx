import type { CSSProperties } from 'react'
import { useUiMotion } from '../../lib/motion-pref'
import styles from './FoxLoader.module.css'
import { isFoxFreeVariant, useUiVariant } from '../../lib/ui-variant'

export function FoxLoader({ size = 48, label = '正在加载…', compact = false }: { size?: number; label?: string; compact?: boolean }) {
  const variant = useUiVariant()
  const reduce = useUiMotion()
  return <span className={`${styles.loader} ${compact ? styles.compact : ''}`} role="status" aria-label={label}
    data-reduce-motion={reduce || undefined} style={{ '--fox-size': `${size}px` } as CSSProperties}>
    {isFoxFreeVariant(variant) ? <svg className={styles.ring} width={Math.min(size, 36)} height={Math.min(size, 36)} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="27" fill="none" stroke="var(--line)" strokeWidth="6" />
      <circle cx="32" cy="32" r="27" fill="none" stroke="var(--green)" strokeWidth="6" strokeDasharray="60 110" strokeLinecap="round" />
    </svg> : <span className={styles.mascotStage} aria-hidden="true">
      <img className={styles.mascot} src={`${import.meta.env.BASE_URL}brand/ohu-original/fox-loader-wave-v2.png`}
        width="1254" height="1254" alt="" decoding="async" />
    </span>}
    {!compact ? <>
      <span className={styles.dots} aria-hidden="true"><i /><i /><i /></span>
      <span className={styles.label}>{label}</span>
    </> : null}
  </span>
}

