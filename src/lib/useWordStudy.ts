import { useSyncExternalStore } from 'react'
import { getWordStudyError, getWordStudyRevision, getWordStudyScope, retryWordStudy, subscribeWordStudy } from '../services/words/study-storage'

/** Reads and mutations share the same account-owned local study revision. */
export function useWordStudy() {
  const revision = useSyncExternalStore(subscribeWordStudy, getWordStudyRevision, () => 0)
  return { revision, scope: getWordStudyScope(), error: getWordStudyError(), retry: retryWordStudy }
}
