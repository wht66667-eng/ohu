import type { Campus, CampusPoi } from './campus-map'

export const JOU_OFFICIAL_MAP = 'https://international.jou.edu.cn/chinese/xysh/xxdt.htm'
export const JOU_CANGWU_BOUNDS: [[number, number], [number, number]] = [[119.2088377, 34.6035568], [119.2222944, 34.6129888]]
export const JOU_CAMPUS_BOUNDS: Record<string, [[number,number],[number,number]]> = {
  苍梧: JOU_CANGWU_BOUNDS,
  通灌: [[119.1826138,34.5863148],[119.1876054,34.5895564]],
  宋跳: [[119.2010368,34.6454415],[119.2048727,34.6505101]],
}
/** Local read-only guide anchors, not CloudBase record IDs or surveyed boundaries. */
const CAMPUSES: Campus[] = [
  { id: -2001, school_id: 'jou', name: '苍梧校区', center_lng: 119.215566, center_lat: 34.608273, enabled: true },
  { id: -2002, school_id: 'jou', name: '通灌校区', center_lng: 119.18511, center_lat: 34.58794, enabled: true },
  // OSM Nominatim university result: 119.2030062, 34.6488744 (approximate centre, not an entrance).
  { id: -2004, school_id: 'jou', name: '宋跳校区', center_lng: 119.2030062, center_lat: 34.6488744, enabled: true },
]
const POINTS = [
  [-21001, '海洋学院', '教学楼', 119.21429, 34.6073, 'way/1160697407'],
  [-21002, '文思楼', '教学楼', 119.21403, 34.60869, 'way/744830217'],
  [-21003, '食品工程学院', '教学楼', 119.21751, 34.60674, 'way/1160704063'],
  [-21004, '艺术院', '教学楼', 119.21762, 34.60753, 'way/1160703992'],
  [-21005, '东操场', '运动场', 119.21709, 34.61163, 'way/1002427174'],
  [-21006, '江苏海洋大学西门', '校门', 119.21191, 34.60374, 'way/1160703894'],
] as const
export function jouReferenceCampuses(): Campus[] { return CAMPUSES.map(campus => ({ ...campus })) }
/** Keep the three requested JOU campuses, preserving CloudBase IDs for writes. */
export function jouCampusChoices(cloud: Campus[]): Campus[] {
  return CAMPUSES.map(reference => {
    const matched = cloud.find(row => row.school_id === 'jou' && row.name.includes(reference.name.slice(0, 2)))
    return matched ? { ...matched, center_lng: matched.center_lng ?? reference.center_lng, center_lat: matched.center_lat ?? reference.center_lat } : { ...reference }
  })
}
export function jouReferencePois(campus: Campus | undefined): CampusPoi[] {
  if (!campus?.name.includes('苍梧')) return []
  return POINTS.map(([id, name, category, lng, lat, osm]) => ({ id, campus_id: campus.id, name, category, lng, lat, enabled: true,
    source_url: `https://www.openstreetmap.org/${osm}`, source_license: 'OpenStreetMap ODbL 1.0', verification_status: 'candidate',
    note: '公开地图参考位置，尚未现场核对。打卡保存在本机；精确入口以现场为准。',
  }))
}
export function isJouGuidePoi(poi: CampusPoi): boolean { return poi.id < 0 && poi.verification_status !== 'local' }
