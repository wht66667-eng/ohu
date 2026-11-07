import { AnimatePresence, motion, type Variants } from 'motion/react'
import { useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'

/**
 * 页面返回 / 前进转场。
 *
 * - 返回（POP）：当前页面向左淡出，上一页从右侧轻微回弹进入；
 * - 前进（PUSH）：方向相反；
 * - 280ms，easeOutBack 轻微回弹，阴影随位移变化；
 * - 扁平化，不做 3D、不做多余装饰，只保留位移 / 透明度 / 阴影。
 */
export function PageTransition({ children, direction }: { children: ReactNode; direction: 1 | -1 }) {
  const location = useLocation()

  const variants: Variants = {
    enter: (dir: 1 | -1) => ({
      opacity: 0,
      x: dir > 0 ? 34 : 0,
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
    exit: (dir: 1 | -1) => ({
      opacity: 0,
      x: dir > 0 ? 0 : -34,
      scale: 0.994,
      boxShadow: '0 18px 48px rgba(0,0,0,0.16)',
      transition: { duration: 0.05, ease: [0.4, 0, 0.2, 1] },
    }),
  }

  return <AnimatePresence mode="popLayout" initial={false} custom={direction}>
    <motion.div
      key={location.key}
      custom={direction}
      variants={variants}
      initial="enter"
      animate="center"
      exit="exit"
      style={{
        minHeight: '100%',
        borderRadius: 20,
        overflow: 'hidden',
        background: 'var(--bg, #f7f5ef)',
        willChange: 'transform, opacity, box-shadow',
      }}
    >
      {children}
    </motion.div>
  </AnimatePresence>
}
