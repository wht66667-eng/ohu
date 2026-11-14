import { getAppShell, SHELL_META } from './app-shell'

export type BootKey = 'auth' | 'home'
export const MIN_BOOT_MS = 0
export const MAX_BOOT_MS = 3000
export const BOOT_FILL_MS = 0
export const BOOT_FADE_MS = 160
// DEV inspection is explicit and still uses the real auth and route guards.
const previewBoot = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === 'boot'
const ready = new Set<BootKey>()
const listeners = new Set<() => void>()
let settled = false
let settleResolve: (() => void) | null = null
const settlePromise = new Promise<void>((resolve) => { settleResolve = resolve })
let animations: Animation[] = []
let stopPresentation: (() => void) | undefined
let bootRoot: HTMLElement | null = null
let previousFocus: HTMLElement | null = null
let presentationStartedAt: number | undefined
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const documentStartedAt = typeof window === 'undefined' ? Date.now() : (window as Window & { __OHU_BOOT_STARTED_AT__?: number }).__OHU_BOOT_STARTED_AT__ || Date.now()

function updatePresentation() {
  const splash = document.getElementById('boot-splash')
  if (!splash || splash.dataset.dismissed || splash.dataset.failed) return
  const work = splash.dataset.shell !== 'user'
  const label = document.getElementById('boot-label')
  if (label) label.textContent = work ? '正在恢复工作台…' : '正在准备你的校园…'
  const status = document.getElementById('boot-status')
  if (status) status.textContent = ready.has('auth')
    ? ready.has('home') ? '界面已准备好' : '正在准备页面'
    : '正在恢复登录状态'
}

/** The HTML first frame stays usable even if the main bundle cannot mount. */
export function showBootRecovery() {
  const splash = document.getElementById('boot-splash')
  if (!splash || settled) return
  splash.dataset.failed = '1'
  animations.forEach((animation) => animation.cancel()); animations = []
  const label = document.getElementById('boot-label')
  const status = document.getElementById('boot-status')
  const retry = document.getElementById('boot-retry')
  if (label) label.textContent = '页面还没有准备好'
  if (status) status.textContent = '加载较慢，请检查网络，或重试'
  if (retry) retry.hidden = false
}

/** One cold-start story. A resumed app never resets its clock. */
export function startBootPresentation(): () => void {
  const splash = document.getElementById('boot-splash')
  if (!splash || settled) return () => {}
  stopPresentation?.()
  splash.dataset.shell = getAppShell()
  splash.dataset.runtime = '1'
  delete splash.dataset.failed
  const retry = document.getElementById('boot-retry')
  if (retry) retry.hidden = true
  const title = document.getElementById('boot-title')
  if (title) title.textContent = SHELL_META[getAppShell()].label
  bootRoot = document.getElementById('root')
  if (bootRoot) bootRoot.inert = true
  previousFocus ||= document.activeElement instanceof HTMLElement ? document.activeElement : null
  const skip = document.getElementById('boot-skip') as HTMLButtonElement | null
  if (previewBoot) {
    splash.dataset.preview = '1'
    if (skip) { skip.textContent = '关闭预览'; skip.setAttribute('aria-label', '关闭启动效果预览') }
  }
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  presentationStartedAt ??= Date.now()
  const stopMotion = () => { animations.forEach((animation) => animation.cancel()); animations = [] }
  const runMotion = () => {
    stopMotion()
    // 默认无启动屏进场动画；仅 DEV ?preview=boot 保留预览。
    if (!previewBoot || media.matches || !splash.animate) return
    // StrictMode remounts continue one timeline; foreground and resize never replay it.
    const elapsed = Date.now() - presentationStartedAt!
    if (elapsed > 1000) return
    const elements = [...splash.querySelectorAll<HTMLElement>('[data-boot-animate]')]
      .filter((element) => element.getClientRects().length)
    elements.forEach((element, index) => {
      const animation = element.animate([{ opacity: 0, transform: 'translateY(9px)' }, { opacity: 1, transform: 'translateY(0)' }], {
        delay: Math.min(index * 45, 180), duration: 240, easing: 'ease-out', fill: 'backwards',
      })
      animation.currentTime = elapsed
      animations.push(animation)
    })
    const hero = splash.querySelector<HTMLElement>('[data-boot-hero]')
    if (hero && getAppShell() === 'user') {
      const animation = hero.animate([{ transform: 'rotate(-3deg) scale(.96)' }, { transform: 'rotate(2deg) scale(1.025)', offset: .55 }, { transform: 'rotate(0) scale(1)' }], {
        duration: 820, easing: 'ease-out', fill: 'backwards',
      })
      animation.currentTime = elapsed
      animations.push(animation)
    }
  }
  const skipAnimation = () => dismissBootSplash('skip')
  if (skip) {
    skip.hidden = !previewBoot
    if (previewBoot) skip.addEventListener('click', skipAnimation)
  }
  media.addEventListener('change', runMotion)
  runMotion(); updatePresentation()
  const cleanup = () => { stopMotion(); media.removeEventListener('change', runMotion); skip?.removeEventListener('click', skipAnimation) }
  stopPresentation = cleanup
  // A delayed bundle may mount after the static recovery deadline has passed.
  if (!previewBoot && Date.now() >= documentStartedAt + MAX_BOOT_MS - BOOT_FADE_MS) dismissBootSplash('timeout')
  return cleanup
}

export function markBootReady(key: BootKey): void {
  if (ready.has(key)) return
  ready.add(key); updatePresentation(); listeners.forEach((listener) => listener())
}
export function isBootReady(key: BootKey) { return ready.has(key) }
export function subscribeBoot(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function bootSettled() { return settled }
export function whenBootSettled() { return settlePromise }

/** Decoration ending does not authenticate a user or change any route guard. */
export function dismissBootSplash(reason: 'ready' | 'timeout' | 'skip' = 'ready'): void {
  if (typeof document === 'undefined' || settled) return
  if (previewBoot && reason !== 'skip') return
  settled = true; settleResolve?.(); settleResolve = null
  document.documentElement.classList.remove('boot-lock')
  stopPresentation?.(); stopPresentation = undefined
  if (bootRoot) bootRoot.inert = false
  const splash = document.getElementById('boot-splash')
  if (!splash) return
  splash.dataset.dismissed = '1'
  const restoreFocus = splash.contains(document.activeElement)
  const finish = () => {
    splash.remove()
    if (restoreFocus && previousFocus && previousFocus !== document.body && previousFocus.isConnected) previousFocus.focus({ preventScroll: true })
  }
  const remaining = Math.max(0, documentStartedAt + MAX_BOOT_MS - Date.now())
  if (!previewBoot || reduceMotion() || !splash.animate || remaining === 0) { finish(); return }
  splash.style.pointerEvents = 'none'
  splash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: previewBoot ? BOOT_FADE_MS : Math.min(BOOT_FADE_MS, remaining), fill: 'forwards' }).finished.then(finish, finish)
}

if (typeof window !== 'undefined') window.setTimeout(() => {
  if (settled || previewBoot) return
  if (document.getElementById('boot-splash')?.dataset.runtime) dismissBootSplash('timeout')
  else showBootRecovery()
}, Math.max(0, documentStartedAt + MAX_BOOT_MS - BOOT_FADE_MS - Date.now()))
