/**
 * 站内私信（IM）前端数据层
 *
 * 服务端事实源（云开发 PG，迁移 20260938000000_chat.sql + 20260939000000_chat_inbox.sql）：
 * - chat_threads  会话线：话题（topic_type + topic_id）+ 一对参与者 + 双方各自未读 + 单方隐藏时间
 * - chat_messages 消息（append-only，无 UPDATE / DELETE 策略）
 * - RPC：chat_thread_open / chat_send / chat_mark_read / chat_thread_hide /
 *        chat_thread_list / chat_messages_page
 *
 * 前端约定（与迁移内注释同一口径，不要绕开）：
 * 1. 写操作一律走 RPC，不直写 chat_threads。PG 在 RLS 下 UPDATE 需要读行时会叠加 SELECT 策略，
 *    本人隐藏过的行对自己不可 SELECT，直写 UPDATE 永远恢复不回来。
 * 2. 读也走 RPC：会话列表 / 消息翻页都是 SECURITY DEFINER + 游标分页，
 *    直读表拿不到 other_name / my_unread / has_more 这些派生字段。
 * 3. 隐藏是单方软删除：只影响我的列表与我对该行的读取，对方完全不受影响；
 *    我重新打开会话（chat_thread_open）或对方发来新消息（chat_send）时自动恢复。
 */
import { cbAuth, cbRdb } from './cb'

type Any = Record<string, any>

/* ---------------- 类型 ---------------- */

/** 会话线（chat_thread_list 的一行，已按「我」的视角加工） */
export interface ChatThreadItem {
  id: number
  topic_type: string
  topic_id: number | null
  topic_title: string
  user_uid: string
  user_name: string
  peer_uid: string
  peer_name: string
  peer_role: string
  last_message: string
  last_sender: string
  last_at: string
  created_at: string
  user_unread: number
  peer_unread: number
  /** 我是不是这条会话线的发起方（user_uid） */
  i_am_user: boolean
  /** 我这一侧的未读（服务端已按视角折算） */
  my_unread: number
  /** 对方 uid / 昵称 / 角色（服务端已按视角折算） */
  other_uid: string
  other_name: string
  other_role: string
  last_sender_is_me: boolean
}

export interface ChatMessageItem {
  id: number
  thread_id: number
  sender_uid: string
  sender_name: string
  sender_role: string
  body: string
  /** text 文本（含 emoji）· image 图片，地址见 media_url */
  kind: 'text' | 'image'
  /** kind === 'image' 时的公开图片地址，走 CloudBase images 桶 chats/{uid}/ */
  media_url: string
  created_at: string
  is_mine: boolean
}

/** 会话列表游标：last_at 并列时靠 before_id 兜底，不丢行不重复 */
export interface ChatCursor {
  before_at: string
  before_id: number
}

export interface ChatThreadPage {
  items: ChatThreadItem[]
  total: number
  unread_total: number
  has_more: boolean
  next_cursor: ChatCursor | null
}

export interface ChatMessagePage {
  items: ChatMessageItem[]
  has_more: boolean
  next_cursor: { before_id: number } | null
}

export interface ChatSendResult {
  message: ChatMessageItem
  thread: ChatThreadItem
  /** 我这句是否把对方隐藏的会话顶回了他的列表 */
  peer_restored: boolean
}

export interface ChatOpenResult {
  created: boolean
  /** 命中的是我删过的会话，本次重新打开顺手恢复了可见性 */
  restored: boolean
  thread: ChatThreadItem
}

export interface ChatOpenInput {
  /** 话题类型：secondhand（闲置）/ task（互助），与详情页路由一一对应 */
  topicType: string
  topicId: number | null
  topicTitle: string
  peerUid: string
  peerName?: string
  peerRole?: string
}

/* ---------------- 内部工具 ---------------- */

export const CHAT_PAGE_SIZE = 20
export const CHAT_MSG_PAGE_SIZE = 30

function errText(e: unknown): string {
  if (!e) return '操作失败，请稍后重试'
  const a = e as { message?: unknown; msg?: unknown }
  const m = typeof a.message === 'string' ? a.message : typeof a.msg === 'string' ? a.msg : ''
  return m || '操作失败，请稍后重试'
}

function readError(e: unknown): string | null {
  if (!e) return null
  if (typeof e === 'string') return e
  const msg = (e as { message?: string }).message
  return msg || null
}

