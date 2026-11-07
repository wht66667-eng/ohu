import { CAMPUSES, isCampus, type Campus } from './campus'

/** One current JOU campus per local account, shared by every student workflow. */
const temporary = new Map<string, Campus | ''>()
const listeners = new Set<() => void>()
const PREFIX = 'ohhu.campus.v1:'

export function campusPreferenceKey(uid: string): string {
  return `${PREFIX}${encodeURIComponent(uid || 'guest')}`
}

export function loadCampusPreference(uid: string): Campus | '' {
  const key = campusPreferenceKey(uid)
  if (temporary.has(key)) return temporary.get(key)!
  try {
    const raw = localStorage.getItem(key)
    if (raw !== null) {
      const stored = JSON.parse(raw)
      return isCampus(stored?.campus) ? stored.campus : ''
    }
    // Reuse a homepage choice made before the shared preference was introduced.
    const legacy = JSON.parse(localStorage.getItem(`ohhu.home.v1:${encodeURIComponent(uid || 'guest')}`) || 'null')
    return isCampus(legacy?.campus) ? legacy.campus : ''
  } catch {
    return ''
  }
}

export function saveCampusPreference(uid: string, campus: Campus | ''): boolean {
  if (campus !== '' && !isCampus(campus)) return false
  const key = campusPreferenceKey(uid)
  let persisted = true
  try {
    localStorage.setItem(key, JSON.stringify({ version: 1, campus }))
    temporary.delete(key)
  } catch {
    // A blocked/full store must not make other open screens forget this choice.
    temporary.set(key, campus)
    persisted = false
  }
  listeners.forEach(listener => listener())
  return persisted
}

/** Carry the first guest choice through login, without replacing an account's own choice. */
export function inheritGuestCampus(uid: string): void {
  if (!uid || temporary.has(campusPreferenceKey(uid))) return
  try {
    if (localStorage.getItem(campusPreferenceKey(uid)) !== null) return
    const legacy = JSON.parse(localStorage.getItem(`ohhu.home.v1:${encodeURIComponent(uid)}`) || 'null')
    if (isCampus(legacy?.campus)) return
  } catch {
    return
  }
  const guestCampus = loadCampusPreference('')
  if (guestCampus) saveCampusPreference(uid, guestCampus)
}

export function subscribeCampusPreference(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent) => {
    if (event.key && !event.key.startsWith(PREFIX) && !event.key.startsWith('ohhu.home.v1:')) return
    if (event.key === null) temporary.clear()
    else temporary.delete(event.key)
    listener()
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }
}

/** Resolve by name; local guide IDs and cloud campus IDs are different namespaces. */
export function campusNameFromLabel(name: string): Campus | '' {
  return CAMPUSES.find(campus => name.trim() === campus || name.trim() === `江苏海洋大学${campus}` || name.trim() === `江苏海洋大学 · ${campus}`) || ''
}

export function preferredCampusRow<T extends { name: string }>(rows: T[], campus: Campus | ''): T | undefined {
  if (campus) return rows.find(row => campusNameFromLabel(row.name) === campus)
  return rows.find(row => campusNameFromLabel(row.name) === '苍梧校区') || rows[0]
}
