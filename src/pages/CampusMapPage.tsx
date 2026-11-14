import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { PinPhotoPicker } from '../components/CampusPinPhotos'
import { preparePinPhotos, savePinPhotos, readPinPhotos } from '../lib/campus-map-photos'
import { getCurrentMapLocation, type MapLocation } from '../lib/campus-map-location'
import { isJouGuidePoi, jouCampusChoices, jouReferencePois, JOU_OFFICIAL_MAP } from '../lib/jou-campus-reference'
import { ImagePickButton } from '../components/ImageUploadField'
import { useAuth } from '../lib/auth'
import { useCampusPreference } from '../lib/use-campus-preference'
import { campusNameFromLabel, preferredCampusRow } from '../lib/campus-preference'
import { uploadImages } from '../lib/market'
import { saveLocalCampusCheckin } from '../lib/campus-map-local'
import { createCampusPoiCheckin, submitCampusPoi, fetchCampusPois, fetchCampuses, fetchCampusPosts, fetchCampusSchools, createCampusPost, toggleCampusLike, fetchCampusComments, createCampusComment, type Campus, type CampusComment, type CampusPoi, type CampusPost, type CampusSchool } from '../lib/campus-map'
import { submitReport } from '../lib/reports'
import { currentActor } from '../lib/social-actor'
import { useToast } from '../context/ToastContext'
import { CampusMapCanvas, type CampusMapHandle } from '../components/campus-map/CampusMapCanvas'
import { PoiDetailSheet } from '../components/campus-map/PoiDetailSheet'
import { MapIcon } from '../components/campus-map/MapIcons'
import { FoxSheetPose } from '../components/fox/FoxSheetPose'
import { filterMapPois, MAP_CATEGORIES, poiCategory, fetchCampusGuidePois, type MapCategory } from '../lib/campus-map-presentation'
import s from './CampusMapPage.module.css'
import { readLocalPins, saveLocalPin, mergeCampusPois, readLocalCampusCheckins, type LocalPin } from '../lib/campus-map-local'
import { saveSnapshotToJournal, journalOwnerOf } from '../lib/journal-snapshot'
import { localDateKey } from '../lib/chat-fortune'

const OPEN_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'
const CampusSandbox = lazy(() => import('../components/campus-map/CampusSandbox').then(m => ({ default: m.CampusSandbox })))
const CampusBuildingDirectory = lazy(() => import('../components/campus-map/CampusBuildingDirectory').then(m => ({ default: m.CampusBuildingDirectory })))

