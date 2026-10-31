/* ============================================================
 * 通用动效组件集
 * ------------------------------------------------------------
 * 目标：把「卸载旧的 + 挂载新的」这种硬切换，换成共享布局过渡。
 * 项目已装 motion（motion/react），此前全项目 0 处 layoutId /
 * AnimatePresence，这里补齐底座，页面按需取用：
 *   - SubmitButton  提交原位 loading → 打勾 → 结果
 *   - MenuCloseIcon / PlayPauseIcon  图标路径变形
 *   - SegmentedTabs 标签指示条先拉伸再收回
 *   - ExpandingSearch 搜索图标 ↔ 输入框同位置展开
 *   - StepperButton  按钮 ↔ 数量步进器互相变形
 *   - Collapsible    列表内展开详情，其余顺势下移
 *   - RevealPanel    从按钮位置扩散铺满全屏，内容依次入场
 *   - useScrollCollapse 顶栏随滚动收起
 * ========================================================== */

import {
  AnimatePresence,
  motion,
} from 'motion/react'
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { IconSearch } from '../Icons'
import styles from './ui.module.css'
import { DialogLayer } from './DialogLayer'
import { useUiVariant } from '../../lib/ui-variant'
import { FoxLoader } from '../fox/FoxLoader'
import { SuccessMark } from './feedback'
import { useUiMotion as useReducedMotion } from '../../lib/motion-pref'
import { SPRING, fadeUp, uiTransition, revealList, revealItem, submitIconFeedback, submitLabelFeedback, submitBusyFeedback, submitPressStates } from '../../lib/animations'
export { revealList, revealItem } from '../../lib/animations'


/* ---------------- 1. 提交状态反馈 ---------------- */

export type SubmitState = 'idle' | 'busy' | 'done'

/**
 * 按钮原位显示真实提交状态；完成状态由业务成功结果传入，不自动模拟成功。
 * 用法：const [st, setSt] = useState<SubmitState>('idle')
 */
export function SubmitButton({
  state,
  label,
  busyText = '处理中…',
  doneText = '已完成',
  className,
  disabled,
  onClick,
  type = 'button',
}: {
  state: SubmitState
  label: string
  busyText?: string
  doneText?: string
  className?: string
  disabled?: boolean
  onClick?: () => void | Promise<void>
  type?: 'button' | 'submit'
}) {
  const reduce = useReducedMotion()
  const [pending, setPending] = useState(false)
  const pendingAction = useRef(false)
  const busy = state === 'busy' || pending
  const displayState = busy ? 'busy' : state
  const text = busy ? busyText : state === 'done' ? doneText : label
  const blocked = disabled || busy
  const ui = useUiVariant()
  const cute = ui === 'cute' || ui === 'immersive'
  const minimal = ui === 'minimal'
  function submit() {
    if (blocked || pendingAction.current) return
    pendingAction.current = true
    let action: void | Promise<void>
    try { action = onClick?.() } catch (error) { pendingAction.current = false; throw error }
    if (!action || typeof action.then !== 'function') { pendingAction.current = false; return }
    setPending(true)
    return Promise.resolve(action).finally(() => { pendingAction.current = false; setPending(false) })
  }
  return (
    <motion.button
      type={type}
      className={`${styles.submitButton} ${className || ''}`}
      disabled={blocked}
      aria-busy={busy}
      onClick={submit}
      layout={!reduce}
      transition={reduce ? { duration: 0 } : SPRING}
      initial="rest"
      animate="rest"
      whileTap={reduce || blocked ? undefined : 'pressed'}
    >
      <motion.span className={styles.submitInner} variants={reduce ? undefined : cute ? { rest: { scale: 1, transition: { duration: .35, ease: [.34,1.56,.64,1] } }, pressed: { scale: .96 } } : minimal ? { rest: { scale: 1, transition: uiTransition() }, pressed: { scale: .98 } } : submitPressStates}>
        <AnimatePresence mode="popLayout" initial={false}>
          {displayState === 'busy' ? (
            <motion.span
              key="spin"
              className={styles.submitIcon}
              aria-hidden="true"
              {...submitIconFeedback(reduce)}
            >
              {cute ? <FoxLoader size={24} label={busyText} compact /> : <motion.span className={styles.spinner} {...submitBusyFeedback(reduce)} />}
            </motion.span>
          ) : null}
          {displayState === 'done' ? (
            <motion.span
              key="ok"
              className={styles.submitIcon}
              aria-hidden="true"
              {...submitIconFeedback(reduce)}
            >
              <SuccessMark />
            </motion.span>
          ) : null}
        </AnimatePresence>
        <span aria-live="polite" aria-atomic="true">
          <motion.span key={text} {...submitLabelFeedback(reduce)}>{text}</motion.span>
        </span>
      </motion.span>
    </motion.button>
  )
}

