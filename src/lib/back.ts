import type { NavigateFunction } from 'react-router-dom'
import { studyBackHistory } from './study-back-history'
import { clientPath } from './client-navigation'

/**
 * 统一返回：有历史就回上一页，深链/冷启动无历史时回首页，
 * 避免「点了返回没反应」。
 */
export function goBack(nav: NavigateFunction, fallback = '/'): void {
  const state = window.history.state as { idx?: number } | null
  const pathname = window.location.hash.startsWith('#/')
    ? window.location.hash.slice(1).split(/[?#]/)[0]
    : window.location.pathname
  const plan = studyBackHistory.plan(state?.idx, pathname)
  if (plan) {
    if ('delta' in plan) nav(plan.delta)
    else nav(plan.to, { replace: true })
    return
  }
  const hasPrev =
    typeof state?.idx === 'number' ? state.idx > 0 : window.history.length > 1
  if (hasPrev) nav(-1)
  else nav(clientPath(fallback), { replace: true })
}
