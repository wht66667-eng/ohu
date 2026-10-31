/**
 * 站内行为埋点（本地轻量版）
 *
 * 原 `lib/pet-hooks.ts` 把行为上报到宠物成长系统，宠物模块归档后改为本地计数，
 * 保持调用方的 fire-and-forget 语义不变：不 await、不改写主流程、失败静默。
 */

const DAY_PREFIX = 'campus-ping-daily:'
const COUNT_KEY = 'campus-ping-counts.v1'

type Counts = Record<string, number>

function dayTag(): string {
  return new Date().toDateString()
}

function seenToday(action: string): boolean {
  try {
    return window.localStorage.getItem(DAY_PREFIX + action) === dayTag()
  } catch {
    return false
  }
}

function markToday(action: string): void {
  try {
    window.localStorage.setItem(DAY_PREFIX + action, dayTag())
  } catch {
    /* 静默 */
  }
}

function bump(action: string): void {
  try {
    const raw = JSON.parse(window.localStorage.getItem(COUNT_KEY) || '{}') as Counts
    raw[action] = (raw[action] || 0) + 1
    window.localStorage.setItem(COUNT_KEY, JSON.stringify(raw))
  } catch {
    /* 静默 */
  }
}

/** 记录一次站内行为。同一天同一行为只计一次（去重），总数始终累加。 */
export async function pingActivity(action: string): Promise<void> {
  if (!action) return
  try {
    if (!seenToday(action)) markToday(action)
    bump(action)
  } catch {
    /* ignore */
  }
}

/** 语义化便捷入口，避免调用方硬编码行为字符串 */
export const pingBehavior = {
  secondhandPublish: () => pingActivity('secondhand_publish'),
  taskPublish: () => pingActivity('task_publish'),
  feedbackPost: () => pingActivity('feedback_post'),
  helpPublish: () => pingActivity('help_publish'),
  helpDone: () => pingActivity('help_done'),
  teamupPublish: () => pingActivity('teamup_publish'),
  teamupJoin: () => pingActivity('teamup_join'),
  campusCheckin: () => pingActivity('campus_checkin'),
}

export function readActivityCounts(): Counts {
  try {
    return JSON.parse(window.localStorage.getItem(COUNT_KEY) || '{}') as Counts
  } catch {
    return {}
  }
}
