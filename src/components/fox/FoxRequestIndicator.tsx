import { useEffect, useState } from 'react'
import { isFoxFreeVariant, useUiVariant } from '../../lib/ui-variant'
import type { FoxPoseId } from '../../lib/fox-sheet'
import { FoxSheetPose } from './FoxSheetPose'
import styles from './FoxRequestIndicator.module.css'

/** Mount only while an actual request is pending; short requests never show the mascot. */
export function FoxRequestIndicator({ label, pose = 'thinking' }: { label: string; pose?: FoxPoseId }) {
  const [slow, setSlow] = useState(false)
  const variant = useUiVariant()
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 450)
    return () => window.clearTimeout(timer)
  }, [])
  const showFox = slow && !isFoxFreeVariant(variant)
  return <span className={styles.content} role="status" aria-live="polite" data-request-indicator={slow ? 'slow' : 'pending'}>
    <span className={styles.visual} aria-hidden="true">
      {showFox ? <FoxSheetPose className={styles.fox} pose={pose} /> : <span className={styles.spinner} />}
    </span>
    <span>{label}</span>
  </span>
}
