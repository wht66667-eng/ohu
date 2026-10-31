import { useEffect, useSyncExternalStore } from 'react'
import { useAuth } from '../lib/auth'
import { captureQbankSession, isQbankSessionCurrent, subscribeQbank } from '../lib/qbank'
import { getPersonalReminderScope, PERSONAL_REMINDER_ERROR_EVENT } from '../lib/personal-reminders'
import { refreshTodoReminderState, TODO_DATA_CHANGED_EVENT } from '../lib/todo-remind'

/** Keeps todo alarms in sync when the visual reminder host is muted or replaced by a work shell. */
export function TodoReminderSyncHost() {
  const scope = useSyncExternalStore(subscribeQbank, getPersonalReminderScope, getPersonalReminderScope)
  return <TodoReminderSyncAccountHost key={scope} />
}

function TodoReminderSyncAccountHost() {
  const auth = useAuth()
  const session = captureQbankSession()
  const signed = auth.isSigned && auth.user?.uid === session.uid

  useEffect(() => {
    if (!signed) return
    const sync = () => {
      void refreshTodoReminderState(session).catch(() => {
        if (isQbankSessionCurrent(session)) {
          window.dispatchEvent(new CustomEvent(PERSONAL_REMINDER_ERROR_EVENT, { detail: '待办提醒更新失败，请检查通知权限后重试。' }))
        }
      })
    }
    window.addEventListener(TODO_DATA_CHANGED_EVENT, sync)
    return () => window.removeEventListener(TODO_DATA_CHANGED_EVENT, sync)
  }, [signed, session.uid, session.revision])

  return null
}
