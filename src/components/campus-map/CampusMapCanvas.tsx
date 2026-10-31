import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Map as MlMap, Marker, NavigationControl, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl'
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { FeatureCollection } from 'geojson'
import type { Campus, CampusPoi } from '../../lib/campus-map'
import type { MapLocation } from '../../lib/campus-map-location'
import { campusOverviewBounds, locationAccuracyFeature, locationZoom } from '../../lib/campus-map-view'
import { campusGeometryUrl, MAP_CATEGORIES, poiCategory } from '../../lib/campus-map-presentation'
import { campusArtGeometry } from '../../lib/campus-map-art'
import { installJouCampusGeometry } from '../../lib/jou-map-geometry'
import { foxPoseSvgMarkup } from '../../lib/fox-sheet'
import { MAP_ICONS } from './MapIcons'
import s from './CampusMapCanvas.module.css'

export type CampusMapHandle = { overview: () => void; focus: (poi: CampusPoi) => void }
type Props = {
  campus?: Campus; pois: CampusPoi[]; illustrated: boolean; realStyle: string; visible: boolean
  selectedPoi: CampusPoi | null; userLocation: MapLocation | null; picking: boolean; pin: [number,number] | null
  onSelect: (poi: CampusPoi) => void; onPick: (point:[number,number]) => void
}
const localStyle=():StyleSpecification=>({version:8,glyphs:'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',sources:{},layers:[{id:'paper',type:'background',paint:{'background-color':'#f3edda'}}]})
const duration=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:450

