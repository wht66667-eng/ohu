import { useSyncExternalStore } from 'react'
import { fadeUp } from './animations'

const query = '(prefers-reduced-motion: reduce)'
const subscribe = (onChange: () => void) => {
  const media = window.matchMedia(query)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}
const getSnapshot = () => typeof window !== 'undefined' && window.matchMedia(query).matches
export function useUiMotion() { return useSyncExternalStore(subscribe, getSnapshot, () => true) }
export function prefersReducedMotion() { return getSnapshot() }
export function enterMotion(reduce?: boolean) { return fadeUp(reduce ?? prefersReducedMotion()) }