export function CampusMapPage() {
  const auth = useAuth(); const toast = useToast()
  const ownerUid = auth.isSigned ? auth.user?.uid || '' : ''
  const draftOwnerUid = useRef(ownerUid)
  const [schools, setSchools] = useState<CampusSchool[]>([]); const schoolId: string = 'jou'
  const [campuses, setCampuses] = useState<Campus[]>([])
  const { campus: currentCampus, setCampus } = useCampusPreference()
  const campusId = preferredCampusRow(campuses, currentCampus)?.id ?? null
  const [pois, setPois] = useState<CampusPoi[]>([]); const [localPois, setLocalPois] = useState<LocalPin[]>([]); const [posts, setPosts] = useState<CampusPost[]>([])
  const [view, setView] = useState<'map'|'list'>('map'); const [filter, setFilter] = useState<MapCategory>('全部'); const [selectedPoi, setSelectedPoi] = useState<CampusPoi | null>(null)
  const [query,setQuery] = useState('')
  const [mapPresentation, setMapPresentation] = useState<'illustrated'|'real'>('illustrated')
  const [loading, setLoading] = useState(true); const [error, setError] = useState('')
  const [compose, setCompose] = useState(false); const [body, setBody] = useState(''); const [poiId, setPoiId] = useState(''); const [files, setFiles] = useState<File[]>([]); const [busy, setBusy] = useState(false)
  const [shareProfile, setShareProfile] = useState(false); const [checkinOpen, setCheckinOpen] = useState(false); const [checkinNote, setCheckinNote] = useState(''); const [shareCheckin, setShareCheckin] = useState(false)
  const [pinForm, setPinForm] = useState(false); const [pinName, setPinName] = useState(''); const [pinCategory, setPinCategory] = useState<'美食'|'好玩'|'打卡'>('打卡'); const [pinCoords, setPinCoords] = useState(''); const [pinNote, setPinNote] = useState(''); const [submitPin, setSubmitPin] = useState(false); const [pickPoint, setPickPoint] = useState(false); const pickPointRef = useRef(false)
  const [pinPhotos, setPinPhotos] = useState<File[]>([]); const [locating, setLocating] = useState(false); const [locationMessage, setLocationMessage] = useState(''); const [locationError, setLocationError] = useState('')
  const [userLocation, setUserLocation] = useState<MapLocation | null>(null)
  const [savingJournal, setSavingJournal] = useState(false)
  const [sandboxOpen, setSandboxOpen] = useState(false)
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const locationAbort = useRef<AbortController | null>(null)
  const locationRequest = useRef(0); const positionRef = useRef<[number, number] | null>(null); const actionScope = useRef(''); actionScope.current = `${ownerUid}:${schoolId}:${campusId}`
  const actionGeneration = useRef(0)
  const hasUnsavedDraft = useRef(false)
  hasUnsavedDraft.current = Boolean(compose || body.trim() || files.length || shareProfile || checkinOpen || checkinNote.trim() || shareCheckin || pinForm || pinName.trim() || pinNote.trim() || pinPhotos.length)
  useEffect(() => () => { actionScope.current = ''; locationRequest.current++; locationAbort.current?.abort() }, [])
  useEffect(() => {
    actionGeneration.current++
    locationAbort.current?.abort(); locationRequest.current++
    setBusy(false); setPoiId(''); setCheckinOpen(false); setCheckinNote(''); setShareCheckin(false); setSelectedPoi(null)
    setLocating(false); setPinForm(false); setPinPhotos([]); setPinCoords(''); setPinName(''); setPinNote(''); setSubmitPin(false); setLocationMessage(''); setLocationError(''); setPickPoint(false); pickPointRef.current = false; positionRef.current = null
  }, [ownerUid, schoolId, campusId])
  useEffect(() => {
    const previousUid = draftOwnerUid.current
    if (previousUid !== ownerUid && hasUnsavedDraft.current) {
      toast.warn('账号已切换，未提交的地图草稿已清空，避免混入新账号。')
    }
    draftOwnerUid.current = ownerUid
    setCompose(false); setBody(''); setPoiId(''); setFiles([]); setShareProfile(false)
    setCheckinOpen(false); setCheckinNote(''); setShareCheckin(false); setSelectedPoi(null)
    setCommentsOpen([]); setComments({}); setCommentDraft({})
  }, [ownerUid])
  useEffect(() => { setUserLocation(null) }, [ownerUid])
  const [commentsOpen, setCommentsOpen] = useState<number[]>([]); const [comments, setComments] = useState<Record<number, CampusComment[]>>({}); const [commentDraft, setCommentDraft] = useState<Record<number, string>>({})
  const canvasRef = useRef<CampusMapHandle>(null)
  const school = schools.find(x => x.id === schoolId); const selectedCampus = campuses.find(x => x.id === campusId)
  const canIllustrate = selectedCampus?.name.includes('苍梧') === true
  const illustrated = canIllustrate && mapPresentation === 'illustrated'
  const directoryCampus = selectedCampus?.name.includes('通灌') ? 'tongguan' : selectedCampus?.name.includes('宋跳') ? 'songtiao' : selectedCampus?.name.includes('墟沟') ? 'xugou' : 'cangwu'
  const cloudCampusId = campusId != null && campusId > 0 ? campusId : null
  const localCheckinOnly = selectedPoi != null && (selectedPoi.verification_status === 'local' || isJouGuidePoi(selectedPoi))
  const mapStyleUrl = school?.map_style_url || OPEN_MAP_STYLE
  const visiblePois = useMemo(() => filterMapPois(pois,filter,query),[pois,filter,query])
  const postRequest = useRef(0)
  const loadPosts = useCallback(async () => { const request = ++postRequest.current; const scope = actionScope.current; setLoading(true); const r = await fetchCampusPosts(schoolId, cloudCampusId); if (request !== postRequest.current || scope !== actionScope.current) return; setLoading(false); setError(r.error || ''); setPosts(r.rows) }, [schoolId, cloudCampusId, campusId, ownerUid])
  useEffect(() => { void fetchCampusSchools().then(r => { setSchools(r.rows); if (r.error) setError(`${r.error}（请先应用校园地图数据库迁移）`) }) }, [])
  useEffect(() => { let live = true; setCampuses([]); setPois([]); setSelectedPoi(null); void fetchCampuses(schoolId).then(r => { if (!live) return; const rows = schoolId === 'jou' ? jouCampusChoices(r.rows) : r.rows; setCampuses(rows); if (!rows.length && r.error) setError(`${r.error}（地点范围尚未配置）`) }); return () => { live = false } }, [schoolId])
  useEffect(() => {
    let live=true
    setSelectedPoi(null);setPinForm(false);setCheckinOpen(false);setQuery('')
    const local=readLocalPins(ownerUid,schoolId,campusId),reference=jouReferencePois(selectedCampus)
    setLocalPois(local);setPois(mergeCampusPois(reference,local))
    if(!selectedCampus)return
    void Promise.all([fetchCampusGuidePois(selectedCampus),campusId!=null&&campusId>0?fetchCampusPois(campusId):Promise.resolve({rows:[] as CampusPoi[],error:null})]).then(([guide,cloud])=>{
      if(!live)return
      const names=new Set(cloud.rows.map(p=>p.name)),sources=new Set(cloud.rows.map(p=>p.source_url).filter(Boolean))
      const all=[...cloud.rows,...reference.filter(p=>!names.has(p.name)&&(!p.source_url||!sources.has(p.source_url)))]
      const known=new Set(all.map(p=>p.name)),knownSources=new Set(all.map(p=>p.source_url).filter(Boolean))
      all.push(...guide.filter(p=>!known.has(p.name)&&(!p.source_url||!knownSources.has(p.source_url))))
      setPois(mergeCampusPois(all,local))
      if(cloud.error)setError('共享地点暂时读取失败，仍可浏览公开地图参考位置。')
    })
    return()=>{live=false}
  },[schoolId,campusId,ownerUid,selectedCampus])
  useEffect(() => { void loadPosts() }, [loadPosts])
  const postCount = useMemo(() => posts.length, [posts])
  async function publish() {
    const actor = currentActor()
    if (!auth.isSigned || !ownerUid || actor?.uid !== ownerUid) { toast.err('请先登录后发布'); return }
    const generation = actionGeneration.current, scope = actionScope.current
    const stillCurrent = () => actionGeneration.current === generation && actionScope.current === scope && currentActor()?.uid === ownerUid
    setBusy(true)
    try {
      const uploaded = files.length ? await uploadImages(files, 'campus-posts') : { urls: [], error: null }
      if (!stillCurrent()) return
      if (uploaded.error) { toast.err(uploaded.error); return }
      const r = await createCampusPost({ schoolId, campusId: cloudCampusId, poiId: Number(poiId) > 0 ? Number(poiId) : null, body, images: uploaded.urls, shareProfile })
      if (!stillCurrent()) return
      if (r.error) { toast.err(r.error); return }
      toast('已提交，审核通过后会在校园圈展示'); setCompose(false); setBody(''); setFiles([]); setPoiId(''); setShareProfile(false)
    } catch (error) {
      if (stillCurrent()) toast.err(error instanceof Error ? error.message : '发布失败，请重试')
    } finally {
      if (actionGeneration.current === generation) setBusy(false)
    }
  }
  async function checkin() {
    if (!selectedPoi) return
    const actor = currentActor()
    if (!auth.isSigned || !ownerUid || actor?.uid !== ownerUid) { toast.err('请先登录后打卡'); return }
    const poi = selectedPoi, note = checkinNote.trim().slice(0, 240), share = shareCheckin
    if (selectedPoi.verification_status === 'local' || isJouGuidePoi(selectedPoi)) {
      try { saveLocalCampusCheckin(ownerUid, { poi_name: poi.name, lng: poi.lng, lat: poi.lat, note, created_at: new Date().toISOString() }); toast('本地打卡已保存，仅此设备可见'); setCheckinOpen(false); setCheckinNote(''); return } catch { toast.err('本地保存失败，请检查设备存储空间'); return }
    }
    const generation = actionGeneration.current, scope = actionScope.current
    const stillCurrent = () => actionGeneration.current === generation && actionScope.current === scope && currentActor()?.uid === ownerUid
    setBusy(true)
    try {
      const r = await createCampusPoiCheckin(poi.id, note, share)
      if (!stillCurrent()) return
      if (r.error) { toast.err(r.error); return }
      toast(share ? '打卡已保存，公开内容审核通过后展示' : '打卡已保存，仅自己可见'); setCheckinOpen(false); setCheckinNote(''); setShareCheckin(false)
    } catch (error) {
      if (stillCurrent()) toast.err(error instanceof Error ? error.message : '打卡保存失败，请重试')
    } finally {
      if (actionGeneration.current === generation) setBusy(false)
    }
  }
  async function saveVisitsToJournal() {
    if (savingJournal) return
    setSavingJournal(true)
    try {
      const today = localDateKey()
      const rows = readLocalCampusCheckins(ownerUid).filter(row => localDateKey(new Date(row.created_at)) === today)
      const body = rows.length ? `今日到访 ${rows.length} 处：\n${rows.map(row => '· ' + row.poi_name).join('\n')}` : '今天还没有本机到访记录，去地图上打卡吧。'
      await saveSnapshotToJournal(journalOwnerOf(auth.isSigned, auth.user?.uid), '地图 · 今日到访', body)
    } catch { toast.err('保存失败，请重试。') } finally { setSavingJournal(false) }
  }

  async function uploadPinForReview(row: LocalPin, scope: string, uid: string): Promise<string | null> {
    if (!cloudCampusId) return '此校区还没有配置云端地点范围，地点和照片可先保存在本机'
    const photos = row.local_photo_count ? await readPinPhotos(uid, row.id) : []
    if (photos.length !== (row.local_photo_count || 0)) return '本机照片不完整，请重新选择照片后提交'
    if (actionScope.current !== scope || currentActor()?.uid !== uid) return '账号或地点范围已变化，请重新提交'
    const uploaded = photos.length ? await uploadImages(photos, 'campus-pois') : { urls: [], error: null }
    if (uploaded.error) return uploaded.error
    if (actionScope.current !== scope || currentActor()?.uid !== uid) return '账号或地点范围已变化，请重新提交'
    const result = await submitCampusPoi({ campusId: cloudCampusId, name: row.name, category: row.category === '美食' || row.category === '好玩' ? row.category : '打卡', lng: row.lng, lat: row.lat, note: row.note || '', images: uploaded.urls })
    return result.error
  }
  async function savePin() {
    if (busy || locating) return
    if (!ownerUid || currentActor()?.uid !== ownerUid) { auth.openLogin('登录后添加自己的打卡点'); return }
    const pair = pinCoords.split(',').map(Number)
    if (!pinCoords || !pinName.trim() || pair.length !== 2 || !pair.every(Number.isFinite) || pair[0] < 118 || pair[0] > 120 || pair[1] < 33 || pair[1] > 36) { toast.err('请填写地点名称，并使用我的位置或在连云港地图上选点'); return }
    const scope = actionScope.current, uid = ownerUid, generation = actionGeneration.current
    const row: LocalPin = { id: -Date.now(), campus_id: campusId ?? 0, name: pinName.trim().slice(0,80), category: pinCategory, lng: pair[0], lat: pair[1], enabled: true, verification_status: 'local', note: pinNote.trim().slice(0,240), local_photo_count: pinPhotos.length }
    setBusy(true)
    try {
      const prepared = await preparePinPhotos(pinPhotos)
      if (actionScope.current !== scope || currentActor()?.uid !== uid) return
      await savePinPhotos(uid, row.id, prepared)
      if (actionScope.current !== scope || currentActor()?.uid !== uid) return
      saveLocalPin(uid, schoolId, row)
      const next = [...localPois, row].slice(-200)
      setLocalPois(next); setPois(current => mergeCampusPois(current.filter(p => p.verification_status !== 'local'), next)); setSelectedPoi(row); setPinForm(false)
      if (submitPin && cloudCampusId) {
        const error = await uploadPinForReview(row, scope, uid)
        if (actionScope.current !== scope) return
        if (error) toast.err(`地点和照片已保存在本机，但提交失败：${error}`)
        else toast('地点和照片已提交审核，通过后公开展示')
      } else toast('地点和照片已保存到本机，仅当前账号可见')
      resetPinDraft()
    } catch (e) { if (actionScope.current === scope) toast.err(e instanceof Error ? e.message : '保存失败，请检查设备空间后重试') }
    finally { if (actionGeneration.current === generation) setBusy(false) }
  }
  function resetPinDraft() { locationAbort.current?.abort(); locationAbort.current = null; locationRequest.current++; setLocating(false); setPinPhotos([]); setPinName(''); setPinCategory('打卡'); setPinCoords(''); setPinNote(''); setSubmitPin(false); setLocationError(''); setLocationMessage(''); setPickPoint(false); pickPointRef.current = false }
  async function submitSelectedLocalPin() {
    if (!selectedPoi || selectedPoi.verification_status !== 'local' || busy) return
    if (!auth.isSigned || !cloudCampusId) { toast.err(!auth.isSigned ? '请先登录后提交地点' : '此校区还没有配置云端地点范围，地点和照片已保存在本机'); return }
    const scope = actionScope.current, uid = ownerUid, generation = actionGeneration.current
    setBusy(true)
    try {
      const error = await uploadPinForReview(selectedPoi as LocalPin, scope, uid)
      if (actionScope.current !== scope) return
      if (error) toast.err(error); else toast('地点和照片已提交管理员审核')
    } catch (e) { if (actionScope.current === scope) toast.err(e instanceof Error ? e.message : '提交失败，请重试') }
    finally { if (actionGeneration.current === generation) setBusy(false) }
  }
  async function like(post: CampusPost) { const r = await toggleCampusLike(post); if (r.error) toast.err(r.error); else await loadPosts() }
  async function toggleComments(postId: number) { if (commentsOpen.includes(postId)) { setCommentsOpen(v => v.filter(id => id !== postId)); return }; const r = await fetchCampusComments(postId); if (r.error) toast.err(r.error); else { setComments(v => ({ ...v, [postId]: r.rows })); setCommentsOpen(v => [...v, postId]) } }
  async function comment(postId: number) { const r = await createCampusComment(postId, commentDraft[postId] || ''); if (r.error) { toast.err(r.error); return }; setCommentDraft(v => ({ ...v, [postId]: '' })); const c = await fetchCampusComments(postId); if (!c.error) setComments(v => ({ ...v, [postId]: c.rows })) }
  async function locateMe(forPin = false) {
    locationAbort.current?.abort()
    const controller = new AbortController(); locationAbort.current = controller
    const request = ++locationRequest.current, scope = actionScope.current
    setLocating(true); setLocationError(''); setLocationMessage('正在获取精确位置，请保持定位服务开启…'); setView('map'); setSelectedPoi(null)
    try {
      const position = await getCurrentMapLocation({ signal: controller.signal, onProgress: position => {
        if (request !== locationRequest.current || actionScope.current !== scope) return
        setUserLocation(position)
        setLocationMessage(`已找到位置 · 误差约 ${Math.max(1, Math.round(position.accuracy))} 米，正在提高精度…`)
      } })
      if (request !== locationRequest.current || actionScope.current !== scope) return
      const lngLat: [number, number] = [position.lng, position.lat]
      setUserLocation(position)
      positionRef.current = lngLat
      const accuracy = `误差约 ${Math.max(1, Math.round(position.accuracy))} 米`
      const nearby = position.lng >= 118 && position.lng <= 120 && position.lat >= 33 && position.lat <= 36
      setLocationMessage(`${position.approximate ? '已获取大致位置' : '已定位'} · ${accuracy}${nearby ? '；圆形范围表示定位误差' : '；你当前不在连云港附近，可返回校区全貌'}。位置不会自动上传。`)
      if (forPin) {
        if (!nearby) { setPinCoords(''); setLocationError('你目前不在连云港附近，请在地图上选择连云港的地点'); return }
        setPinCoords(`${position.lng.toFixed(6)},${position.lat.toFixed(6)}`)
        setLocationMessage(`已使用${position.approximate ? '大致' : '当前'}位置 · ${accuracy}${position.approximate ? '，保存前建议在地图上微调' : '，可在地图上调整'}`)
      }
    } catch (e) { if (request === locationRequest.current && actionScope.current === scope && !(e instanceof Error && e.name === 'AbortError')) { const message = e instanceof Error ? e.message : '定位失败，请在地图上选点'; setLocationMessage(''); setLocationError(message) } }
    finally { if (request === locationRequest.current) { setLocating(false); locationAbort.current = null } }
  }
  function cancelLocation() {
    locationRequest.current++; locationAbort.current?.abort(); locationAbort.current = null
    setLocating(false); setLocationError(''); setLocationMessage('已取消定位，可重新定位或在地图上选点。')
  }
  function chooseOnMap() {
    locationAbort.current?.abort(); locationAbort.current = null; locationRequest.current++; setLocating(false); setPinForm(false); setSelectedPoi(null); setView('map'); setPickPoint(true); pickPointRef.current = true
    document.getElementById('campus-map-canvas')?.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})
  }
  async function report(post: CampusPost) { const actor = currentActor(); if (!actor) { toast.err('请先登录后举报'); return }; const reason = window.prompt('请填写举报原因'); if (!reason?.trim()) return; const r = await submitReport({ reporterUid: actor.uid, targetType: 'campus_post', targetId: String(post.id), reason }); if (r.error) toast.err(r.error); else toast('举报已提交') }
  const requireLogin = () => { if(ownerUid)return true;auth.openLogin('登录后使用地图功能');return false }
  const addPin = () => { if(!requireLogin())return;setPinForm(true);setView('map') }
  const point = pinCoords.split(',').map(Number)
  const draftPoint: [number,number] | null = pinCoords && point.length===2 && point.every(Number.isFinite) ? [point[0],point[1]] : null
  return <main className={s.page}>
    <PageHeader title="校园地图" right={<Link className={s.headLink} to="/plaza">校园广场</Link>} />
    <section className={s.mapBrand}>
      <div><span className={s.eyebrow}>OHU · CAMPUS MAP</span><h2>和阿狐一起，探索校园</h2><p>每一个喜欢的地方，都值得记下来。</p></div>
      <FoxSheetPose pose="map" className={s.mapFox}/>
    </section>
    <div className={s.campusPicker} role="group" aria-label="选择江苏海洋大学校区">{campuses.map(x=><button type="button" key={x.id} aria-pressed={campusId===x.id} onClick={()=>{const name=campusNameFromLabel(x.name);if(name)setCampus(name)}}>{x.name.replace('校区','')}</button>)}</div>
    <label className={s.mapSearch}><MapIcon name="search"/><input type="search" value={query} onChange={e=>{setQuery(e.target.value);setSelectedPoi(null)}} placeholder="搜索地点、食堂、教学楼…" aria-label="搜索校园地点"/>{query?<button type="button" aria-label="清空地图搜索" onClick={()=>setQuery('')}><MapIcon name="close"/></button>:null}</label>
    <div className={s.categoryBar} role="group" aria-label="地点分类">{MAP_CATEGORIES.map(x=><button type="button" key={x.label} style={{'--category-color':x.color,'--category-bg':x.background} as import('react').CSSProperties} aria-pressed={filter===x.label} onClick={()=>{setFilter(x.label);setSelectedPoi(null)}}><MapIcon name={x.icon}/>{x.label}</button>)}</div>
    <div className={s.mapToolbar}><span>{selectedCampus?.name||'正在加载校区'}<small> · {visiblePois.length} 个地点</small></span><div role="group" aria-label="地图或地点列表"><button type="button" aria-pressed={view==='map'} onClick={()=>setView('map')}>地图</button><button type="button" aria-pressed={view==='list'} onClick={()=>setView('list')}>列表</button></div></div>
    <section id="campus-map-canvas" className={s.mapStage} hidden={view!=='map'}>
      <CampusMapCanvas ref={canvasRef} campus={selectedCampus} pois={visiblePois} illustrated={illustrated} realStyle={mapStyleUrl} visible={view==='map'} selectedPoi={selectedPoi} userLocation={userLocation} picking={pickPoint} pin={draftPoint} onSelect={setSelectedPoi} onPick={point=>{setPickPoint(false);setPinCoords(`${point[0].toFixed(6)},${point[1].toFixed(6)}`);setLocationMessage('已在地图上选好位置');setLocationError('');setPinForm(true)}}/>
      <div className={s.mapStyleSwitch} role="group" aria-label="地图显示风格"><button type="button" aria-pressed={illustrated} disabled={!canIllustrate} title={canIllustrate?undefined:'该校区内部地理资料仍需补齐，先使用真实地图'} onClick={()=>setMapPresentation('illustrated')}>手绘地图</button><button type="button" aria-pressed={!illustrated} onClick={()=>setMapPresentation('real')}>真实地图</button></div>
      <div className={s.floatingControls}><button type="button" disabled={locating} onClick={()=>void locateMe()}><MapIcon name="location"/><span>{locating?'定位中…':'我的位置'}</span></button><button type="button" onClick={addPin}><MapIcon name="plus"/><span>添加地点</span></button><button type="button" onClick={()=>canvasRef.current?.overview()}><MapIcon name="expand"/><span>校区全貌</span></button></div>
      {pickPoint?<div className={s.pickHint}>点击地图放置地点<button type="button" onClick={()=>{setPickPoint(false);setPinForm(true)}}>返回填写</button></div>:null}
    </section>
    {view==='list'?<section className={s.poiGrid} aria-label="校园地点列表">{visiblePois.length?visiblePois.map(p=><button className={s.poiCard} type="button" key={p.id} onClick={()=>{setSelectedPoi(p);setView('map')}}><span className={s.poiIcon}><MapIcon name={MAP_CATEGORIES.find(x=>x.label===poiCategory(p.category))!.icon}/></span><span><b>{p.name}</b><small>{p.category} · {p.verification_status==='verified'?'已核验':p.verification_status==='local'?'仅自己可见':'公开地图参考'}</small></span><i>查看 →</i></button>):<div className={s.state}>没有找到对应地点，试试其他分类或关键词。</div>}</section>:null}
    {selectedPoi&&view==='map'?<PoiDetailSheet poi={selectedPoi} uid={ownerUid} location={userLocation} busy={busy} canSubmit={!!cloudCampusId} onClose={()=>setSelectedPoi(null)} onCheckin={()=>{if(requireLogin())setCheckinOpen(true)}} onSubmit={()=>void submitSelectedLocalPin()} requireLogin={requireLogin}/>:null}
    {locationMessage||locationError?<div className={`${s.locationStatus} ${locationError?s.locationFailure:''}`} role="status"><span>{locationError||locationMessage}</span>{locating?<button type="button" onClick={cancelLocation}>取消定位</button>:locationError?<button type="button" onClick={()=>void locateMe()}>重新定位</button>:null}</div>:null}
    <button type="button" className={s.directoryEntry} onClick={() => setSandboxOpen(true)}><span><b>四校区 3D 沙盘</b><small>旋转查看建筑和地标</small></span><i>打开 →</i></button>
    <button type="button" className={s.directoryEntry} onClick={()=>setDirectoryOpen(true)}><span><b>校园建筑目录</b><small>四校区官方建筑名称、编号与院系速查</small></span><i>查阅 →</i></button>
    <details className={s.coverageNote}><summary><b>地图说明与数据来源</b><span>查看 ›</span></summary><p>建筑、道路和地点沿用公开地图坐标，树木和建筑高度用于手绘装饰。苍梧提供手绘样板；通灌和宋跳内部资料仍需补齐，先保留真实地图。候选地点名称与入口请以现场为准。</p><a href={JOU_OFFICIAL_MAP} target="_blank" rel="noreferrer">学校官方校园图 ↗</a></details>
    {error?<p className={s.sourceNote} role="status">{error}</p>:null}
    <div className={s.mapSecondaryActions}><button type="button" disabled={savingJournal} onClick={() => void saveVisitsToJournal()}>{savingJournal ? '正在保存…' : '记入手账'}</button><button type="button" onClick={()=>{if(requireLogin())setCompose(true)}}>发布校园动态</button><Link to="/plaza">看看校园广场 →</Link></div>
    <p className={s.sourceNote}>公开地图中的候选位置请以现场和官方信息为准。</p><div className={s.feedHead}><div><b>{school?.name || '校园动态'}</b><span>{selectedCampus ? ` · ${selectedCampus.name}` : ''} · {postCount} 条公开动态</span></div><Link to="/plaza">返回校园广场</Link></div>
    {loading ? <div className={s.state}>正在加载动态…</div> : error && !posts.length ? <div className={s.state}>动态数据暂不可用。请管理员确认校园地图数据库迁移已应用。</div> : !posts.length ? <div className={s.state}>这里还没有公开动态。你可以先发布一条，审核通过后展示。</div> : <div className={s.feed}>{posts.map(post => <article className={s.card} key={post.id}><header><span className={s.avatar}>{post.author_name.slice(0,1) || '校'}</span><div><b>{post.author_name}</b><time>{new Date(post.created_at).toLocaleString()}</time></div><button type="button" className={s.report} onClick={() => void report(post)}>举报</button></header><p>{post.body}</p>{post.image_urls?.length ? <div className={s.images}>{post.image_urls.map(url => <img key={url} src={url} alt="校园动态配图" loading="lazy" />)}</div> : null}<footer><button type="button" aria-pressed={post.liked} onClick={() => void like(post)}>{post.liked ? '♥ 已赞' : '♡ 点赞'} · {post.like_count}</button><button type="button" onClick={() => void toggleComments(post.id)}>评论</button><span>{pois.find(p => p.id === post.poi_id)?.name || selectedCampus?.name || '动态'}</span></footer>{commentsOpen.includes(post.id) ? <div className={s.comments}>{(comments[post.id] || []).map(c => <p key={c.id}><b>校园用户：</b>{c.body}</p>)}<div><input value={commentDraft[post.id] || ''} maxLength={500} onChange={e => setCommentDraft(v => ({ ...v, [post.id]: e.target.value }))} placeholder={auth.isSigned ? '写下评论…' : '登录后评论'} /><button type="button" onClick={() => void comment(post.id)}>发送</button></div></div> : null}</article>)}</div>}
    {compose ? <div className={s.scrim} onClick={e => { if (e.target === e.currentTarget) setCompose(false) }}><section className={s.modal} role="dialog" aria-modal="true" aria-labelledby="compose-title"><h2 id="compose-title">发布动态</h2><p className={s.publicNote}>发布内容会向所有人公开，审核通过后展示。默认不公开账号昵称和头像。</p><label>关联地点（可选）<select value={poiId} onChange={e => setPoiId(e.target.value)}><option value="">不关联地点</option>{pois.filter(p => p.id > 0).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><textarea value={body} onChange={e => setBody(e.target.value)} maxLength={1000} placeholder="分享校园生活…" /><label className={s.profileConsent}><input type="checkbox" checked={shareProfile} onChange={e => setShareProfile(e.target.checked)} />同时公开我的昵称和头像</label><div className={s.photoRow}><ImagePickButton label="添加图片" multiple disabled={busy || files.length >= 6} onPick={f => setFiles(v => [...v, ...f].slice(0,6))} /><span>{files.length}/6</span></div>{files.length ? <div className={s.fileNames}>{files.map(f=>f.name).join('、')}</div> : null}<div className={s.modalActions}><button type="button" onClick={() => setCompose(false)}>取消</button><button type="button" className={s.primary} disabled={busy} onClick={() => void publish()}>{busy ? '正在提交…' : '确认公开并提交审核'}</button></div></section></div> : null}
    {checkinOpen && selectedPoi ? <div className={s.scrim} onClick={e => { if (e.target === e.currentTarget) setCheckinOpen(false) }}><section className={s.modal} role="dialog" aria-modal="true" aria-labelledby="checkin-title"><span className={s.poiTag}>{selectedPoi.category}</span><h2 id="checkin-title">在 {selectedPoi.name} 打卡</h2><p className={s.publicNote}>{localCheckinOnly ? '本地点的打卡记录只保存在当前设备。' : '默认仅自己可见。勾选公开后，内容需审核通过才会展示。'}</p><textarea value={checkinNote} onChange={e => setCheckinNote(e.target.value)} maxLength={240} placeholder="记录一下这次到访…（选填）" />{!localCheckinOnly ? <label className={s.profileConsent}><input type="checkbox" checked={shareCheckin} onChange={e => setShareCheckin(e.target.checked)} />申请公开这条打卡</label> : null}<div className={s.modalActions}><button type="button" onClick={() => setCheckinOpen(false)}>取消</button><button type="button" className={s.primary} disabled={busy} onClick={() => void checkin()}>{busy ? '正在保存…' : '保存打卡'}</button></div></section></div> : null}
    {pinForm ? <div className={s.scrim} onClick={e => { if (e.target === e.currentTarget && !busy) { setPinForm(false); resetPinDraft() } }}><section className={s.modal} role="dialog" aria-modal="true" aria-labelledby="pin-title" aria-busy={busy}>
      <span className={s.poiTag}>我的打卡地点</span><h2 id="pin-title">把喜欢的地方记下来</h2>
      <div className={s.locationChoice}><b>地点位置</b><div><button type="button" className={s.primary} disabled={locating || busy} onClick={() => void locateMe(true)}>{locating ? '正在获取手机位置…' : '◎ 使用我的位置'}</button>{locating ? <button type="button" onClick={cancelLocation}>取消定位</button> : null}<button type="button" disabled={busy} onClick={chooseOnMap}>地图上选点</button></div><p role="status">{locationError || locationMessage || '允许定位后，一键选中你现在的位置。'}</p>{pinCoords ? <small>已选好位置</small> : null}<details><summary>手动填写坐标</summary><label>经度,纬度<input value={pinCoords} disabled={busy} onChange={e => { setPinCoords(e.target.value); setLocationMessage('已手动填写位置'); setLocationError('') }} placeholder="119.21,34.59" /></label></details></div>
      <label>地点名称<input value={pinName} maxLength={80} disabled={busy} onChange={e => setPinName(e.target.value)} placeholder="给这个地方起个名字" /></label>
      <label>地点类型<select value={pinCategory} disabled={busy} onChange={e => setPinCategory(e.target.value as '美食'|'好玩'|'打卡')}><option value="美食">美食</option><option value="好玩">好玩</option><option value="打卡">打卡点</option></select></label>
      <PinPhotoPicker files={pinPhotos} onChange={setPinPhotos} disabled={busy} />
      <label>备注（选填）<textarea value={pinNote} maxLength={240} disabled={busy} onChange={e => setPinNote(e.target.value)} placeholder="记下喜欢这里的理由…" /></label>
      {cloudCampusId && auth.isSigned ? <label className={s.profileConsent}><input type="checkbox" disabled={busy} checked={submitPin} onChange={e => setSubmitPin(e.target.checked)} />提交地点和照片供管理员审核，通过后公开</label> : <p className={s.sourceNote}>共享地点正在准备中；可以先保存到本机。</p>}
      <div className={s.modalActions}><button type="button" disabled={busy} onClick={() => { setPinForm(false); resetPinDraft() }}>取消</button><button type="button" className={s.primary} disabled={busy || locating} onClick={() => void savePin()}>{busy ? '正在保存…' : submitPin ? '保存并提交审核' : '保存到本机'}</button></div>
    </section></div> : null}
    {sandboxOpen ? <Suspense fallback={<p role="status">正在打开 3D 沙盘…</p>}><CampusSandbox initialCampus={directoryCampus} onClose={() => setSandboxOpen(false)} /></Suspense> : null}
    {directoryOpen ? <Suspense fallback={<div className={s.scrim}><div className={s.modal} role="status">正在打开建筑目录…</div></div>}><CampusBuildingDirectory onClose={()=>setDirectoryOpen(false)} initialCampus={directoryCampus}/></Suspense> : null}
  </main>
}


