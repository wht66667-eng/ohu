import type { CampusPoi } from './campus-map'

export interface LocalCampusCheckin {
  poi_name: string
  lng: number
  lat: number
  note: string
  created_at: string
}

const checkinKey = (uid: string) => 'ohhu:campus-map-checkins:v1:' + uid

export function readLocalCampusCheckins(uid: string): LocalCampusCheckin[] {
  if (!uid) return []
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(checkinKey(uid)) || '[]')
    if (!Array.isArray(rows)) return []
    return rows.filter(row => row && typeof row.poi_name === 'string' && typeof row.created_at === 'string')
  } catch { return [] }
}

export function saveLocalCampusCheckin(uid: string, row: LocalCampusCheckin) {
  if (!uid) throw new Error('请先登录后打卡')
  localStorage.setItem(checkinKey(uid), JSON.stringify([row, ...readLocalCampusCheckins(uid)].slice(0, 500)))
}

export type LocalPin = CampusPoi & { verification_status: 'local' }
export function mergeCampusPois(remote: CampusPoi[], local: LocalPin[]): CampusPoi[] {
  return [...remote, ...local.filter(p => !remote.some(r => r.name === p.name && Math.abs(r.lng - p.lng) < 0.0002 && Math.abs(r.lat - p.lat) < 0.0002))]
}
// Personal pins stay with their signed-in owner, including when cloud ranges are added later.
const key = (uid: string, schoolId: string) => `ohhu:campus-map-pins:v2:${encodeURIComponent(uid)}:${schoolId}`
export function readLocalPins(uid: string, schoolId: string, campusId: number | null): LocalPin[] {
  if (!uid) return []
  try {
    const rows = JSON.parse(localStorage.getItem(key(uid, schoolId)) || '[]')
    return Array.isArray(rows) ? rows.filter(p => p && p.verification_status === 'local' && typeof p.name === 'string' && Number.isFinite(p.id) && p.id < 0 && Number.isFinite(p.lng) && Number.isFinite(p.lat) && (!campusId || !p.campus_id || p.campus_id === campusId)).slice(-200) : []
  } catch { return [] }
}
export function saveLocalPin(uid: string, schoolId: string, row: LocalPin) {
  if (!uid) throw new Error('请先登录后添加地点')
  const rows = readLocalPins(uid, schoolId, null)
  localStorage.setItem(key(uid, schoolId), JSON.stringify([...rows.filter(p => p.id !== row.id), row].slice(-200)))
}
