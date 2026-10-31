import { motion, useMotionValue, useSpring } from 'motion/react'
import { useUiMotion } from '../../lib/motion-pref'
import { isFoxFreeVariant, useUiVariant } from '../../lib/ui-variant'
import styles from './StudyFoxCompanion.module.css'

/** Lightweight illustrated layers; the timer remains the primary content. */
export function StudyFoxCompanion({ active = false, complete = false, warning = false, size = 112 }: {
  active?: boolean
  complete?: boolean
  warning?: boolean
  size?: number
}) {
  const reduce = useUiMotion()
  const ui = useUiVariant()
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const rotateX = useSpring(x, { stiffness: 140, damping: 22 })
  const rotateY = useSpring(y, { stiffness: 140, damping: 22 })
  if (isFoxFreeVariant(ui)) return null
  return <div className={styles.scene} style={{ width: size, height: size }} aria-hidden="true"
    onPointerMove={(event) => {
      if (reduce) return
      const rect = event.currentTarget.getBoundingClientRect()
      x.set((.5 - (event.clientY - rect.top) / rect.height) * 8)
      y.set(((event.clientX - rect.left) / rect.width - .5) * 10)
    }} onPointerLeave={() => { x.set(0); y.set(0) }}>
    <motion.div className={styles.layers} style={reduce ? { rotateX: 0, rotateY: 0 } : { rotateX, rotateY }}>
      <span className={styles.halo} />
      <svg className={styles.tail} viewBox="0 0 120 120">
        <motion.g style={{ transformOrigin: '76px 96px' }} animate={reduce ? { rotate: 0 } : complete ? { rotate: [-4, -24, -14] } : active ? { rotate: [-7, 6, -7] } : { rotate: -3 }} transition={complete ? { duration: .35 } : { duration: 3.6, repeat: active ? Infinity : 0, ease: 'easeInOut' }}>
          <path d="M74 98C86 106 108 91 109 67C97 74 82 69 73 84Z" fill="var(--fox-orange, #ff9a3d)" />
          <path d="M100 72L109 67C109 78 106 88 99 94L91 83Z" fill="var(--fox-belly, #fff0dc)" />
        </motion.g>
      </svg>
      <motion.svg className={styles.character} viewBox="0 0 120 120" animate={reduce || !active ? { scaleY: 1, y: 0 } : { scaleY: [1, 1.025, 1], y: [0, -1.5, 0] }} transition={{ duration: 3.6, repeat: active ? Infinity : 0, ease: 'easeInOut' }}>
        <path d="M32 100Q34 73 60 75Q86 74 89 100Q64 110 32 100Z" fill="var(--green)" />
        <path d="M47 89Q53 88 59 93Q65 87 73 89L72 102Q65 100 59 104Q54 100 48 101Z" fill="var(--fox-belly, #fff0dc)" />
        <motion.g style={{ transformOrigin: '35px 45px' }} animate={{ rotate: warning ? -18 : 0 }}>
          <path d="M23 48L22 15Q23 10 28 13L49 34Z" fill="var(--fox-orange, #ff9a3d)" />
          <path d="M26 36L27 21L39 35Z" fill="var(--fox-belly, #fff0dc)" />
          <path d="M22 23L22 15Q23 10 28 13L34 20Z" fill="var(--study-fox-ink)" />
        </motion.g>
        <motion.g style={{ transformOrigin: '84px 45px' }} animate={{ rotate: warning ? 18 : 0 }}>
          <path d="M72 34L93 13Q98 10 99 16L97 48Z" fill="var(--fox-orange, #ff9a3d)" />
          <path d="M81 35L94 21L94 36Z" fill="var(--fox-belly, #fff0dc)" />
          <path d="M87 20L93 13Q98 10 99 16L98 24Z" fill="var(--study-fox-ink)" />
        </motion.g>
        <path d="M22 52Q25 31 59 30Q91 30 98 53L105 68Q90 89 60 90Q31 89 15 69Z" fill="var(--fox-orange, #ff9a3d)" />
        <path d="M17 68Q36 58 47 67Q59 78 73 67Q86 57 103 68Q90 88 60 89Q31 88 17 68Z" fill="var(--fox-belly, #fff0dc)" />
        <ellipse cx="32" cy="68" rx="7" ry="3.5" fill="var(--fox-blush, #ffb3a0)" opacity={warning ? .35 : .7} />
        <ellipse cx="87" cy="68" rx="7" ry="3.5" fill="var(--fox-blush, #ffb3a0)" opacity={warning ? .35 : .7} />
        <motion.g style={{ transformOrigin: '42px 58px' }} animate={reduce || !active ? { scaleY: 1 } : { scaleY: [1, 1, .06, 1, 1] }} transition={{ duration: 4.8, times: [0, .84, .88, .92, 1], repeat: active ? Infinity : 0 }}>
          <ellipse cx="42" cy="58" rx="4.5" ry="6" fill="var(--study-fox-ink)" /><circle cx="43" cy="56" r="1.4" fill="#fff" />
        </motion.g>
        {complete ? <path d="M73 59Q78 53 83 59" fill="none" stroke="var(--study-fox-ink)" strokeWidth="3.4" strokeLinecap="round" /> : <motion.g style={{ transformOrigin: '78px 58px' }} animate={reduce || !active ? { scaleY: 1 } : { scaleY: [1, 1, .06, 1, 1] }} transition={{ duration: 4.8, times: [0, .84, .88, .92, 1], repeat: active ? Infinity : 0 }}><ellipse cx="78" cy="58" rx="4.5" ry="6" fill="var(--study-fox-ink)" /><circle cx="79" cy="56" r="1.4" fill="#fff" /></motion.g>}
        <path d="M55 69Q60 65 65 69L60 74Z" fill="var(--study-fox-ink)" />
        <path d="M54 78Q60 84 67 77" fill="none" stroke="var(--study-fox-ink)" strokeWidth="2" strokeLinecap="round" />
      </motion.svg>
      <span className={styles.ground} />
    </motion.div>
  </div>
}
