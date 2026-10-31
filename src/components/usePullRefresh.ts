/**
 * 下拉刷新手势
 *
 * WebView 没有浏览器自带的下拉刷新，套壳里列表页刷不动会显得很「假」。
 * 这里在页面滚动容器上挂一套触摸手势，并把「刷新」这件事交给
 * src/lib/native.ts 的事件总线——列表页只要用 usePollingRows 取数，
 * 就自动具备下拉刷新能力，页面本身不用写任何代码。
 *
 * 几个刻意的取舍：
 *  - 位移跟手但不移动内容：只把顶部指示器拉出来。移动内容需要知道每页的
 *    首屏结构，成本高且容易在某些页面上闪。指示器方案在所有页面观感一致。
 *  - 跟手位移直接写 DOM，不进 React state：拖动过程中每帧 setState 会让
 *    PhoneShell 整棵树参与 diff（children 虽然会被 bailout，但 TabBar、
 *    Toast 等兄弟节点仍会重渲染）。只有「是否已达触发阈值」才进 state。
 *  - 只认纵向手势：横向滑动（首页轮播、横向商品列表）必须在起手 8px 内让位。
 *  - 只在原生壳启用：移动端 H5 浏览器自带下拉刷新，两套手势叠加会互相打架。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { triggerAppRefresh } from '../lib/native'
import { IS_NATIVE } from '../lib/platform'

/** 松手后触发刷新的位移阈值（px，已含阻尼） */
const TRIGGER_PX = 62
/** 最大下拉位移，超出后阻尼到底，避免拉出一大片空白 */
const MAX_PX = 96
/** 阻尼系数：手指位移 × 该系数 = 指示器位移 */
const RESISTANCE = 0.55
/** 指示器静止位（略微上移 + opacity 0，视觉上完全不可见） */
const HIDDEN_Y = -14
/** 下拉时的最大滑出距离，超出后指示器停住不再跟手 */
const MAX_Y = 28
/** 刷新态最短停留时长，避免接口秒回导致指示器一闪而过 */
const MIN_SPIN_MS = 520
/** 起手判定：小于该位移不区分横纵，避免误触 */
const SLOP_PX = 8

export interface PullRefreshHandle {
  /** 挂到页面滚动容器上（<div ref={...}>） */
  containerRef: (node: HTMLDivElement | null) => void
  /** 挂到指示器上 */
  indicatorRef: React.RefObject<HTMLDivElement | null>
  /** 已拉过触发阈值：指示器翻转并高亮，提示「松手即刷新」 */
  armed: boolean
  /** 刷新中 */
  refreshing: boolean
}

function paint(
  el: HTMLDivElement | null,
  { distance, refreshing }: { distance: number; refreshing: boolean },
): void {
  if (!el) return
  const y = refreshing ? MAX_Y : Math.min(MAX_Y, HIDDEN_Y + distance)
  const opacity = refreshing ? 1 : Math.min(1, Math.max(0, (distance - 6) / 24))
  el.style.transform = `translateY(${y.toFixed(1)}px)`
  el.style.opacity = opacity.toFixed(2)
}

/**
 * Nested lists scroll independently from the shell page. If a gesture starts
 * inside one that is already scrolled, let that list handle a downward swipe
 * back toward its top instead of capturing it as a pull-to-refresh gesture.
 */
function hasScrolledNestedList(target: EventTarget | null, container: HTMLElement): boolean {
  let node = target instanceof Element ? target : null
  while (node && node !== container) {
    const overflowY = window.getComputedStyle(node).overflowY
    if (/^(auto|scroll|overlay)$/.test(overflowY) && node.scrollHeight > node.clientHeight + 1 && node.scrollTop > 0) {
      return true
    }
    node = node.parentElement
  }
  return false
}

export function usePullRefresh(enabled: boolean = IS_NATIVE): PullRefreshHandle {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const indicatorRef = useRef<HTMLDivElement | null>(null)
  const [armed, setArmed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  /** 手势与刷新状态都放在 ref 里给原生事件读，避免闭包捕获旧值 */
  const refreshingRef = useRef(false)

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainer(node)
  }, [])

  useEffect(() => {
    if (!enabled || !container) return undefined

    const el = container
    const indicator = () => indicatorRef.current

    let startY = 0
    let startX = 0
    let distance = 0
    let tracking = false
    let dragging = false

    const reset = () => {
      tracking = false
      dragging = false
      distance = 0
      setArmed(false)
      paint(indicator(), { distance: 0, refreshing: refreshingRef.current })
    }

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current || e.touches.length !== 1) return
      /* 只要还没滚到顶，这次手势一律交给原生滚动 */
      if (el.scrollTop > 0 || hasScrolledNestedList(e.target, el)) return
      startY = e.touches[0].clientY
      startX = e.touches[0].clientX
      tracking = true
      dragging = false
    }

    const onMove = (e: TouchEvent) => {
      if (!tracking) return
      const dy = e.touches[0].clientY - startY
      const dx = e.touches[0].clientX - startX

      if (!dragging) {
        if (Math.abs(dy) < SLOP_PX) return
        /* 横向为主或向上滑 → 让位给页面自身交互与滚动 */
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
          tracking = false
          return
        }
        dragging = true
      }

      /* 拖动中途页面被滚下去了：说明不是下拉刷新，立刻交还控制权 */
      if (el.scrollTop > 0) {
        reset()
        return
      }
      if (dy <= 0) {
        distance = 0
        setArmed(false)
        paint(indicator(), { distance: 0, refreshing: false })
        return
      }

      /* 抑制 WebView 自身的回弹与页面级下拉刷新，避免两套位移叠加 */
      if (e.cancelable) e.preventDefault()

      distance = Math.min(MAX_PX, dy * RESISTANCE)
      const nextArmed = distance >= TRIGGER_PX
      setArmed((prev) => (prev === nextArmed ? prev : nextArmed))
      paint(indicator(), { distance, refreshing: false })
    }

    const onEnd = () => {
      if (!tracking && !dragging) return
      const shouldRefresh = dragging && distance >= TRIGGER_PX
      tracking = false
      dragging = false
      distance = 0
      setArmed(false)

      if (!shouldRefresh || refreshingRef.current) {
        paint(indicator(), { distance: 0, refreshing: refreshingRef.current })
        return
      }

      refreshingRef.current = true
      setRefreshing(true)
      paint(indicator(), { distance: 0, refreshing: true })

      const startedAt = Date.now()
      void triggerAppRefresh().then(() => {
        const wait = Math.max(0, MIN_SPIN_MS - (Date.now() - startedAt))
        window.setTimeout(() => {
          refreshingRef.current = false
          setRefreshing(false)
          paint(indicator(), { distance: 0, refreshing: false })
        }, wait)
      })
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onEnd, { passive: true })

    paint(indicatorRef.current, { distance: 0, refreshing: false })

    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
      reset()
    }
  }, [enabled, container])

  return { containerRef, indicatorRef, armed, refreshing }
}
