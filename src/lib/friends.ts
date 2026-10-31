/** Account-owned friend edges and recipient-owned applications; no profile directory access. */
import { cbRdb } from './cb'
import { currentActor } from './social-actor'
import { captureImSession, currentImSession } from './im-session'
import { positiveRecordId } from './async-owner'

export interface Friend {
  id: number
  user_uid: string
  friend_uid: string
  friend_name: string
  friend_avatar?: string
  created_at: string
  remark?: string
}
export interface FriendRequest {
  id: number
  from_uid: string
  from_name: string
  from_avatar?: string
  from_motto?: string
  from_intro?: string
  to_uid: string
  status: 'pending' | 'accepted' | 'rejected'
  message?: string
  created_at: string
}
export interface QueryRes<T> { rows: T[]; error: string | null }
export interface MutateRes { error: string | null; id?: number; notice?: string }

const changed = '账号已变化，请重新操作'
function captureActor() {
  const actor = currentActor()
  const session = actor ? captureImSession(actor.uid) : null
  return actor && session ? { actor, session } : null
}
type ActorWork = NonNullable<ReturnType<typeof captureActor>>
function current(work: ActorWork) {
  return currentImSession(work.session) && currentActor()?.uid === work.actor.uid
}
function errText(error: unknown): string {
  if (typeof error === 'string') return error || '操作失败，请稍后重试'
  const value = error as { message?: unknown; msg?: unknown } | null
  return typeof value?.message === 'string' ? value.message : typeof value?.msg === 'string' ? value.msg : '操作失败，请稍后重试'
}
function duplicate(error: unknown) {
  return (error as { code?: string } | null)?.code === '23505' || /duplicate|unique/i.test(errText(error))
}

function missingProfileColumns(error: unknown) {
  const value = error as { code?: string; message?: string; details?: string } | null
  return (value?.code === '42703' || value?.code === 'PGRST204')
    && /from_motto|from_intro/.test(`${value.message || ''} ${value.details || ''}`)
}

export async function fetchFriends(): Promise<QueryRes<Friend>> {
  const work = captureActor()
  if (!work) return { rows: [], error: '请先登录' }
  const uid = work.actor.uid
  try {
    const results = await Promise.all([
      cbRdb().from('friends').select('*').eq('user_uid', uid).order('created_at', { ascending: false }),
      cbRdb().from('friends').select('*').eq('friend_uid', uid).order('created_at', { ascending: false }),
    ])
    if (!current(work)) return { rows: [], error: changed }
    const failure = results.find(result => result.error)
    if (failure) return { rows: [], error: errText(failure.error) }
    const peers = new Map<string, Friend>()
    const rows = results.flatMap(result => (result.data || []) as unknown as Friend[])
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    for (const row of rows) {
      if (!positiveRecordId(row.id) || (row.user_uid !== uid && row.friend_uid !== uid)) continue
      const forward = row.user_uid === uid, peerUid = forward ? row.friend_uid : row.user_uid
      if (!peerUid || peerUid === uid) continue
      const friend: Friend = {
        id: row.id, user_uid: uid, friend_uid: peerUid, created_at: row.created_at,
        // A reverse edge stores our own name/avatar/remark, never the other person's.
        friend_name: forward ? row.friend_name || '' : '', friend_avatar: forward ? row.friend_avatar || '' : '',
        remark: forward ? row.remark || '' : '',
      }
      if (!peers.has(peerUid) || (forward && !peers.get(peerUid)!.friend_name)) peers.set(peerUid, friend)
    }
    return { rows: [...peers.values()], error: null }
  } catch (error) {
    return { rows: [], error: current(work) ? errText(error) : changed }
  }
}

export async function fetchFriendRequests(): Promise<QueryRes<FriendRequest>> {
  const work = captureActor()
  if (!work) return { rows: [], error: '请先登录' }
  try {
    const result = await cbRdb().from('friend_requests').select('*')
      .eq('to_uid', work.actor.uid).eq('status', 'pending').order('created_at', { ascending: false })
    if (!current(work)) return { rows: [], error: changed }
    if (result.error) return { rows: [], error: errText(result.error) }
    return { rows: ((result.data || []) as unknown as FriendRequest[])
      .filter(row => row.to_uid === work.actor.uid && row.status === 'pending' && row.from_uid !== work.actor.uid), error: null }
  } catch (error) {
    return { rows: [], error: current(work) ? errText(error) : changed }
  }
}

