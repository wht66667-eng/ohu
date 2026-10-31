import { useEffect, useSyncExternalStore } from 'react'
import { getDownloadedWordsState, initializeDownloadedWords, retryDownloadedWords, subscribeDownloadedWords } from '../services/words/downloads'

export function useDownloadedWordBanks() {
  const state = useSyncExternalStore(subscribeDownloadedWords, getDownloadedWordsState)
  useEffect(() => { void initializeDownloadedWords().catch(() => {}) }, [])
  return { ...state, retry: () => { void retryDownloadedWords().catch(() => {}) } }
}
