import { cbRdb } from './cb'
import { currentActor } from './social-actor'
import { captureImSession, currentImSession } from './im-session'
import type { MutateRes, QueryRes } from './market'

export type CampusSchool = { id: string; name: string; city: string; map_style_url: string | null; enabled: boolean }
export type Campus = { id: number; school_id: string; name: string; center_lng: number | null; center_lat: number | null; enabled: boolean }
export type CampusPoi = { id: number; campus_id: number; name: string; category: string; lng: number; lat: number; enabled: boolean; source_url?: string | null; source_license?: string | null; verification_status?: 'candidate' | 'verified' | 'local' | null; note?: string; image_urls?: string[]; local_photo_count?: number }
export type CampusPoiCheckin = { id: number; poi_id: number; user_uid: string; note: string; is_public: boolean; status: 'private' | 'pending' | 'published' | 'hidden'; created_at: string }
export type CampusPoiSubmission = { id: number; campus_id: number; user_uid: string; name: string; category: string; lng: number; lat: number; note: string; image_urls?: string[]; status: 'pending' | 'approved' | 'rejected'; created_at: string }
export type CampusPost = { id: number; school_id: string; campus_id: number | null; poi_id: number | null; author_uid: string; author_name: string; author_avatar: string; body: string; image_urls: string[]; created_at: string; like_count: number; liked: boolean }
export type CampusComment = { id: number; post_id: number; user_uid?: string; body: string; created_at: string }
type Any = any
const schoolsSeed = [
  ['lyg', '连云港全城'],
  ['jou', '江苏海洋大学'], ['nmukd', '南京医科大学康达学院'], ['lygsf', '连云港师范学院'],
  ['lygtc', '连云港职业技术学院'], ['jscfa', '江苏财会职业学院'],
]
function errorText(e: any): string { return e?.message || e?.msg || '请求失败，请稍后重试' }
function resError(e: any): string | null { return e?.message || e?.msg || null }
function signedActor() { const actor = currentActor(); const ticket = actor ? captureImSession(actor.uid) : null; return actor && ticket ? { actor, ticket } : null }
function stillCurrent(ticket: any) { return currentImSession(ticket) }