function num(v: unknown, d = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(Number.isFinite(n) ? n : lo, lo), hi)
}

/** 当前登录 uid：服务端已给足派生字段，这里只在字段缺失时兜底 */
function currentUid(): string {
  try {
    const u = (cbAuth() as Any).currentUser
    return String(u?.uid || u?.id || '')
  } catch {
    return ''
  }
}

/** jsonb 结果容错：对象 / JSON 字符串 / 单元素数组都可能出现 */
function unwrapJson(v: unknown): Any | null {
  let x: unknown = v
  for (let i = 0; i < 3; i += 1) {
    if (typeof x === 'string') {
      try {
        x = JSON.parse(x)
        continue
      } catch {
        return null
      }
    }
    if (Array.isArray(x)) {
      x = x.length === 1 ? x[0] : null
      continue
    }
    break
  }
  return x && typeof x === 'object' ? (x as Any) : null
}

async function rpcJson(name: string, params: Any): Promise<{ raw: Any | null; error: string | null }> {
  try {
    const res: Any = await (cbRdb() as Any).rpc(name, params)
    const err = readError(res?.error)
    if (err) return { raw: null, error: err }
    return { raw: unwrapJson(res?.data), error: null }
  } catch (e) {
    return { raw: null, error: errText(e) }
  }
}

function normThread(row: Any): ChatThreadItem {
  const uid = currentUid()
  const userUid = String(row?.user_uid || '')
  const peerUid = String(row?.peer_uid || '')
  const iAmUser = row?.i_am_user != null ? !!row.i_am_user : uid !== '' && userUid === uid
  return {
    id: num(row?.id),
    topic_type: String(row?.topic_type || ''),
    topic_id: row?.topic_id == null ? null : num(row.topic_id),
    topic_title: String(row?.topic_title || ''),
    user_uid: userUid,
    user_name: String(row?.user_name || ''),
    peer_uid: peerUid,
    peer_name: String(row?.peer_name || ''),
    peer_role: String(row?.peer_role || 'user'),
    last_message: String(row?.last_message || ''),
    last_sender: String(row?.last_sender || ''),
    last_at: String(row?.last_at || row?.created_at || ''),
    created_at: String(row?.created_at || ''),
    user_unread: num(row?.user_unread),
    peer_unread: num(row?.peer_unread),
    i_am_user: iAmUser,
    my_unread: row?.my_unread != null ? num(row.my_unread) : iAmUser ? num(row?.user_unread) : num(row?.peer_unread),
    other_uid: String(row?.other_uid || (iAmUser ? peerUid : userUid)),
    other_name: String(row?.other_name || (iAmUser ? row?.peer_name : row?.user_name) || '同学'),
    other_role: String(row?.other_role || (iAmUser ? row?.peer_role : 'user') || 'user'),
    last_sender_is_me: row?.last_sender_is_me != null ? !!row.last_sender_is_me : uid !== '' && String(row?.last_sender || '') === uid,
  }
}

/**
 * 消息归一化：补齐 kind / media_url / is_mine 等派生字段。
 * 由 college-group.ts 复用，保证群聊与私信两条通道的字段口径一致。
 */
export function normMessage(row: Any): ChatMessageItem {
  const uid = currentUid()
  const kind = String(row?.kind || 'text') === 'image' ? 'image' : 'text'
  const body = String(row?.body || '')
  return {
    id: num(row?.id),
    thread_id: num(row?.thread_id),
    sender_uid: String(row?.sender_uid || ''),
    sender_name: String(row?.sender_name || ''),
    sender_role: String(row?.sender_role || 'user'),
    body: kind === 'image' ? (body || '[图片]') : body,
    kind,
    media_url: kind === 'image' ? String(row?.media_url || '') : '',
    created_at: String(row?.created_at || ''),
    is_mine: row?.is_mine != null ? !!row.is_mine : uid !== '' && String(row?.sender_uid || '') === uid,
  }
}

/* ---------------- 读：会话列表 / 消息翻页 ---------------- */

