/**
 * 校园广场数据层
 *
 * - plaza_messages：全校共用大厅（room_id = campus）
 * - plaza_posts：吐槽 / 交友 / 帮忙短帖
 * - 登录可读；本人可写；本人或管理员可删（RLS）
 * - 私信不走本表，复用 chat_thread_open（topic = plaza_post | plaza_user）
 */
import { cbRdb } from './cb'
import { fmtTime } from './market'
import { assertPlazaWrite } from './sanctions'

export type PlazaTag = '吐槽' | '交友' | '帮忙'

export interface PlazaMessage {
  id: number
  room_id: string
  body: string
  /** text 文本（含 emoji）· image 图片，地址见 media_url */
  kind?: string
  /** kind==='image' 时的公开图片地址 */
  media_url?: string
  creator_uid: string
  creator_name: string
  creator_avatar?: string
  created_at: string
}

export interface PlazaPost {
  id: number
  body: string
  tag: PlazaTag | string
  creator_uid: string
  creator_name: string
  creator_avatar?: string
  /** 帖子配图（0–3 张），地址来自 CloudBase images 桶 plaza-post/{uid}/ */
  media_urls?: string[]
  created_at: string
  views?: number
  likes?: number
}

export interface QueryRes<T> {
  rows: T[]
  error: string | null
  /** Only present for paged feeds; true when a next page is known to exist. */
  hasMore?: boolean
}

export interface MutateRes {
  error: string | null
  id?: number
}

type Any = Record<string, any>

export const PLAZA_ROOM = 'campus'
export const PLAZA_TAGS: PlazaTag[] = ['吐槽', '交友', '帮忙']
export const PLAZA_POLL_MS = 4000
export const PLAZA_MSG_LIMIT = 80
export const PLAZA_POST_LIMIT = 60
export const PLAZA_POST_PAGE_SIZE = 30

/** 简易敏感词：命中则拒绝发送（完整审核后置） */
const BAD_WORDS = ['赌博', '色情', '约炮', '代考', '办证', '枪支', '毒品', '冰毒', '海洛因']

function readError(e: unknown): string | null {
  if (!e) return null
  if (typeof e === 'string') return e
  const msg = (e as { message?: string }).message
  return msg || null
}

function errText(e: unknown): string {
  if (!e) return '操作失败，请稍后重试'
  const a = e as { message?: unknown; msg?: unknown }
  const m = typeof a.message === 'string' ? a.message : typeof a.msg === 'string' ? a.msg : ''
  return m || '操作失败，请稍后重试'
}

export function plazaModerationBlock(text: string): string | null {
  const t = text.trim()
  if (!t) return '内容不能为空'
  if (t.length > 500) return '内容不能超过 500 字'
  const hit = BAD_WORDS.find((w) => t.includes(w))
  if (hit) return '内容含有不当用语，请修改后再发'
  return null
}

export function fmtPlazaTime(iso?: string): string {
  return fmtTime(iso)
}

async function selectOrdered<T>(
  name: string,
  opts: { eq?: Record<string, string | number>; limit: number; asc?: boolean },
): Promise<QueryRes<T>> {
  try {
    let q: Any = (cbRdb().from(name) as Any).select('*')
    if (opts.eq) {
      for (const k of Object.keys(opts.eq)) q = q.eq(k, opts.eq[k])
    }
    q = opts.asc ? q.order('id', { ascending: true }) : q.order('id', { ascending: false })
    q = q.limit(opts.limit)
    const res = await q
    const err = readError(res?.error)
    if (err) return { rows: [], error: err }
    const data = Array.isArray(res?.data) ? (res.data as T[]) : []
    return { rows: data, error: null }
  } catch (e) {
    return { rows: [], error: errText(e) }
  }
}

/** 大厅消息：按 id 升序（旧→新），方便聊天流渲染 */
export async function fetchPlazaMessages(limit = PLAZA_MSG_LIMIT): Promise<QueryRes<PlazaMessage>> {
  const r = await selectOrdered<PlazaMessage>('plaza_messages', {
    eq: { room_id: PLAZA_ROOM },
    limit,
    asc: false,
  })
  if (r.error) return r
  return { rows: r.rows.slice().reverse(), error: null }
}

