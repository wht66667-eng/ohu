import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { slideSheet, fadeOnly } from '../../lib/animations'
import { useUiMotion } from '../../lib/motion-pref'
import styles from './dialog.module.css'

/** A modal stays in the browser's top layer until its exit transition finishes. */
export function DialogLayer({ title, onClose, children, className = '', full = false, allowClose = true, beforeClose }: {
  title: string
  onClose: () => void
  children: ReactNode
  className?: string
  full?: boolean
  allowClose?: boolean
  /** 有未保存草稿时可拦截退出，先由调用方呈现确认界面。 */
  beforeClose?: () => boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [closing, setClosing] = useState(false)
  const reduce = useUiMotion()
  const requestClose = useCallback(() => {
    if (!allowClose || dialog.current?.dispatchEvent(new Event('app-dismiss-composer-keyboard', { cancelable: true })) === false) return
    if (!beforeClose || beforeClose()) setClosing(true)
  }, [allowClose, beforeClose])

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const host = document.querySelector<HTMLElement>('[data-app-body]')
    const resize = () => {
      const bounds = host?.getBoundingClientRect()
      // 管理端未登录时没有 app-body；此时弹窗仍须占据整个可见窗口。
      if (bounds) {
        const shellBounds = host?.closest('[data-app-viewport]')?.getBoundingClientRect()
        const top = shellBounds
          ? 'calc(var(--app-viewport-top, 0px) + ' + (bounds.top - shellBounds.top) + 'px)'
          : bounds.top + 'px'
        Object.assign(element.style, { left: bounds.left + 'px', top, width: bounds.width + 'px', height: bounds.height + 'px' })
      } else {
        const root = getComputedStyle(document.documentElement)
        const viewport = window.visualViewport
        const visual = viewport && Math.abs(viewport.scale - 1) < .05 ? viewport : null
        Object.assign(element.style, {
          left: '0px',
          top: root.getPropertyValue('--app-viewport-top').trim() || (visual?.offsetTop ?? 0) + 'px',
          width: window.innerWidth + 'px',
          height: root.getPropertyValue('--app-viewport-height').trim() || (visual?.height ?? window.innerHeight) + 'px',
        })
      }
    }
    resize()
    element.showModal()
    const observer = host ? new ResizeObserver(resize) : null
    if (host) observer?.observe(host)
    const viewport = window.visualViewport
    let boundsFrame = 0
    const queueResize = () => {
      cancelAnimationFrame(boundsFrame)
      boundsFrame = requestAnimationFrame(resize)
    }
    window.addEventListener('resize', queueResize)
    window.addEventListener('app-native-insets', queueResize)
    viewport?.addEventListener('resize', queueResize)
    viewport?.addEventListener('scroll', queueResize)
    const frame = requestAnimationFrame(() => {
      element.querySelector<HTMLElement>('[autofocus], button:not([disabled]), input:not([disabled]), [tabindex="0"]')?.focus()
    })
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      cancelAnimationFrame(boundsFrame)
      window.removeEventListener('resize', queueResize)
      window.removeEventListener('app-native-insets', queueResize)
      viewport?.removeEventListener('resize', queueResize)
      viewport?.removeEventListener('scroll', queueResize)
      element.close()
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    const onBack = (event: Event) => {
      const dialogs = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')]
      if (dialogs.at(-1) !== dialog.current || event.defaultPrevented) return
      event.preventDefault()
      requestClose()
    }
    window.addEventListener('app-overlay-back', onBack)
    return () => window.removeEventListener('app-overlay-back', onBack)
  }, [requestClose])

  return <dialog ref={dialog} className={styles.dialog} aria-label={title} aria-modal="true" onCancel={(event) => { event.preventDefault(); requestClose() }} onClick={(event) => { if (event.target === event.currentTarget) requestClose() }}>
    <AnimatePresence initial onExitComplete={() => { if (closing) closeRef.current() }}>
      {!closing ? <motion.div key="layer" className={styles.layer} {...fadeOnly(reduce)}>
        <div className={styles.mask} onClick={requestClose} aria-hidden="true" />
        <motion.section className={`${styles.surface} ${full ? styles.full : ''} ${className}`} {...slideSheet(reduce)}>
          {children}
        </motion.section>
      </motion.div> : null}
    </AnimatePresence>
  </dialog>
}
