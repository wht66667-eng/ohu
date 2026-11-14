import { useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

const rememberedRoutes = new Set(['/', '/services', '/profile'])
const scrollPositions = new Map<string, number>()

/** Restore the scrollable surface when the lazy page has mounted. */
export function StudentScrollRestoration() {
  const marker = useRef<HTMLSpanElement>(null)
  const { pathname } = useLocation()
  const navigationType = useNavigationType()
  const restoreOnMount = useRef(navigationType === 'POP')

  useLayoutEffect(() => {
    const surface = marker.current?.closest<HTMLElement>('[data-app-page][data-app-shell="user"]')
    if (!surface) return
    const historyIndex = window.history.state?.idx
    const positionKey = `${historyIndex}:${pathname}`
    const remember = rememberedRoutes.has(pathname)
    const top = remember && restoreOnMount.current ? scrollPositions.get(positionKey) ?? 0 : 0
    surface.scrollTo({ top, behavior: 'instant' })

    if (!remember) return
    if (!restoreOnMount.current) scrollPositions.delete(positionKey)

    // The page and bottom bar may settle after this child mounts. Restore as
    // soon as the saved position fits, or yield when the user interacts.
    let observer: ResizeObserver | undefined
    let timer: number | undefined
    const interaction = new AbortController()
    const stopWaiting = () => {
      observer?.disconnect()
      observer = undefined
      window.clearTimeout(timer)
      interaction.abort()
    }
    const content = marker.current?.nextElementSibling ?? marker.current?.parentElement
    if (content && surface.scrollTop + 1 < top) {
      observer = new ResizeObserver(() => {
        surface.scrollTo({ top, behavior: 'instant' })
        if (surface.scrollTop + 1 >= top) stopWaiting()
      })
      observer.observe(content)
      observer.observe(surface)
      timer = window.setTimeout(stopWaiting, 1000)
      for (const event of ['pointerdown', 'wheel', 'keydown']) {
        surface.addEventListener(event, stopWaiting, { signal: interaction.signal, passive: true })
      }
    }

    // React Router keeps the history index when replacing a query parameter.
    const save = () => {
      if (observer || window.history.state?.idx !== historyIndex) return
      scrollPositions.delete(positionKey)
      scrollPositions.set(positionKey, surface.scrollTop)
      if (scrollPositions.size > 60) scrollPositions.delete(scrollPositions.keys().next().value!)
    }
    surface.addEventListener('scroll', save, { passive: true })
    return () => {
      stopWaiting()
      surface.removeEventListener('scroll', save)
    }
  }, [pathname])

  return <span ref={marker} hidden />
}
