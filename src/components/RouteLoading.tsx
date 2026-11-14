import { useEffect, useLayoutEffect, useState } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
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
  const { pathname } = useLocation()
  const navigationType = useNavigationType()
  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const surface = document.getElementById('main-content') || document.getElementById('admin-main')
    if (!surface?.animate) return
    if (document.activeElement?.matches('textarea, input, [contenteditable="true"]')) return
    // 翻页节奏读纸面令牌 --turn-ms（随皮肤变化）；令牌缺失时回落 260ms。
    const turnMs = Number.parseFloat(getComputedStyle(surface).getPropertyValue('--turn-ms')) || 260
    const backward = navigationType === 'POP'
    const animation = surface.animate([
      { opacity: .75, transform: `perspective(1400px) rotateY(${backward ? 7 : -7}deg)`, transformOrigin: backward ? 'right center' : 'left center' },
      { opacity: 1, transform: 'none', transformOrigin: backward ? 'right center' : 'left center' },
    ], { duration: turnMs, easing: 'ease-out' })
    return () => animation.cancel()
  }, [pathname, navigationType])
  return null
}
