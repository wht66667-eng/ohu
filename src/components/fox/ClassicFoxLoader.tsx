import { useEffect, useRef, type CSSProperties } from 'react'
import { foxAssetUrl } from '../../lib/fox-art'
import { useUiMotion } from '../../lib/motion-pref'
import styles from './FoxLoader.module.css'
import { BOOT_MOTION, foxFrame, foxLoaderTravel } from '../../lib/animations'

export function ClassicFoxLoader({ size = 48, label = '正在加载…', compact = false }: { size?: number; label?: string; compact?: boolean }) {
  const reduce = useUiMotion()
  const track = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const runner = track.current?.querySelector<HTMLElement>(`.${styles.runner}`)
    const facing = track.current?.querySelector<HTMLElement>(`.${styles.facing}`)
    if (reduce || !runner?.animate || !facing) return
    const animations = [runner.animate(foxLoaderTravel(size), BOOT_MOTION.travel), facing.animate(BOOT_MOTION.facing, BOOT_MOTION.direction)]
    track.current?.querySelectorAll<HTMLElement>(`.${styles.frame}`).forEach((frame, index) => animations.push(frame.animate(foxFrame, { ...BOOT_MOTION.frames, delay: -index * 200 })))
    return () => animations.forEach((animation) => animation.cancel())
  }, [reduce, size])
  return <span className={`${styles.loader} ${compact ? styles.compact : ''}`} role="status" aria-label={label} style={{ '--fox-size': `${size}px` } as CSSProperties}>
    <span ref={track} className={styles.track} aria-hidden="true">
      {reduce ? <img className={styles.still} src={foxAssetUrl('loading')} width={size} height={size} alt="" /> : <span className={styles.runner}><span className={styles.facing}>{[0, 1, 2, 3].map((frame) => <span key={frame} className={styles.frame}><img src={`${import.meta.env.BASE_URL}pixel-fox/run-cycle-v1.png`} alt="" className={styles.sprite} style={{ transform: `translate(${-50 * (frame % 2)}%, ${-50 * Math.floor(frame / 2)}%)` }} /></span>)}</span></span>}
    </span>
    {!compact ? <span className={styles.label}>{label}</span> : null}
  </span>
}
