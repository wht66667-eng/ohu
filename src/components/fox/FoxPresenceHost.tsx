/**
 * 第一层 · 常驻在场位
 *
 * 挂在 PhoneShell 里，一次挂载全站生效：TabBar 上方右侧的小狐狸浮岛。
 * 轻点 → 跳转小海阿狐（AI 助手）；按住可拖到顺手的位置；右上角 × 可收起。
 *
 * 隐藏规则：沉浸式番茄钟 / 登录页时隐身，专注优先。
 */
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { IconStateKey } from '../../lib/app-icon'
import { isFocusImmersive } from '../../services/focus'
import { FOX_LABELS } from '../../lib/fox-labels'
import { isFoxDockOn, onFoxDockToggle, setFoxDockOn } from '../../lib/fox-dock-pref'
import { FoxAvatar } from './FoxAvatar'
import { useFoxState } from './useFoxState'
import styles from './FoxPresenceHost.module.css'
import { isFoxFreeVariant, useUiVariant } from '../../lib/ui-variant'

const HIDE_ROUTES = ['/welcome', '/login', '/signup', '/auth', '/first-run']
const POS_KEY = 'fox.dock.pos'

/** 拖动锚点：按下时浮岛落点 + 最后位置（松手时持久化） */
type DragInfo = {
  sx: number
  sy: number
  ix: number
  iy: number
  lastX: number
  lastY: number
  moved: boolean
}

function loadSavedPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as { x?: unknown; y?: unknown }
    if (typeof p.x === 'number' && typeof p.y === 'number') return { x: p.x, y: p.y }
  } catch {
    /* ignore */
  }
  return null
}

export function FoxPresenceHost() {
  const loc = useLocation()
  const nav = useNavigate()
  const eng = useFoxState()
  const variant = useUiVariant()
  const [immersive, setImmersive] = useState(() => isFocusImmersive())
  const [dim, setDim] = useState(false)

  /* 可拖动 + 可收起：位置与关闭状态记在本地（与设置页开关共享） */
  const [closed, setClosed] = useState(() => !isFoxDockOn())
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => loadSavedPos())
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<DragInfo | null>(null)

  /* 沉浸式番茄钟：专注优先，狐狸隐身 */
  useEffect(() => {
    const onChange = (e: Event) => setImmersive(!!(e as CustomEvent<boolean>).detail)
    setImmersive(isFocusImmersive())
    window.addEventListener('pet-focus-immersive', onChange)
    return () => window.removeEventListener('pet-focus-immersive', onChange)
  }, [loc.pathname])

  /* 页面滚动到底部时降透明，不压内容 */
  useEffect(() => {
    const el = document.querySelector('[data-app-page]')
    if (!el) return
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const rest = el.scrollHeight - el.scrollTop - el.clientHeight
        setDim(rest < 24)
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [loc.pathname])

  /* 设置页开关切换时实时响应 */
  useEffect(() => onFoxDockToggle((on) => setClosed(!on)), [])

  if (immersive || variant === 'minimal' || isFoxFreeVariant(variant)) return null
  if (variant === 'cute' && /^\/(study|schedule|todo|wallet)(\/|$)/.test(loc.pathname)) return null
  if (HIDE_ROUTES.some((r) => loc.pathname.startsWith(r))) return null
  if (closed) return null

  const state: IconStateKey = eng?.iconState || 'default'

  const savePos = (x: number, y: number) => {
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ x, y }))
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className={`${styles.dock} ${dim ? styles.dim : ''} ${dragging ? styles.dockDrag : ''}`}
      style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}
      role="button"
      tabIndex={0}
      aria-label={`小狐狸：${FOX_LABELS[state]}，点击找 AI 助手`}
      onPointerDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        const rect = e.currentTarget.getBoundingClientRect()
        const base = pos ?? { x: rect.left, y: rect.top }
        if (!pos) setPos(base)
        dragRef.current = {
          sx: e.clientX,
          sy: e.clientY,
          ix: base.x,
          iy: base.y,
          lastX: base.x,
          lastY: base.y,
          moved: false,
        }
        setDragging(true)
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const d = dragRef.current
        if (!d) return
        const dx = e.clientX - d.sx
        const dy = e.clientY - d.sy
        if (!d.moved && Math.abs(dx) + Math.abs(dy) > 6) d.moved = true
        if (d.moved) {
          d.lastX = d.ix + dx
          d.lastY = d.iy + dy
          setPos({ x: d.lastX, y: d.lastY })
        }
      }}
      onPointerUp={(e) => {
        const d = dragRef.current
        if (!d) return
        dragRef.current = null
        setDragging(false)
        try {
          e.currentTarget.releasePointerCapture(e.pointerId)
        } catch {
          /* ignore */
        }
        if (d.moved) savePos(d.lastX, d.lastY)
        else nav('/chat')
      }}
      onPointerCancel={() => {
        dragRef.current = null
        setDragging(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') nav('/chat')
      }}
    >
      <FoxAvatar state={state} size={40} wave />
      <span className={styles.bubble}>{FOX_LABELS[state]}</span>
      <button
        type="button"
        className={styles.dockClose}
        aria-label="收起小狐狸"
        onClick={(e) => {
          e.stopPropagation()
          setFoxDockOn(false)
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        ×
      </button>
    </div>
  )
}
