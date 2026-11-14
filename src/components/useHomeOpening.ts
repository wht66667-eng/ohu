import { useEffect, useRef, useState } from 'react'
import { whenBootSettled } from '../lib/boot'
import { useUiMotion } from '../lib/motion-pref'
import { IS_NATIVE } from '../lib/platform'
import { getUiVariant } from '../lib/ui-variant'

const openingDuration = { companion: 1000, classic: 1000, handdrawn: 1080 } as const
type OpeningSkin = keyof typeof openingDuration

function isOpeningSkin(variant: string): variant is OpeningSkin {
  return Object.hasOwn(openingDuration, variant)
}

let openingPlayed = false
const loadedOnHome = typeof window !== 'undefined' && (IS_NATIVE
  ? ['', '#/'].includes(window.location.hash.split('?')[0])
  : window.location.pathname === '/')

/** Run after the real startup gate opens, once per document and only on the initial home route. */
export function useHomeOpening(ready: boolean, onHome: boolean) {
  const initialHome = useRef(loadedOnHome && onHome)
  const reduceMotion = useUiMotion()
  const [opening, setOpening] = useState<OpeningSkin>()

  useEffect(() => {
    if (!onHome) initialHome.current = false
    if (!ready || !initialHome.current || openingPlayed) return
    let cancelled = false
    let endTimer: number | undefined
    void whenBootSettled().then(() => {
      if (cancelled || openingPlayed) return
      openingPlayed = true
      const skin = getUiVariant()
      if (!reduceMotion && isOpeningSkin(skin)) {
        setOpening(skin)
        endTimer = window.setTimeout(() => setOpening(undefined), openingDuration[skin])
      }
    })
    return () => {
      cancelled = true
      window.clearTimeout(endTimer)
    }
  }, [ready, onHome, reduceMotion])

  useEffect(() => {
    if (!opening || (ready && onHome && !reduceMotion)) return
    const timer = window.setTimeout(() => setOpening(undefined), 0)
    return () => window.clearTimeout(timer)
  }, [opening, ready, onHome, reduceMotion])

  return ready && onHome && !reduceMotion ? opening : undefined
}
