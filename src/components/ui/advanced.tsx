/* ============================================================
 * 高级交互组件（第二批 · 8 项）
 * ------------------------------------------------------------
 * 共同点：模拟物理世界的材质感 / 阻尼感 / 连贯过渡，
 * 而不是「卸载旧的 + 挂载新的」硬切换。
 *
 *   ① TiltPanel      3D 倾斜光影面板
 *   ② FluidMorph     流体胶囊形变
 *   ③ SharedExpand   共享元素无缝展开
 *   ④ RollingNumber / SnapChart  磁吸游标与滚动码表
 *   ⑤ DampedSheet    阻尼弹性抽屉
 *   ⑥ GlowBorder     动态弥散光晕边框
 *   ⑦ SpringStagger  物理弹簧交错流
 *   ⑧ Pressable      按压微缩与回弹
 *
 * 全部尊重 prefers-reduced-motion。
 * ========================================================== */

import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type PanInfo,
} from 'motion/react'
import {
  useRef,
  useState,
  useId,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import styles from './advanced.module.css'
import { DialogLayer } from './DialogLayer'
import { useUiVariant } from '../../lib/ui-variant'
import { FoxPaw } from '../fox/FoxMarks'
import { useUiMotion as useReducedMotion } from '../../lib/motion-pref'
import { FLUID, SPRING, fadeUp, uiTransition, springList, springItem, pointerRipple } from '../../lib/animations'
export { springList, springItem } from '../../lib/animations'


/* ============ ⑧ 按压微缩与回弹 ============ */

/**
 * 按压时微缩回弹，单个水波从按下位置扩散；键盘操作保留原生按钮语义。
 * 直接替代页面里的 <button>，视觉与手感统一。
 */
export function Pressable({
  children,
  className,
  onClick,
  disabled,
  type = 'button',
  ariaLabel,
  style,
}: {
  children: ReactNode
  className?: string
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
  ariaLabel?: string
  style?: CSSProperties
}) {
  const reduce = useReducedMotion()
  const rippleId = useRef(0)
  const ui = useUiVariant()
  const cute = ui === 'cute'
  const minimal = ui === 'minimal'
  const [ripple, setRipple] = useState<{ id: number; x: number; y: number; diameter: number } | null>(null)
  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (disabled || reduce || minimal || event.button !== 0) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left))
    const y = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top))
    const diameter = 2 * Math.hypot(Math.max(x, bounds.width - x), Math.max(y, bounds.height - y))
    setRipple({ id: ++rippleId.current, x, y, diameter })
  }
  return (
    <motion.button
      type={type}
      className={`${styles.press} ${styles.rippleButton} ${className || ''}`}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerCancel={() => setRipple(null)}
      disabled={disabled}
      aria-label={ariaLabel}
      style={style}
      whileTap={reduce || disabled ? undefined : { scale: minimal ? .98 : .96 }}
      transition={reduce ? { duration: .16 } : cute ? { duration: .35, ease: [.34,1.56,.64,1] } : minimal ? uiTransition() : SPRING}
    >
      {children}
      {ripple && !reduce && !disabled ? <span className={styles.rippleLayer} aria-hidden="true">
        <motion.span
          key={ripple.id}
          className={cute ? styles.pawRipple : styles.ripple}
          style={cute ? { left: ripple.x - 16, top: ripple.y - 16, width: 32, height: 32 } : { left: ripple.x - ripple.diameter / 2, top: ripple.y - ripple.diameter / 2, width: ripple.diameter, height: ripple.diameter }}
          {...(cute ? { initial: { scale: .4, opacity: .2 }, animate: { scale: 3, opacity: 0 }, transition: { duration: .35 } } : pointerRipple())}
          onAnimationComplete={() => setRipple((current) => current?.id === ripple.id ? null : current)}
        >{cute ? <FoxPaw size={32} /> : null}</motion.span>
      </span> : null}
    </motion.button>
  )
}

/** 非按钮元素（卡片 / 链接）版按压 */
export function PressableDiv({
  children,
  className,
  onClick,
  style,
}: {
  children: ReactNode
  className?: string
  onClick?: () => void
  style?: CSSProperties
}) {
  const reduce = useReducedMotion()
  const ui = useUiVariant()
  return (
    <motion.div
      className={`${styles.press} ${className || ''}`}
      onClick={onClick}
      style={style}
      whileTap={reduce ? undefined : { scale: ui === 'minimal' ? .98 : .96 }}
      transition={reduce ? { duration: .16 } : ui === 'cute' ? { duration: .35, ease: [.34,1.56,.64,1] } : ui === 'minimal' ? uiTransition() : SPRING}
    >
      {children}
    </motion.div>
  )
}

