/** NON-PRODUCTION: per-account synthetic inbox, friend requests and notifications. No remote writes. */
import { useSyncExternalStore } from 'react'
import { captureQbankSession, isQbankSessionCurrent, getPreviewDelay, getPreviewIdentity, getPreviewMessageRows, writePreviewMessage, appendPreviewMessages as appendRoomMessages, sampleImage } from './ui-review-fixtures'
import type { ChatCursor, ChatOpenInput, ChatThreadItem } from '../src/lib/chat'
import type { Friend, FriendRequest } from '../src/lib/friends'
import type { NotifyRow } from '../src/lib/notify'
export * from './ui-review-home-fixtures'
export { chatPreviewText, chatRelTime } from '../src/lib/chat'
export { notifyMeta, relTime } from '../src/lib/notify'
export { HELP_KIND_TEXT, HELP_STATUS_TEXT, LOST_KIND_TEXT, LOST_STATUS_TEXT, activitySeatText, fmtBulletinTime } from '../src/lib/bulletin'

export type MessagePreviewMode = 'unread' | 'all-read' | 'empty' | 'error' | 'notify-error' | 'slow' | 'hide-error'
export const MESSAGE_PREVIEW_MODES: ReadonlyArray<{ value: MessagePreviewMode; label: string }> = [
  { value: 'unread', label: '会话与未读 · 本地样例' }, { value: 'all-read', label: '全部已读' }, { value: 'empty', label: '空数据' },
  { value: 'error', label: '消息读取失败' }, { value: 'notify-error', label: '仅通知读取失败' }, { value: 'slow', label: '4 秒慢请求' }, { value: 'hide-error', label: '移除会话失败' },
]
let scenario = { mode: 'unread' as MessagePreviewMode, revision: 0 }
const listeners = new Set<() => void>()
export function useMessagePreviewMode() { return useSyncExternalStore(notify => { listeners.add(notify); return () => { listeners.delete(notify) } }, () => scenario, () => scenario) }
export function setMessagePreviewMode(mode: MessagePreviewMode) { scenario = { mode, revision: scenario.revision + 1 }; listeners.forEach(notify => notify()) }
const capture = () => ({ session: captureQbankSession(), mode: scenario.mode, revision: scenario.revision })
const current = (work: ReturnType<typeof capture>) => isQbankSessionCurrent(work.session) && work.revision === scenario.revision
const wait = (work: ReturnType<typeof capture>) => new Promise<void>(resolve => setTimeout(resolve, work.mode === 'slow' ? 4000 : getPreviewDelay()))
const iso = (offset = 0) => new Date(Date.now() + offset).toISOString()
const stale = '本地样例账号或场景已变化，已停止旧请求'
const failed = '本地合成错误：模拟消息读取失败，请重试'
type OwnerStore = { threads: Map<number, ChatThreadItem>; hidden: Set<number>; notifications: NotifyRow[]; friends: Friend[]; requests: FriendRequest[]; broadcastReads: Set<number> }
const owners = new Map<string, OwnerStore>()
function ownerStore(uid: string): OwnerStore {
  if (!owners.has(uid)) {
    const who = uid.endsWith('b') ? '乙' : '甲'
    const threads = new Map(Array.from({ length: 46 }, (_, index) => {
      const id = index === 0 ? 7 : 99 + index, peer = index === 0 ? 'local:ui-review-peer' : `local:ui-review-peer-${index}`
      const mine = index % 4 === 3, unread = index === 0 ? 3 : index === 1 || index === 24 ? 1 : 0
      const row: ChatThreadItem = { id, topic_type: 'plaza_user', topic_id: null, topic_title: `本地样例${who} · 课程交流 ${index + 1}`, user_uid: uid, user_name: `本地样例${who}`, peer_uid: peer,
        peer_name: index === 1 ? '本地样例 · 名称很长的课程笔记交流同学，用于检查截断与阅读' : `同学 ${index + 1} · 本地样例`, peer_role: 'user',
        last_message: index === 1 ? '本地合成摘要：我们可以先整理英语课堂笔记，再核对小组汇报内容。这个较长的消息摘要用于检查窄屏中的文本截断和布局。' : `本地合成消息 ${index + 1}：课程笔记已整理，稍后一起核对。`, last_sender: mine ? uid : peer,
        last_at: iso(-(index + 1) * 90_000), created_at: iso(-(index + 2) * 86400_000), user_unread: unread, peer_unread: 0, i_am_user: true, my_unread: unread, other_uid: peer,
        other_name: index === 1 ? '本地样例 · 名称很长的课程笔记交流同学，用于检查截断与阅读' : `同学 ${index + 1} · 本地样例`, other_role: 'user', last_sender_is_me: mine }
      return [id, row] as const
    }))
    owners.set(uid, { threads, hidden: new Set(), broadcastReads: new Set(), notifications: [
      { id: 401, uid, kind: 'todo_due', title: '本地样例 · 课程计划临近', body: '合成通知，只检查通知列表与已读反馈。', link: '/schedule', ref_id: null, read_at: null, created_at: iso(-3600_000) },
      { id: 402, uid, kind: 'role_review', title: '本地样例 · 资料审核反馈', body: '这不是实际审核或校园通知。', link: '', ref_id: null, read_at: null, created_at: iso(-7200_000) },
      { id: 403, uid, kind: 'todo_due', title: '本地样例 · 已读通知', body: '用于检查已读通知分组。', link: '', ref_id: null, read_at: iso(-5000), created_at: iso(-86400_000) },
    ], friends: [
      { id: 501, user_uid: uid, friend_uid: 'local:ui-review-peer', friend_name: '同学 1 · 本地样例', friend_avatar: sampleImage, created_at: iso(-86400_000) },
      { id: 502, user_uid: uid, friend_uid: 'local:ui-review-peer-1', friend_name: '本地样例 · 名称很长的课程笔记交流同学', friend_avatar: sampleImage, remark: '英语课程笔记 · 本地样例', created_at: iso(-172800_000) },
    ], requests: [
      { id: 601, from_uid: 'local:ui-review-request-1', from_name: '申请同学甲 · 本地样例', from_avatar: sampleImage, to_uid: uid, status: 'pending', message: '本地合成申请：一起核对课程笔记。', created_at: iso(-180_000) },
      { id: 602, from_uid: 'local:ui-review-request-2', from_name: '申请同学乙 · 本地样例', from_avatar: sampleImage, to_uid: uid, status: 'pending', message: '本地合成申请，不会发给真实用户。', created_at: iso(-360_000) },
    ] })
  }
  return owners.get(uid)!
}
function sortedThreads(work: ReturnType<typeof capture>) {
  if (!work.session.uid || work.mode === 'empty') return []
  const store = ownerStore(work.session.uid)
  return [...store.threads.values()].filter(row => !store.hidden.has(row.id)).map(row => ({ ...row, ...(work.mode === 'all-read' ? { my_unread: 0, user_unread: 0 } : {}) })).sort((a, b) => b.last_at.localeCompare(a.last_at) || b.id - a.id)
}
export async function fetchChatThreads(limit = 20, cursor?: ChatCursor | null) {
  const work = capture(), all = sortedThreads(work), remaining = cursor ? all.filter(row => row.last_at < cursor.before_at || row.last_at === cursor.before_at && row.id < cursor.before_id) : all
  const items = remaining.slice(0, Math.max(1, Math.min(100, limit))), last = items.at(-1), more = remaining.length > items.length
  await wait(work)
  const error = !current(work) ? stale : work.mode === 'error' ? failed : null
  return { error, data: { items: error ? [] : items, total: error ? 0 : all.length, unread_total: error ? 0 : all.reduce((sum, row) => sum + row.my_unread, 0), has_more: !error && more, next_cursor: !error && more && last ? { before_at: last.last_at, before_id: last.id } : null } }
}
export async function fetchChatMessages(thread: number, limit = 30, before?: number | null) {
  const work = capture(), exists = !!work.session.uid && ownerStore(work.session.uid).threads.has(thread)
  const all = exists && work.mode !== 'empty' ? getPreviewMessageRows(work.session.uid, thread).filter(row => before == null || row.id < before) : [], items = all.slice(-limit), more = all.length > items.length
  await wait(work)
  const error = !current(work) ? stale : !exists ? '本地样例会话不存在或尚未登录' : work.mode === 'error' ? failed : null
  return { error, data: { items: error ? [] : items, has_more: !error && more, next_cursor: !error && more && items.length ? { before_id: items[0].id } : null } }
}
export async function chatMarkRead(thread: number) {
  const work = capture(); await wait(work)
  if (!current(work) || !work.session.uid) return { error: stale, cleared: 0, myUnread: 0 }
  if (work.mode === 'error') return { error: failed, cleared: 0, myUnread: 0 }
  const row = ownerStore(work.session.uid).threads.get(thread), cleared = row?.my_unread || 0
  if (row) { row.my_unread = 0; row.user_unread = 0 }
  return { error: null, cleared, myUnread: 0 }
}
export async function chatHideThread(thread: number, hidden = true) {
  const work = capture(); await wait(work)
  if (!current(work) || !work.session.uid) return { error: stale }
  if (work.mode === 'error' || work.mode === 'hide-error') return { error: '本地合成错误：会话移除失败，请重试' }
  const store = ownerStore(work.session.uid)
  if (hidden) store.hidden.add(thread); else store.hidden.delete(thread)
  return { error: null }
}
export async function chatOpenThread(input: ChatOpenInput) {
  const work = capture(); await wait(work)
  if (!current(work) || !work.session.uid) return { error: stale, data: null }
  if (work.mode === 'error') return { error: failed, data: null }
  const store = ownerStore(work.session.uid)
  let thread = [...store.threads.values()].find(row => row.other_uid === input.peerUid), created = false
  const friend = store.friends.find(row => row.friend_uid === input.peerUid)
  if (!thread && friend) {
    const id = 200 + store.threads.size
    thread = { ...store.threads.get(7)!, id, peer_uid: friend.friend_uid, peer_name: friend.friend_name, other_uid: friend.friend_uid, other_name: friend.friend_name, topic_type: input.topicType, topic_id: input.topicId, topic_title: input.topicTitle, last_message: '', last_sender: '', last_at: iso(), created_at: iso(), user_unread: 0, my_unread: 0, last_sender_is_me: false }
    store.threads.set(id, thread); created = true
  }
  if (!thread) return { error: '请使用列表内的本地样例好友，此预览不联系真实用户', data: null }
  const restored = store.hidden.delete(thread.id)
  return { error: null, data: { created, restored, thread: { ...thread } } }
}
async function sendLocal(thread: number, body: string, image?: string) {
  const work = capture(); await wait(work)
  if (!current(work) || !work.session.uid) return { error: stale, data: null }
  if (work.mode === 'error') return { error: failed, data: null }
  const store = ownerStore(work.session.uid), row = store.threads.get(thread)
  if (!row || !body.trim() || image && !/^(data:|blob:)/.test(image)) return { error: '本地样例消息或会话无效', data: null }
  const message = writePreviewMessage(work.session.uid, thread, body, image)
  Object.assign(row, { last_message: image ? '[图片]' : body, last_sender: work.session.uid, last_at: message.created_at, last_sender_is_me: true })
  store.hidden.delete(thread)
  return { error: null, data: { message, thread: { ...row }, peer_restored: false } }
}
export const chatSendMessage = (thread: number, body: string) => sendLocal(thread, body)
export const chatSendImage = (thread: number, image: string) => sendLocal(thread, '[图片]', image)
export function appendPreviewMessages(count = 1, thread = 7) {
  const uid = getPreviewIdentity(); if (!uid) return
  appendRoomMessages(count, thread)
  const store = ownerStore(uid), row = store.threads.get(thread)
  if (row) Object.assign(row, { my_unread: row.my_unread + count, user_unread: row.my_unread + count, last_message: `新到本地样例消息 ${count} 条`, last_at: iso(), last_sender_is_me: false })
  store.hidden.delete(thread)
}
export async function queryRows<T>(table: string, filters?: { id?: number }) {
  const work = capture(), thread = work.session.uid ? ownerStore(work.session.uid).threads.get(filters?.id || 7) : null; await wait(work)
  return { rows: (current(work) && table === 'chat_threads' && thread ? [{ ...thread }] : []) as T[], error: !current(work) ? stale : table !== 'chat_threads' ? '本地预览未模拟此查询' : null }
}
export async function uploadChatImage(file: File) { const work = capture(); await wait(work); return current(work) && work.session.uid ? { error: null, url: URL.createObjectURL(file) } : { error: stale, url: null } }
export const uploadPlazaImage = uploadChatImage
export async function fetchNotifications(uid: string, limit = 100) {
  const work = capture(), rows = uid && uid === work.session.uid && work.mode !== 'empty' ? ownerStore(uid).notifications.slice(0, limit).map(row => ({ ...row, ...(work.mode === 'all-read' ? { read_at: row.read_at || iso() } : {}) })) : []
  await wait(work)
  const error = !current(work) ? stale : work.mode === 'error' || work.mode === 'notify-error' ? '本地合成错误：模拟通知读取失败' : null
  return { rows: error ? [] : rows, error }
}
export async function fetchUnreadCount(uid: string) { const result = await fetchNotifications(uid); return { count: result.rows.filter(row => !row.read_at).length, error: result.error } }
export async function notifyMarkRead(ids: number[]) { const work = capture(); await wait(work); if (!current(work) || !work.session.uid) return { error: stale }; if (work.mode === 'error' || work.mode === 'notify-error') return { error: failed }; ownerStore(work.session.uid).notifications.filter(row => ids.includes(row.id)).forEach(row => { row.read_at = iso() }); return { error: null } }
export async function notifyMarkAllRead() { const uid = getPreviewIdentity(); return notifyMarkRead(uid ? ownerStore(uid).notifications.map(row => row.id) : []) }
async function localRows<T>(pick: (store: OwnerStore) => T[]) { const work = capture(), rows = work.session.uid && work.mode !== 'empty' ? pick(ownerStore(work.session.uid)).map(row => ({ ...row })) : []; await wait(work); return { rows: !current(work) || work.mode === 'error' ? [] : rows, error: !current(work) ? stale : work.mode === 'error' ? failed : null } }
export const fetchFriends = () => localRows(store => store.friends)
export const fetchFriendRequests = () => localRows(store => store.requests.filter(row => row.status === 'pending'))
export async function acceptFriendRequest(id: number) { const work = capture(); await wait(work); if (!current(work) || !work.session.uid) return { error: stale }; if (work.mode === 'error') return { error: failed }; const store = ownerStore(work.session.uid), request = store.requests.find(row => row.id === id && row.to_uid === work.session.uid && row.status === 'pending'); if (!request) return { error: '本地样例申请不存在或已处理' }; request.status = 'accepted'; store.friends.push({ id: 500 + id, user_uid: work.session.uid, friend_uid: request.from_uid, friend_name: request.from_name, friend_avatar: sampleImage, created_at: iso() }); return { error: null } }
export async function rejectFriendRequest(id: number) { const work = capture(); await wait(work); if (!current(work) || !work.session.uid) return { error: stale }; if (work.mode === 'error') return { error: failed }; const request = ownerStore(work.session.uid).requests.find(row => row.id === id && row.to_uid === work.session.uid); if (request) request.status = 'rejected'; return { error: null } }
export async function sendFriendRequest(peer: string) { const work = capture(); await wait(work); if (!current(work) || !work.session.uid) return { error: stale }; return { error: peer.startsWith('local:ui-review-') && work.mode !== 'error' ? null : '本地预览只接受样例账号 ID，例如 local:ui-review-peer，不联系真实用户' } }
export async function deleteFriend(id: number) { const work = capture(); await wait(work); if (!current(work) || !work.session.uid) return { error: stale }; if (work.mode === 'error') return { error: failed }; const store = ownerStore(work.session.uid); store.friends = store.friends.filter(row => row.id !== id); return { error: null } }