export async function sendPlazaMessage(
  body: string,
  creatorUid: string,
  creatorName: string,
  creatorAvatar = '',
): Promise<MutateRes> {
  const block = plazaModerationBlock(body)
  if (block) return { error: block }
  return insertPlazaMessage({
    body: body.trim(),
    kind: 'text',
    media_url: '',
    creatorUid,
    creatorName,
    creatorAvatar,
  })
}

/**
 * 大厅发图片：url 是已上传到 CloudBase images 桶 plaza/{uid}/ 的公开地址。
 * 正文统一落 '[图片]'（列表摘要与老版本客户端都能看懂），地址单独存 media_url。
 */
export async function sendPlazaImage(
  url: string,
  creatorUid: string,
  creatorName: string,
  creatorAvatar = '',
): Promise<MutateRes> {
  const safe = String(url || '').trim()
  if (!/^https:\/\/\S+$/.test(safe) || safe.length > 1024) return { error: '图片地址无效，请重新发送' }
  return insertPlazaMessage({
    body: '[图片]',
    kind: 'image',
    media_url: safe,
    creatorUid,
    creatorName,
    creatorAvatar,
  })
}

async function insertPlazaMessage(input: {
  body: string
  kind: 'text' | 'image'
  media_url: string
  creatorUid: string
  creatorName: string
  creatorAvatar: string
}): Promise<MutateRes> {
  const gate = await assertPlazaWrite(input.creatorUid, 'hall')
  if (gate) return { error: gate }
  try {
    const res: Any = await (cbRdb().from('plaza_messages') as Any)
      .insert({
        room_id: PLAZA_ROOM,
        body: input.body,
        kind: input.kind,
        media_url: input.media_url,
        creator_uid: input.creatorUid,
        creator_name: input.creatorName || '同学',
        creator_avatar: String(input.creatorAvatar || '').slice(0, 600),
      })
      .select('id')
    const err = readError(res?.error)
    if (err) return { error: err }
    const id = Array.isArray(res?.data) && res.data[0] ? Number(res.data[0].id) : undefined
    return { error: null, id }
  } catch (e) {
    return { error: errText(e) }
  }
}

export async function deletePlazaMessage(id: number): Promise<MutateRes> {
  try {
    const res: Any = await (cbRdb().from('plaza_messages') as Any).delete().eq('id', id)
    return { error: readError(res?.error) }
  } catch (e) {
    return { error: errText(e) }
  }
}

export async function fetchPlazaPosts(limit = PLAZA_POST_LIMIT): Promise<QueryRes<PlazaPost>> {
  const pageSize = Math.max(1, Math.min(Math.floor(limit) || PLAZA_POST_LIMIT, 60))
  const res = await selectOrdered<PlazaPost>('plaza_posts', { limit: pageSize + 1, asc: false })
  if (res.error) return res
  return { rows: res.rows.slice(0, pageSize), hasMore: res.rows.length > pageSize, error: null }
}

/** Keyset page for older feed posts; id is the stable ordering key. */
export async function fetchOlderPlazaPosts(beforeId: number, limit = PLAZA_POST_PAGE_SIZE): Promise<QueryRes<PlazaPost>> {
  if (!Number.isSafeInteger(beforeId) || beforeId <= 0) return { rows: [], hasMore: false, error: '动态位置无效，请刷新后重试' }
  try {
    const pageSize = Math.max(1, Math.min(Math.floor(limit) || PLAZA_POST_PAGE_SIZE, 60))
    let query: Any = (cbRdb().from('plaza_posts') as Any).select('*')
    query = query.lt('id', beforeId).order('id', { ascending: false }).limit(pageSize + 1)
    const res = await query
    const error = readError(res?.error)
    if (error) return { rows: [], hasMore: false, error }
    const rows = Array.isArray(res?.data) ? res.data as PlazaPost[] : []
    return { rows: rows.slice(0, pageSize), hasMore: rows.length > pageSize, error: null }
  } catch (error) { return { rows: [], hasMore: false, error: errText(error) } }
}