/* ============ ① 3D 倾斜光影面板 ============ */

/**
 * 手指按压时面板随触点做 3D 俯仰微倾，径向镜面高光跟随流转；
 * 松手阻尼弹性复位。
 */
export function TiltPanel({
  children,
  className,
  max = 7,
  glare = true,
  style,
}: {
  children: ReactNode
  className?: string
  /** 最大倾斜角度（度） */
  max?: number
  glare?: boolean
  style?: CSSProperties
}) {
  const reduce = useReducedMotion()
  const minimal = useUiVariant() === 'minimal'
  const ref = useRef<HTMLDivElement>(null)
  const px = useMotionValue(0.5)
  const py = useMotionValue(0.5)
  const pressed = useMotionValue(0)

  const rx = useSpring(useTransform(py, [0, 1], [max, -max]), { duration: 0.32, bounce: 0 })
  const ry = useSpring(useTransform(px, [0, 1], [-max, max]), { duration: 0.32, bounce: 0 })
  const lift = useSpring(pressed, { duration: 0.32, bounce: 0 })

  const glareOpacity = useTransform(lift, [0, 1], [0, 0.55])

  function onMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (reduce || minimal) return
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    px.set((e.clientX - r.left) / r.width)
    py.set((e.clientY - r.top) / r.height)
  }

  if (reduce || minimal) {
    return (
      <div className={`${styles.tilt} ${className || ''}`} style={style} ref={ref}>
        {children}
      </div>
    )
  }

  return (
    <motion.div
      ref={ref}
      className={`${styles.tilt} ${className || ''}`}
      style={{ ...style, rotateX: rx, rotateY: ry, transformPerspective: 900 }}
      onPointerMove={onMove}
      onPointerDown={() => pressed.set(1)}
      onPointerUp={() => pressed.set(0)}
      onPointerLeave={() => {
        px.set(0.5)
        py.set(0.5)
        pressed.set(0)
      }}
      onPointerCancel={() => pressed.set(0)}
    >
      {children}
      {glare ? (
        <motion.span
          className={styles.tiltGlare}
          aria-hidden="true"
          style={{
            background: 'radial-gradient(circle at 50% 30%, rgba(255,255,255,.3), transparent 65%)',
            opacity: glareOpacity,
          }}
        />
      ) : null}
    </motion.div>
  )
}

/* ============ ② 流体胶囊形变 ============ */

/**
 * 触发态像水滴一样平滑延展成面板：圆角与尺寸走高阻尼流体曲线，
 * 无弹窗感。collapsed 态是胶囊按钮，expanded 态是面板。
 */
export function FluidMorph({
  open,
  onToggle,
  pill,
  children,
  className,
}: {
  open: boolean
  onToggle: (v: boolean) => void
  /** 胶囊态内容 */
  pill: ReactNode
  children: ReactNode
  className?: string
}) {
  const reduce = useReducedMotion()
  const t = reduce ? { duration: 0 } : FLUID
  return (
    <motion.div
      layout={!reduce}
      transition={t}
      className={`${styles.fluid} ${open ? styles.fluidOpen : styles.fluidPill} ${className || ''}`}
      style={{ borderRadius: open ? 22 : 999 }}
    >
      <button
        type="button"
        className={styles.fluidHead}
        aria-expanded={open}
        onClick={() => onToggle(!open)}
      >
        {pill}
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            className={styles.fluidBody}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scaleY: 0.92 }}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, scaleY: 0.92 }}
            transition={t}
          >
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  )
}

/* ============ ③ 共享元素无缝展开 ============ */

/**
 * 点击列表条目 → 条目原地平滑放大成详情；返回反向收缩回原位。
 * summary 与 detail 共用同一个 layoutId，中间无白屏。
 */
