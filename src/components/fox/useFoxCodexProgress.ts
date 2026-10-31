import { useEffect } from 'react'
import { markCodexSeen } from './FoxCodex'
import { useFoxState } from './useFoxState'

/** Preserve earned expressions without mounting an interactive mascot overlay. */
export function useFoxCodexProgress(enabled: boolean) {
  const engagement = useFoxState()
  useEffect(() => {
    if (enabled && engagement) markCodexSeen(engagement.iconState)
  }, [enabled, engagement])
}