/** 我的会话列表：按 last_at 倒序，cursor 传上一页返回的 next_cursor */
export async function fetchChatThreads(
  limit = CHAT_PAGE_SIZE,
  cursor?: ChatCursor | null,
): Promise<{ data: ChatThreadPage; error: string | null }> {
  const empty: ChatThreadPage = { items: [], total: 0, unread_total: 0, has_more: false, next_cursor: null }
  const params: Any = { p_limit: clamp(limit, 1, 100) }
  if (cursor && cursor.before_at && cursor.before_id != null) {
    params.p_before_at = cursor.before_at
    params.p_before_id = cursor.before_id
  }
  const { raw, error } = await rpcJson('chat_thread_list', params)
  if (error || !raw) return { data: empty, error: error || '会话列表读取失败' }

  const items = Array.isArray(raw.items) ? (raw.items as Any[]).map(normThread) : []
  const nc = raw.next_cursor && typeof raw.next_cursor === 'object' ? (raw.next_cursor as Any) : null
  return {
    data: {
      items,
      total: num(raw.total),
      unread_total: num(raw.unread_total),
      has_more: !!raw.has_more,
      next_cursor: nc && nc.before_at && nc.before_id != null ? { before_at: String(nc.before_at), before_id: num(nc.before_id) } : null,
    },
    error: null,
  }
}

/** 会话内消息：不传 beforeId 取最新一页；传上一页的 next_cursor.before_id 取更早一页 */
export async function fetchChatMessages(
  threadId: number,
  limit = CHAT_MSG_PAGE_SIZE,
  beforeId?: number | null,
): Promise<{ data: ChatMessagePage; error: string | null }> {
  const empty: ChatMessagePage = { items: [], has_more: false, next_cursor: null }
  if (!threadId) return { data: empty, error: '会话不存在' }

  const params: Any = { p_thread_id: threadId, p_limit: clamp(limit, 1, 100) }
  if (beforeId != null) params.p_before_id = beforeId

  const { raw, error } = await rpcJson('chat_messages_page', params)
  if (error || !raw) return { data: empty, error: error || '消息读取失败' }

  const items = Array.isArray(raw.items) ? (raw.items as Any[]).map(normMessage) : []
  const nc = raw.next_cursor && typeof raw.next_cursor === 'object' ? (raw.next_cursor as Any) : null
  return {
    data: {
      items,
      has_more: !!raw.has_more,
      next_cursor: nc && nc.before_id != null ? { before_id: num(nc.before_id) } : null,
    },
    error: null,
  }
}

/* ---------------- 写：开会话 / 发消息 / 清未读 / 隐藏 ---------------- */

export async function chatOpenThread(input: ChatOpenInput): Promise<{ data: ChatOpenResult | null; error: string | null }> {
  const { raw, error } = await rpcJson('chat_thread_open', {
    p_topic_type: input.topicType,
    p_topic_id: input.topicId,
    p_topic_title: input.topicTitle,
    p_peer_uid: input.peerUid,
    p_peer_name: input.peerName || '',
    p_peer_role: input.peerRole || 'user',
  })
  if (error || !raw?.thread) return { data: null, error: error || '会话建立失败' }
  return { data: { created: !!raw.created, restored: !!raw.restored, thread: normThread(raw.thread) }, error: null }
}

/** 发文本消息；data.message 用于本地即时上屏（服务端已落库） */
export async function chatSendMessage(
  threadId: number,
  body: string,
  senderRole = 'user',
): Promise<{ data: ChatSendResult | null; error: string | null }> {
  const text = body.trim()
  if (!text) return { data: null, error: '消息内容不能为空' }
  if (text.length > 2000) return { data: null, error: '消息内容不能超过 2000 字' }
  return sendRaw(threadId, { p_thread_id: threadId, p_body: text, p_sender_role: senderRole })
}

/**
 * 发图片消息：url 必须是已上传到 CloudBase images 桶的 https 公开地址。
 * 服务端只存 URL（正文统一落 '[图片]'），不经过 IM，不产生 IM 存储/流量费用。
 */
export async function chatSendImage(
  threadId: number,
  url: string,
  senderRole = 'user',
): Promise<{ data: ChatSendResult | null; error: string | null }> {
  const safe = String(url || '').trim()
  if (!/^https:\/\/\S+$/.test(safe) || safe.length > 1024) return { data: null, error: '图片地址无效，请重新发送' }
  return sendRaw(threadId, {
    p_thread_id: threadId,
    p_body: '[图片]',
    p_sender_role: senderRole,
    p_kind: 'image',
    p_media_url: safe,
  })
}