export function SharedExpand({
  id,
  open,
  onOpen,
  onClose,
  summary,
  detail,
  className,
}: {
  id: string | number
  open: boolean
  onOpen: () => void
  onClose: () => void
  summary: ReactNode
  detail: ReactNode
  className?: string
}) {
  const reduce = useReducedMotion()
  return <>
    <motion.div className={styles.sharedCard + ' ' + (className || '')} role="button" tabIndex={0}
      onClick={() => { if (!open) onOpen() }}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen() } }}
      whileTap={reduce ? undefined : { scale: 0.98 }} transition={uiTransition(reduce)} data-expand-id={id}>
      {summary}
    </motion.div>
    {open ? <DialogLayer title="详情" onClose={onClose} className={styles.sharedDetail}>
      <button type="button" className={styles.sharedClose} aria-label="收起" onClick={(event) => event.currentTarget.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))}>✕</button>
      <motion.div {...fadeUp(reduce)}>{detail}</motion.div>
    </DialogLayer> : null}
  </>
}

/* ============ ④ 磁吸游标 + 滚动码表 ============ */

/**
 * 滚动码表：数字变化时每一位像机械码表一样翻滚跳变。
 */
export function RollingNumber({
  value,
  className,
  duration = 0.24,
}: {
  value: number | string
  className?: string
  duration?: number
}) {
  const reduce = useReducedMotion()
  const chars = String(value).split('')
  return (
    <span className={`${styles.roll} ${className || ''}`} aria-label={String(value)}>
      {chars.map((c, i) => (
        <span key={`${i}-${c}`} className={styles.rollCol}>
          <motion.span
            className={styles.rollDigit}
            initial={reduce ? false : { y: '-60%', opacity: 0 }}
            animate={{ y: '0%', opacity: 1 }}
            transition={reduce ? { duration: 0 } : { ...uiTransition(), duration: Math.min(0.4, duration) }}
          >
            {c}
          </motion.span>
        </span>
      ))}
    </span>
  )
}

export type ChartPoint = {
  label: string
  value: number
  /** 附加说明，展示在游标浮层里 */
  hint?: string
  /** 是否高亮（如今天） */
  active?: boolean
}

/**
 * 磁吸游标折线图：滑动时指示线自动吸附最近的数据点，
 * 交点光晕呼吸放大；顶部数值走滚动码表，实时联动。
 */
