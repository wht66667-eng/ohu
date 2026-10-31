import type { Feature, Polygon } from 'geojson'
import type { Campus, CampusPoi } from './campus-map'
import type { MapLocation } from './campus-map-location'
import { JOU_CAMPUS_BOUNDS } from './jou-campus-reference'

export function locationZoom(accuracy: number): number {
  return accuracy <= 30 ? 17 : accuracy <= 100 ? 16 : accuracy <= 300 ? 15 : 14
}

/** Accuracy is a radius in metres, never a second destination or a saved check-in. */
export function locationAccuracyFeature(position: MapLocation): Feature<Polygon> {
  const radius = Math.max(1, Math.min(position.accuracy, 1000))
  const coordinates: number[][] = []
  for (let index = 0; index <= 64; index++) {
    const angle = index * Math.PI / 32
    coordinates.push([position.lng + Math.cos(angle) * radius / (111320 * Math.cos(position.lat * Math.PI / 180)), position.lat + Math.sin(angle) * radius / 111320])
  }
  return { type: 'Feature', properties: { accuracy: position.accuracy }, geometry: { type: 'Polygon', coordinates: [coordinates] } }
}

/** A display extent, not an asserted legal campus boundary. */
export function campusOverviewBounds(campus: Campus | undefined, pois: readonly CampusPoi[]): [[number, number], [number, number]] | null {
  if (campus?.school_id === 'jou') {
    const bounds=Object.entries(JOU_CAMPUS_BOUNDS).find(([name])=>campus.name.includes(name))?.[1]
    if(bounds)return bounds.map(point=>[...point]) as [[number,number],[number,number]]
  }
  const points = pois.filter(p => Number.isFinite(p.lng) && Number.isFinite(p.lat)).map(p => [p.lng, p.lat])
  if (campus?.center_lng != null && campus.center_lat != null) points.push([campus.center_lng, campus.center_lat])
  if (!points.length) return null
  const xs = points.map(p => p[0]), ys = points.map(p => p[1])
  const x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys)
  const padX = Math.max(.002, (x2 - x1) * .12), padY = Math.max(.002, (y2 - y1) * .12)
  return [[x1 - padX, y1 - padY], [x2 + padX, y2 + padY]]
}