export const CampusMapCanvas=forwardRef<CampusMapHandle,Props>(function CampusMapCanvas(props,ref) {
  const el=useRef<HTMLDivElement>(null),mapRef=useRef<MlMap|null>(null),latest=useRef(props);latest.current=props
  const [ready,setReady]=useState(0),[issue,setIssue]=useState(''),[geometry,setGeometry]=useState<FeatureCollection|null>(null)
  const gps=useRef<Marker|null>(null),pin=useRef<Marker|null>(null),markers=useRef<Marker[]>([])
  function overview(){const p=latest.current,m=mapRef.current,b=campusOverviewBounds(p.campus,p.pois);if(m&&b)m.fitBounds(b,{padding:{top:46,bottom:65,left:32,right:60},duration:duration(),maxZoom:16.5})}
  function focus(poi:CampusPoi){mapRef.current?.flyTo({center:[poi.lng,poi.lat],zoom:17.1,duration:duration()})}
  useImperativeHandle(ref,()=>({overview,focus}),[])
  useEffect(()=>{
    if(!el.current) return
    setWorkerUrl(mapWorkerUrl)
    const p=latest.current
    const map=new MlMap({container:el.current,style:p.illustrated?localStyle():p.realStyle,center:[p.campus?.center_lng??119.215566,p.campus?.center_lat??34.608273],zoom:16,pitch:p.illustrated?25:0,attributionControl:{compact:true},maxPitch:50})
    mapRef.current=map
    map.addControl(new NavigationControl({showCompass:true}),'top-left')
    const resize=new ResizeObserver(()=>map.resize());resize.observe(el.current)
    map.on('style.load',()=>{setIssue('');setReady(v=>v+1)})
    map.on('error',()=>setIssue(latest.current.illustrated?'部分地图文字或图层暂不可用，可继续浏览或切换真实地图。':'真实底图加载异常，可切换手绘地图或查看地点列表。'))
    map.on('click',event=>{
      const p=latest.current
      if(p.picking){p.onPick([event.lngLat.lng,event.lngLat.lat]);return}
      const ids=['jou-building-fill','jou-sport-fill','jou-water-fill'].filter(id=>map.getLayer(id))
      if(!ids.length)return
      const found=map.queryRenderedFeatures(event.point,{layers:ids}).find(f=>f.properties?.name)
      if(!found?.properties?.name || !p.campus)return
      const prop=found.properties
      p.onSelect({id:-300000000000-Number(prop.osm_id||0),campus_id:p.campus.id,name:prop.name,category:prop.kind==='sport'?'运动场':prop.kind==='water'?'打卡':'校园建筑',lng:event.lngLat.lng,lat:event.lngLat.lat,enabled:true,verification_status:'candidate',source_url:`https://www.openstreetmap.org/${prop.osm_type||'way'}/${prop.osm_id}`,note:'公开地图参考位置，名称和入口请以现场为准。此地点打卡保存在本机。'})
    })
    return()=>{resize.disconnect();markers.current.forEach(m=>m.remove());gps.current?.remove();pin.current?.remove();map.remove();mapRef.current=null}
  },[])
  useEffect(()=>{
    const m=mapRef.current;if(!m)return
    m.setStyle(props.illustrated?localStyle():props.realStyle)
    m.easeTo({pitch:props.illustrated?25:0,duration:duration()})
  },[props.illustrated,props.realStyle])
  useEffect(()=>{
    const controller=new AbortController();setGeometry(null)
    fetch(campusGeometryUrl(props.campus),{signal:controller.signal}).then(r=>{if(!r.ok)throw Error();return r.json()}).then((data:FeatureCollection)=>{if(data.type!=='FeatureCollection')throw Error();setGeometry(campusArtGeometry(data))}).catch(e=>{if(e.name!=='AbortError')setIssue('该校区手绘资料暂不可用，请切换真实地图。')})
    const campus=props.campus
    if(campus?.center_lng!=null&&campus.center_lat!=null)mapRef.current?.flyTo({center:[campus.center_lng,campus.center_lat],zoom:campus.name.includes('苍梧')?16.3:16.1,duration:duration()})
    return()=>controller.abort()
  },[props.campus?.id])
  useEffect(()=>{
    const m=mapRef.current;if(!m?.isStyleLoaded()||!props.illustrated||!geometry)return
    if(m.getSource('jou-campus-geometry'))(m.getSource('jou-campus-geometry') as GeoJSONSource).setData(geometry)
    else installJouCampusGeometry(m,geometry)
  },[geometry,ready,props.illustrated])
  useEffect(()=>{
    if(!props.visible)return
    mapRef.current?.resize()
  },[props.visible])
  useEffect(()=>{
    const map=mapRef.current;if(!map)return
    markers.current.forEach(marker=>marker.remove())
    const priority=(poi:CampusPoi)=>poi.id===props.selectedPoi?.id?100:poi.verification_status==='verified'?50:/图书|食堂|餐厅|门|操场|体育/.test(poi.name)?20:0
    const ordered=[...props.pois].sort((a,b)=>priority(b)-priority(a))
    markers.current=ordered.map(poi=>{
      const category=MAP_CATEGORIES.find(c=>c.label===poiCategory(poi.category))!
      const button=document.createElement('button');button.type='button';button.className=`${s.poiMarker} ${props.selectedPoi?.id===poi.id?s.selected:''}`;button.style.setProperty('--pin-color',category.color);button.setAttribute('aria-label',`查看地点：${poi.name}`)
      button.innerHTML=`<span class="${s.pinHead}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="${MAP_ICONS[category.icon]}"/></svg></span>`
      const label=document.createElement('span');label.className=s.pinLabel;label.textContent=poi.name;button.append(label)
      button.addEventListener('click',event=>{event.stopPropagation();if(!latest.current.picking)latest.current.onSelect(poi)})
      return new Marker({element:button,anchor:'bottom'}).setLngLat([poi.lng,poi.lat]).addTo(map)
    })
    const place=()=>{
      const accepted:Array<{x:number;y:number}>=[],size=map.getContainer(),zoom=map.getZoom(),gap=zoom<16?78:zoom<17?65:42
      markers.current.forEach((marker,index)=>{
        const p=map.project(marker.getLngLat()),selected=ordered[index]?.id===latest.current.selectedPoi?.id
        const visible=selected||(p.x>0&&p.y>20&&p.x<size.clientWidth-42&&p.y<size.clientHeight-24&&!accepted.some(a=>Math.abs(a.x-p.x)<gap&&Math.abs(a.y-p.y)<64))
        marker.getElement().style.display=visible?'flex':'none'
        if(visible)accepted.push(p)
      })
    }
    place();map.on('move',place);map.on('resize',place)
    return()=>{map.off('move',place);map.off('resize',place);markers.current.forEach(marker=>marker.remove());markers.current=[]}
  },[props.pois,props.selectedPoi?.id])
  useEffect(()=>{if(props.selectedPoi)focus(props.selectedPoi)},[props.selectedPoi?.id])
  useEffect(()=>{
    const m=mapRef.current;if(!m?.isStyleLoaded())return
    const data=props.userLocation?locationAccuracyFeature(props.userLocation):{type:'FeatureCollection' as const,features:[]}
    const source=m.getSource('user-accuracy') as GeoJSONSource|undefined
    if(source)source.setData(data)
    else{m.addSource('user-accuracy',{type:'geojson',data});m.addLayer({id:'user-accuracy-fill',type:'fill',source:'user-accuracy',paint:{'fill-color':'#238b73','fill-opacity':.12}});m.addLayer({id:'user-accuracy-line',type:'line',source:'user-accuracy',paint:{'line-color':'#238b73','line-width':1}})}
    gps.current?.remove();gps.current=null
    if(!props.userLocation)return
    const pos=props.userLocation,element=document.createElement('div');element.className=s.meMarker;element.setAttribute('aria-label','我的位置')
    element.innerHTML=`${foxPoseSvgMarkup('cool','ohu-map-me-crop')}<span></span><b>我在这里</b>`
    gps.current=new Marker({element,anchor:'bottom',offset:[0,-2]}).setLngLat([pos.lng,pos.lat]).addTo(m)
  },[props.userLocation,ready])
  useEffect(()=>{const p=props.userLocation;if(p)mapRef.current?.flyTo({center:[p.lng,p.lat],zoom:locationZoom(p.accuracy),duration:duration()})},[props.userLocation])
  useEffect(()=>{pin.current?.remove();pin.current=null;if(props.pin && mapRef.current)pin.current=new Marker({color:'#ee8643'}).setLngLat(props.pin).addTo(mapRef.current)},[props.pin])
  return <><div ref={el} className={`${s.canvas} ${props.picking?s.picking:''}`} aria-label={`${props.campus?.name||'江苏海洋大学'}${props.illustrated?'手绘':'真实'}地图，可拖动缩放`} />{issue?<div className={s.mapIssue} role="status">{issue}</div>:null}</>
})