/* ---------------- 2. 图标变形 ---------------- */

const SVG_BOX: CSSProperties = { transformBox: 'fill-box', transformOrigin: 'center' }

/** 汉堡 ↔ 关闭：三条线各自绕自身中心旋转 + 平移，中点线淡出，过程连贯 */
export function MenuCloseIcon({ open, size = 20 }: { open: boolean; size?: number }) {
  const reduce = useReducedMotion()
  const t = reduce ? { duration: 0 } : SPRING
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <motion.line
        x1="4"
        y1="7"
        x2="20"
        y2="7"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        style={SVG_BOX}
        animate={open ? { y: 5, rotate: 45 } : { y: 0, rotate: 0 }}
        transition={t}
      />
      <motion.line
        x1="4"
        y1="12"
        x2="20"
        y2="12"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        style={SVG_BOX}
        animate={{ opacity: open ? 0 : 1, scaleX: open ? 0.3 : 1 }}
        transition={t}
      />
      <motion.line
        x1="4"
        y1="17"
        x2="20"
        y2="17"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        style={SVG_BOX}
        animate={open ? { y: -5, rotate: -45 } : { y: 0, rotate: 0 }}
        transition={t}
      />
    </svg>
  )
}

/** 播放 ↔ 暂停：三角与双竖条交叉旋转淡入淡出 */
export function PlayPauseIcon({ playing, size = 20 }: { playing: boolean; size?: number }) {
  const reduce = useReducedMotion()
  const t = uiTransition(reduce)
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <motion.g
        style={SVG_BOX}
        animate={{ opacity: playing ? 0 : 1, scale: playing ? 0.55 : 1, rotate: playing ? -90 : 0 }}
        transition={t}
      >
        <path d="M8 5.2 19 12 8 18.8Z" />
      </motion.g>
      <motion.g
        style={SVG_BOX}
        animate={{ opacity: playing ? 1 : 0, scale: playing ? 1 : 0.55, rotate: playing ? 0 : 90 }}
        transition={t}
      >
        <rect x="7" y="5.5" width="3.6" height="13" rx="1.4" />
        <rect x="13.4" y="5.5" width="3.6" height="13" rx="1.4" />
      </motion.g>
    </svg>
  )
}

/* ---------------- 3. 标签指示条 ---------------- */

