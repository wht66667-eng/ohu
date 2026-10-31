import { useEffect } from 'react'
import { dismissBootSplash, isBootReady, startBootPresentation, subscribeBoot } from '../lib/boot'
import { getAppShell } from '../lib/app-shell'
import { hasCampusGatePass } from '../lib/campus-gate'
import { isFirstRunComplete } from '../lib/first-run'
import { IS_NATIVE } from '../lib/platform'
import { mountStartupCover, updateStartupCover } from '../lib/startup-cover'

/** A welcome/login gate or a deep link is ready without mounting the homepage. */
function needsHomeFrame() {
  if (!IS_NATIVE && (window.location.pathname.startsWith('/admin') || window.innerWidth >= 900)) return false
  if (getAppShell() !== 'user' || !isFirstRunComplete()) return false
  try { if (!hasCampusGatePass()) return false } catch { return false }
  const path = window.location.hash.startsWith('#/') ? window.location.hash.slice(1).split('?')[0] : window.location.pathname
  return path === '/'
}
export function BootGate() {
  useEffect(() => {
    const stopCover = mountStartupCover()
    const stop = startBootPresentation()
    const check = () => {
      updateStartupCover()
      if (isBootReady('auth') && (isBootReady('home') || !needsHomeFrame())) dismissBootSplash()
    }
    check(); const off = subscribeBoot(check)
    return () => { off(); stop(); stopCover() }
  }, [])
  return null
}
