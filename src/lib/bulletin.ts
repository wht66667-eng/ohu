/**
 * 校园信息站数据层：公告 news / 活动 activities / 报名 / 失物招领 lost_items
 *
 * - 公开列表：读公开视图 v_news_public / v_activities_public / v_lost_public（匿名可读，已剥联系方式）
 * - 失物详情联系方式：登录后读主表 lost_items（RLS 允许非游客登录用户读全部行）
 * - 活动报名：activity_signups（每人每活动一条，服务端触发器校验名额/重复）
 */
import { cbRdb } from './cb'
import { fmtTime } from './market'

/* ---------------- 类型 ---------------- */

export interface News {
  id: number
  title: string
  summary: string
  body: string
  cover: string
  tag: string
  source: string
  is_top: boolean
  creator_name: string
  status: string
  published_at: string
  created_at: string
}

export interface Activity {
  id: number
  title: string
  organizer: string
  description: string
  tag: string
  location: string
  start_at: string
  end_at: string
  seats: number
  cover: string
  creator_name: string
  creator_uid?: string // 主表读回才有（视图脱敏）
  signup_count: number
  status: string
  created_at: string
  /** activity=校园活动（默认） teamup=组队出行；旧数据缺省视为 activity */
  category?: string
}

/** 组队出行类目（复用 activities 表，category='teamup'） */
export const TEAMUP_CATEGORY = 'teamup'

export interface LostItem {
  id: number
  kind: 'lost' | 'found'
  category: string
  title: string
  description: string
  place: string
  happen_at: string
  creator_name: string
  creator_uid?: string // 主表读回才有（视图脱敏）
  status: string
  created_at: string
  contact?: string
}

type Any = Record<string, any>

export interface QueryRes<T> {
  rows: T[]
  error: string | null
}

export interface MutateRes {
  error: string | null
}

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

function sortDesc<T extends { created_at?: string }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
}

async function selectRows<T>(name: string, filters?: Record<string, string | number | boolean>): Promise<QueryRes<T>> {
  try {
    let q: Any = (cbRdb().from(name) as Any).select('*')
    if (filters) {
      for (const k of Object.keys(filters)) {
        const v = filters[k]
        q = typeof v === 'boolean' ? q.eq(k, v) : q.eq(k, v)
      }
    }
    const res = await q
    const err = readError(res?.error)
    if (err) return { rows: [], error: err }
    const data = Array.isArray(res?.data) ? (res.data as T[]) : []
    return { rows: data, error: null }
  } catch (e) {
    return { rows: [], error: errText(e) }
  }
}

async function mutate(name: string, kind: 'insert' | 'update' | 'delete', body?: Record<string, unknown>, where?: Record<string, unknown>): Promise<MutateRes> {
  try {
    const q: Any = cbRdb().from(name) as Any
    let res: { error?: { message?: string } | string }
    if (kind === 'insert' && body) {
      res = await q.insert(body)
      return { error: readError(res?.error) }
    }
    if (kind === 'update' && body && where) {
      let wq: Any = q.update(body)
      for (const k of Object.keys(where)) wq = wq.eq(k, where[k])
      res = await wq
      return { error: readError(res?.error) }
    }
    if (kind === 'delete' && where) {
      let wq: Any = q.delete()
      for (const k of Object.keys(where)) wq = wq.eq(k, where[k])
      res = await wq
      return { error: readError(res?.error) }
    }
    return { error: '参数错误' }
  } catch (e) {
    return { error: errText(e) }
  }
}

/* ---------------- 公告 news ---------------- */