export function SegmentedTabs({
  tabs,
  value,
  onChange,
  id = 'seg',
  label = '切换分类',
}: {
  tabs: readonly string[]
  value: string
  onChange: (t: string) => void
  id?: string
  label?: string
}) {
  const reduce = useReducedMotion()
  const uniqueId = useId()
  return (
    <div className={styles.tabs} role="tablist" aria-label={label}>
      {tabs.map((t) => {
        const on = t === value
        return (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on || (!tabs.includes(value) && t === tabs[0]) ? 0 : -1}
            onKeyDown={(event) => {
              const index = tabs.indexOf(t)
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length : -1
              if (next < 0) return
              event.preventDefault()
              onChange(tabs[next])
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
            }}
            className={`${styles.tab} ${on ? styles.tabOn : ''}`}
            onClick={() => onChange(t)}
          >
            {on ? (
              <motion.span
                className={styles.ind}
                layoutId={`${id}-${uniqueId}-ind`}
                transition={reduce ? { duration: 0 } : SPRING}
              />
            ) : null}
            <span className={styles.tabText}>{t}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ---------------- 4. 搜索框展开 ---------------- */

/**
 * 常驻形态是输入框；随页面滚动可收窄成放大镜图标（collapsed），
 * 点图标再原地展开并自动聚焦，无需跳页。
 */
export function ExpandingSearch({
  value,
  onChange,
  onSubmit,
  placeholder = '搜索',
  collapsed = false,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit?: (v: string) => void
  placeholder?: string
  collapsed?: boolean
}) {
  const reduce = useReducedMotion()
  const [typing, setTyping] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchButtonRef = useRef<HTMLButtonElement>(null)
  const open = !collapsed || typing || value.length > 0

  useEffect(() => {
    if (typing) inputRef.current?.focus()
  }, [typing])

  return (
    <motion.div
      layout={!reduce}
      transition={reduce ? { duration: 0 } : SPRING}
      className={`${styles.searchBox} ${open ? styles.searchOpen : styles.searchCollapsed}`}
    >
      <button
        ref={searchButtonRef}
        type="button"
        className={styles.searchIcon}
        aria-label="搜索"
        onClick={() => {
          setTyping(true)
          requestAnimationFrame(() => inputRef.current?.focus())
        }}
      >
        <IconSearch />
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            className={styles.searchField}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={uiTransition(reduce)}
          >
            <input
              ref={inputRef}
              value={value}
              placeholder={placeholder}
              aria-label={placeholder}
              type="search"
              enterKeyHint="search"
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                  e.preventDefault()
                  onSubmit?.(value)
                }
              }}
            />
            {typing ? (
              <button
                type="button"
                className={styles.searchClear}
                onClick={() => {
                  setTyping(false)
                  onChange('')
                  requestAnimationFrame(() => searchButtonRef.current?.focus())
                }}
              >
                收起
              </button>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  )
}

/* ---------------- 5. 按钮 ↔ 步进器 ---------------- */

export function StepperButton({
  id,
  qty,
  onStep,
  max = 99,
  label = '加入',
  className,
}: {
  id: string | number
  qty: number
  onStep: (delta: number) => void
  max?: number
  label?: string
  className?: string
}) {
  const reduce = useReducedMotion()
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {qty <= 0 ? (
        <motion.button
          key="add"
          layoutId={`stepper-${id}`}
          type="button"
          className={`${styles.stepAdd} ${className || ''}`}
          disabled={max <= 0}
          transition={reduce ? { duration: 0 } : SPRING}
          whileTap={reduce ? undefined : { scale: 0.94 }}
          onClick={() => { if (qty < max) onStep(1) }}
        >
          {label}
        </motion.button>
      ) : (
        <motion.div key="stepper" layoutId={`stepper-${id}`} className={styles.stepper} transition={reduce ? { duration: 0 } : SPRING}>
          <button type="button" className={styles.stepBtn} aria-label="减少" onClick={() => onStep(-1)}>
            −
          </button>
          <span className={styles.stepNum}>{qty}</span>
          <button
            type="button"
            className={styles.stepBtn}
            aria-label="增加"
            disabled={qty >= max}
            onClick={() => { if (qty < max) onStep(1) }}
          >
            +
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ---------------- 6. 列表内展开详情 ---------------- */

export function Collapsible({
  open,
  children,
  className,
}: {
  open: boolean
  children: ReactNode
  className?: string
}) {
  const reduce = useReducedMotion()
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          className={className}
          style={{ overflow: 'hidden' }}
          {...fadeUp(reduce)}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/* ---------------- 7. 菜单铺满全屏 ---------------- */


export function RevealPanel({
  open,
  title,
  onClose,
  origin = 'top right',
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  origin?: string
  children: ReactNode
}) {
  const reduce = useReducedMotion()
  return open ? (
    <DialogLayer title={title} onClose={onClose} full className={styles.reveal}>
      <div className={styles.revealHead} style={{ transformOrigin: origin }}>
        <h2>{title}</h2>
        <button type="button" className={styles.revealClose} aria-label="关闭菜单" onClick={(event) => event.currentTarget.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))}>
          <MenuCloseIcon open size={20} />
        </button>
      </div>
      <motion.div className={styles.revealGrid} variants={reduce ? undefined : revealList} initial={reduce ? false : 'hidden'} animate="show">
        {children}
      </motion.div>
    </DialogLayer>
  ) : null
}

export function RevealGroup({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <motion.div variants={revealItem} className={styles.revealGroup}>
      <div className={styles.revealGroupTitle}>{title}</div>
      {children}
    </motion.div>
  )
}

export function RevealRow({
  to,
  icon,
  label,
  hint,
  onGo,
  onPress,
  trailing,
}: {
  to?: string
  icon: ReactNode
  label: string
  hint?: string
  onGo?: () => void
  /** 就地操作（不跳转），如开关切换；提供时不渲染箭头而渲染 trailing */
  onPress?: () => void
  /** 右侧自定义内容（开关状态文本等），默认 › */
  trailing?: ReactNode
}) {
  const nav = useNavigate()
  if (!to && !onPress) return (
    <motion.div variants={revealItem} className={styles.revealRow}>
      <span className={styles.revealRowIc} aria-hidden="true">{icon}</span>
      <span className={styles.revealRowGrow}><b>{label}</b>{hint ? <span>{hint}</span> : null}</span>
      {trailing ? <span className={styles.revealRowArrow}>{trailing}</span> : null}
    </motion.div>
  )
  return (
    <motion.button
      type="button"
      variants={revealItem}
      className={styles.revealRow}
      onClick={() => {
        if (onPress) {
          onPress()
          return
        }
        onGo?.()
        if (to) nav(to)
      }}
    >
      <span className={styles.revealRowIc} aria-hidden="true">{icon}</span>
      <span className={styles.revealRowGrow}>
        <b>{label}</b>
        {hint ? <span>{hint}</span> : null}
      </span>
      <span className={styles.revealRowArrow}>{trailing ?? '›'}</span>
    </motion.button>
  )
}

/** 分段选择器：设置面板里的「浅色/深色/跟随系统」等三选一 */
export function RevealSeg<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<readonly [T, string]>
  value: T
  onChange: (v: T) => void
}) {
  return (
    <motion.div variants={revealItem} className={styles.revealSeg}>
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={v === value}
          className={v === value ? styles.revealSegOn : styles.revealSegBtn}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </motion.div>
  )
}

/* ---------------- 8. 顶栏随滚动收起 ---------------- */

export function useScrollCollapse(threshold = 48): boolean {
  const [collapsed, setCollapsed] = useState(false)
  const { pathname } = useLocation()
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('[data-app-page]')
    if (!el) return
    let last = el.scrollTop
    let frame = 0
    setCollapsed(false)
    const on = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const y = el.scrollTop
        const dy = y - last
        if (y <= threshold) setCollapsed(false)
        else if (Math.abs(dy) > 6) setCollapsed(dy > 0)
        last = Math.max(0, y)
      })
    }
    el.addEventListener('scroll', on, { passive: true })
    return () => { cancelAnimationFrame(frame); el.removeEventListener('scroll', on) }
  }, [threshold, pathname])
  return collapsed
}

