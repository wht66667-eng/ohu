/**
 * 同学院交流群：一个学院一个官方群，成员按 profiles.college 自动归属。
 *
 * 设计取舍：**不引入群成员表**。
 *   成员 = profiles.college 与本群 college_key 相同的用户。
 *   好处：加入 / 换学院只是改 profiles.college 一列，无需维护成员关系与一致性；
 *   代价：暂时做不到「一人同时在多个群」和群内未读红点（真需要时再加成员表）。
 *
 * 数据模型（复用私信体系，不新建消息表）：
 *   chat_threads  中 kind='group' 的行即学院群，college_key 与 profiles.college 对应
 *   chat_messages 复用同一张表，thread_id 指向学院群
 *
 * 权限：读消息走 chat_in_thread()（已支持 college 匹配）；发消息走 chat_group_send()。
 */
import { cbRdb } from './cb'
import { normMessage, type ChatMessageItem } from './chat'

type Any = Record<string, any>

/** 学院群列表项：与 public.chat_college_groups() 返回结构一一对应 */
export interface CollegeGroup {
  threadId: number
  collegeKey: string
  title: string
  memberCount: number
}

/** 年级可选项（选填） */
export const GRADES = ['大一', '大二', '大三', '大四', '大五', '研究生'] as const

/**
 * 学院可选项：key 与 chat_threads.college_key / profiles.college 一致。
 *
 * 与 src/data/zhongce.ts 的 COLLEGES 名单保持同步（那边是综合测评细则用），
 * 新增 / 改名学院时两边都要改，否则会出现「选得到学院但进不了群」。
 */
export const COLLEGE_OPTIONS: { key: string; name: string }[] = [
  { key: 'yingyong', name: '应用技术学院' },
  { key: 'huagong', name: '环境与化学工程学院' },
  { key: 'lixue', name: '理学院' },
  { key: 'haiyang', name: '海洋科学与水产学院' },
  { key: 'haice', name: '海洋技术与测绘学院' },
  { key: 'shipin', name: '食品科学与工程学院' },
  { key: 'jixie', name: '机械工程学院' },
  { key: 'dianzi', name: '电子信息工程学院' },
  { key: 'shang', name: '商学院' },
  { key: 'wenfa', name: '文法学院' },
  { key: 'waiyu', name: '外国语学院' },
  { key: 'tumugang', name: '土木与港航工程学院' },
  { key: 'chuangxin', name: '创新创业学院' },
]

/** key → 学院名；拿不到就回退成 key 本身 */
export function collegeName(key?: string | null): string {
  const k = String(key || '').trim()
  if (!k) return ''
  return COLLEGE_OPTIONS.find((c) => c.key === k)?.name || k
}

