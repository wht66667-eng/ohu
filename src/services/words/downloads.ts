import { setDownloadedWordBank } from '../../data/words/banks'
import { downloadExamPack, parsePersonalVocab, readPersonalVocab, savePersonalVocab, type ExamPack, type ExamType, type ExamWord } from '../../lib/personal-exam-vocab'

let rows: ExamWord[] = []
let initialized: Promise<void> | null = null
let queue: Promise<unknown> = Promise.resolve()
let state = { revision: 0, ready: false, error: '' }
const listeners = new Set<() => void>()
export const subscribeDownloadedWords = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const getDownloadedWordsState = () => state
export const getDownloadedExamWords = () => rows

function notify(ready: boolean, error = '') {
  state = { ready, error, revision: state.revision + 1 }
  for (const listener of listeners) listener()
}

export function initializeDownloadedWords(): Promise<void> {
  if (initialized) return initialized
  initialized = readPersonalVocab().then(saved => {
    // Normalize legacy records and reject corrupted data without overwriting the DB.
    rows = saved.length ? parsePersonalVocab(JSON.stringify(saved)) : []
    setDownloadedWordBank(rows)
    notify(true)
  }).catch(error => {
    initialized = null
    notify(true, error instanceof Error ? error.message : '读取下载词库失败，可继续使用内置词库。')
    throw error
  })
  return initialized
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const pending = queue.then(operation)
  queue = pending.catch(() => {})
  return pending
}

export function retryDownloadedWords(): Promise<void> {
  return serialize(async () => { initialized = null; await initializeDownloadedWords() })
}

export async function installDownloadedPack(pack: ExamPack, signal: AbortSignal): Promise<void> {
  await initializeDownloadedWords()
  const incoming = await downloadExamPack(pack, signal)
  await serialize(async () => {
    if (signal.aborted) throw new DOMException('下载已取消', 'AbortError')
    const next = [...rows.filter(row => row.exam_type !== pack.exam_type), ...incoming]
    await savePersonalVocab(next)
    rows = next
    setDownloadedWordBank(rows)
    notify(true)
  })
}

export function removeDownloadedPack(exam: ExamType): Promise<void> {
  return serialize(async () => {
    await initializeDownloadedWords()
    const next = rows.filter(row => row.exam_type !== exam)
    await savePersonalVocab(next)
    rows = next
    setDownloadedWordBank(rows)
    // Keep custom words, plans and SRS when releasing the downloaded package.
    notify(true)
  })
}
