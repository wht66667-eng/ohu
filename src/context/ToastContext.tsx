import { createContext, useContext, type ReactNode } from 'react'
import { toast } from '../lib/toast'

/** 页面里沿用 `const toast = useToast(); toast('提示')` 的旧写法，底层统一走 lib/toast 的全局 Toaster */
export type ToastFn = ((msg: string, opts?: { sound?: boolean }) => void) & {
  ok: (msg: string, opts?: { sound?: boolean }) => void
  err: (msg: string) => void
  warn: (msg: string) => void
}

const noop = () => {}
const ToastContext = createContext<ToastFn>(Object.assign(noop, { ok: noop, err: noop, warn: noop }))

export function ToastProvider({ children }: { children: ReactNode }) {
  return <ToastContext.Provider value={toast}>{children}</ToastContext.Provider>
}

export function useToast() {
  return useContext(ToastContext)
}
