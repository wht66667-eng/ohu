import { useRef, useState, type ButtonHTMLAttributes, type MouseEvent, type PointerEvent } from 'react'
import { motion, type HTMLMotionProps } from 'motion/react'
import { foxCampusAssetUrl, useUiVariant } from '../../lib/ui-variant'
import { useUiMotion } from '../../lib/motion-pref'
import { FoxPaw } from './FoxMarks'
import styles from './FoxButton.module.css'

export type FoxButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  variant?: 'primary' | 'secondary' | 'icon' | 'chip'
  fox?: boolean
  loading?: boolean
  loadingText?: string
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void | Promise<void>
}

/** The native button remains the touch target; feedback never delays its action. */
export function FoxButton({ variant = 'primary', fox = false, loading = false, loadingText, children, className = '', onClick, onPointerDown, onPointerUp, onPointerCancel, onPointerLeave, ...props }: FoxButtonProps) {
  const ui = useUiVariant()
  const reduce = useUiMotion()
  const cute = ui === 'cute' || ui === 'immersive'
  const minimal = ui === 'minimal'
  const [pressed, setPressed] = useState(false)
  const [pending, setPending] = useState(false)
  const pendingAction = useRef(false)
  const [ripple, setRipple] = useState<{ id: number; x: number; y: number } | null>(null)
  const rippleId = useRef(0)
  const selected = props['aria-pressed'] === true || props['aria-pressed'] === 'true'
  const busy = loading || pending
  const blocked = props.disabled || busy
  const showEars = cute && variant === 'icon'
  function click(event: MouseEvent<HTMLButtonElement>) {
    if (blocked || pendingAction.current) {
      event.preventDefault()
      return
    }
    // Lock synchronously so a second event cannot start the same pending request.
    pendingAction.current = true
    let action: void | Promise<void>
    try {
      action = onClick?.(event)
    } catch (error) {
      pendingAction.current = false
      throw error
    }
    if (!action || typeof action.then !== 'function') {
      pendingAction.current = false
      return
    }
    setPressed(false)
    setPending(true)
    // Rejection remains observable; business handlers own error messages and retries.
    return Promise.resolve(action).finally(() => {
      pendingAction.current = false
      setPending(false)
    })
  }
  function press(event: PointerEvent<HTMLButtonElement>) {
    onPointerDown?.(event)
    if (blocked || event.defaultPrevented || event.button !== 0) return
    setPressed(true)
    if (cute && !reduce) {
      const rect = event.currentTarget.getBoundingClientRect()
      setRipple({ id: ++rippleId.current, x: event.clientX - rect.left, y: event.clientY - rect.top })
    }
  }
  return <motion.button
    type="button"
    {...props as HTMLMotionProps<'button'>}
    className={`${styles.button} ${styles[variant]} ${className}`}
    disabled={blocked}
    aria-busy={busy ? true : props['aria-busy'] ?? false}
    onClick={click}
    onPointerDown={press}
    onPointerUp={(event) => { setPressed(false); onPointerUp?.(event) }}
    onPointerCancel={(event) => { setPressed(false); setRipple(null); onPointerCancel?.(event) }}
    onPointerLeave={(event) => { setPressed(false); onPointerLeave?.(event) }}
    whileTap={reduce || blocked ? undefined : { scale: minimal ? .98 : .96 }}
    transition={reduce ? { duration: .16 } : { duration: cute ? .35 : .2, ease: cute ? [.34, 1.56, .64, 1] : [.2, .9, .3, 1] }}
  >
    {showEars ? <motion.span className={`${styles.ears} ${selected || pressed ? styles.earsUp : ''}`} aria-hidden="true"
      animate={pressed && !reduce ? { rotate: [-8, 8, -4, 0] } : { rotate: 0 }} transition={{ duration: .35 }}><i /><i /></motion.span> : null}
    {busy ? <span className={styles.spinner} aria-hidden="true" /> : fox && !minimal && foxCampusAssetUrl('avatar.webp') ? <img src={foxCampusAssetUrl('avatar.webp')} width="24" height="24" alt="" /> : null}
    {busy && loadingText ? <span aria-live="polite">{loadingText}</span> : children}
    {cute && variant === 'primary' ? <span className={styles.pawPattern} aria-hidden="true"><FoxPaw size={33} /></span> : null}
    {ripple && cute && !reduce ? <span className={styles.rippleLayer} aria-hidden="true"><motion.span key={ripple.id} className={styles.pawRipple}
      style={{ left: ripple.x, top: ripple.y }} initial={{ scale: .4, opacity: .2 }} animate={{ scale: 3, opacity: 0 }} transition={{ duration: .35, ease: [.2, .9, .3, 1] }}
      onAnimationComplete={() => setRipple((current) => current?.id === ripple.id ? null : current)}><FoxPaw size={30} /></motion.span></span> : null}
  </motion.button>
}

export function Button(props: FoxButtonProps) { return <FoxButton {...props} /> }
export function IconButton(props: Omit<FoxButtonProps, 'variant'> & { 'aria-label': string }) { return <FoxButton {...props} variant="icon" /> }
export function Tag(props: Omit<FoxButtonProps, 'variant'>) { return <FoxButton {...props} variant="chip" /> }
