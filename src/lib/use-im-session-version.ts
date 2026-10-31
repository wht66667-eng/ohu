import { useSyncExternalStore } from 'react'
import { captureImSession, subscribeImSession } from './im-session'

/** Rebuild private page state even when an account leaves and returns as the same UID. */
export function useImSessionVersion(uid: string): number {
  return useSyncExternalStore(subscribeImSession, () => captureImSession(uid)?.revision ?? -1, () => -1)
}