export async function sendFriendRequest(
  toUid: string,
  message = '',
  personalSnapshot?: { motto?: string; intro?: string },
): Promise<MutateRes> {
  const work = captureActor()
  if (!work) return { error: '请先登录' }
  const peerUid = String(toUid || '').trim()
  if (!peerUid) return { error: '请输入对方的好友码' }
  if (peerUid === work.actor.uid) return { error: '不能添加自己为好友' }
  try {
    const base = {
      from_uid: work.actor.uid, from_name: work.actor.name, from_avatar: work.actor.avatar,
      to_uid: peerUid, status: 'pending', message: message.trim(), created_at: new Date().toISOString(),
    }
    const snapshot = {
      from_motto: String(personalSnapshot?.motto ?? work.actor.motto ?? '').trim().slice(0, 40),
      from_intro: String(personalSnapshot?.intro ?? work.actor.intro ?? '').trim().slice(0, 160),
    }
    let result = await cbRdb().from('friend_requests').insert({ ...base, ...snapshot })
    if (!current(work)) return { error: changed }
    // Retry only after a definite schema rejection: network, permission and
    // duplicate failures must never cause another potentially successful write.
    let notice: string | undefined
    if (result.error && missingProfileColumns(result.error)) {
      result = await cbRdb().from('friend_requests').insert(base)
      notice = snapshot.from_motto || snapshot.from_intro ? '申请已发送；当前服务暂不支持随申请展示个人介绍。' : undefined
    }
    if (!current(work)) return { error: changed }
    if (result.error) return { error: duplicate(result.error) ? '已发送过申请，请等待对方处理' : errText(result.error) }
    return { error: null, notice }
  } catch (error) {
    return { error: current(work) ? errText(error) : changed }
  }
}

async function readPendingRequest(work: ActorWork, requestId: number): Promise<{ request: FriendRequest | null; error: string | null }> {
  if (!positiveRecordId(requestId)) return { request: null, error: '申请无效' }
  const result = await cbRdb().from('friend_requests').select('*').eq('id', requestId).eq('to_uid', work.actor.uid).maybeSingle()
  if (!current(work)) return { request: null, error: changed }
  if (result.error) return { request: null, error: errText(result.error) }
  const request = result.data as unknown as FriendRequest | null
  if (!request || request.id !== requestId || request.to_uid !== work.actor.uid || request.from_uid === work.actor.uid
    || request.status !== 'pending') return { request: null, error: '申请不存在或已处理，请刷新列表' }
  return { request, error: null }
}

async function updateRequest(work: ActorWork, requestId: number, status: 'accepted' | 'rejected'): Promise<MutateRes> {
  if (!current(work)) return { error: changed }
  const result = await cbRdb().from('friend_requests').update({ status }).eq('id', requestId)
    .eq('to_uid', work.actor.uid).eq('status', 'pending').select('id,to_uid,status').maybeSingle()
  if (!current(work)) return { error: changed }
  if (result.error) return { error: errText(result.error) }
  const row = result.data as unknown as FriendRequest | null
  return row?.id === requestId && row.to_uid === work.actor.uid && row.status === status
    ? { error: null } : { error: '申请状态已变化，请刷新列表' }
}

/** The database decides the request and creates its edge in one transaction. */
export async function acceptFriendRequest(requestId: number): Promise<MutateRes> {
  const work = captureActor()
  if (!work) return { error: '请先登录' }
  try {
    const { request, error } = await readPendingRequest(work, requestId)
    if (!current(work)) return { error: changed }
    if (error || !request) return { error: error || '申请不存在' }
    const updated = await updateRequest(work, requestId, 'accepted')
    if (!current(work)) return { error: changed }
    return updated
  } catch (error) {
    return { error: current(work) ? errText(error) : changed }
  }
}

export async function rejectFriendRequest(requestId: number): Promise<MutateRes> {
  const work = captureActor()
  if (!work) return { error: '请先登录' }
  try {
    const { request, error } = await readPendingRequest(work, requestId)
    if (!current(work)) return { error: changed }
    if (error || !request) return { error: error || '申请不存在' }
    const updated = await updateRequest(work, requestId, 'rejected')
    return current(work) ? updated : { error: changed }
  } catch (error) {
    return { error: current(work) ? errText(error) : changed }
  }
}

export async function deleteFriend(friendId: number): Promise<MutateRes> {
  const work = captureActor()
  if (!work) return { error: '请先登录' }
  if (!positiveRecordId(friendId)) return { error: '好友记录无效' }
  try {
    const read = await cbRdb().from('friends').select('*').eq('id', friendId).maybeSingle()
    if (!current(work)) return { error: changed }
    if (read.error) return { error: errText(read.error) }
    const row = read.data as unknown as Friend | null
    if (!row || (row.user_uid !== work.actor.uid && row.friend_uid !== work.actor.uid)) return { error: '好友记录不存在' }
    const result = await cbRdb().from('friends').delete().eq('id', friendId)
    if (!current(work)) return { error: changed }
    return { error: result.error ? errText(result.error) : null }
  } catch (error) {
    return { error: current(work) ? errText(error) : changed }
  }
}
