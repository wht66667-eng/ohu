/** 朋友圈：按已登录账号隔离读取、发布与互动；最终可见性由数据库 RLS 决定。 */
import { cbRdb } from './cb'
import { currentActor } from './social-actor'
import { captureImSession, currentImSession } from './im-session'
import { positiveRecordId } from './async-owner'
import { fmtTime } from './market'

export interface Moment {
  id: number; creator_uid: string; creator_name: string; creator_avatar?: string
  body: string; media_urls?: string[]; media_type?: 'image' | 'video' | 'mixed'; created_at: string
  likes_count?: number; comments_count?: number; liked_by_me?: boolean
  visibility?: 'public' | 'friends_only' | 'private'
}
export interface MomentLike { id: number; moment_id: number; liker_uid: string; liker_name: string; created_at: string }
export interface MomentComment { id: number; moment_id: number; commenter_uid: string; commenter_name: string; body: string; created_at: string }
export interface QueryRes<T> { rows: T[]; error: string | null }
export interface MutateRes { error: string | null; id?: number }
const BAD_WORDS = ['赌博', '色情', '约炮', '代考', '办证', '枪支', '毒品']
const changed = '账号已变化，请重新操作'
function capture() {
  const actor = currentActor(), session = actor ? captureImSession(actor.uid) : null
  return actor && session ? { actor, session } : null
}
type Work = NonNullable<ReturnType<typeof capture>>
function current(work: Work) { return currentImSession(work.session) && currentActor()?.uid === work.actor.uid }
function errText(error: unknown): string {
  if (typeof error === 'string') return error || '操作失败，请稍后重试'
  const value = error as { message?: string; msg?: string } | null
  return value?.message || value?.msg || '操作失败，请稍后重试'
}
export function momentsModerationBlock(text: string): string | null {
  const value = text.trim()
  if (!value) return '内容不能为空'
  if (value.length > 1000) return '内容不能超过 1000 字'
  return BAD_WORDS.some(word => value.includes(word)) ? '内容含有不当用语，请修改后再发' : null
}
export function fmtMomentsTime(iso?: string) { return fmtTime(iso) }
async function markLikedByMe(list: Moment[], work: Work) {
  if (!list.length || !current(work)) return
  const result = await cbRdb().from('moments_likes').select('moment_id').eq('liker_uid', work.actor.uid).in('moment_id', list.map(row => row.id))
  if (!current(work) || result.error) return
  const liked = new Set(((result.data || []) as unknown as MomentLike[]).map(row => Number(row.moment_id)))
  list.forEach(row => { row.liked_by_me = liked.has(Number(row.id)) })
}
async function readMoments(limit = 100, friendUids?: string[], id?: number): Promise<QueryRes<Moment>> {
  const work = capture()
  if (!work) return { rows: [], error: '请先登录查看朋友圈' }
  if (friendUids && !friendUids.length) return { rows: [], error: null }
  try {
    let query = cbRdb().from('moments').select('*')
    if (friendUids) query = query.in('creator_uid', friendUids)
    if (id) query = query.eq('id', id)
    const result = await query.order('created_at', { ascending: false }).limit(Math.max(1, Math.min(100, Math.floor(limit) || 100)))
    if (!current(work)) return { rows: [], error: changed }
    if (result.error) return { rows: [], error: errText(result.error) }
    const rows = ((result.data || []) as unknown as Moment[]).filter(row => positiveRecordId(row.id)).map(row => ({ ...row }))
    try { await markLikedByMe(rows, work) } catch { /* feed remains usable */ }
    return current(work) ? { rows, error: null } : { rows: [], error: changed }
  } catch (error) { return { rows: [], error: current(work) ? errText(error) : changed } }
}
export function fetchMoments(limit = 100) { return readMoments(limit) }
export function fetchFriendsMoments(friendUids: string[], limit = 100) { return readMoments(limit, friendUids) }
export function fetchMoment(id: number): Promise<QueryRes<Moment>> {
  return positiveRecordId(id) ? readMoments(1, undefined, id) : Promise.resolve({ rows: [], error: '动态不存在' })
}
export async function createMoment(body: string, media_urls: string[] = [], media_type: 'image' | 'video' | 'mixed' = 'image', visibility: 'public' | 'friends_only' | 'private' = 'friends_only'): Promise<MutateRes> {
  const work = capture()
  if (!work) return { error: '请先登录' }
  const validation = body.trim() ? momentsModerationBlock(body) : media_urls.length ? null : '内容不能为空'
  if (validation) return { error: validation }
  if (!['public', 'friends_only', 'private'].includes(visibility)) return { error: '请选择可见范围' }
  if (media_urls.length > 9 || media_urls.some(url => typeof url !== 'string' || !/^https?:\/\//i.test(url))) return { error: '最多添加 9 张有效图片' }
  try {
    const result = await cbRdb().from('moments').insert({ creator_uid: work.actor.uid, creator_name: work.actor.name, creator_avatar: work.actor.avatar,
      body: body.trim(), media_urls, media_type, visibility, created_at: new Date().toISOString() }).select('id')
    if (!current(work)) return { error: changed }
    if (result.error) return { error: errText(result.error) }
    const id = positiveRecordId((result.data as unknown as { id: number }[] | null)?.[0]?.id)
    return id ? { error: null, id } : { error: '未确认动态发布成功，请刷新查看后再试' }
  } catch (error) { return { error: current(work) ? errText(error) : changed } }
}
export async function deleteMoment(id: number): Promise<MutateRes> {
  const work = capture()
  if (!work) return { error: '请先登录' }
  if (!positiveRecordId(id)) return { error: '动态不存在' }
  try {
    const result = await cbRdb().from('moments').delete().eq('id', id).eq('creator_uid', work.actor.uid).select('id')
    if (!current(work)) return { error: changed }
    if (result.error) return { error: errText(result.error) }
    return (result.data as unknown as { id: number }[] | null)?.some(row => Number(row.id) === id) ? { error: null } : { error: '动态不存在或已删除，请刷新列表' }
  } catch (error) { return { error: current(work) ? errText(error) : changed } }
}
export async function likeMoment(momentId: number): Promise<MutateRes> {
  const work = capture()
  if (!work) return { error: '请先登录' }
  if (!positiveRecordId(momentId)) return { error: '动态不存在' }
  try {
    const existing = await cbRdb().from('moments_likes').select('id').eq('moment_id', momentId).eq('liker_uid', work.actor.uid).limit(1)
    if (!current(work)) return { error: changed }
    if (existing.error) return { error: errText(existing.error) }
    if ((existing.data || []).length) return { error: null }
    const result = await cbRdb().from('moments_likes').insert({ moment_id: momentId, liker_uid: work.actor.uid, liker_name: work.actor.name, created_at: new Date().toISOString() })
    if (!current(work)) return { error: changed }
    return { error: result.error ? errText(result.error) : null }
  } catch (error) { return { error: current(work) ? errText(error) : changed } }
}
export async function unlikeMoment(momentId: number): Promise<MutateRes> {
  const work = capture()
  if (!work) return { error: '请先登录' }
  if (!positiveRecordId(momentId)) return { error: '动态不存在' }
  try {
    const result = await cbRdb().from('moments_likes').delete().eq('moment_id', momentId).eq('liker_uid', work.actor.uid)
    if (!current(work)) return { error: changed }
    return { error: result.error ? errText(result.error) : null }
  } catch (error) { return { error: current(work) ? errText(error) : changed } }
}
export async function commentMoment(momentId: number, body: string): Promise<MutateRes> {
  const work = capture()
  if (!work) return { error: '请先登录' }
  if (!positiveRecordId(momentId)) return { error: '动态不存在' }
  const validation = momentsModerationBlock(body)
  if (validation) return { error: validation }
  try {
    const result = await cbRdb().from('moments_comments').insert({ moment_id: momentId, commenter_uid: work.actor.uid, commenter_name: work.actor.name, body: body.trim(), created_at: new Date().toISOString() }).select('id')
    if (!current(work)) return { error: changed }
    if (result.error) return { error: errText(result.error) }
    const id = positiveRecordId((result.data as unknown as { id: number }[] | null)?.[0]?.id)
    return id ? { error: null, id } : { error: '未确认评论发送成功，请刷新后查看' }
  } catch (error) { return { error: current(work) ? errText(error) : changed } }
}
async function readChildren<T>(table: 'moments_comments' | 'moments_likes', momentId: number): Promise<QueryRes<T>> {
  const work = capture()
  if (!work) return { rows: [], error: '请先登录' }
  if (!positiveRecordId(momentId)) return { rows: [], error: '动态不存在' }
  try {
    const result = await cbRdb().from(table).select('*').eq('moment_id', momentId).order('created_at', { ascending: false }).limit(100)
    if (!current(work)) return { rows: [], error: changed }
    return { rows: result.error ? [] : (result.data || []) as unknown as T[], error: result.error ? errText(result.error) : null }
  } catch (error) { return { rows: [], error: current(work) ? errText(error) : changed } }
}
export function fetchMomentComments(momentId: number) { return readChildren<MomentComment>('moments_comments', momentId) }
export function fetchMomentLikes(momentId: number) { return readChildren<MomentLike>('moments_likes', momentId) }
