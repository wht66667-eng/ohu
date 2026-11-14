import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { DialogLayer } from '../ui/DialogLayer'
import styles from './CampusSandbox.module.css'

type Building = { id: string; name: string; category: number; height: number; outline: number[]; detail: string; planned: boolean }
type Landmark = { id: string; name: string; point: number[]; detail: string }
type Campus = { id: string; title: string; boundary: number[]; roads: { width: number; line: number[] }[]; buildings: Building[]; landmarks: Landmark[] }

const palette = [0xd6ab75, 0xbb7c62, 0x7cb3aa, 0x81a871, 0xe5b677, 0xc59a80]
function points(values: number[]) {
  return Array.from({ length: values.length / 2 }, (_, index) => new THREE.Vector2(values[index * 2], -values[index * 2 + 1]))
}

function CampusScene({ campus, select, selected }: { campus: Campus; select: (id: string) => void; selected: string }) {
  const host = useRef<HTMLDivElement>(null)
  const highlight = useRef<((id: string) => void) | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => {
    const container = host.current
    if (!container) return
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true }) }
    catch { setUnavailable(true); return }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    container.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xeaf1e8)
    const camera = new THREE.PerspectiveCamera(42, 1, 1, 12000)
    const boundary = points(campus.boundary)
    const bounds = new THREE.Box2().setFromPoints(boundary)
    const center = bounds.getCenter(new THREE.Vector2())
    const span = bounds.getSize(new THREE.Vector2()).length()
    camera.position.set(center.x + span * .56, span * .78, -center.y + span * .66)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(center.x, 0, -center.y)
    controls.minDistance = 45
    controls.maxDistance = span * 3
    controls.maxPolarAngle = Math.PI * .48
    controls.update()
    scene.add(new THREE.HemisphereLight(0xfff7e8, 0x7b917e, 2.1))
    const sun = new THREE.DirectionalLight(0xffffff, 2)
    sun.position.set(150, 360, -180)
    scene.add(sun)

    const ground = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(boundary)), new THREE.MeshLambertMaterial({ color: 0xb5cba1, side: THREE.DoubleSide }))
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)
    const roadMaterial = new THREE.MeshLambertMaterial({ color: 0xe8e1d0 })
    for (const road of campus.roads) {
      const line = points(road.line)
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i]
        const distance = a.distanceTo(b)
        if (!distance) continue
        const roadMesh = new THREE.Mesh(new THREE.BoxGeometry(distance, 0.5, road.width), roadMaterial)
        roadMesh.position.set((a.x + b.x) / 2, .25, -(a.y + b.y) / 2)
        roadMesh.rotation.y = Math.atan2(b.y - a.y, b.x - a.x)
        scene.add(roadMesh)
      }
    }
    const markers: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>[] = []
    for (const building of campus.buildings) {
      const mesh = new THREE.Mesh(
        new THREE.ExtrudeGeometry(new THREE.Shape(points(building.outline)), { depth: Math.max(1, building.height), bevelEnabled: false }),
        new THREE.MeshLambertMaterial({ color: building.planned ? 0xb2ab9e : palette[building.category] ?? 0xd6ab75 }),
      )
      mesh.rotation.x = -Math.PI / 2
      mesh.userData.id = building.id
      markers.push(mesh)
      scene.add(mesh)
    }
    for (const landmark of campus.landmarks) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, 7, 12), new THREE.MeshLambertMaterial({ color: 0x347666 }))
      mesh.position.set(landmark.point[0], 3.5, landmark.point[1])
      mesh.userData.id = landmark.id
      markers.push(mesh)
      scene.add(mesh)
    }

    const render = () => renderer.render(scene, camera)
    const resize = () => {
      const width = container.clientWidth, height = container.clientHeight
      if (!width || !height) return
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
      render()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    controls.addEventListener('change', render)
    highlight.current = id => {
      for (const marker of markers) marker.material.emissive.setHex(marker.userData.id === id ? 0xa35e15 : 0)
      render()
    }
    let down: [number, number] | null = null
    const start = (event: PointerEvent) => { down = [event.clientX, event.clientY] }
    const end = (event: PointerEvent) => {
      if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 7) return
      const rect = renderer.domElement.getBoundingClientRect()
      const ray = new THREE.Raycaster()
      ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), camera)
      const hit = ray.intersectObjects(markers)[0]
      if (hit) select(hit.object.userData.id)
    }
    renderer.domElement.addEventListener('pointerdown', start)
    renderer.domElement.addEventListener('pointerup', end)
    resize()
    return () => {
      highlight.current = null
      observer.disconnect()
      controls.dispose()
      scene.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose() })
      ground.material.dispose()
      roadMaterial.dispose()
      for (const marker of markers) marker.material.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [campus, select])
  useEffect(() => { highlight.current?.(selected) }, [selected, campus])
  return <div className={styles.scene} ref={host} aria-label="校园 3D 模型">
    {unavailable ? <p>此设备暂时无法显示 3D，仍可在下方查阅建筑。</p> : null}
  </div>
}

export function CampusSandbox({ initialCampus, onClose }: { initialCampus: string; onClose: () => void }) {
  const [data, setData] = useState<Campus[]>([])
  const [campusId, setCampusId] = useState(initialCampus)
  const [selection, setSelection] = useState('')
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetch('/maps/jou-campus-sandbox.json', { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('地图读取失败'); return response.json() as Promise<Campus[]> })
      .then(campuses => { if (!controller.signal.aborted) setData(campuses) })
      .catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [attempt])
  const campus = data.find(item => item.id === campusId) ?? data[0]
  const places = campus ? [...campus.buildings, ...campus.landmarks] : []
  const selected = places.find(place => place.id === selection)

  return <DialogLayer full title="四校区 3D 沙盘" onClose={onClose}>
    <section className={styles.panel}>
      <header><h2>四校区 3D 沙盘</h2><button type="button" onClick={onClose}>返回地图</button></header>
      <p>拖动旋转，双指缩放，点建筑看用途。示意模型仅供浏览，实际位置请以校园地图为准。</p>
      {failed ? <p role="alert">无法加载沙盘。 <button type="button" onClick={() => { setFailed(false); setAttempt(n => n + 1) }}>重试</button></p> : null}
      {campus ? <>
        <div className={styles.tabs} role="group" aria-label="沙盘校区">{data.map(item => <button type="button" key={item.id} aria-pressed={item.id === campus.id} onClick={() => { setCampusId(item.id); setSelection('') }}>{item.title}</button>)}</div>
        <CampusScene key={campus.id} campus={campus} select={setSelection} selected={selection} />
        <label>查阅建筑或地标 <select value={selection} onChange={event => setSelection(event.target.value)}>
          <option value="">请选择</option>
          {places.map(place => <option key={place.id} value={place.id}>{place.name}</option>)}
        </select></label>
        {selected ? <article className={styles.detail} aria-live="polite"><h3>{selected.name}</h3><p>{selected.detail || '暂无用途说明'}</p>{'planned' in selected && selected.planned ? <small>规划建筑</small> : null}</article> : null}
      </> : !failed ? <p role="status">正在加载沙盘…</p> : null}
    </section>
  </DialogLayer>
}
