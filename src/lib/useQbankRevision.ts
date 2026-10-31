import { useSyncExternalStore } from 'react'
import { getQbankRevision, subscribeQbank } from './qbank'

/** Reads refresh immediately after local writes and auth identity changes. */
export function useQbankRevision(): number {
  return useSyncExternalStore(subscribeQbank, getQbankRevision, () => 0)
}
