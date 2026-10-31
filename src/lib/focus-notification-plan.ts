import type { FocusSession } from '../services/focus'

// Dedicated slots, outside class/exam/cert/todo reminder ranges.
export const FOCUS_NOTIFICATION_IDS = [840000001, 840000002] as const
export type FocusNotice = { id: number; at: number; title: string; body: string; phase: 'focus' | 'break'; sessionId: string }
export function focusNotificationPlan(session: FocusSession | null, now = Date.now()): FocusNotice[] {
  if (!session || session.pausedLeftMs != null || session.reminder === 'none' || !session.sessionId) return []
  const notices: FocusNotice[] = []
  if (session.endsAt > now) notices.push({
    id: session.phase === 'break' ? FOCUS_NOTIFICATION_IDS[1] : FOCUS_NOTIFICATION_IDS[0],
    at: session.endsAt,
    title: session.phase === 'break' ? '休息结束' : '专注完成',
    body: session.phase === 'break' ? '准备好就开始下一轮吧。' : `${session.title || '学习'} · 完成 ${session.minutes} 分钟专注`,
    phase: session.phase === 'break' ? 'break' : 'focus', sessionId: session.sessionId,
  })
  if (session.phase !== 'break' && session.breakMinutes && session.endsAt + session.breakMinutes * 60000 > now) {
    notices.push({ id: FOCUS_NOTIFICATION_IDS[1], at: session.endsAt + session.breakMinutes * 60000, title: '休息结束', body: '准备好就开始下一轮吧。', phase: 'break', sessionId: `${session.sessionId}:break` })
  }
  return notices
}
