/**
 * 列表页通用取数：首屏拉一次 + 自适应轮询，后台与离线暂停。
 * 与 campus-life-h5 的列表页约定保持一致（定时器随 effect 清理，避免后台耗流量）。
 *
 * 另外订阅了原生壳的下拉刷新总线：套壳 App 里下拉一次即立即重取，
 * 页面自身不用写任何代码（手势见 src/components/usePullRefresh.ts）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from './auth'
import { onAppRefresh } from './native'
import { startAdaptivePolling } from './adaptive-polling'

export interface RowsRes<T> {
  rows: T[]
  error: string | null
  hasMore?: boolean
}

export interface PollingState<T> {
  rows: T[]
  error: string | null
  loading: boolean
  hasMore: boolean
  reload: () => void
}

export function usePollingRows<T>(
  load: () => Promise<RowsRes<T>>,
  deps: unknown[],
  intervalMs = 30000,
): PollingState<T> {
  const [rows, setRows] = useState<T[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  /** 会话就绪前 rdb 拿不到 token，请求必然失败，因此先等 phase 离开 booting */
  const { phase: authPhase, user } = useAuth()
  const sessionUid = user?.uid || ''

  const loadRef = useRef(load)
  loadRef.current = load
  /** 当前生效的取数函数：下拉刷新直接复用它，不重新建定时器 */
  const runRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => {
    if (authPhase === 'booting') {
      setLoading(true)
      return
    }
    let alive = true
    setLoading(true)
    setError(null)
    setRows([])
    setHasMore(false)
    const onOffline = () => {
      setError('当前已离线，网络恢复后会继续更新')
      setLoading(false)
    }
    if (navigator.onLine === false) onOffline()
    window.addEventListener('offline', onOffline)
    const polling = startAdaptivePolling(async () => {
      try {
        const res = await loadRef.current()
        if (!alive) return false
        if (res.error) setError(res.error)
        else { setError(null); setRows(res.rows); setHasMore(!!res.hasMore) }
        return !res.error
      } catch {
        if (alive) setError('暂时无法获取数据，请检查网络后重试')
        return false
      } finally {
        if (alive) setLoading(false)
      }
    }, { intervalMs })
    const run = polling.refresh
    runRef.current = run

    return () => {
      alive = false
      if (runRef.current === run) runRef.current = null
      polling.stop()
      window.removeEventListener('offline', onOffline)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, intervalMs, authPhase, sessionUid])

  /* 下拉刷新：等本次取数真正返回后，指示器才收起（避免转半圈就停） */
  useEffect(() => {
    if (authPhase === 'booting') return undefined
    return onAppRefresh(async () => {
      await runRef.current?.()
    })
  }, [authPhase])

  const reload = useCallback(() => { void runRef.current?.() }, [])
  return { rows, error, loading, hasMore, reload }
}
