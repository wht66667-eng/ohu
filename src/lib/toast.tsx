/* ============================================================
 * 轻量 toast：微信 H5 内提示（复制成功等）
 * ------------------------------------------------------------
 * 兼容升级（第二阶段）：
 *  - toast(text) 原有签名不变，113+ 处历史调用零改动；
 *  - 扩展 toast(text, opts) 与快捷方法 toast.ok / toast.err /
 *    toast.warn：变体底色 + 可配置展示时长；
 *  - 入场沿用基础动画 toastIn；离场挂 .is-leave 播放 xToastOut；
 *    .toast--ok/--err/--warn 与离场样式由 motion.css 增量提供；
 *  - Toaster 常驻 App 根（App.tsx），不拦截指针事件，aria-live 播报。
 * ============================================================ */

import { useEffect, useState } from 'react'

export type ToastType = 'ok' | 'err' | 'warn'
export type ToastOptions = {
  type?: ToastType
  /** 展示时长（ms），下限 800ms */
  duration?: number
}

type ToastPayload = { text: string; type?: ToastType; duration?: number }
type ToastItem = ToastPayload & { id: number; leaving?: boolean }
type Detail = ToastPayload | string // 兼容历史 string payload

const DEFAULT_MS = 1800
const LEAVE_MS = 240 // 与 motion.css xToastOut 0.22s 对齐

function show(text: string, opts: ToastOptions = {}) {
  window.dispatchEvent(
    new CustomEvent<ToastPayload>('app-toast', {
      detail: { text, type: opts.type, duration: opts.duration },
    }),
  )
}

type VariantOpts = Omit<ToastOptions, 'type'>

export const toast = Object.assign(show, {
  ok(text: string, opts: VariantOpts = {}) {
    show(text, { ...opts, type: 'ok' })
  },
  err(text: string, opts: VariantOpts = {}) {
    show(text, { ...opts, type: 'err' })
  },
  warn(text: string, opts: VariantOpts = {}) {
    show(text, { ...opts, type: 'warn' })
  },
})

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([])

  useEffect(() => {
    let seed = 0
    const on = (e: Event) => {
      const raw = (e as CustomEvent<Detail>).detail
      const payload: ToastPayload =
        typeof raw === 'string' ? { text: raw } : raw
      if (!payload || !payload.text) return
      const id = ++seed
      setItems((list) => [...list, { id, text: payload.text, type: payload.type }])
      const ms = Math.max(800, payload.duration ?? DEFAULT_MS)
      window.setTimeout(() => {
        // 第一步：标记离场，播放收起动画
        setItems((list) =>
          list.map((i) => (i.id === id ? { ...i, leaving: true } : i)),
        )
        // 第二步：动画结束后真正移除，避免布局残留
        window.setTimeout(() => {
          setItems((list) => list.filter((i) => i.id !== id))
        }, LEAVE_MS)
      }, ms)
    }
    window.addEventListener('app-toast', on)
    return () => window.removeEventListener('app-toast', on)
  }, [])

  return (
    <div className="toaster" aria-live="polite">
      {items.map((i) => (
        <div
          key={i.id}
          className={[
            'toast',
            i.type ? `toast--${i.type}` : '',
            i.leaving ? 'is-leave' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span>{i.text}</span>
        </div>
      ))}
    </div>
  )
}
