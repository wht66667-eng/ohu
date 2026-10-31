import {
  useRef,
  useEffect,
  type PointerEvent as RPointerEvent,
  type ReactNode,
  type HTMLAttributes,
} from 'react'
import styles from './TiltCard.module.css'
import { useUiVariant } from '../lib/ui-variant'
import { useUiMotion } from '../lib/motion-pref'

type TiltProps = {
  children: ReactNode
  className?: string
  max?: number
  /** 是否显示跟随触点的镜面高光（默认开） */
  glare?: boolean
  as?: 'div' | 'section' | 'article'
} & Omit<HTMLAttributes<HTMLElement>, 'children' | 'className'>

/** 轻量 3D 倾斜卡片：按压 / 悬停时随触点俯仰微倾，镜面高光随之流转，松手阻尼回弹。
 *  适合天气条、课表卡、热门服务等区块，不抢交互焦点。 */
export function TiltCard({
  children,
  className = '',
  max = 7,
  glare = true,
  as: Tag = 'div',
  ...rest
}: TiltProps) {
  const ref = useRef<HTMLElement | null>(null)
  const glareRef = useRef<HTMLSpanElement | null>(null)
  const variant = useUiVariant()
  const reduce = useUiMotion()
  const enabled = !reduce && variant !== 'minimal' && variant !== 'pure'
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.transform = ''
    el.classList.remove(styles.follow, styles.pressed)
    if (glareRef.current) glareRef.current.style.opacity = '0'
  }, [variant, reduce])

  const onMove = (e: RPointerEvent) => {
    const el = ref.current
    if (!el || !enabled) return
    const r = el.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width
    const py = (e.clientY - r.top) / r.height
    const limit = variant === 'cute' ? Math.min(max, 3) : max
    const rx = (0.5 - py) * limit
    const ry = (px - 0.5) * limit
    el.classList.add(styles.follow)
    el.style.transform = `perspective(720px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(${variant === 'cute' ? -2 : 0}px)`
    const g = glareRef.current
    if (g) {
      g.style.setProperty('--gx', `${px * 100}%`)
      g.style.setProperty('--gy', `${py * 100}%`)
      g.style.opacity = '1'
    }
  }

  const onLeave = () => {
    const el = ref.current
    if (!el) return
    el.classList.remove(styles.follow, styles.pressed)
    el.style.transform = enabled ? 'perspective(720px) rotateX(0deg) rotateY(0deg) translateZ(0)' : ''
    const g = glareRef.current
    if (g) g.style.opacity = '0'
  }

  return (
    <Tag
      ref={ref as never}
      className={`${enabled ? styles.tilt : styles.flat} ${className}`}
      {...rest}
      onPointerMove={(e) => {
        rest.onPointerMove?.(e)
        onMove(e)
      }}
      onPointerLeave={(e) => {
        rest.onPointerLeave?.(e)
        onLeave()
      }}
      onPointerCancel={(e) => {
        rest.onPointerCancel?.(e)
        onLeave()
      }}
      onPointerDown={(e) => {
        rest.onPointerDown?.(e)
        const el = ref.current
        if (el && enabled) el.classList.add(styles.pressed)
      }}
      onPointerUp={(e) => {
        rest.onPointerUp?.(e)
        const el = ref.current
        if (el) el.classList.remove(styles.pressed)
      }}
    >
      {children}
      {glare && enabled ? <span ref={glareRef} className={styles.glare} aria-hidden="true" /> : null}
    </Tag>
  )
}
