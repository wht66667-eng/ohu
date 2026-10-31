import { useEffect, useRef, useState } from 'react'
import { FoxSheetPose } from './FoxSheetPose'
import type { FoxPoseId } from '../../lib/fox-sheet'
import styles from './FoxTap.module.css'

/** A small opt-in interaction for existing mascot placements; it never adds page chrome. */
export function FoxTap({ pose, frames, message, className, defaultSrc }: {
  pose: FoxPoseId
  frames: readonly [FoxPoseId, FoxPoseId]
  message: string
  className?: string
  defaultSrc?: string
}) {
  const [frame, setFrame] = useState<FoxPoseId | null>(null)
  const [showTip, setShowTip] = useState(false)
  const timers = useRef<number[]>([])
  useEffect(() => () => { timers.current.forEach(window.clearTimeout); timers.current = [] }, [])

  const tap = () => {
    timers.current.forEach(window.clearTimeout)
    setShowTip(true)
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setFrame(frames[0])
      timers.current = [
        window.setTimeout(() => setFrame(frames[1]), 200),
        window.setTimeout(() => setFrame(pose), 400),
        window.setTimeout(() => setFrame(null), 650),
      ]
    }
    timers.current.push(window.setTimeout(() => setShowTip(false), 2800))
  }

  return <span className={`${styles.wrap} ${className || ''}`}>
    <button className={styles.button} type="button" onClick={tap} aria-label="点击阿狐，听一句提醒">
      {defaultSrc && !frame ? <img src={defaultSrc} alt="" loading="lazy" /> : <FoxSheetPose pose={frame || pose} className={frame ? styles.frame : styles.pose} />}
    </button>
    {showTip ? <span className={styles.tip} role="status">{message}</span> : null}
  </span>
}
