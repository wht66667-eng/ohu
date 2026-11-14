import { motion, type Variants } from 'motion/react'
import { useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useUiMotion } from '../lib/motion-pref'

const variants: Variants = {
  enter: (direction: 1 | -1) => ({
    opacity: 0,
    x: direction > 0 ? 34 : 0,
    scale: 0.992,
    boxShadow: '0 18px 48px rgba(0,0,0,0.18)',
  }),
  center: {
    opacity: 1,
    x: 0,
    scale: 1,
    boxShadow: '0 0 0 rgba(0,0,0,0)',
    transition: { duration: 0.05, ease: [0.22, 1, 0.36, 1] },
  },
}

export function PageTransition({ children, direction }: { children: ReactNode; direction: 1 | -1 }) {
  const { pathname, key } = useLocation()
  const reduceMotion = useUiMotion()

  return (
    <motion.div
      key={pathname === '/services' ? pathname : key}
      custom={direction}
      variants={variants}
      initial={reduceMotion ? false : 'enter'}
      animate={reduceMotion ? undefined : 'center'}
      style={{
        minHeight: '100%',
        borderRadius: 20,
        overflow: 'hidden',
        background: 'var(--bg, #f7f5ef)',
      }}
    >
      {children}
    </motion.div>
  )
}
