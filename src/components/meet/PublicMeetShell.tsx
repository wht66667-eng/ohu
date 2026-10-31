import type { ReactNode } from 'react'
import { AuthSheets } from '../../lib/auth-ui'
import { Toaster } from '../../lib/toast'
import { ToastProvider } from '../../context/ToastContext'
import styles from './PublicMeetShell.module.css'

/** Web invitees can view and respond without completing the native-app first-run flow. */
export function PublicMeetShell({ children }: { children: ReactNode }) {
  return <div className={styles.outer} data-student-shell="true">
    <div className={styles.phone} data-app-body="">
      <ToastProvider>
        <main className={styles.main} id="main-content" tabIndex={-1}>{children}</main>
        <Toaster />
        <AuthSheets />
      </ToastProvider>
    </div>
  </div>
}