/** 把 datetime-local 之类的输入规整成 ISO；非法或空一律返回 null（= 用当前时间） */
function normalizePublishAt(v?: string | null): string | null {
  const raw = String(v || '').trim()
  if (!raw) return null
  const t = new Date(raw).getTime()
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/** 还没到点：已置为 published 但生效时间在未来，学生端此刻看不到 */
export function isScheduledNews(n: Pick<News, 'status' | 'published_at'>): boolean {
  if (n.status !== 'published') return false
  const t = new Date(String(n.published_at || '')).getTime()
  return Number.isFinite(t) && t > Date.now()
}

export async function fetchNews(): Promise<QueryRes<News>> {
  const res = await selectRows<News>('v_news_public')
  if (res.error) return res
  const now = Date.now()
  const visible = res.rows.filter((n) => {
    if (n.status && n.status !== 'published') return false
    // 定时公告：到点才出现
    const t = new Date(String(n.published_at || '')).getTime()
    return !Number.isFinite(t) || t <= now
  })
  const sorted = visible.slice().sort((a, b) => {
    if (!!a.is_top !== !!b.is_top) return a.is_top ? -1 : 1
    return String(b.published_at || '').localeCompare(String(a.published_at || ''))
  })
  return { rows: sorted.slice(0, 30), error: null }
}

/** 管理端：含已下架公告的全量（登录管理员可读全部行） */
export async function fetchNewsAll(): Promise<QueryRes<News>> {
  return selectRows<News>('news')
}

export interface NewsDraft {
  title: string
  summary: string
  body: string
  tag: string
  source: string
  creator_name: string
  cover?: string
}

/**
 * 新建公告。
 * publishAt 传未来时间即为「定时发布」：状态直接置为 published，但 published_at 是未来时刻，
 * 学生端 fetchNews() 会过滤掉未到点的行，到点自动出现，无需服务端定时任务。
 */
export async function createNews(
  d: NewsDraft,
  status: 'draft' | 'published' = 'draft',
  publishAt?: string | null,
): Promise<MutateRes & { id?: number }> {
  try {
    const at = normalizePublishAt(publishAt)
    const body = {
      ...d,
      status,
      published_at: at ?? (status === 'published' ? new Date().toISOString() : null),
    }
    const res: Any = await (cbRdb().from('news') as Any).insert(body).select('id')
    const err = readError(res?.error)
    if (err) return { error: err }
    const id = Array.isArray(res?.data) && res.data[0] ? Number(res.data[0].id) : undefined
    return { error: null, id }
  } catch (e) {
    return { error: errText(e) }
  }
}

/** 编辑公告（正文/封面等，仅管理员或本人可改） */
export async function updateNews(id: number, patch: Partial<NewsDraft>): Promise<MutateRes> {
  return mutate('news', 'update', patch as unknown as Record<string, unknown>, { id })
}

/** 删除公告 */
export async function deleteNews(id: number): Promise<MutateRes> {
  return mutate('news', 'delete', undefined, { id })
}

export async function setNewsStatus(
  id: number,
  status: 'draft' | 'published' | 'hidden',
  publishAt?: string | null,
): Promise<MutateRes> {
  const patch: Record<string, unknown> = { status }
  const at = normalizePublishAt(publishAt)
  if (status === 'published') patch.published_at = at ?? new Date().toISOString()
  return mutate('news', 'update', patch, { id })
}

/** 同时只保留一条置顶 */
export async function pinNewsExclusive(id: number, on: boolean): Promise<MutateRes> {
  if (on) {
    const all = await fetchNewsAll()
    if (!all.error) {
      for (const row of all.rows) {
        if (row.id !== id && row.is_top) await setNewsTop(row.id, false)
      }
    }
  }
  return setNewsTop(id, on)
}

export interface NewsBroadcast {
  id: number
  news_id: number | null
  title: string
  body: string
  actor_name: string
  created_at: string
}

const BROADCAST_DAY_CAP = 8

export async function fetchNewsBroadcasts(): Promise<QueryRes<NewsBroadcast>> {
  try {
    const res: Any = await (cbRdb().from('news_broadcasts') as Any)
      .select('id,news_id,title,body,actor_name,created_at')
      .order('id', { ascending: false })
      .limit(30)
    const err = readError(res?.error)
    if (err) return { rows: [], error: err }
    const rows = (Array.isArray(res?.data) ? res.data : []).map((raw: Any) => ({
      id: Number(raw.id || 0),
      news_id: raw.news_id == null ? null : Number(raw.news_id),
      title: String(raw.title || ''),
      body: String(raw.body || ''),
      actor_name: String(raw.actor_name || ''),
      created_at: String(raw.created_at || ''),
    }))
    return { rows, error: null }
  } catch (e) {
    return { rows: [], error: errText(e) }
  }
}

export interface NewsBroadcastStat {
  broadcast_id: number
  news_id: number | null
  title: string
  created_at: string
  read_count: number
}

/**
 * 管理端：每条站内信的已读人数。
 * news_broadcast_reads 的 RLS 是 `uid = auth.uid()`，管理员直接查只能看到自己的已读记录，
 * 所以走 `news_broadcast_stats` RPC（security definer + is_admin_user() 守卫）。
 * RPC 还没上线时返回空数组，页面降级为「暂不可统计」，不影响其他功能。
 */
export async function fetchNewsBroadcastStats(): Promise<QueryRes<NewsBroadcastStat>> {
  try {
    const res: Any = await (cbRdb() as Any).rpc('news_broadcast_stats', { p_limit: 50 })
    const err = readError(res?.error)
    if (err) return { rows: [], error: err }
    const raw = Array.isArray(res?.data) ? res.data : []
    const rows = raw.map((r: Any) => ({
      broadcast_id: Number(r.broadcast_id || 0),
      news_id: r.news_id == null ? null : Number(r.news_id),
      title: String(r.title || ''),
      created_at: String(r.created_at || ''),
      read_count: Number(r.read_count || 0),
    }))
    return { rows, error: null }
  } catch (e) {
    return { rows: [], error: errText(e) }
  }
}

export async function fetchReadBroadcastIds(uid: string): Promise<Set<number>> {
  if (!uid) return new Set()
  try {
    const res: Any = await (cbRdb().from('news_broadcast_reads') as Any)
      .select('broadcast_id')
      .eq('uid', uid)
      .limit(80)
    const ids = (Array.isArray(res?.data) ? res.data : []).map((r: Any) => Number(r.broadcast_id))
    return new Set(ids.filter((n: number) => n > 0))
  } catch {
    return new Set()
  }
}

export async function markBroadcastRead(id: number, uid: string): Promise<MutateRes> {
  if (!uid || !id) return { error: null }
  try {
    const res: Any = await (cbRdb().from('news_broadcast_reads') as Any).insert({
      broadcast_id: id,
      uid,
      read_at: new Date().toISOString(),
    })
    const err = readError(res?.error)
    if (err && /duplicate|unique|23505/i.test(err)) return { error: null }
    return { error: err }
  } catch (e) {
    return { error: errText(e) }
  }
}

/** 给学生端写一条站内通知（管理端发布公告时勾选「通知学生」才写）。每天全校最多 8 条。 */
export async function notifyStudentsOfNews(input: {
  newsId: number | null
  title: string
  body: string
  actorUid: string
  actorName: string
}): Promise<MutateRes> {
  const title = input.title.trim()
  if (!title) return { error: '公告标题为空，无法通知' }
  const recent = await fetchNewsBroadcasts()
  if (recent.error) return { error: recent.error }
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const today = recent.rows.filter((r) => new Date(r.created_at).getTime() >= start.getTime()).length
  if (today >= BROADCAST_DAY_CAP) return { error: `今天已发 ${BROADCAST_DAY_CAP} 条全员通知，请明天再发` }
  try {
    const res: Any = await (cbRdb().from('news_broadcasts') as Any).insert({
      news_id: input.newsId,
      title: title.slice(0, 80),
      body: input.body.trim().slice(0, 140),
      actor_uid: input.actorUid || '',
      actor_name: input.actorName || '管理员',
      created_at: new Date().toISOString(),
    })
    return { error: readError(res?.error) }
  } catch (e) {
    return { error: errText(e) }
  }
}

/** 置顶/取消置顶（仅管理员可改他人公告；本人发布亦可） */
export async function setNewsTop(id: number, isTop: boolean): Promise<MutateRes> {
  return mutate('news', 'update', { is_top: isTop }, { id })
}

export async function setActivityStatus(id: number, status: 'open' | 'closed' | 'cancelled'): Promise<MutateRes> {
  return mutate('activities', 'update', { status }, { id })
}

/* ---------------- 活动 activities ---------------- */

export async function fetchActivities(category = 'activity'): Promise<QueryRes<Activity>> {
  const res = await selectRows<Activity>('v_activities_public', { category })
  // 兼容：目标库尚未执行 20260927000000_mutual_help.sql（无 category 列）时退回客户端筛选
  if (res.error) {
    const all = await selectRows<Activity>('v_activities_public')
    if (all.error) return res
    return {
      rows: sortDesc(all.rows)
        .filter((r) => (r.category || 'activity') === category)
        .slice(0, 30),
      error: null,
    }
  }
  return { rows: sortDesc(res.rows).slice(0, 30), error: null }
}

/** 活动详情（主表读回：拿到 creator_uid 判断本人可管理） */
export async function fetchActivityDetail(id: number): Promise<QueryRes<Activity>> {
  const res = await selectRows<Activity>('activities', { id })
  if (res.error) return res
  return { rows: res.rows.map((r) => ({ ...r, signup_count: Number(r.signup_count) || 0 })), error: null }
}

/** 按 id 批量取活动主表行（供“我报名的活动”组装；可能含已关闭活动） */
export async function fetchActivitiesByIds(ids: number[], category = 'activity'): Promise<QueryRes<Activity>> {
  if (!ids.length) return { rows: [], error: null }
  try {
    let q: Any = (cbRdb().from('activities') as Any).select('*').in('id', ids)
    const res = await q
    const err = readError(res?.error)
    if (err) return { rows: [], error: err }
    const data = Array.isArray(res?.data) ? (res.data as Activity[]) : []
    return {
      rows: sortDesc(data)
        .filter((r) => (r.category || 'activity') === category)
        .map((r) => ({ ...r, signup_count: Number(r.signup_count) || 0 })),
      error: null,
    }
  } catch (e) {
    return { rows: [], error: errText(e) }
  }
}

export interface ActivityDraft {
  title: string
  organizer: string
  description: string
  tag: string
  location: string
  start_at: string
  end_at: string
  seats: number
  cover: string
  creator_name: string
  /** 缺省 'activity'；组队出行传 'teamup' */
  category?: string
}

/** 发布活动（真实登录用户即可，RLS 允许本人非游客发布） */
export async function createActivity(d: ActivityDraft): Promise<MutateRes> {
  const res = await mutate('activities', 'insert', { ...d, status: 'open' } as unknown as Record<string, unknown>)
  if (!res.error && (d.category || 'activity') === TEAMUP_CATEGORY) {
    void import('./activity-ping').then(({ pingBehavior }) => pingBehavior.teamupPublish())
  }
  return res
}

/** 我发起的活动（含已结束/取消，避免主办人把活动关闭后失去管理入口）；报名数从公开视图合并 */
export async function fetchMyCreatedActivities(uid: string, category = 'activity'): Promise<QueryRes<Activity>> {
  try {
    let mine = await selectRows<Activity>('activities', { creator_uid: uid, category })
    // 兼容：目标库尚未执行 20260927000000_mutual_help.sql（无 category 列）时退回客户端筛选
    if (mine.error) {
      mine = await selectRows<Activity>('activities', { creator_uid: uid })
      if (mine.error) return mine
    }
    const countById = new Map<number, number>()
    const pub = await selectRows<Activity>('v_activities_public')
    if (!pub.error) {
      for (const r of pub.rows) countById.set(Number(r.id), Number(r.signup_count) || 0)
    }
    return {
      rows: sortDesc(mine.rows)
        .filter((r) => (r.category || 'activity') === category)
        .map((r) => {
          const id = Number(r.id)
          const c = countById.get(id)
          return { ...r, signup_count: c === undefined ? Number(r.signup_count) || 0 : c }
        }),
      error: null,
    }
  } catch (e) {
    return { rows: [], error: errText(e) }
  }
}

/** 主办人/管理员删除自己发起的活动（报名记录由外键级联删除） */
export async function deleteActivity(id: number): Promise<MutateRes> {
  return mutate('activities', 'delete', undefined, { id })
}

export interface ActivitySignup {
  id: number
  activity_id: number
  uid: string
  name: string
  building: string
  contact: string
  created_at: string
}

/** 某活动的报名名单（主办人可读，依赖 20260914100000 迁移放行 organizer 策略） */
export async function fetchActivitySignups(activity_id: number): Promise<QueryRes<ActivitySignup>> {
  return selectRows<ActivitySignup>('activity_signups', { activity_id })
}

/** 我报名过的活动 id 列表 */
export async function fetchMySignupIds(uid: string): Promise<number[]> {
  try {
    const q: Any = (cbRdb().from('activity_signups') as Any).select('activity_id').eq('uid', uid)
    const res = await q
    const data = Array.isArray(res?.data) ? (res.data as Array<{ activity_id: number }>) : []
    return data.map((r) => Number(r.activity_id)).filter((n) => !Number.isNaN(n))
  } catch {
    return []
  }
}

export interface SignupPayload {
  activity_id: number
  uid: string
  name: string
  building: string
  contact: string
}

export async function signupActivity(
  p: SignupPayload,
  opts?: { category?: string },
): Promise<MutateRes> {
  const res = await mutate('activity_signups', 'insert', p as unknown as Record<string, unknown>)
  if (!res.error && (opts?.category || '') === TEAMUP_CATEGORY) {
    void import('./activity-ping').then(({ pingBehavior }) => pingBehavior.teamupJoin())
  }
  return res
}

export async function cancelSignup(activity_id: number, uid: string): Promise<MutateRes> {
  return mutate('activity_signups', 'delete', undefined, { activity_id, uid })
}

/* ---------------- 失物招领 lost_items ---------------- */

export async function fetchLostList(kind?: 'lost' | 'found'): Promise<QueryRes<LostItem>> {
  const res = await selectRows<LostItem>('v_lost_public', kind ? { kind } : undefined)
  if (res.error) return res
  return { rows: sortDesc(res.rows).slice(0, 40), error: null }
}

/** 详情（登录后）读主表拿联系方式 */
export async function fetchLostDetail(id: number): Promise<QueryRes<LostItem>> {
  return selectRows<LostItem>('lost_items', { id })
}

export interface LostDraft {
  kind: 'lost' | 'found'
  category: string
  title: string
  description: string
  place: string
  happen_at: string
  contact: string
  creator_name: string
}

export async function publishLost(d: LostDraft): Promise<MutateRes> {
  return mutate('lost_items', 'insert', { ...d, status: 'open' } as unknown as Record<string, unknown>)
}

export async function setLostStatus(id: number, status: 'open' | 'done' | 'closed'): Promise<MutateRes> {
  return mutate('lost_items', 'update', { status }, { id })
}

/** 我的失物发布（含 closed/done，主表含联系方式） */
export async function fetchLostMine(uid: string): Promise<QueryRes<LostItem>> {
  return selectRows<LostItem>('lost_items', { creator_uid: uid })
}

export async function deleteLost(id: number): Promise<MutateRes> {
  return mutate('lost_items', 'delete', undefined, { id })
}

/* ---------------- 生活求助墙 help_items ---------------- */

export interface HelpItem {
  id: number
  /** pin=拼单凑单 borrow=借东西 help=临时求助 partner=求带组队 */
  kind: string
  category: string
  title: string
  description: string
  place: string
  expect_at: string
  creator_name: string
  creator_uid?: string // 主表读回才有（视图脱敏）
  status: string
  created_at: string
  contact?: string
}

export interface HelpDraft {
  kind: string
  category: string
  title: string
  description: string
  place: string
  expect_at: string
  contact: string
  creator_name: string
  /** 配图，text[]；列由 docs/release/ugc-images.sql 补出 */
  images?: string[]
}

/** 迁移未执行时的可读提示（help_items / v_help_public 尚不存在） */
function helpErrHint(err: string): string {
  return /404|does not exist|relation|column .* does not exist|schema cache|not found/i.test(err)
    ? '互助板块的数据库还未初始化，请先执行 cloudbase/migrations/20260927000000_mutual_help.sql'
    : err
}

/** 浏览求助墙（读公开视图，已剥联系方式） */
export async function fetchHelpList(kind?: string): Promise<QueryRes<HelpItem>> {
  const res = await selectRows<HelpItem>('v_help_public', kind ? { kind } : undefined)
  if (res.error) return { rows: [], error: helpErrHint(res.error) }
  return { rows: sortDesc(res.rows).slice(0, 40), error: null }
}

/** 详情（读主表，本人/管理员可管理） */
export async function fetchHelpDetail(id: number): Promise<QueryRes<HelpItem>> {
  const res = await selectRows<HelpItem>('help_items', { id })
  if (res.error) return { rows: [], error: helpErrHint(res.error) }
  return res
}

/** 我的求助发布（含 closed/done） */
export async function fetchHelpMine(uid: string): Promise<QueryRes<HelpItem>> {
  const res = await selectRows<HelpItem>('help_items', { creator_uid: uid })
  if (res.error) return { rows: [], error: helpErrHint(res.error) }
  return res
}

export async function publishHelp(d: HelpDraft): Promise<MutateRes> {
  const res = await mutate('help_items', 'insert', { ...d, status: 'open' } as unknown as Record<string, unknown>)
  if (!res.error) {
    void import('./activity-ping').then(({ pingBehavior }) => pingBehavior.helpPublish())
  }
  return res.error ? { error: helpErrHint(res.error) } : res
}

export async function setHelpStatus(id: number, status: 'open' | 'done' | 'closed'): Promise<MutateRes> {
  const res = await mutate('help_items', 'update', { status }, { id })
  if (!res.error && status === 'done') {
    void import('./activity-ping').then(({ pingBehavior }) => pingBehavior.helpDone())
  }
  return res.error ? { error: helpErrHint(res.error) } : res
}

export async function deleteHelp(id: number): Promise<MutateRes> {
  const res = await mutate('help_items', 'delete', undefined, { id })
  return res.error ? { error: helpErrHint(res.error) } : res
}

/* ---------------- 展示 ---------------- */

export const LOST_KIND_TEXT: Record<string, string> = { lost: '寻物', found: '招领' }

export const LOST_STATUS_TEXT: Record<string, string> = { open: '进行中', done: '已解决', closed: '已关闭' }

export const ACTIVITY_STATUS_TEXT: Record<string, string> = { open: '报名中', closed: '已结束', cancelled: '已取消' }

/** 报名人数/名额的统一文案（活动与组队共用，放在数据层避免组件间循环依赖） */
export function activitySeatText(a: Activity): string {
  const n = a.signup_count || 0
  return !a.seats || a.seats <= 0 ? `不限人数 · 已加入 ${n} 人` : `限 ${a.seats} 人 · 已加入 ${n} 人`
}

export const HELP_KIND_TEXT: Record<string, string> = {
  pin: '拼单凑单',
  borrow: '借东西',
  help: '临时求助',
  partner: '求带组队',
}

export const HELP_STATUS_TEXT: Record<string, string> = { open: '进行中', done: '已解决', closed: '已关闭' }

/** 求助墙分类（与 src/data/content.ts 的 help 任务组口径一致） */
export const HELP_CATS = ['拼单凑单', '借东西', '求带组队', '临时求助', '其他']

/** 求助墙筛选（value 为空串代表全部；对应 help_items.kind） */
export const HELP_KIND_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'pin', label: '拼单凑单' },
  { value: 'borrow', label: '借东西' },
  { value: 'partner', label: '求带组队' },
  { value: 'help', label: '临时求助' },
]

/** 组队出行类目（复用 activities 表） */
export const TEAMUP_TAGS = ['同城出游', '返乡同行', '运动搭子', '拼车同行', '其他']

export function fmtBulletinTime(iso?: string): string {
  return fmtTime(iso)
}
