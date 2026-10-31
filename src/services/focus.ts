/**
 * 番茄专注会话：完成后记入每日统计；中途退出仅提示，不再耦合宠物经验。
 * 原 services/petdex/focus.ts 已随宠物模块归档，这里保留纯净版。
 */
import { addFocusMinutes } from '../lib/focus-stats'
import { currentFocusRepository } from '../lib/focus-store'

const IMMERSIVE_KEY = 'pet.focus.immersive'

export type FocusSession = {
  version?: 3
  sessionId?: string
  userId?: string
  minutes: number
  startedAt: number
  endsAt: number
  phase?: 'focus' | 'break'
  title?: string
  breakMinutes?: number
  pausedLeftMs?: number | null
  noise?: string
  reminder?: 'sound' | 'vibrate' | 'none'
  todoId?: number | null
}

export function setFocusImmersive(on: boolean) {
  try {
    if (on) sessionStorage.setItem(IMMERSIVE_KEY, '1')
    else sessionStorage.removeItem(IMMERSIVE_KEY)
    window.dispatchEvent(new CustomEvent('pet-focus-immersive', { detail: on }))
  } catch {
    /* ignore */
  }
}

export function isFocusImmersive(): boolean {
  try {
    return sessionStorage.getItem(IMMERSIVE_KEY) === '1'
  } catch {
    return false
  }
}

export function saveFocusSession(s: FocusSession | null) {
  return currentFocusRepository().save(s)
}

export function readFocusSession(): FocusSession | null {
  return currentFocusRepository().read().active
}

/** 请求中断专注（硬件返回键等） */
export function requestFocusAbort() {
  window.dispatchEvent(new CustomEvent('pet-focus-abort-request'))
}

/**
 * 中途退出：不再扣宠物经验，仅清掉会话。
 * 返回文案供 toast。
 */
export function applyFocusAbortPenalty(): { message: string } {
  return { message: '专注中断，本次不计入统计' }
}

/** 专注完成：把分钟数记入每日统计 */
export async function claimFocusComplete(minutes: number, at = Date.now()): Promise<void> {
  if (minutes > 0) addFocusMinutes(minutes, at)
}