/* ---------------- 9. 列表 ↔ 网格切换 ---------------- */

export function ViewToggle({
  value,
  onChange,
  id = 'view',
}: {
  value: 'list' | 'grid'
  onChange: (v: 'list' | 'grid') => void
  id?: string
}) {
  const reduce = useReducedMotion()
  const uniqueId = useId()
  const items: Array<{ key: 'list' | 'grid'; icon: ReactNode; label: string }> = [
    {
      key: 'list',
      label: '列表视图',
      icon: (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <rect x="1" y="2.5" width="12" height="2" rx="1" fill="currentColor" />
          <rect x="1" y="6" width="12" height="2" rx="1" fill="currentColor" />
          <rect x="1" y="9.5" width="12" height="2" rx="1" fill="currentColor" />
        </svg>
      ),
    },
    {
      key: 'grid',
      label: '网格视图',
      icon: (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <rect x="1" y="1" width="5" height="5" rx="1.4" fill="currentColor" />
          <rect x="8" y="1" width="5" height="5" rx="1.4" fill="currentColor" />
          <rect x="1" y="8" width="5" height="5" rx="1.4" fill="currentColor" />
          <rect x="8" y="8" width="5" height="5" rx="1.4" fill="currentColor" />
        </svg>
      ),
    },
  ]
  return (
    <div className={styles.viewToggle} role="group" aria-label="切换视图">
      {items.map((it) => {
        const on = it.key === value
        return (
          <button
            key={it.key}
            type="button"
            aria-label={it.label}
            aria-pressed={on}
            className={`${styles.viewBtn} ${on ? styles.viewOn : ''}`}
            onClick={() => onChange(it.key)}
          >
            {on ? (
              <motion.span
                className={styles.viewInd}
                layoutId={`${id}-${uniqueId}-vind`}
                transition={reduce ? { duration: 0 } : SPRING}
              />
            ) : null}
            <span className={styles.viewIcon}>{it.icon}</span>
          </button>
        )
      })}
    </div>
  )
}
