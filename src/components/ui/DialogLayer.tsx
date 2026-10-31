import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { slideSheet, fadeOnly } from '../../lib/animations'
import { useUiMotion } from '../../lib/motion-pref'
import styles from './dialog.module.css'

/** A modal stays in the browser's top layer until its exit transition finishes. */
export function DialogLayer({ title, onClose, children, className = '', full = false, allowClose = true }: {
  title: string
  onClose: () => void
  children: ReactNode
  className?: string
  full?: boolean
  allowClose?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [closing, setClosing] = useState(false)
  const reduce = useUiMotion()
  const requestClose = useCallback(() => { if (allowClose) setClosing(true) }, [allowClose])

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const host = document.querySelector<HTMLElement>('[data-app-body]')
    const resize = () => {
      const bounds = host?.getBoundingClientRect()
      if (bounds) Object.assign(element.style, { left: `${bounds.left}px`, top: `${bounds.top}px`, width: `${bounds.width}px`, height: `${bounds.height}px` })
    }
    resize()
    element.showModal()
    const observer = host ? new ResizeObserver(resize) : null
    if (host) observer?.observe(host)
    window.addEventListener('resize', resize)
    const frame = requestAnimationFrame(() => {
      element.querySelector<HTMLElement>('[autofocus], button:not([disabled]), input:not([disabled]), [tabindex="0"]')?.focus()
    })
    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', resize)
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
