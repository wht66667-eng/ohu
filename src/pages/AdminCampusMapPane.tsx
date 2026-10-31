import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../context/ToastContext'
import { fetchModerationCampusPosts, fetchPendingCampusPoiCheckins, fetchPendingCampusPoiSubmissions, fetchCampusSchools, fetchCampuses, setCampusPoiCheckinStatus, setCampusPoiSubmissionStatus, setCampusPostStatus, type Campus, type CampusPoiCheckin, type CampusPoiSubmission, type CampusPost, type CampusSchool } from '../lib/campus-map'
import { PinPhotoGallery } from '../components/CampusPinPhotos'
import { useAuth } from '../lib/auth'
import s from './AdminCampusMapPane.module.css'

export function AdminCampusMapPane() {
  const auth = useAuth(); const toast = useToast()
  const [rows, setRows] = useState<(CampusPost & { status: string; audience: string })[]>([])
  const [checkins, setCheckins] = useState<CampusPoiCheckin[]>([])
  const [submissions, setSubmissions] = useState<CampusPoiSubmission[]>([])
  const [schools, setSchools] = useState<CampusSchool[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(0)
  const [schoolId, setSchoolId] = useState(''); const [styleUrl, setStyleUrl] = useState('')
  const [campuses, setCampuses] = useState<Campus[]>([]); const [campusName, setCampusName] = useState(''); const [campusCenter, setCampusCenter] = useState(''); const [poiName, setPoiName] = useState(''); const [poiCategory, setPoiCategory] = useState('好玩 · 景点'); const [poiCoords, setPoiCoords] = useState(''); const [campusId, setCampusId] = useState('')
  const load = useCallback(async () => { const [p, sc, ci, ps] = await Promise.all([fetchModerationCampusPosts(), fetchCampusSchools(), fetchPendingCampusPoiCheckins(), fetchPendingCampusPoiSubmissions()]); setRows(p.rows); setSchools(sc.rows); setCheckins(ci.rows); setSubmissions(ps.rows); setError(p.error || sc.error || ci.error || ps.error || '') }, [])
  useEffect(() => { void load() }, [load])
  useEffect(() => { const v = schools.find(x => x.id === schoolId)?.map_style_url || ''; setStyleUrl(v) }, [schools, schoolId])
  useEffect(() => { if (!schoolId) { setCampuses([]); return }; void fetchCampuses(schoolId).then(r => { setCampuses(r.rows); if (r.rows[0]) setCampusId(String(r.rows[0].id)) }) }, [schoolId])
  if (!auth.isSigned || !(auth.profile?.isAdmin || auth.profile?.isSuperAdmin)) return <div className={s.state}>需要管理员权限。</div>
  async function moderate(row: CampusPost & { status: string }, status: 'published'|'hidden') { setBusy(row.id); const r = await setCampusPostStatus(row.id, status); setBusy(0); if (r.error) toast.err(r.error); else { toast(status === 'published' ? '已通过并公开' : '已隐藏'); await load() } }
  async function moderateCheckin(row: CampusPoiCheckin, status: 'published'|'hidden') { setBusy(row.id); const r = await setCampusPoiCheckinStatus(row.id, status); setBusy(0); if (r.error) toast.err(r.error); else { toast(status === 'published' ? '打卡已公开' : '打卡已隐藏'); await load() } }
  async function reviewPoi(row: CampusPoiSubmission, status: 'approved'|'rejected') { setBusy(row.id); const r = await setCampusPoiSubmissionStatus(row.id, status); setBusy(0); if (r.error) toast.err(r.error); else { toast(status === 'approved' ? '地点已审核并加入地图' : '已驳回地点申请'); await load() } }
  async function saveStyle() {
    if (!schoolId) { toast.err('请先选择学校'); return }
    if (styleUrl && !/^https:\/\//i.test(styleUrl)) { toast.err('样式地址必须使用 HTTPS'); return }
    try { const db: any = (await import('../lib/cb')).cbRdb(); const r: any = await db.from('campus_schools').update({ map_style_url: styleUrl.trim() || null }).eq('id', schoolId); if (r.error) throw r.error; toast('底图样式地址已保存'); await load() }
    catch (e) { toast.err((e as any)?.message || '保存失败；请确认数据库迁移已应用') }
  }
  async function saveCampus() {
    if (!schoolId || !campusName.trim()) { toast.err('请填写学校和校区名称'); return }
    const pair = campusCenter.trim() ? campusCenter.split(',').map(Number) : []
    if (pair.length && (pair.length !== 2 || !Number.isFinite(pair[0]) || !Number.isFinite(pair[1]) || Math.abs(pair[0]) > 180 || Math.abs(pair[1]) > 90)) { toast.err('中心坐标请填经度,纬度，并先核验来源与坐标系'); return }
    try { const { cbRdb } = await import('../lib/cb'); const r: any = await cbRdb().from('campus_campuses').insert({ school_id: schoolId, name: campusName.trim(), center_lng: pair[0] ?? null, center_lat: pair[1] ?? null }); if (r.error) throw r.error; setCampusName(''); setCampusCenter(''); toast('校区已添加'); await load(); const rows = await fetchCampuses(schoolId); setCampuses(rows.rows) }
    catch (e) { toast.err((e as any)?.message || '添加失败；请检查迁移和坐标') }
  }
  async function savePoi() {
    const pair = poiCoords.split(',').map(Number)
    if (!campusId || !poiName.trim() || pair.length !== 2 || !pair.every(Number.isFinite) || Math.abs(pair[0]) > 180 || Math.abs(pair[1]) > 90) { toast.err('请填写校区、地点名称和已核实的经度,纬度'); return }
    try { const { cbRdb } = await import('../lib/cb'); const r: any = await cbRdb().from('campus_pois').insert({ campus_id: Number(campusId), name: poiName.trim(), category: poiCategory.trim() || '好玩 · 景点', lng: pair[0], lat: pair[1], verification_status: 'verified', verified_at: new Date().toISOString() }); if (r.error) throw r.error; setPoiName(''); setPoiCoords(''); toast('地点已添加并标记为已核验') }
    catch (e) { toast.err((e as any)?.message || '添加失败；请检查迁移和坐标') }
  }
  return <section className={s.wrap}>
    <header className={s.header}><div><h2>地图地点与校园圈</h2><p>维护各学校和连云港全城地点，核验坐标后即可在地图和地点列表展示。</p></div><button type="button" onClick={() => void load()}>刷新</button></header>
    {error ? <div className={s.notice}>云端数据暂不可用：{error}。首次设置地图请应用 docs/sql/campus-map-132.sql；连云港全城与打卡功能还需应用 docs/sql/campus-map-city-134.sql。</div> : null}
    <div className={s.listTitle}><h3>学生新增地点审核</h3><span>{submissions.length} 条待审核</span></div>
    {!submissions.length ? <div className={s.state}>暂无地点申请。管理员通过后，地点会加入对应范围的地图。</div> : <div className={s.list}>{submissions.map(row => <article className={s.card} key={`poi-${row.id}`}><header><b>{row.name} · {row.category}</b><time>{new Date(row.created_at).toLocaleString()}</time></header><p>坐标：{row.lng.toFixed(5)}, {row.lat.toFixed(5)}{row.note ? ` · ${row.note}` : ''}</p><PinPhotoGallery urls={row.image_urls || []} /><footer><button disabled={busy===row.id} onClick={() => void reviewPoi(row,'approved')}>审核通过并上图</button><button className={s.hide} disabled={busy===row.id} onClick={() => void reviewPoi(row,'rejected')}>驳回</button></footer></article>)}</div>}
    <section className={s.config}><h3>底图配置</h3><div className={s.fields}><label>学校<select value={schoolId} onChange={e => setSchoolId(e.target.value)}><option value="">选择学校</option>{schools.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label>MapLibre 样式 HTTPS 地址<input value={styleUrl} onChange={e => setStyleUrl(e.target.value)} placeholder="https://…/style.json" /></label><button type="button" onClick={() => void saveStyle()}>保存样式地址</button></div><small>只填写已验收且允许用于该项目的样式地址；校区与地点坐标必须先核实来源、坐标系和位置。</small>
      <h3 className={s.subhead}>新增地点范围</h3><div className={s.fields}><label>范围名称<input value={campusName} onChange={e => setCampusName(e.target.value)} placeholder="例如：连云港全域" /></label><label>范围中心（经度,纬度；可留空）<input value={campusCenter} onChange={e => setCampusCenter(e.target.value)} placeholder="119.xxx,34.xxx" /></label><button type="button" onClick={() => void saveCampus()}>添加范围</button></div>
      <h3 className={s.subhead}>新增地图标点</h3><div className={s.fields}><label>所属范围<select value={campusId} onChange={e => setCampusId(e.target.value)}><option value="">选择范围</option>{campuses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>地点名称<input value={poiName} onChange={e => setPoiName(e.target.value)} placeholder="地点名称" /></label><label>类型<input value={poiCategory} onChange={e => setPoiCategory(e.target.value)} placeholder="美食 · 海鲜 / 好玩 · 景点" /></label><label>坐标（经度,纬度）<input value={poiCoords} onChange={e => setPoiCoords(e.target.value)} placeholder="119.xxx,34.xxx" /></label><button type="button" onClick={() => void savePoi()}>核验并添加</button></div></section>
    <div className={s.listTitle}><h3>公开打卡审核</h3><span>{checkins.length} 条</span></div>
    {!checkins.length ? <div className={s.state}>暂无待审核的公开打卡。</div> : <div className={s.list}>{checkins.map(row => <article className={s.card} key={`checkin-${row.id}`}><header><b>地点打卡 · 待审核</b><time>{new Date(row.created_at).toLocaleString()}</time></header><p>地点编号：{row.poi_id}{row.note ? ` · ${row.note}` : ' · 未填写留言'}</p><footer><button disabled={busy===row.id} onClick={() => void moderateCheckin(row,'published')}>通过公开</button><button className={s.hide} disabled={busy===row.id} onClick={() => void moderateCheckin(row,'hidden')}>隐藏</button></footer></article>)}</div>}
    <div className={s.listTitle}><h3>公开动态审核</h3><span>{rows.length} 条</span></div>
    {!rows.length ? <div className={s.state}>暂无动态，或校园地图迁移尚未应用。</div> : <div className={s.list}>{rows.map(row => <article className={s.card} key={row.id}><header><b>{row.author_name} · {row.status === 'pending' ? '待审核' : row.status === 'published' ? '已公开' : '已隐藏'}</b><time>{new Date(row.created_at).toLocaleString()}</time></header><p>{row.body || '（图片动态）'}</p>{row.image_urls?.length ? <div className={s.images}>{row.image_urls.map(url => <img key={url} src={url} alt="待审核动态配图" loading="lazy" />)}</div> : null}<footer>{row.status !== 'published' ? <button disabled={busy===row.id} onClick={() => void moderate(row,'published')}>通过并公开</button> : null}{row.status !== 'hidden' ? <button className={s.hide} disabled={busy===row.id} onClick={() => void moderate(row,'hidden')}>隐藏</button> : null}</footer></article>)}</div>}
  </section>
}