export function SnapChart({
  points,
  height = 132,
  unit = '分钟',
  color = 'var(--green-deep)',
}: {
  points: ChartPoint[]
  height?: number
  unit?: string
  color?: string
}) {
  const reduce = useReducedMotion()
  const wrapRef = useRef<HTMLDivElement>(null)
  const chartId = useId()
  const [idx, setIdx] = useState<number | null>(null)
  const max = Math.max(1, ...points.map((p) => p.value))
  const n = points.length
  const W = 100 // 用百分比坐标系
  const H = 100

  const xOf = (i: number) => (n <= 1 ? W / 2 : (i / (n - 1)) * W)
  const yOf = (v: number) => H - (v / max) * (H - 14) - 7

  const line = points.map((p, i) => `${xOf(i)},${yOf(p.value)}`).join(' ')
  const area = `${line} ${xOf(n - 1)},${H} ${xOf(0)},${H}`

  /** 磁吸：把触点 x 吸附到最近的数据点 */
  function pick(clientX: number) {
    const el = wrapRef.current
    if (!el || !n) return
    const r = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < n; i++) {
      const d = Math.abs(xOf(i) / W - ratio)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    setIdx(best)
  }

  const cur = idx == null ? null : points[idx]
  const curX = idx == null ? 0 : xOf(idx)

  return (
    <div className={styles.chart}>
      <div className={styles.chartHead}>
        <span className={styles.chartValue}>
          <RollingNumber value={cur ? cur.value : points.reduce((s, p) => s + p.value, 0)} />
          <em>{unit}</em>
        </span>
        <span className={styles.chartLabel}>
          {cur ? `${cur.label}${cur.hint ? ` · ${cur.hint}` : ''}` : `近 ${n} 天合计`}
        </span>
      </div>

      <div
        className={styles.chartCanvas}
        ref={wrapRef}
        style={{ height }}
        onPointerDown={(e) => pick(e.clientX)}
        onPointerMove={(e) => {
          if (e.buttons || e.pointerType !== 'mouse') pick(e.clientX)
        }}
        onPointerLeave={() => setIdx(null)}
        role="group"
        tabIndex={0}
        aria-label={`近 ${n} 天趋势图，左右方向键查看每日数据`}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          setIdx((previous) => Math.max(0, Math.min(n - 1, (previous ?? 0) + (event.key === 'ArrowRight' ? 1 : -1))))
        }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={styles.chartSvg}>
          <defs>
            <linearGradient id={chartId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={area} fill={`url(#${chartId})`} />
          <polyline
            points={line}
            fill="none"
            stroke={color}
            strokeWidth="1.6"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {points.map((p, i) => (
            <circle
              key={i}
              cx={xOf(i)}
              cy={yOf(p.value)}
              r={p.active ? 2.4 : 1.6}
              fill={p.active ? color : 'var(--card)'}
              stroke={color}
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        {/* 磁吸指示线 */}
        {idx != null ? (
          <motion.div
            className={styles.chartSnap}
            style={{ left: `${curX}%` }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={uiTransition(reduce)}
            aria-hidden="true"
          >
            <motion.span
              className={styles.chartHalo}
              style={{ top: `${yOf(points[idx].value)}%`, borderColor: color }}
              animate={{ opacity: 1, scale: 1 }}
              transition={uiTransition(reduce)}
            />
          </motion.div>
        ) : null}

        {/* x 轴标签 */}
        <div className={styles.chartAxis}>
          {points.map((p, i) => (
            <span key={i} className={idx === i ? styles.axisOn : ''}>
              {p.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ============ ⑤ 阻尼弹性抽屉 ============ */

/**
 * 底部抽屉：拉到顶 / 拉到底有橡皮筋阻尼拉伸，松手按拖拽速度吸附到对应高度。
 */
export function DampedSheet({
  open,
  onClose,
  title,
  children,
  height = 460,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  height?: number
}) {
  const reduce = useReducedMotion()
  function onDragEnd(_: unknown, info: PanInfo) {
    if (info.velocity.y > 620 || info.offset.y > 100) {
      grip.current?.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))
    }
  }
  const grip = useRef<HTMLDivElement>(null)
  return open ? <DialogLayer title={title || '详情'} onClose={onClose} className={styles.sheet}>
    <motion.div ref={grip} className={styles.sheetGrip} aria-hidden="true" drag={reduce ? false : 'y'} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={0.2} onDragEnd={onDragEnd} transition={uiTransition(reduce)} />
    <div className={styles.sheetHead}>
      {title ? <h2 className={styles.sheetTitle}>{title}</h2> : <span />}
      <button type="button" className={styles.sharedClose} aria-label="关闭详情" onClick={(event) => event.currentTarget.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))}>✕</button>
    </div>
    <div className={styles.sheetBody} style={{ maxHeight: height }}>{children}</div>
  </DialogLayer> : null
}

/* ============ ⑥ 动态弥散光晕边框 ============ */

/**
 * 核心模块外圈：缓慢旋转的渐变流光微边框 + 背后柔和的毛玻璃弥散光晕。
 */
export function GlowBorder({
  children,
  className,
  active = true,
  hue = 'var(--green-deep)',
  style,
}: {
  children: ReactNode
  className?: string
  active?: boolean
  hue?: string
  style?: CSSProperties
}) {
  return (
    <div
      className={`${styles.glow} ${active ? styles.glowOn : ''} ${className || ''}`}
      style={{ ...style, ['--glow-hue' as string]: hue }}
    >
      <div className={styles.glowInner}>{children}</div>
    </div>
  )
}

/* ============ ⑦ 物理弹簧交错流 ============ */


/**
 * 列表 / 瀑布流加载：不再整体淡入，而是每项从下往上带物理弹性依次弹入。
 */
export function SpringStagger({
  children,
  className,
  /** 每次 key 变化都会重播一次入场 */
  replayKey,
}: {
  children: ReactNode
  className?: string
  replayKey?: string | number
}) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      key={replayKey}
      className={className}
      variants={reduce ? undefined : springList}
      initial={reduce ? false : 'hidden'}
      animate="show"
    >
      {children}
    </motion.div>
  )
}

export function SpringItem({
  children,
  className,
  onClick,
}: {
  children: ReactNode
  className?: string
  onClick?: () => void
}) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      variants={reduce ? undefined : springItem}
      className={className}
      onClick={onClick}
      whileTap={reduce ? undefined : { scale: 0.97 }}
      transition={reduce ? { duration: 0 } : SPRING}
    >
      {children}
    </motion.div>
  )
}