// Legacy update feed remains a separate, labelled local route. Public copy is synthetic too.
export async function fetchNews() { return { rows: scenario.mode === 'empty' ? [] : [{ id: 701, title: '本地样例 · 学习空间开放说明', summary: '合成公告，不代表学校安排', body: '', cover: '', tag: '', source: '本地合成信息站', is_top: false, creator_name: '本地样例', status: 'published', published_at: iso(-3600_000), created_at: iso(-3600_000) }], error: scenario.mode === 'error' ? failed : null } }
export const fetchNewsBroadcasts = async () => ({ rows: [], error: null })
export const fetchReadBroadcastIds = async (uid: string) => new Set(ownerStore(uid).broadcastReads)
export async function markBroadcastRead(id: number, uid: string) { const work = capture(); await wait(work); if (!current(work) || uid !== work.session.uid) return { error: stale }; ownerStore(uid).broadcastReads.add(id); return { error: null } }
export const fetchMySignupIds = async () => [] as number[]
export const fetchActivitiesByIds = async () => ({ rows: [], error: null })
export const fetchLostMine = async () => ({ rows: [], error: null })
export const fetchHelpMine = async () => ({ rows: [], error: null })
export const fetchMyTasks = async () => ({ rows: [], error: null })
export const fetchMyItems = async () => ({ rows: [], error: null })
