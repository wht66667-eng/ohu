/** Task favorites are private per-account local data; legacy device-only favorites require an explicit claim. */
import { useSyncExternalStore } from 'react'

const LEGACY_KEY = 'campus-task-favs'
const CLAIM_KEY = 'campus-task-favs.legacy-owner.v1'
const PREFIX = 'campus-task-favs.v2:'
const EVENT = 'campus-favs-change'

function keyFor(scope: string): string { return `${PREFIX}${scope || 'guest'}` }

function normalize(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const output: number[] = []
  for (const raw of value) {
    const id = Number(raw)
    if (Number.isSafeInteger(id) && id > 0 && !output.includes(id)) output.push(id)
  }
  return output
}

function readKey(key: string): number[] {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? normalize(JSON.parse(raw)) : []
  } catch { return [] }
}

const snapshots = new Map<string, number[]>()
const listeners = new Map<string, Set<() => void>>()
function getSnapshot(scope: string): number[] {
  const key = keyFor(scope)
  if (!snapshots.has(key)) snapshots.set(key, readKey(key))
  return snapshots.get(key)!
}

function emit(scope: string): void {
  const key = keyFor(scope)
  for (const listener of listeners.get(key) || []) listener()
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: { scope } })) } catch { /* ignore */ }
}

function subscribe(scope: string, listener: () => void): () => void {
  const key = keyFor(scope)
  let set = listeners.get(key)
  if (!set) { set = new Set(); listeners.set(key, set) }
  set.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key !== key && event.key !== LEGACY_KEY && event.key !== CLAIM_KEY && event.key !== null) return
    if (event.key === key || event.key === null) snapshots.set(key, readKey(key))
    emit(scope)
  }
  window.addEventListener('storage', onStorage)
  return () => {
    set!.delete(listener)
    window.removeEventListener('storage', onStorage)
    if (!set!.size) listeners.delete(key)
  }
}

export function listFavIds(scope = 'guest'): number[] { return getSnapshot(scope) }

/** Toggle a task favorite in the current account or guest bucket. */
export function toggleFav(id: number, scope = 'guest'): boolean {
  if (!Number.isSafeInteger(id) || id <= 0) return false
  const key = keyFor(scope)
  const current = getSnapshot(scope)
  const exists = current.includes(id)
  const next = exists ? current.filter((value) => value !== id) : [...current, id]
  try {
    const encoded = JSON.stringify(next)
    window.localStorage.setItem(key, encoded)
    if (window.localStorage.getItem(key) !== encoded) throw new Error('收藏写入校验失败，请稍后重试')
    snapshots.set(key, next)
    emit(scope)
  } catch (error) {
    throw error instanceof Error ? error : new Error('本机存储不可用，收藏没有保存')
  }
  return !exists
}

export function useFavIds(scope = 'guest'): number[] {
  return useSyncExternalStore((listener) => subscribe(scope, listener), () => getSnapshot(scope), () => getSnapshot(scope))
}

export function hasClaimableLegacyFavs(scope = 'guest'): boolean {
  try {
    const owner = window.localStorage.getItem(CLAIM_KEY)
    return (!owner || owner === (scope || 'guest')) && readKey(LEGACY_KEY).length > 0
  } catch { return false }
}

export function useHasClaimableLegacyFavs(scope = 'guest'): boolean {
  const subscribeClaimability = (listener: () => void) => {
    const onChange = (event: Event) => {
      const changedScope = (event as CustomEvent<{ scope?: string }>).detail?.scope
      if (!changedScope || changedScope === scope) listener()
    }
    window.addEventListener(EVENT, onChange)
    const onStorage = (event: StorageEvent) => {
      if (event.key === LEGACY_KEY || event.key === CLAIM_KEY || event.key === null) listener()
    }
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(EVENT, onChange)
      window.removeEventListener('storage', onStorage)
    }
  }
  return useSyncExternalStore(subscribeClaimability, () => hasClaimableLegacyFavs(scope), () => false)
}

/** Copy the old device-only list only after the user confirms it belongs to this account. */
export async function claimLegacyFavs(scope = 'guest'): Promise<number> {
  const ownerScope = scope || 'guest'
  const locks = (navigator as Navigator & { locks?: LockManager }).locks
  if (!locks) throw new Error('当前浏览器不支持安全恢复旧收藏，请在较新的哦狐版本中打开')
  return locks.request('ohu-task-favorites-legacy-claim', () => {
    const oldRows = readKey(LEGACY_KEY)
    if (!oldRows.length) return 0
    let reserved = false
    let committed = false
    try {
      const owner = window.localStorage.getItem(CLAIM_KEY)
      if (owner && owner !== ownerScope) throw new Error('这批旧收藏已归入另一账号，不能再次导入')
      const key = keyFor(ownerScope)
      if (!owner) {
        window.localStorage.setItem(CLAIM_KEY, ownerScope)
        if (window.localStorage.getItem(CLAIM_KEY) !== ownerScope) throw new Error('旧收藏归属已被其他操作占用，请刷新后重试')
        reserved = true
      }
      const merged = normalize([...readKey(key), ...oldRows])
      const encoded = JSON.stringify(merged)
      window.localStorage.setItem(key, encoded)
      if (window.localStorage.getItem(key) !== encoded) throw new Error('收藏写入校验失败')
      snapshots.set(key, merged)
      committed = true
      window.localStorage.removeItem(LEGACY_KEY)
      emit(ownerScope)
      return oldRows.length
    } catch (error) {
      if (reserved && !committed) {
        try { if (window.localStorage.getItem(CLAIM_KEY) === ownerScope) window.localStorage.removeItem(CLAIM_KEY) } catch { /* retain ownership marker if cleanup is unavailable */ }
      }
      // If only legacy cleanup failed, the verified account copy is kept; retrying is safe because IDs are deduplicated.
      throw error instanceof Error ? error : new Error('恢复旧收藏失败，请检查设备存储空间')
    }
  })
}
