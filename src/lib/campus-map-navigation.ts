export type NavigationMode = 'walk' | 'ride' | 'car'
export const navigationModes: { mode: NavigationMode; label: string }[] = [
  { mode: 'walk', label: '步行' }, { mode: 'ride', label: '骑行' }, { mode: 'car', label: '驾车' },
]

/** MapLibre / OSM / browser GPS coordinates are WGS84. Never send them as GCJ02. */
export function amapNavigationUrl(poi: { lng: number; lat: number; name: string }, mode: NavigationMode, callNative = true): string {
  if (!Number.isFinite(poi.lng) || !Number.isFinite(poi.lat) || Math.abs(poi.lng) > 180 || Math.abs(poi.lat) > 90) throw new Error('地点位置无效，请重新选择')
  if (!navigationModes.some(item => item.mode === mode)) throw new Error('请选择出行方式')
  const url = new URL('https://uri.amap.com/navigation')
  // Commas are URI field separators, including inside the decoded destination name.
  url.searchParams.set('to', `${poi.lng},${poi.lat},${poi.name.replace(/[,\r\n]/g, ' ').slice(0, 80)}`)
  url.searchParams.set('mode', mode)
  url.searchParams.set('coordinate', 'wgs84')
  url.searchParams.set('src', 'ohhu')
  url.searchParams.set('callnative', callNative ? '1' : '0')
  return url.href
}

/** Official app URI. dev=1 asks Amap to convert our WGS84 coordinates. */
export function amapAppNavigationUrl(poi: { lng: number; lat: number; name: string }, mode: NavigationMode, os: string): string {
  amapNavigationUrl(poi, mode) // share validation
  const url = new URL(os === 'ios' ? 'iosamap://path' : 'amapuri://route/plan/')
  url.searchParams.set('sourceApplication', 'ohhu')
  url.searchParams.set('dlat', String(poi.lat))
  url.searchParams.set('dlon', String(poi.lng))
  url.searchParams.set('dname', poi.name.slice(0, 80))
  url.searchParams.set('dev', '1')
  url.searchParams.set('t', String({ walk: 2, ride: 3, car: 0 }[mode]))
  return url.href
}