export async function createPlazaPost(
  body: string,
  tag: PlazaTag,
  creatorUid: string,
  creatorName: string,
  creatorAvatar = '',
  mediaUrls: string[] = [],
): Promise<MutateRes> {
  const block = plazaModerationBlock(body)
  if (block) return { error: block }
  const gate = await assertPlazaWrite(creatorUid, 'post')
  if (gate) return { error: gate }
  const safeTag = PLAZA_TAGS.includes(tag) ? tag : '吐槽'
  const safeMedia = Array.isArray(mediaUrls)
    ? mediaUrls.filter((u) => /^https:\/\/\S+$/.test(String(u))).slice(0, 3)
    : []
  try {
    const res: Any = await (cbRdb().from('plaza_posts') as Any)
      .insert({
        body: body.trim(),
        tag: safeTag,
        media_urls: safeMedia,
        creator_uid: creatorUid,
        creator_name: creatorName || '同学',
        creator_avatar: String(creatorAvatar || '').slice(0, 600),
      })
      .select('id')
    const err = readError(res?.error)
    if (err) return { error: err }
    const id = Array.isArray(res?.data) && res.data[0] ? Number(res.data[0].id) : undefined
    return { error: null, id }
  } catch (e) {
    return { error: errText(e) }
  }
}

export async function fetchPlazaMessageById(id: number): Promise<{ row: PlazaMessage | null; error: string | null }> {
  try {
    const res: Any = await (cbRdb().from('plaza_messages') as Any).select('*').eq('id', id).limit(1)
    const error = readError(res?.error)
    if (error) return { row: null, error }
    const row = Array.isArray(res?.data) ? res.data[0] : null
    return { row: row ? row as PlazaMessage : null, error: null }
  } catch (error) {
    return { row: null, error: errText(error) }
  }
}

export async function fetchPlazaPostById(id: number): Promise<{ row: PlazaPost | null; error: string | null }> {
  try {
    const res: Any = await (cbRdb().from('plaza_posts') as Any).select('*').eq('id', id).limit(1)
    const error = readError(res?.error)
    if (error) return { row: null, error }
    const row = Array.isArray(res?.data) ? res.data[0] : null
    return { row: row ? row as PlazaPost : null, error: null }
  } catch (error) {
    return { row: null, error: errText(error) }
  }
}

export async function deletePlazaPost(id: number): Promise<MutateRes> {
  try {
    const res: Any = await (cbRdb().from('plaza_posts') as Any).delete().eq('id', id)
    return { error: readError(res?.error) }
  } catch (e) {
    return { error: errText(e) }
  }
}

/* —— 浏览量 / 点赞 / 搜索 / 排行榜 —— */

/** 按指定列降序取帖子（排行榜用，views / likes） */
async function selectPostsOrderedBy(
  column: 'views' | 'likes',
  limit: number,
  offset = 0,
): Promise<QueryRes<PlazaPost>> {
  try {
    const pageSize = Math.max(1, Math.min(Math.floor(limit) || 8, 60))
    const start = Math.max(0, Math.floor(offset) || 0)
    const res: Any = await (cbRdb().from('plaza_posts') as Any)
      .select('*')
      .order(column, { ascending: false })
      // Resolve ties by recency so each refresh produces the same rank order.
      .order('id', { ascending: false })
      .range(start, start + pageSize)
    const err = readError(res?.error)
    if (err) return { rows: [], hasMore: false, error: err }
    const data = Array.isArray(res?.data) ? (res.data as PlazaPost[]) : []
    return { rows: data.slice(0, pageSize), hasMore: data.length > pageSize, error: null }
  } catch (e) {
    return { rows: [], hasMore: false, error: errText(e) }
  }
}