async function sendRaw(threadId: number, params: Any): Promise<{ data: ChatSendResult | null; error: string | null }> {
  if (!threadId) return { data: null, error: '会话不存在' }
  const { raw, error } = await rpcJson('chat_send', params)
  if (error || !raw?.message) return { data: null, error: error || '消息发送失败' }
  return {
    data: {
      message: normMessage(raw.message),
      thread: normThread(raw.thread),
      peer_restored: !!raw.peer_restored,
    },
    error: null,
  }
}

/** 进入会话即把我这一侧未读置 0（幂等） */
export async function chatMarkRead(threadId: number): Promise<{ error: string | null; cleared: number; myUnread: number }> {
  if (!threadId) return { error: '会话不存在', cleared: 0, myUnread: 0 }
  const { raw, error } = await rpcJson('chat_mark_read', { p_thread_id: threadId })
  if (error) return { error, cleared: 0, myUnread: 0 }
  return { error: null, cleared: num(raw?.cleared), myUnread: num(raw?.my_unread) }
}

/** 单方隐藏（软删除）或恢复：只影响我这一侧，对方完全不受影响 */
export async function chatHideThread(threadId: number, hidden = true): Promise<{ error: string | null }> {
  if (!threadId) return { error: '会话不存在' }
  const { error } = await rpcJson('chat_thread_hide', { p_thread_id: threadId, p_hidden: hidden })
  return { error }
}

/* ---------------- 展示工具 ---------------- */

const TOPIC_LABEL: Record<string, string> = {
  secondhand: '闲置',
  task: '互助',
  plaza_post: '广场动态',
  plaza_user: '广场同学',
  college: '学院群',
}

export function chatTopicLabel(topicType: string): string {
  return TOPIC_LABEL[topicType] || '私信'
}

/** 话题对应的详情页路由；话题已下架/删除时返回 null（只展示不可跳） */
export function chatTopicPath(topicType: string, topicId: number | null | undefined): string | null {
  if (topicType === 'plaza_user') return '/plaza'
  if (topicType === 'plaza_post') return '/plaza?tab=feed'
  if (!topicId) return null
  if (topicType === 'secondhand') return `/item/${topicId}`
  if (topicType === 'task') return `/task/${topicId}`
  return null
}

/**
 * 从广场打开私信：
 * - 动态帖：topic_type=plaza_post + topic_id=帖 id
 * - 大厅点人：topic_type=plaza_user + topic_id=null（同参与者复用一条）
 */
export async function openPlazaChat(input: {
  peerUid: string
  peerName?: string
  postId?: number | null
  postPreview?: string
}): Promise<{ data: ChatOpenResult | null; error: string | null }> {
  const fromPost = input.postId != null && Number.isFinite(input.postId) && input.postId > 0
  const title = fromPost
    ? (input.postPreview || '广场动态').trim().slice(0, 40) || '广场动态'
    : `私聊 · ${input.peerName || '同学'}`
  return chatOpenThread({
    topicType: fromPost ? 'plaza_post' : 'plaza_user',
    topicId: fromPost ? Number(input.postId) : null,
    topicTitle: title,
    peerUid: input.peerUid,
    peerName: input.peerName,
  })
}

/** 列表里的最后一句话（我发的加「我：」前缀） */
export function chatPreviewText(t: ChatThreadItem): string {
  const body = (t.last_message || '').trim()
  if (!body) return '还没有消息，打个招呼吧'
  return t.last_sender_is_me ? `我：${body}` : body
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 会话列表的相对时间：刚刚 / n 分钟前 / 今天 HH:mm / 昨天 HH:mm / M月D日 */
export function chatRelTime(iso?: string): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const now = Date.now()
  const diff = now - t
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  const d = new Date(t)
  const today = new Date(now)
  if (d.toDateString() === today.toDateString()) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  const yest = new Date(now)
  yest.setDate(yest.getDate() - 1)
  if (d.toDateString() === yest.toDateString()) return `昨天 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  if (d.getFullYear() === today.getFullYear()) return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 消息气泡上的时间：只给 HH:mm（跨天时带上日期） */
export function chatBubbleTime(iso?: string): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return hm
  return `${d.getMonth() + 1}-${pad2(d.getDate())} ${hm}`
}
