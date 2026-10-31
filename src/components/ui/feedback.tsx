import { motion } from 'motion/react'
import { useId } from 'react'
import { successFeedback, switchThumb } from '../../lib/animations'
import { useUiMotion } from '../../lib/motion-pref'
import styles from './feedback.module.css'

/** Native input preserves labels, Space, disabled state and visible keyboard focus. */
export function MotionSwitch({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  const reduce = useUiMotion()
  const id = useId()
  return <span className={styles.switch}>
    <input id={id} type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    <span aria-hidden="true" className={`${styles.track} ${checked ? styles.on : ''}`}><motion.span className={styles.thumb} {...switchThumb(checked, reduce)} /></span>
  </span>
}
/** Fixed tick segments reveal via transforms, without animating SVG stroke properties. */
export function SuccessMark() {
  const reduce = useUiMotion()
  return <span className={styles.success} aria-hidden="true"><motion.span className={styles.ring} {...successFeedback(0, reduce)} /><span className={styles.shortAngle}><motion.span className={styles.stroke} {...successFeedback(1, reduce)} /></span><span className={styles.longAngle}><motion.span className={styles.stroke} {...successFeedback(2, reduce)} /></span></span>
}
