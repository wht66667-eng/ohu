import type { Campus, CampusPoi } from './campus-map'
import type { FeatureCollection, Position } from 'geojson'
export const MAP_CATEGORIES = [
  { label: '全部', icon: 'all', color: '#26744a', background: '#e0efcd' },
  { label: '美食', icon: 'food', color: '#e87834', background: '#ffeddf' },
  { label: '好玩', icon: 'fun', color: '#7775c9', background: '#ecebff' },
  { label: '打卡', icon: 'checkin', color: '#e6a027', background: '#fff2d0' },
  { label: '学习', icon: 'study', color: '#287da5', background: '#e3f2fa' },
  { label: '生活', icon: 'life', color: '#b86c95', background: '#f8e8f0' },
] as const
export type MapCategory = typeof MAP_CATEGORIES[number]['label']
export function poiCategory(category: string): MapCategory {
  if (/食|餐|咖啡|茶饮/.test(category)) return '美食'
  if (/玩|游|运动|体育/.test(category)) return '好玩'
  if (/打卡|景观|湖/.test(category)) return '打卡'
  if (/教学|学院|图书|学习|校园建筑/.test(category)) return '学习'
  return '生活'
}
export function filterMapPois(pois: CampusPoi[], category: MapCategory, query: string): CampusPoi[] {
  const text = query.trim().toLocaleLowerCase('zh-CN')
  return pois.filter(poi => (category === '全部' || poiCategory(poi.category) === category)
    && (!text || `${poi.name} ${poi.category} ${poi.note || ''}`.toLocaleLowerCase('zh-CN').includes(text)))
}
export function campusGeometryUrl(campus?: Campus): string {
  const key = campus?.name.includes('通灌') ? 'tongguan' : campus?.name.includes('宋跳') ? 'songtiao' : 'cangwu'
  return `/maps/jou-${key}.geojson`
}
/** Names and coordinates come from the local OSM extract, never the reference artwork. */
export async function fetchCampusGuidePois(campus: Campus): Promise<CampusPoi[]> {
  try {
    const response=await fetch(campusGeometryUrl(campus));if(!response.ok)return []
    const data=await response.json() as FeatureCollection,seen=new Set<string>()
    return data.features.flatMap(feature=>{
      const p=feature.properties
      if(!p?.name || !['building','sport','water','poi'].includes(p.kind) || seen.has(p.name))return []
      const coordinates:Position[]=[]
      function collect(value:unknown){if(!Array.isArray(value))return;if(typeof value[0]==='number'&&typeof value[1]==='number')coordinates.push(value as Position);else value.forEach(collect)}
      if('coordinates' in feature.geometry)collect(feature.geometry.coordinates)
      if(!coordinates.length)return []
      const lng=coordinates.reduce((n,p)=>n+p[0],0)/coordinates.length,lat=coordinates.reduce((n,p)=>n+p[1],0)/coordinates.length
      if(!Number.isFinite(lng)||!Number.isFinite(lat))return []
      seen.add(p.name)
      const category=/食堂|餐厅/.test(p.name)?'美食':/宿舍|浴室|卫生|水房|邮政/.test(p.name)?'生活':p.kind==='sport'?'运动场':p.kind==='water'?'打卡':'校园建筑'
      return [{id:-300000000000-Number(p.osm_id||0),campus_id:campus.id,name:p.name,category,lng,lat,enabled:true,verification_status:'candidate' as const,source_url:`https://www.openstreetmap.org/${p.osm_type||'way'}/${p.osm_id}`,source_license:'OpenStreetMap ODbL 1.0',note:'公开地图参考位置；名称和入口请以现场为准，打卡保存在本机。'}]
    })
  }catch{return []}
}
export function mapDistance(a: {lng:number;lat:number}, b: {lng:number;lat:number}): string {
  const rad = Math.PI / 180, dLat = (b.lat-a.lat)*rad, dLng=(b.lng-a.lng)*rad
  const x=Math.sin(dLat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLng/2)**2
  const m=6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x))
  return m<1000 ? `${Math.round(m)} m` : `${(m/1000).toFixed(1)} km`
}
