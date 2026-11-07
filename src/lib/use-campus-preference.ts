import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useAuth } from './auth'
import { type Campus } from './campus'
import { inheritGuestCampus, loadCampusPreference, saveCampusPreference, subscribeCampusPreference } from './campus-preference'

export function useCampusPreference() {
  const auth = useAuth()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const campus = useSyncExternalStore(subscribeCampusPreference, () => loadCampusPreference(uid), () => '' as const)
  useEffect(() => { inheritGuestCampus(uid) }, [uid])
  const setCampus = useCallback((next: Campus | '') => saveCampusPreference(uid, next), [uid])
  return { campus, setCampus }
}