export async function fetchCampusSchools(): Promise<QueryRes<CampusSchool>> {
  try {
    const r: Any = await (cbRdb().from('campus_schools') as Any).select('id,name,city,map_style_url,enabled').eq('enabled', true).order('name')
    if (r.error) return { rows: [], error: resError(r.error) }
    const data = Array.isArray(r.data) ? r.data : []
    return { rows: data.length ? data : schoolsSeed.map(([id, name]) => ({ id, name, city: '待核实', map_style_url: null, enabled: true })), error: null }
  } catch (e) { return { rows: [], error: errorText(e) } }
}
export async function fetchCampuses(schoolId: string): Promise<QueryRes<Campus>> {
  try { const r: Any = await (cbRdb().from('campus_campuses') as Any).select('*').eq('school_id', schoolId).eq('enabled', true).order('name'); return { rows: Array.isArray(r.data) ? r.data : [], error: resError(r.error) } }
  catch (e) { return { rows: [], error: errorText(e) } }
}
export async function fetchCampusPois(campusId: number): Promise<QueryRes<CampusPoi>> {
  try { const r: Any = await (cbRdb().from('campus_pois') as Any).select('*').eq('campus_id', campusId).eq('enabled', true).order('name'); return { rows: Array.isArray(r.data) ? r.data : [], error: resError(r.error) } }
  catch (e) { return { rows: [], error: errorText(e) } }
}
export async function createCampusPoiCheckin(poiId: number, note: string, sharePublic: boolean): Promise<MutateRes> {
  const session = signedActor()
  if (!session) return { error: '请先登录后打卡' }
  const content = note.trim().slice(0, 240)
  try {
    const r: Any = await (cbRdb().from('campus_poi_checkins') as Any).insert({
      poi_id: poiId, user_uid: session.actor.uid, note: content,
      is_public: sharePublic, status: sharePublic ? 'pending' : 'private', created_at: new Date().toISOString(),
    })
    if (!stillCurrent(session.ticket)) return { error: '账号已切换，请重新确认打卡状态' }
    return { error: resError(r.error) }
  } catch (e) { return { error: errorText(e) } }
}
export async function fetchPendingCampusPoiCheckins(): Promise<QueryRes<CampusPoiCheckin>> {
  try { const r: Any = await (cbRdb().from('campus_poi_checkins') as Any).select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(200); return { rows: Array.isArray(r.data) ? r.data : [], error: resError(r.error) } }
  catch (e) { return { rows: [], error: errorText(e) } }
}
export async function setCampusPoiCheckinStatus(id: number, status: 'published' | 'hidden'): Promise<MutateRes> {
  try { const r: Any = await (cbRdb().from('campus_poi_checkins') as Any).update({ status }).eq('id', id).eq('is_public', true); return { error: resError(r.error) } }
  catch (e) { return { error: errorText(e) } }
}
export async function submitCampusPoi(input: { campusId: number; name: string; category: '美食' | '好玩' | '打卡'; lng: number; lat: number; note: string; images?: string[] }): Promise<MutateRes> {
  const session = signedActor()
  if (!session) return { error: '请先登录后提交地点' }
  if (!input.name.trim() || !Number.isFinite(input.lng) || !Number.isFinite(input.lat) || Math.abs(input.lng) > 180 || Math.abs(input.lat) > 90) return { error: '地点名称或坐标无效' }
  const images = input.images || []
  if (images.length > 3 || images.some(url => typeof url !== 'string' || url.length > 2048 || !/^https?:\/\//i.test(url))) return { error: '地点照片地址无效，请重新上传（最多 3 张）' }
  try {
    const r: Any = await (cbRdb().from('campus_poi_submissions') as Any).insert({
      campus_id: input.campusId, user_uid: session.actor.uid, name: input.name.trim().slice(0, 80),
      category: input.category, lng: input.lng, lat: input.lat, note: input.note.trim().slice(0, 240), status: 'pending', created_at: new Date().toISOString(),
      ...(images.length ? { image_urls: images } : {}),
    })
    if (!stillCurrent(session.ticket)) return { error: '账号已切换，请重新确认提交状态' }
    return { error: resError(r.error) }
  } catch (e) { return { error: errorText(e) } }
}
export async function fetchPendingCampusPoiSubmissions(): Promise<QueryRes<CampusPoiSubmission>> {
  try { const r: Any = await (cbRdb().from('campus_poi_submissions') as Any).select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(200); return { rows: Array.isArray(r.data) ? r.data : [], error: resError(r.error) } }
  catch (e) { return { rows: [], error: errorText(e) } }
}
export async function setCampusPoiSubmissionStatus(id: number, status: 'approved' | 'rejected'): Promise<MutateRes> {
  try { const r: Any = await (cbRdb().from('campus_poi_submissions') as Any).update({ status }).eq('id', id).eq('status', 'pending'); return { error: resError(r.error) } }
  catch (e) { return { error: errorText(e) } }
}
export async function fetchCampusPosts(schoolId: string, campusId?: number | null): Promise<QueryRes<CampusPost>> {
  const session = signedActor()
  try {
    let q: Any = (cbRdb().from('campus_posts') as Any).select('id,school_id,campus_id,poi_id,author_name,author_avatar,body,image_urls,created_at,like_count').eq('school_id', schoolId).eq('status', 'published').eq('audience', 'guest_public').order('created_at', { ascending: false }).limit(100)
    if (campusId) q = q.eq('campus_id', campusId)
    const r: Any = await q
    if (!stillCurrent(session?.ticket ?? null) && session) return { rows: [], error: '账号已切换，请重新加载' }
    if (r.error) return { rows: [], error: resError(r.error) }
    const rows = Array.isArray(r.data) ? r.data : []
    if (!session) return { rows: rows.map((v: any) => ({ ...v, liked: false })), error: null }
    const ids = rows.map((v: any) => Number(v.id)).filter(Boolean)
    if (!ids.length) return { rows: [], error: null }
    const likes: Any = await (cbRdb().from('campus_post_likes') as Any).select('post_id').eq('user_uid', session.actor.uid).in('post_id', ids)
    if (!stillCurrent(session.ticket)) return { rows: [], error: '账号已切换，请重新加载' }
    if (likes.error) return { rows: [], error: resError(likes.error) }
    const liked = new Set((Array.isArray(likes.data) ? likes.data : []).map((v: any) => Number(v.post_id)))
    return { rows: rows.map((v: any) => ({ ...v, liked: liked.has(Number(v.id)) })), error: null }
  } catch (e) { return { rows: [], error: errorText(e) } }
}
export async function createCampusPost(input: { schoolId: string; campusId: number | null; poiId: number | null; body: string; images: string[]; shareProfile: boolean }): Promise<MutateRes> {
  const session = signedActor()
  if (!session) return { error: '请先登录后发布' }
  if (!input.body.trim() && !input.images.length) return { error: '请填写内容或添加图片' }
  try {
    const r: Any = await (cbRdb().from('campus_posts') as Any).insert({ school_id: input.schoolId, campus_id: input.campusId, poi_id: input.poiId, author_uid: session.actor.uid, author_name: input.shareProfile ? (session.actor.name || '校园用户') : '校园用户', author_avatar: input.shareProfile ? session.actor.avatar : '', body: input.body.trim().slice(0, 1000), image_urls: input.images.slice(0, 6), audience: 'guest_public', status: 'pending', created_at: new Date().toISOString() })
    if (!stillCurrent(session.ticket)) return { error: '账号已切换，请重新确认发布状态' }
    return { error: resError(r.error) }
  } catch (e) { return { error: errorText(e) } }
}
export async function toggleCampusLike(post: CampusPost): Promise<MutateRes> {
  const session = signedActor()
  if (!session) return { error: '请先登录后互动' }
  try {
    const db: Any = cbRdb().from('campus_post_likes')
    const r: Any = post.liked ? await db.delete().eq('post_id', post.id).eq('user_uid', session.actor.uid) : await db.insert({ post_id: post.id, user_uid: session.actor.uid, created_at: new Date().toISOString() })
    if (!stillCurrent(session.ticket)) return { error: '账号已切换，请重新加载' }
    return { error: resError(r.error) }
  } catch (e) { return { error: errorText(e) } }
}
export async function fetchCampusComments(postId: number): Promise<QueryRes<CampusComment>> {
  try { const r: Any = await (cbRdb().from('campus_post_comments') as Any).select('id,post_id,body,status,created_at').eq('post_id', postId).eq('status', 'published').order('created_at', { ascending: true }).limit(100); return { rows: Array.isArray(r.data) ? r.data : [], error: resError(r.error) } }
  catch (e) { return { rows: [], error: errorText(e) } }
}
export async function createCampusComment(postId: number, body: string): Promise<MutateRes> {
  const session = signedActor(); if (!session) return { error: '请先登录后评论' }
  const content = body.trim().slice(0, 500); if (!content) return { error: '请先填写评论内容' }
  try { const r: Any = await (cbRdb().from('campus_post_comments') as Any).insert({ post_id: postId, user_uid: session.actor.uid, body: content, status: 'published', created_at: new Date().toISOString() }); if (!stillCurrent(session.ticket)) return { error: '账号已切换，请重新确认评论状态' }; return { error: resError(r.error) } }
  catch (e) { return { error: errorText(e) } }
}
export async function setCampusPostStatus(id: number, status: 'published' | 'hidden'): Promise<MutateRes> {
  try { const r: Any = await (cbRdb().from('campus_posts') as Any).update({ status, updated_at: new Date().toISOString() }).eq('id', id); return { error: resError(r.error) } }
  catch (e) { return { error: errorText(e) } }
}
export async function fetchModerationCampusPosts(): Promise<QueryRes<CampusPost & { status: string; audience: string }>> {
  try { const r: Any = await (cbRdb().from('campus_posts') as Any).select('*').order('created_at', { ascending: false }).limit(300); return { rows: Array.isArray(r.data) ? r.data : [], error: resError(r.error) } }
  catch (e) { return { rows: [], error: errorText(e) } }
}
export async function fetchCampusPostById(id: number): Promise<{ row: { author_uid: string; author_name: string } | null; error: string | null }> {
  try {
    const r: Any = await (cbRdb().from('campus_posts') as Any).select('author_uid,author_name').eq('id', id).maybeSingle()
    const error = resError(r?.error)
    return { row: error || !r?.data ? null : r.data, error }
  } catch (error) { return { row: null, error: errorText(error) } }
}
