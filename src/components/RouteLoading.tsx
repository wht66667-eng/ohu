import { useEffect, useLayoutEffect, useState } from 'react'
import { FoxLoader } from './fox/FoxLoader'
import styles from './RouteLoading.module.css'

export const ROUTE_LOADING_DELAY_MS = 300

/** Fast route chunks stay quiet; only a real pending route reveals a loader. */
export function RouteLoading() {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), ROUTE_LOADING_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [])
  return <div className={styles.pending} aria-busy="true" data-route-pending="">
    {slow ? <div className={styles.feedback} data-route-loading=""><FoxLoader size={96} label="正在打开页面…" /></div> : null}
  </div>
}

/** Animate the existing route surface, so full-height pages keep their layout. */
export function RouteEntryMotion() {
  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const surface = document.getElementById('main-content') || document.getElementById('admin-main')
    if (!surface?.animate) return
    const animation = surface.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' })
    return () => animation.cancel()
  }, [])
  return null
}
