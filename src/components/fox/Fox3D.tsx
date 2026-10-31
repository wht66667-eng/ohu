import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import decoderJs from 'three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url'
import decoderWasm from 'three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url'
import { themeAssetUrl, useUiVariant } from '../../lib/ui-variant'
import { FoxAvatar } from './FoxAvatar'
import styles from './Fox3D.module.css'

export type Fox3DAnimation = 'idle' | 'wave' | 'loading' | 'success' | 'fail'
export interface Fox3DProps {
  animation?: Fox3DAnimation
  size?: number
  className?: string
  onInteraction?: () => void
}

/** Homepage starts with installed-pack artwork. 3D is a deliberate, reversible opt-in. */
export function Fox3D({animation='idle',size=160,className='',onInteraction}:Fox3DProps) {
  const variant=useUiVariant()
  const isV5=String(variant)==='immersive'
  const modelUrl=isV5?themeAssetUrl('fox.glb'):''
  const imageUrl=isV5?themeAssetUrl('mascot.png'):''
  const reduced=!!useReducedMotion()
  const [enabled,setEnabled]=useState(false)
  const [loading,setLoading]=useState(false)
  const [failed,setFailed]=useState('')
  const [imageFailed,setImageFailed]=useState(false)
  const host=useRef<HTMLDivElement>(null)
  const player=useRef<((name:Fox3DAnimation)=>void)|null>(null)
  const animationRef=useRef(animation);animationRef.current=animation
  const lowDevice=typeof navigator!=='undefined'&&((navigator.hardwareConcurrency>0&&navigator.hardwareConcurrency<=2)||((navigator as Navigator&{deviceMemory?:number}).deviceMemory||8)<=1)

  useEffect(()=>{setEnabled(false);setFailed('');setImageFailed(false)},[modelUrl,imageUrl])
  useEffect(()=>{if(reduced)setEnabled(false)},[reduced])
  useEffect(()=>{player.current?.(animation)},[animation])
  useEffect(()=>{
    const element=host.current
    // A theme pack owns its Blob URLs. Never fall back to a public model or revoke those URLs here.
    if(!enabled||!isV5||!modelUrl.startsWith('blob:')||reduced||lowDevice||!element)return
    let alive=true,raf=0,last=performance.now(),budget=0,animationDelta=0,frames=0,sampleTime=0,warmup=0
    let visible=true,renderer:THREE.WebGLRenderer|null=null,mixer:THREE.AnimationMixer|null=null,root:THREE.Object3D|null=null
    let resize:ResizeObserver|null=null,intersection:IntersectionObserver|null=null
    const abort=new AbortController(),draco=new DRACOLoader().setDecoderPath({js:decoderJs,wasm:decoderWasm}).setWorkerLimit(1)
    const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>()
    const actions=new Map<Fox3DAnimation,THREE.AnimationAction>();let active:THREE.AnimationAction|null=null
    const fail=(message:string)=>{if(!alive)return;setFailed(message);setEnabled(false);setLoading(false)}
    setLoading(true)
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(32,1,.02,20)
    const cleanupModel=(object:THREE.Object3D)=>object.traverse(part=>{
      if(!(part instanceof THREE.Mesh))return
      geometries.add(part.geometry)
      for(const mat of Array.isArray(part.material)?part.material:[part.material]){materials.add(mat);for(const value of Object.values(mat)){if(value instanceof THREE.Texture)textures.add(value)}}
    })
    const play=(name:Fox3DAnimation)=>{
      const next=actions.get(name);if(!next)return
      if(active&&active!==next)active.fadeOut(.18)
      next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1)
      const loop=name==='idle'||name==='loading'
      next.setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1);next.clampWhenFinished=true;next.fadeIn(.18).play();active=next
    }
    try{
      renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'})
      renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace
      renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.98;renderer.setClearColor(0,0)
      renderer.domElement.setAttribute('aria-hidden','true');element.appendChild(renderer.domElement)
      scene.add(new THREE.HemisphereLight('#fff3dd','#406b4d',.85))
      const key=new THREE.DirectionalLight('#fff2dd',1.5);key.position.set(-2,3,4);scene.add(key)
      const fill=new THREE.DirectionalLight('#e2efed',.50);fill.position.set(2,1.5,2);scene.add(fill)
      const rim=new THREE.DirectionalLight('#ffe4c4',.55);rim.position.set(1,2,-2);scene.add(rim)
      camera.position.set(.4,.08,2.25);camera.lookAt(0,0,0)
      resize=new ResizeObserver(entries=>{const rect=entries[0]?.contentRect;if(rect&&renderer&&rect.width>0&&rect.height>0){renderer.setSize(rect.width,rect.height,false);camera.aspect=rect.width/rect.height;camera.updateProjectionMatrix()}})
      resize.observe(element)
      const loader=new GLTFLoader().setDRACOLoader(draco)
      void fetch(modelUrl,{signal:abort.signal}).then(response=>{if(!response.ok)throw new Error('无法读取已安装模型');return response.arrayBuffer()}).then(bytes=>loader.parseAsync(bytes,'')).then(gltf=>{
        cleanupModel(gltf.scene)
        if(!alive){geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());return}
        root=gltf.scene;scene.add(root);root.updateMatrixWorld(true)
        const bounds=new THREE.Box3().setFromObject(root),center=bounds.getCenter(new THREE.Vector3()),height=bounds.getSize(new THREE.Vector3()).y
        root.position.sub(center);const scale=height?1.05/height:1;root.scale.multiplyScalar(scale);root.position.multiplyScalar(scale)
        mixer=new THREE.AnimationMixer(root)
        for(const clip of gltf.animations){if(['idle','wave','loading','success','fail'].includes(clip.name))actions.set(clip.name as Fox3DAnimation,mixer.clipAction(clip))}
        mixer.addEventListener('finished',event=>{if(event.action===active)play('idle')})
        player.current=play;play(animationRef.current);mixer.update(0);setLoading(false)
      }).catch(error=>{if(alive&&!abort.signal.aborted)fail(error instanceof Error?'阿狐先用插画陪你。':'三维互动暂时不可用。')})
      const render=()=>{
        if(!alive||document.hidden||!visible)return
        raf=requestAnimationFrame(render)
        const now=performance.now(),dt=Math.min(.075,(now-last)/1000);last=now;budget+=dt;animationDelta+=dt
        if(budget<1/30||!renderer)return
        const renderedDelta=animationDelta;animationDelta=0;budget%=1/30;mixer?.update(renderedDelta);renderer.render(scene,camera)
        if(!root)return
        warmup+=renderedDelta;sampleTime+=renderedDelta;frames++
        if(warmup>1.5&&sampleTime>4){if(frames/sampleTime<24){fail('阿狐先用插画陪你。');return}sampleTime=0;frames=0}
      }
      const resume=()=>{cancelAnimationFrame(raf);last=performance.now();budget=0;animationDelta=0;if(!document.hidden&&visible)raf=requestAnimationFrame(render)}
      document.addEventListener('visibilitychange',resume)
      intersection=new IntersectionObserver(entries=>{visible=!!entries[0]?.isIntersecting;resume()},{threshold:.01});intersection.observe(element)
      const lost=(event:Event)=>{event.preventDefault();fail('阿狐先用插画陪你。')}
      renderer.domElement.addEventListener('webglcontextlost',lost)
      raf=requestAnimationFrame(render)
      return()=>{
        alive=false;abort.abort();cancelAnimationFrame(raf);document.removeEventListener('visibilitychange',resume);resize?.disconnect();intersection?.disconnect();player.current=null
        mixer?.stopAllAction();if(mixer&&root)mixer.uncacheRoot(root);draco.dispose()
        geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose())
        if(renderer){renderer.domElement.removeEventListener('webglcontextlost',lost);renderer.dispose();renderer.domElement.remove()}scene.clear()
      }
    }catch{fail('阿狐先用插画陪你。');return()=>{alive=false;abort.abort();draco.dispose();resize?.disconnect();renderer?.dispose();renderer?.domElement.remove()}}
  },[enabled,isV5,modelUrl,reduced,lowDevice])

  if(!isV5)return null
  const canInteract=!!modelUrl&&modelUrl.startsWith('blob:')&&!reduced&&!lowDevice&&!failed
  const interact=()=>{if(enabled){player.current?.('wave');onInteraction?.()}else if(canInteract)setEnabled(true)}
  return <div className={`${styles.root} ${className}`} style={{width:size}} data-fox-3d data-mode={enabled?'model':'static'}>
    <button type="button" className={styles.stage} style={{height:size}} onClick={interact} aria-label={enabled?'和阿狐挥手打招呼':'查看阿狐的三维互动'} disabled={!enabled&&!canInteract}>
      {!enabled&&(imageUrl&&!imageFailed?<img src={imageUrl} alt="绿卫衣小狐狸" onError={()=>setImageFailed(true)}/>:<FoxAvatar pose="welcome" size={size} ring={false} alt="哦狐小狐狸"/>)}
      <div ref={host} className={styles.canvas}/>
      {enabled&&loading&&<span className={styles.status}>阿狐来了…</span>}
    </button>
    <button type="button" className={styles.toggle} disabled={!canInteract&&!enabled} aria-pressed={enabled} aria-label={enabled?'切换为静态插画':'开启三维互动'} onClick={()=>setEnabled(current=>!current)}>{enabled?'静态插画':'三维互动'}</button>
    {failed&&<p className={styles.notice} role="status">{failed}</p>}
  </div>
}
