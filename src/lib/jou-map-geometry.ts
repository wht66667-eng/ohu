import type { Map, LayerSpecification } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { treeSprite } from './campus-map-art'
export const JOU_GEOMETRY_LAYERS=['jou-campus-fill','jou-campus-boundary','jou-green-fill','jou-water-fill','jou-water-line','jou-sport-fill','jou-road-casing','jou-road-line','jou-building-fill','jou-building-ink','jou-tree','jou-geometry-label']
/** Coordinates are geographic; building heights and vegetation are visual decoration. */
export function installJouCampusGeometry(map:Map,data:FeatureCollection|string='/maps/jou-cangwu.geojson') {
  if(map.getSource('jou-campus-geometry')) return
  const font=map.getStyle().layers.find(l=>l.type==='symbol' && l.layout?.['text-font'])
  const textFont=font?.type==='symbol'?font.layout?.['text-font']:['Noto Sans Regular']
  map.addSource('jou-campus-geometry',{type:'geojson',data,attribution:'地图 © OpenStreetMap contributors · 树木与建筑高度为视觉装饰'})
  if(!map.hasImage('ohu-map-tree')) map.addImage('ohu-map-tree',treeSprite(),{pixelRatio:2})
  const layers:LayerSpecification[]=[
    {id:'jou-campus-fill',type:'fill',filter:['==',['get','kind'],'campus'],paint:{'fill-color':'#e7edcb'}},
    {id:'jou-campus-boundary',type:'line',filter:['==',['get','kind'],'campus'],paint:{'line-color':'#9eb780','line-width':2,'line-dasharray':[3,2],'line-opacity':.8}},
    {id:'jou-green-fill',type:'fill',filter:['==',['get','kind'],'green'],paint:{'fill-color':'#c9dea7','fill-outline-color':'#9db47a','fill-opacity':.8}},
    {id:'jou-water-fill',type:'fill',filter:['==',['get','kind'],'water'],paint:{'fill-color':'#a6dce3','fill-outline-color':'#7ebfca'}},
    {id:'jou-water-line',type:'line',filter:['==',['get','kind'],'water'],paint:{'line-color':'#e0f5e8','line-width':3,'line-opacity':.65}},
    {id:'jou-sport-fill',type:'fill',filter:['==',['get','kind'],'sport'],paint:{'fill-color':'#c4d69c','fill-outline-color':'#d39b84'}},
    {id:'jou-road-casing',type:'line',filter:['==',['get','kind'],'road'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#d4c39e','line-width':['interpolate',['linear'],['zoom'],14,3,17,9,20,18]}},
    {id:'jou-road-line',type:'line',filter:['==',['get','kind'],'road'],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#fff5dc','line-width':['interpolate',['linear'],['zoom'],14,2,17,7,20,14]}},
    {id:'jou-building-fill',type:'fill-extrusion',filter:['==',['get','kind'],'building'],paint:{'fill-extrusion-color':'#e7c79e','fill-extrusion-height':9,'fill-extrusion-base':0,'fill-extrusion-opacity':1,'fill-extrusion-vertical-gradient':true}},
    {id:'jou-building-ink',type:'line',filter:['==',['get','kind'],'building'],paint:{'line-color':'#a58c68','line-width':.75,'line-opacity':.5}},
    {id:'jou-tree',type:'symbol',minzoom:14.5,filter:['==',['get','kind'],'tree'],layout:{'icon-image':'ohu-map-tree','icon-size':['interpolate',['linear'],['zoom'],14,.55,17,1,19,1.3],'icon-allow-overlap':true,'icon-ignore-placement':true,'icon-anchor':'bottom'}},
    {id:'jou-geometry-label',type:'symbol',minzoom:16.2,filter:['all',['has','name'],['!=',['get','name'],''],['!=',['get','kind'],'campus'],['!=',['get','kind'],'road'],['!=',['get','kind'],'poi']],layout:{'text-field':['get','name'],'text-font':textFont,'text-size':11,'text-max-width':7,'text-padding':8},paint:{'text-color':'#385b48','text-halo-color':'#fffbee','text-halo-width':2}},
  ].map(layer=>({...layer,source:'jou-campus-geometry'})) as LayerSpecification[]
  for(const layer of layers) map.addLayer(layer)
}
export function setJouGeometryVisible(map:Map,visible:boolean) {
  for(const id of JOU_GEOMETRY_LAYERS) if(map.getLayer(id)) map.setLayoutProperty(id,'visibility',visible?'visible':'none')
}