/** 后端返回形态不统一（数组 / {data:[...]}），统一摊平成数组 */
function toRows(raw: Any | null): Any[] {
  if (Array.isArray(raw)) return raw
  if (raw && Array.isArray(raw.data)) return raw.data
  if (raw && Array.isArray(raw.rows)) return raw.rows
  return []
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function errText(e: unknown): string {
  const m = (e as { message?: unknown })?.message
  return typeof m === 'string' && m ? m : '操作失败，请稍后重试'
}

async function rpcJson(name: string, params: Any): Promise<{ raw: Any | null; error: string | null }> {
  try {
    const res: Any = await (cbRdb() as Any).rpc(name, params)
    const err = (res?.error as { message?: string } | null | undefined)?.message
    if (err) return { raw: null, error: err }
    return { raw: (res?.data ?? null) as Any | null, error: null }
  } catch (e) {
    return { raw: null, error: errText(e) }
  }
}

/** 全部学院群（含成员数）；失败返回空数组，不抛错 */
export async function fetchCollegeGroups(): Promise<CollegeGroup[]> {
  const { raw, error } = await rpcJson('chat_college_groups', {})
  if (error || !raw) return []
  return toRows(raw).map((r) => ({
    threadId: num(r?.thread_id),
    collegeKey: String(r?.college_key || ''),
    title: String(r?.title || ''),
    memberCount: num(r?.member_count),
  }))
}

/** 我所属学院的那个群；没填学院或查不到时返回 null */
export async function fetchMyCollegeGroup(uid: string): Promise<CollegeGroup | null> {
  if (!uid) return null
  try {
    const res = await cbRdb()
      .from('profiles')
      .select('college')
      .eq('uid', uid)
      .limit(1)
    const row = ((res as { data?: unknown }).data as Any[] | null)?.[0]
    const key = String(row?.college || '').trim()
    if (!key) return null
    const groups = await fetchCollegeGroups()
    return groups.find((g) => g.collegeKey === key) ?? null
  } catch {
    return null
  }
}

/** 设置 / 更改所属学院（即加入对应学院群） */
export async function joinCollegeGroup(collegeKey: string): Promise<{ error: string | null }> {
  const key = String(collegeKey || '').trim()
  if (!key) return { error: '请选择学院' }
  const { raw, error } = await rpcJson('chat_college_join', { p_college_key: key })
  if (error) return { error }
  if (raw && raw.ok === false) return { error: String(raw.message || '加入失败，请稍后重试') }
  return { error: null }
}

/**
 * 群成员（同学院的人）。当前不要直接查 profiles —— 它的 SELECT 策略是
 * profiles_select_own（uid = auth.uid()），直查只能拿到自己这一行，
 * 结果会静默变成「群里只有我」。真要列成员得照 chat_college_groups() 加一个
 * SECURITY DEFINER RPC。前端暂无调用点，仅预留结构。
 */
export interface GroupMember {
  uid: string
  username: string
  college: string
}

export async function fetchGroupMembers(collegeKey: string): Promise<GroupMember[]> {
  const key = String(collegeKey || '').trim()
  if (!key) return []
  try {
    const res = await cbRdb()
      .from('profiles')
      .select('uid,username,college')
      .eq('college', key)
      .limit(200)
    const rows = ((res as { data?: unknown }).data as Any[] | null) ?? []
    return rows.map((r) => ({
      uid: String(r?.uid || ''),
      username: String(r?.username || '同学'),
      college: String(r?.college || ''),
    }))
  } catch {
    return []
  }
}

/** 发送结果：与 chat.ts 的 ChatSendResult 同形，便于会话页复用同一套上屏逻辑 */
export interface CollegeGroupSendResult {
  message: ChatMessageItem
  threadId: number
}

/**
 * 学院群发言底层通道：走 chat_group_send。
 *
 * 为什么不能复用 chat_send：
 *   1. chat_send 围绕「会话双方」设计，未读要落在 user_unread / peer_unread，
 *      而学院群每个成员未读数各不相同，单行两列存不下；
 *   2. 更关键的是 chat_send 的成员判据是 `user_uid = uid OR peer_uid = uid`，
 *      群会话两列皆 NULL，三值逻辑下判据为 NULL —— 既不拒绝也不放行到正确分支，
 *      等于任何登录用户都能往任意学院群写消息。chat_group_send 显式校验
 *      kind='group' 且 profiles.college = college_key。
 */
async function groupSendRaw(
  threadId: number,
  params: Any,
): Promise<{ data: CollegeGroupSendResult | null; error: string | null }> {
  if (!threadId) return { data: null, error: '群聊不存在' }
  const { raw, error } = await rpcJson('chat_group_send', params)
  if (error) return { data: null, error }
  const msg = normMessage(raw?.message)
  if (!msg.id) return { data: null, error: '消息发送失败' }
  return { data: { message: msg, threadId }, error: null }
}

/** 在学院群里发一条文本消息 */
export async function sendCollegeGroupMessage(
  threadId: number,
  body: string,
  senderRole = 'user',
): Promise<{ data: CollegeGroupSendResult | null; error: string | null }> {
  const text = String(body || '').trim()
  if (!text) return { data: null, error: '消息内容不能为空' }
  if (text.length > 2000) return { data: null, error: '消息内容不能超过 2000 字' }
  return groupSendRaw(threadId, {
    p_thread_id: threadId,
    p_body: text,
    p_sender_role: senderRole,
  })
}

/**
 * 在学院群里发一张图片：url 必须已上传到 CloudBase images 桶。
 * 服务端只存 URL（正文统一落 '[图片]'）。
 */
export async function sendCollegeGroupImage(
  threadId: number,
  url: string,
  senderRole = 'user',
): Promise<{ data: CollegeGroupSendResult | null; error: string | null }> {
  const safe = String(url || '').trim()
  if (!/^https:\/\/\S+$/.test(safe) || safe.length > 1024) {
    return { data: null, error: '图片地址无效，请重新发送' }
  }
  return groupSendRaw(threadId, {
    p_thread_id: threadId,
    p_body: '[图片]',
    p_sender_role: senderRole,
    p_kind: 'image',
    p_media_url: safe,
  })
}
