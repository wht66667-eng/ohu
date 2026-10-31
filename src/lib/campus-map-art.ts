import type { FeatureCollection, Feature, Geometry, Position } from 'geojson'
function inside(point: Position, ring: Position[]): boolean {
  let yes=false
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j]
    if((a[1]>point[1])!==(b[1]>point[1]) && point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0]) yes=!yes
  }
  return yes
}
function inShape(point: Position, geometry: Geometry): boolean {
  if(geometry.type==='Polygon') return inside(point,geometry.coordinates[0]) && !geometry.coordinates.slice(1).some(r=>inside(point,r))
  if(geometry.type==='MultiPolygon') return geometry.coordinates.some(r=>inside(point,r[0]) && !r.slice(1).some(h=>inside(point,h)))
  return false
}
function nearRoad(point: Position, geometry: Geometry): boolean {
  const paths=geometry.type==='LineString'?[geometry.coordinates]:geometry.type==='MultiLineString'?geometry.coordinates:[]
  return paths.some(path=>path.slice(1).some((b,i)=>{
    const a=path[i],sx=.82,dx=(b[0]-a[0])*sx,dy=b[1]-a[1],px=(point[0]-a[0])*sx,py=point[1]-a[1]
    const t=Math.max(0,Math.min(1,(px*dx+py*dy)/(dx*dx+dy*dy||1)))
    return Math.hypot(px-t*dx,py-t*dy)<.000075
  }))
}
/** Decorative vegetation, not surveyed tree locations. Source feature geometry is never moved. */
export function campusArtGeometry(data: FeatureCollection): FeatureCollection {
  const boundary=data.features.find(f=>f.properties?.kind==='campus')
  if(!boundary) return data
  const coordinates: Position[]=[]
  function collect(value: unknown) {
    if(!Array.isArray(value)) return
    if(typeof value[0]==='number' && typeof value[1]==='number') coordinates.push(value as Position)
    else value.forEach(collect)
  }
  if('coordinates' in boundary.geometry) collect(boundary.geometry.coordinates)
  if(!coordinates.length) return data
  const west=Math.min(...coordinates.map(p=>p[0])),east=Math.max(...coordinates.map(p=>p[0]))
  const south=Math.min(...coordinates.map(p=>p[1])),north=Math.max(...coordinates.map(p=>p[1]))
  const blocked=data.features.filter(f=>['building','water','sport'].includes(f.properties?.kind))
  const roads=data.features.filter(f=>f.properties?.kind==='road'),trees:Feature[]=[]
  for(let y=south,row=0;y<north && trees.length<350;y+=.00029,row++) {
    for(let x=west,col=0;x<east && trees.length<350;x+=.00033,col++) {
      const jitter=Math.sin(row*91+col*37)*.000055,p=[x+jitter,y-jitter]
      if(!inShape(p,boundary.geometry)||blocked.some(f=>inShape(p,f.geometry))||roads.some(f=>nearRoad(p,f.geometry))) continue
      trees.push({type:'Feature',properties:{kind:'tree',decorative:true},geometry:{type:'Point',coordinates:p}})
    }
  }
  return {...data,features:[...data.features,...trees]}
}
export function treeSprite(): ImageData {
  const canvas=document.createElement('canvas');canvas.width=64;canvas.height=88
  const c=canvas.getContext('2d')!
  c.fillStyle='#39684b28';c.beginPath();c.ellipse(34,77,22,7,0,0,Math.PI*2);c.fill()
  c.strokeStyle='#92734c';c.lineWidth=5;c.lineCap='round';c.beginPath();c.moveTo(32,76);c.lineTo(32,41);c.stroke()
  for(const [x,y,r,color] of [[22,44,18,'#689b56'],[42,43,17,'#7ba55d'],[32,27,20,'#a2be6e'],[24,24,12,'#b4cd7d']] as const){c.fillStyle=color;c.beginPath();c.ellipse(x,y,r,r*1.18,0,0,Math.PI*2);c.fill()}
  return c.getImageData(0,0,64,88)
}