/** 浏览量排行（首页热门帖子 / 广场排行榜） */
export async function fetchHotPosts(limit = 6, offset = 0): Promise<QueryRes<PlazaPost>> {
  return selectPostsOrderedBy('views', limit, offset)
}

/** 点赞量排行（广场排行榜） */
export async function fetchTopLikedPosts(limit = 6, offset = 0): Promise<QueryRes<PlazaPost>> {
  return selectPostsOrderedBy('likes', limit, offset)
}

/** 搜索广场帖子（正文模糊匹配，不区分大小写） */
export async function searchPlazaPosts(keyword: string, limit = 40, beforeId?: number): Promise<QueryRes<PlazaPost>> {
  const kw = keyword.trim()
  if (kw.length < 2) return { rows: [], hasMore: false, error: null }
  if (beforeId !== undefined && (!Number.isSafeInteger(beforeId) || beforeId <= 0)) {
    return { rows: [], hasMore: false, error: '搜索位置无效，请重新搜索' }
  }
  const pageSize = Math.max(1, Math.min(Math.floor(limit) || 40, 60))
  // 转义 ilike 通配符（% _ \），避免被当作模式匹配符
  const safe = kw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
  try {
    let query: Any = (cbRdb().from('plaza_posts') as Any)
      .select('*')
      .ilike('body', `%${safe}%`)
      .order('id', { ascending: false })
    if (beforeId !== undefined) query = query.lt('id', beforeId)
    const res: Any = await query.limit(pageSize + 1)
    const err = readError(res?.error)
    if (err) return { rows: [], hasMore: false, error: err }
    const data = Array.isArray(res?.data) ? (res.data as PlazaPost[]) : []
    return { rows: data.slice(0, pageSize), hasMore: data.length > pageSize, error: null }
  } catch (e) {
    return { rows: [], hasMore: false, error: errText(e) }
  }
}

/** 帖子浏览量 +1（调用 SECURITY DEFINER RPC，绕过 RLS） */
export async function incrPostView(id: number): Promise<void> {
  try {
    await (cbRdb() as Any).rpc('incr_post_view', { pid: id })
  } catch {
    /* 浏览量统计失败不影响阅读 */
  }
}

/** 点赞切换（调用 RPC），返回 { liked, likes } */
export async function togglePostLike(
  id: number,
): Promise<{ liked: boolean; likes: number; error: string | null }> {
  try {
    const res: Any = await (cbRdb() as Any).rpc('toggle_post_like', { pid: id })
    const err = readError(res?.error)
    if (err) return { liked: false, likes: 0, error: err }
    let raw: unknown = res?.data
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw)
      } catch {
        return { liked: false, likes: 0, error: '服务端返回格式异常' }
      }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { liked: false, likes: 0, error: '服务端返回格式异常' }
    }
    const d = raw as Any
    const likes = typeof d.likes === 'number'
      ? d.likes
      : typeof d.likes === 'string' && d.likes.trim()
        ? Number(d.likes)
        : Number.NaN
    if (typeof d.liked !== 'boolean' || !Number.isSafeInteger(likes) || likes < 0) {
      return { liked: false, likes: 0, error: '服务端返回格式异常' }
    }
    return {
      liked: d.liked,
      likes,
      error: null,
    }
  } catch (e) {
    return { liked: false, likes: 0, error: errText(e) }
  }
}

/** 拉取当前用户已点赞的帖子 id 集合；查询失败与成功空集合必须区分。 */
export async function fetchLikedPostIds(uid: string): Promise<{ ids: Set<number>; error: string | null }> {
  try {
    const res: Any = await (cbRdb().from('plaza_post_likes') as Any)
      .select('post_id')
      .eq('uid', uid)
    const error = readError(res?.error)
    if (error) return { ids: new Set(), error }
    const rows = Array.isArray(res?.data) ? res.data : []
    const ids = rows.map((r: Any) => Number(r.post_id)).filter((id: number) => Number.isSafeInteger(id) && id > 0)
    return { ids: new Set(ids), error: null }
  } catch (error) {
    return { ids: new Set(), error: errText(error) }
  }
}
