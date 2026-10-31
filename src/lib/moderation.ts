/**
 * 管理端内容治理数据层
 *
 * 设计目标：把「两类商品下架/删除」与「三类评论删除/回复」收敛到同一套
 * 归一化形状，页面只管渲染，不再各写一套字段映射。
 *
 * 覆盖范围（均为学生端真实在用的主表，非历史遗留表）：
 *   商品：secondhand_items 二手闲置 · ebike_items 电动车
 *   评论：secondhand_item_comments 二手留言 · feedbacks 反馈墙 · secondhand_evaluations 成交评价
 *   帖子：tasks 校园任务 · help_items 生活求助
 *
 * 2026-10 交易链（食堂点餐 / 小店 / 档口 / 骑手）整体下线，治理口径同步收窄：
 * shop_goods 小店货架、canteen_dishes 档口菜品、canteen_reviews 档口评价
 * 已从本层摘除，管理端不再读写这三张表。
 *
 * 权限：前端 isAdmin 只用于界面呈现，真正的越权拦截由 PG 行级安全
 * （各表 DELETE / UPDATE 策略均含 is_admin_user()）兜底，与项目既有约定一致。
 *
 * 关联展示：需要「所属店铺名 / 所属商品标题」时统一先批量取父对象再本地 Map
 * 关联（fetchRowsByIds），避免逐条查询造成 N+1。
 */
import { deleteTask, fetchRowsByIds, mutateRows, queryRows } from './market'
import { cbRdb } from './cb'
import { HELP_KIND_TEXT, deleteHelp } from './bulletin'

/* ---------------- 归一化类型 ---------------- */

export type GoodsSource = 'secondhand_items' | 'ebike_items'
export type CommentSource =
  | 'secondhand_item_comments'
  | 'feedbacks'
  | 'secondhand_evaluations'

export interface ModGoods {
  source: GoodsSource
  id: number
  title: string
  price: number
  /** 归一化状态：on 在售 / off 已下架 / sold 已出 / pending 待审核 / rejected 未通过 */
  status: string
  /** 发布者展示名 */
  ownerName: string
  /** 所属楼栋 / 取货点，无则为空串 */
  parentLabel: string
  image: string
  createdAt: string
}

export interface ModComment {
  source: CommentSource
  id: number
  authorName: string
  content: string
  /** 仅评价类有星级，其余为 null */
  score: number | null
  /** 仅反馈墙支持管理员回复 */
  reply: string
  /** 所属商品 / 反馈分类，无则为空串 */
  parentLabel: string
  createdAt: string
}

export interface ModQueryRes<T> {
  rows: T[]
  error: string | null
  truncated?: boolean
}

/* ---------------- 文案字典 ---------------- */

export const GOODS_SOURCE_TEXT: Record<GoodsSource, string> = {
  secondhand_items: '二手闲置',
  ebike_items: '电动车',
}

export const COMMENT_SOURCE_TEXT: Record<CommentSource, string> = {
  secondhand_item_comments: '二手留言',
  feedbacks: '反馈墙',
  secondhand_evaluations: '成交评价',
}

export const GOODS_SOURCE_ORDER: GoodsSource[] = ['secondhand_items', 'ebike_items']

export const COMMENT_SOURCE_ORDER: CommentSource[] = [
  'secondhand_item_comments',
  'feedbacks',
  'secondhand_evaluations',
]

const STATUS_TEXT: Record<string, string> = {
  on: '在售',
  off: '已下架',
  sold: '已出',
  pending: '待审核',
  rejected: '未通过',
}

/** 状态胶囊文案；未知状态原样返回，避免新状态被吞成空白 */
export function goodsStatusText(status: string): string {
  return STATUS_TEXT[status] || status || '未知'
}

/** 状态胶囊色调：ok 绿 / off 灰 / warn 橙 / bad 红 */
export function goodsStatusTone(status: string): 'ok' | 'off' | 'warn' | 'bad' {
  if (status === 'on') return 'ok'
  if (status === 'off' || status === 'sold') return 'off'
  if (status === 'pending') return 'warn'
  return 'bad'
}

/** 只有「上过架」的类目可用二态开关；审核态由审核台处理，治理页仅提供下架/删除 */
export function canToggleGoods(status: string): boolean {
  return status === 'on' || status === 'off' || status === 'sold'
}

/** 下架 / 上架后的目标状态 */
export function nextGoodsStatus(status: string): 'on' | 'off' {
  return status === 'on' ? 'off' : 'on'
}

/** 评论来源是否支持管理员回复 */
export function canReplyComment(source: CommentSource): boolean {
  return source === 'feedbacks'
}

/* ---------------- 内部工具 ---------------- */

/** queryRows 要求行类型至少含 created_at 可选字段，这里给只读计数用的最小形状 */
interface IdRow {
  id: number
  created_at?: string
}

function firstImage(v: unknown): string {
  if (Array.isArray(v) && v.length) return String(v[0] || '')
  if (typeof v === 'string' && v) return v
  return ''
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function sortDesc<T extends { createdAt: string }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
    || Number((b as T & { id?: number }).id || 0) - Number((a as T & { id?: number }).id || 0)
    || String((b as T & { source?: string }).source || '').localeCompare(String((a as T & { source?: string }).source || '')))
}

/** 批量取「id -> 名称」，父对象缺失时回落为空串 */
async function nameMap(table: string, ids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>()
  const uniq = Array.from(new Set(ids.filter((n) => Number.isFinite(n) && n > 0)))
  if (!uniq.length) return map
  const r = await fetchRowsByIds<{ id: number; name?: string; title?: string }>(table, uniq)
  for (const row of r.rows) map.set(Number(row.id), String(row.name || row.title || ''))
  return map
}

/* ---------------- 商品：读取 ---------------- */

interface RawGoods {
  id: number
  title?: string
  name?: string
  price?: number
  status?: string
  created_at?: string
  images?: unknown
  building?: string
  pickup_place?: string
  creator_name?: string
  owner_name?: string
}

export type CreatedIdCursor = { created_at: string; id: number }
export type GoodsPageCursor = Record<GoodsSource, CreatedIdCursor | null>
export type GoodsPageRes = ModQueryRes<ModGoods> & { cursor: GoodsPageCursor; hasMore: Record<GoodsSource, boolean> }
const GOODS_PAGE_SIZE = 30
const GOODS_FIELDS = 'id,title,name,price,status,created_at,images,building,pickup_place,creator_name,owner_name'

async function fetchGoodsSourcePage(source: GoodsSource, cursor: CreatedIdCursor | null) {
  if (cursor && (!Number.isSafeInteger(cursor.id) || cursor.id <= 0
    || !/^[-0-9TtZz:.+ ]+$/.test(cursor.created_at) || !Number.isFinite(Date.parse(cursor.created_at)))) {
    return { rows: [] as RawGoods[], cursor, hasMore: false, error: '商品分页位置无效，请刷新列表' }
  }
  try {
    let q: any = (cbRdb().from(source) as any).select(GOODS_FIELDS)
    if (cursor) q = q.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`)
    const res = await q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(GOODS_PAGE_SIZE + 1)
    if (res?.error) return { rows: [] as RawGoods[], cursor, hasMore: false, error: String(res.error?.message || res.error) }
    const raw = Array.isArray(res?.data) ? res.data as RawGoods[] : []
    const rows = raw.slice(0, GOODS_PAGE_SIZE)
    const last = rows[rows.length - 1]
    return { rows, cursor: last?.created_at && last.id ? { created_at: last.created_at, id: last.id } : cursor, hasMore: raw.length > GOODS_PAGE_SIZE, error: null as string | null }
  } catch (error) {
    return { rows: [] as RawGoods[], cursor, hasMore: false, error: String((error as { message?: string })?.message || '暂时无法加载商品') }
  }
}

function mapGoods(source: GoodsSource, raw: RawGoods[]): ModGoods[] {
  return raw.map((r) => ({
    source, id: num(r.id), title: String(r.title || r.name || (source === 'secondhand_items' ? '未命名闲置' : '未命名车辆')),
    price: num(r.price), status: String(r.status || 'on'),
    ownerName: String((source === 'secondhand_items' ? r.creator_name : r.owner_name) || '同学'),
    parentLabel: String((source === 'secondhand_items' ? r.building : r.pickup_place) || ''),
    image: firstImage(r.images), createdAt: String(r.created_at || ''),
  }))
}

/** 管理端商品按来源独立使用 created_at + id 游标；只读取卡片字段。 */
export async function fetchGoodsPage(before: GoodsPageCursor = { secondhand_items: null, ebike_items: null }): Promise<GoodsPageRes> {
  const [item, ebike] = await Promise.all([
    fetchGoodsSourcePage('secondhand_items', before.secondhand_items),
    fetchGoodsSourcePage('ebike_items', before.ebike_items),
  ])
  const error = item.error || ebike.error
  if (error) return { rows: [], error, cursor: before, hasMore: { secondhand_items: false, ebike_items: false } }
  const rows = sortDesc([
    ...mapGoods('secondhand_items', item.rows),
    ...mapGoods('ebike_items', ebike.rows),
  ])
  return {
    rows, error: null,
    cursor: { secondhand_items: item.cursor, ebike_items: ebike.cursor },
    hasMore: { secondhand_items: item.hasMore, ebike_items: ebike.hasMore },
  }
}

/** Backward-compatible first page for existing consumers. */
export async function fetchAllGoods(): Promise<ModQueryRes<ModGoods>> {
  const [item, ebike] = await Promise.all([
    queryRows<RawGoods>('secondhand_items', undefined, 301, { newestFirst: true }),
    queryRows<RawGoods>('ebike_items', undefined, 301, { newestFirst: true }),
  ])
  const rows = sortDesc([
    ...mapGoods('secondhand_items', item.rows.slice(0, 300)),
    ...mapGoods('ebike_items', ebike.rows.slice(0, 300)),
  ])
  return { rows, error: item.error || ebike.error, truncated: item.rows.length > 300 || ebike.rows.length > 300 }
}

/* ---------------- 商品：写入 ---------------- */

const GOODS_TABLE: Record<GoodsSource, string> = {
  secondhand_items: 'secondhand_items',
  ebike_items: 'ebike_items',
}

/** 下架 / 恢复上架（电动车沿用同一 status 语义） */
export async function setGoodsStatus(
  source: GoodsSource,
  id: number,
  status: 'on' | 'off' | 'sold',
): Promise<{ error: string | null }> {
  return mutateRows(GOODS_TABLE[source], 'update', { status }, id)
}

export async function deleteGoods(source: GoodsSource, id: number): Promise<{ error: string | null }> {
  return mutateRows(GOODS_TABLE[source], 'delete', undefined, id)
}

/* ---------------- 评论：读取 ---------------- */

interface RawComment {
  id: number
  content?: string
  score?: number
  reply?: string
  created_at?: string
  item_id?: number
  creator_name?: string
  title?: string
  category?: string
}

/** 反馈墙「所属对象」用分类标签代替（它没有父级业务对象） */
const FEEDBACK_CATEGORY_TEXT: Record<string, string> = {
  complaint: '投诉',
  suggest: '建议',
  praise: '点赞',
  other: '其他',
}

export type CommentPageCursor = Record<CommentSource, CreatedIdCursor | null>
export type CommentPageRes = ModQueryRes<ModComment> & { cursor: CommentPageCursor; hasMore: Record<CommentSource, boolean> }
const COMMENT_PAGE_SIZE = 30
const COMMENT_FIELDS = 'id,content,score,reply,created_at,item_id,creator_name,title,category'

async function fetchCommentSourcePage(source: CommentSource, cursor: CreatedIdCursor | null) {
  if (cursor && (!Number.isSafeInteger(cursor.id) || cursor.id <= 0
    || !/^[-0-9TtZz:.+ ]+$/.test(cursor.created_at) || !Number.isFinite(Date.parse(cursor.created_at)))) {
    return { rows: [] as RawComment[], cursor, hasMore: false, error: '评论分页位置无效，请刷新列表' }
  }
  try {
    let q: any = (cbRdb().from(source) as any).select(COMMENT_FIELDS)
    if (cursor) q = q.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`)
    const res = await q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(COMMENT_PAGE_SIZE + 1)
    if (res?.error) return { rows: [] as RawComment[], cursor, hasMore: false, error: String(res.error?.message || res.error) }
    const raw = Array.isArray(res?.data) ? res.data as RawComment[] : []
    const rows = raw.slice(0, COMMENT_PAGE_SIZE)
    const last = rows[rows.length - 1]
    return { rows, cursor: last?.created_at && last.id ? { created_at: last.created_at, id: last.id } : cursor, hasMore: raw.length > COMMENT_PAGE_SIZE, error: null as string | null }
  } catch (error) {
    return { rows: [] as RawComment[], cursor, hasMore: false, error: String((error as { message?: string })?.message || '暂时无法加载评论') }
  }
}

/** 管理端评论按来源独立游标分页，父对象名称只为当前页批量查询。 */
export async function fetchCommentsPage(before: CommentPageCursor = {
  secondhand_item_comments: null, feedbacks: null, secondhand_evaluations: null,
}): Promise<CommentPageRes> {
  const [comment, feedback, evaluation] = await Promise.all([
    fetchCommentSourcePage('secondhand_item_comments', before.secondhand_item_comments),
    fetchCommentSourcePage('feedbacks', before.feedbacks),
    fetchCommentSourcePage('secondhand_evaluations', before.secondhand_evaluations),
  ])
  const error = comment.error || feedback.error || evaluation.error
  if (error) return { rows: [], error, cursor: before, hasMore: { secondhand_item_comments: false, feedbacks: false, secondhand_evaluations: false } }
  const itemIds = [...comment.rows, ...evaluation.rows].map((r) => num(r.item_id))
  const items = await nameMap('secondhand_items', itemIds)

  const rows: ModComment[] = []

  for (const r of comment.rows) {
    rows.push({
      source: 'secondhand_item_comments',
      id: num(r.id),
      authorName: String(r.creator_name || '同学'),
      content: String(r.content || ''),
      score: null,
      reply: '',
      parentLabel: items.get(num(r.item_id)) || '',
      createdAt: String(r.created_at || ''),
    })
  }

  for (const r of feedback.rows) {
    rows.push({
      source: 'feedbacks',
      id: num(r.id),
      authorName: String(r.creator_name || '同学'),
      content: String(r.title ? `${r.title} · ${r.content || ''}` : r.content || ''),
      score: null,
      reply: String(r.reply || ''),
      parentLabel: FEEDBACK_CATEGORY_TEXT[String(r.category || '')] || '其他',
      createdAt: String(r.created_at || ''),
    })
  }

  for (const r of evaluation.rows) {
    rows.push({
      source: 'secondhand_evaluations',
      id: num(r.id),
      authorName: '买家',
      content: String(r.content || ''),
      score: num(r.score),
      reply: '',
      parentLabel: items.get(num(r.item_id)) || '',
      createdAt: String(r.created_at || ''),
    })
  }

  return {
    rows: sortDesc(rows), error: null,
    cursor: {
      secondhand_item_comments: comment.cursor, feedbacks: feedback.cursor, secondhand_evaluations: evaluation.cursor,
    },
    hasMore: {
      secondhand_item_comments: comment.hasMore, feedbacks: feedback.hasMore, secondhand_evaluations: evaluation.hasMore,
    },
  }
}

/** Backward-compatible first page for existing consumers. */
export async function fetchAllComments(): Promise<ModQueryRes<ModComment>> {
  const [comment, feedback, evaluation] = await Promise.all([
    queryRows<RawComment>('secondhand_item_comments', undefined, 301, { newestFirst: true }),
    queryRows<RawComment>('feedbacks', undefined, 301, { newestFirst: true }),
    queryRows<RawComment>('secondhand_evaluations', undefined, 301, { newestFirst: true }),
  ])
  const commentRows = comment.rows.slice(0, 300)
  const feedbackRows = feedback.rows.slice(0, 300)
  const evaluationRows = evaluation.rows.slice(0, 300)
  const items = await nameMap('secondhand_items', [...commentRows, ...evaluationRows].map((r) => num(r.item_id)))
  const rows: ModComment[] = [
    ...commentRows.map((r): ModComment => ({
      source: 'secondhand_item_comments', id: num(r.id), authorName: String(r.creator_name || '同学'),
      content: String(r.content || ''), score: null, reply: '', parentLabel: items.get(num(r.item_id)) || '', createdAt: String(r.created_at || ''),
    })),
    ...feedbackRows.map((r): ModComment => ({
      source: 'feedbacks', id: num(r.id), authorName: String(r.creator_name || '同学'),
      content: String(r.title ? `${r.title} · ${r.content || ''}` : r.content || ''), score: null,
      reply: String(r.reply || ''), parentLabel: FEEDBACK_CATEGORY_TEXT[String(r.category || '')] || '其他', createdAt: String(r.created_at || ''),
    })),
    ...evaluationRows.map((r): ModComment => ({
      source: 'secondhand_evaluations', id: num(r.id), authorName: '买家', content: String(r.content || ''),
      score: num(r.score), reply: '', parentLabel: items.get(num(r.item_id)) || '', createdAt: String(r.created_at || ''),
    })),
  ]
  return {
    rows: sortDesc(rows), error: comment.error || feedback.error || evaluation.error,
    truncated: comment.rows.length > 300 || feedback.rows.length > 300 || evaluation.rows.length > 300,
  }
}

/* ---------------- 评论：写入 ---------------- */

const COMMENT_TABLE: Record<CommentSource, string> = {
  secondhand_item_comments: 'secondhand_item_comments',
  feedbacks: 'feedbacks',
  secondhand_evaluations: 'secondhand_evaluations',
}

export async function deleteComment(source: CommentSource, id: number): Promise<{ error: string | null }> {
  return mutateRows(COMMENT_TABLE[source], 'delete', undefined, id)
}

/**
 * 管理员回复。
 * - feedbacks：写 reply，并把 open 推进为 replied（已关闭的保持 closed，只补内容）
 * secondhand_item_comments / secondhand_evaluations 无 UPDATE 策略，
 * 因此不支持回复（见 canReplyComment）。
 */
export async function replyComment(
  source: CommentSource,
  id: number,
  reply: string,
  currentStatus?: string,
): Promise<{ error: string | null }> {
  if (source === 'feedbacks') {
    const status = currentStatus === 'closed' ? 'closed' : 'replied'
    return mutateRows(
      'feedbacks',
      'update',
      { reply, status, handled_at: new Date().toISOString() },
      id,
    )
  }
  return { error: '该类评价不支持回复' }
}

/* ---------------- 帖子：校园任务 / 生活求助 ---------------- */

export type PostSource = 'tasks' | 'help_items'

/** 归一化后的任务 / 求助行 */
export interface ModPost {
  source: PostSource
  id: number
  title: string
  /** 正文（任务/求助描述），可能为空串 */
  body: string
  /** 类目文字：任务种类 / 求助种类 */
  kindText: string
  authorName: string
  /** 报酬 / 地点 / 期望时间等补充信息，已拼成一行 */
  metaText: string
  status: string
  createdAt: string
}

export const POST_SOURCE_TEXT: Record<PostSource, string> = {
  tasks: '校园任务',
  help_items: '生活求助',
}

export const POST_SOURCE_ORDER: PostSource[] = ['tasks', 'help_items']

/** 行首图标：任务与求助语义不同，用图标区分来源 */
export const POST_SOURCE_ICON: Record<PostSource, string> = {
  tasks: '📋',
  help_items: '🤝',
}

/** 状态文案：两类表的同名字段含义不同（open 在任务是待接单、在求助是进行中），按来源取值 */
const POST_STATUS_TEXT: Record<PostSource, Record<string, string>> = {
  tasks: { open: '待接单', doing: '进行中', done: '已完成', cancelled: '已关闭' },
  help_items: { open: '进行中', done: '已解决', closed: '已关闭' },
}

export function postStatusText(source: PostSource, status: string): string {
  return POST_STATUS_TEXT[source]?.[status] || status || '未知'
}

/** 状态胶囊色调：待处理/进行中=绿，已结束/已关闭=灰，其余=橙 */
export function postStatusTone(status: string): 'ok' | 'off' | 'warn' | 'bad' {
  if (status === 'open' || status === 'doing') return 'ok'
  if (status === 'done' || status === 'closed' || status === 'cancelled') return 'off'
  return 'warn'
}

interface RawPost {
  id: number
  title?: string
  description?: string
  kind?: string
  reward?: string
  location?: string
  deadline?: string
  place?: string
  expect_at?: string
  creator_name?: string
  status?: string
  created_at?: string
}

/**
 * 仅 help_items 缺失时才提示互助表未建，tasks 缺表属于独立故障。
 * 只认「对象确定不存在」的确定性信号：`relation` / `not found` 这类泛化词
 * 在网络抖动或临时 5xx 的报错文本里同样会命中，会把瞬时故障误报成「表没建」。
 */
function postErrHint(source: PostSource, err: string): string {
  if (source !== 'help_items') return err
  return /404|PGRST20[45]|does not exist|schema cache/i.test(err)
    ? '互助板块的数据表还没建好，请让管理员在云开发控制台确认 public.help_items 是否存在'
    : err
}

function joinMeta(parts: Array<string | number>): string {
  return parts
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
    .join(' · ')
}

export interface PostCursor { created_at: string; id: number }
export interface PostsPageCursor { tasks: PostCursor | null; help_items: PostCursor | null }
export interface PostsPageRes extends ModQueryRes<ModPost> {
  cursor: PostsPageCursor
  hasMore: { tasks: boolean; help_items: boolean }
}

const POST_PAGE_SIZE = 30
const POST_FIELDS = 'id,title,description,kind,reward,location,deadline,place,expect_at,creator_name,status,created_at'

/** 管理端任务/求助使用稳定游标分页，只读取审核展示字段，不读取联系方式等个人信息。 */
export async function fetchPostsPage(before: PostsPageCursor = { tasks: null, help_items: null }): Promise<PostsPageRes> {
  const page = async (table: PostSource, cursor: PostCursor | null) => {
    if (cursor && (!Number.isSafeInteger(cursor.id) || cursor.id <= 0
      || !/^[-0-9TtZz:.+ ]+$/.test(cursor.created_at)
      || !Number.isFinite(Date.parse(cursor.created_at)))) {
      return { rows: [] as RawPost[], hasMore: false, error: '分页位置无效，请刷新列表' }
    }
    try {
      let q: any = (cbRdb().from(table) as any).select(POST_FIELDS)
      if (cursor) q = q.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`)
      const res = await q.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(POST_PAGE_SIZE + 1)
      if (res?.error) return { rows: [] as RawPost[], hasMore: false, error: String(res.error?.message || res.error) }
      const rows = Array.isArray(res?.data) ? res.data as RawPost[] : []
      return { rows: rows.slice(0, POST_PAGE_SIZE), hasMore: rows.length > POST_PAGE_SIZE, error: null as string | null }
    } catch (e) {
      return { rows: [] as RawPost[], hasMore: false, error: String((e as { message?: string })?.message || '暂时无法加载内容') }
    }
  }
  const [tasks, help] = await Promise.all([page('tasks', before.tasks), page('help_items', before.help_items)])

  const rows: ModPost[] = []

  for (const r of tasks.rows) {
    rows.push({
      source: 'tasks',
      id: num(r.id),
      title: String(r.title || '未命名任务'),
      body: String(r.description || ''),
      kindText: String(r.kind || '其他'),
      authorName: String(r.creator_name || '同学'),
      metaText: joinMeta([r.reward ? `¥${r.reward}` : '', r.location || '', r.deadline || '']),
      status: String(r.status || 'open'),
      createdAt: String(r.created_at || ''),
    })
  }

  for (const r of help.rows) {
    rows.push({
      source: 'help_items',
      id: num(r.id),
      title: String(r.title || '未命名求助'),
      body: String(r.description || ''),
      kindText: HELP_KIND_TEXT[String(r.kind || 'help')] || String(r.kind || '求助'),
      authorName: String(r.creator_name || '同学'),
      metaText: joinMeta([r.place || '', r.expect_at || '']),
      status: String(r.status || 'open'),
      createdAt: String(r.created_at || ''),
    })
  }

  const err = tasks.error ? tasks.error : help.error ? postErrHint('help_items', help.error) : null
  const next = (items: RawPost[], old: PostCursor | null): PostCursor | null => {
    const last = items[items.length - 1]
    return last?.created_at && last.id ? { created_at: last.created_at, id: last.id } : old
  }
  return {
    rows: sortDesc(rows), error: err,
    cursor: { tasks: next(tasks.rows, before.tasks), help_items: next(help.rows, before.help_items) },
    hasMore: { tasks: tasks.hasMore, help_items: help.hasMore },
  }
}

/**
 * 管理员删除任务 / 求助。
 * tasks_delete_own / help_delete_own 策略为 `creator_uid = auth.uid() OR is_admin_user()`，
 * 管理员可跨用户删除，普通学生仍只能删自己发布的。
 * 复用学生端既有 deleteTask / deleteHelp，避免同一张表出现两套删除实现。
 */
export async function deletePost(source: PostSource, id: number): Promise<{ error: string | null }> {
  if (source === 'tasks') return deleteTask(id)
  return deleteHelp(id)
}

/* ---------------- 管理页徽标 ---------------- */

/** 待处理数（反馈墙未处理 + 待审核电动车），用于设置页入口卡徽标 */
export async function fetchModerationPendingCount(): Promise<{ count: number | null; atLeast: boolean }> {
  const [feedback, ebike] = await Promise.all([
    queryRows<IdRow>('feedbacks', { status: 'open' }, 201, { newestFirst: true }),
    queryRows<IdRow>('ebike_items', { status: 'pending' }, 201, { newestFirst: true }),
  ])
  if (feedback.error || ebike.error) return { count: null, atLeast: false }
  return {
    count: Math.min(feedback.rows.length, 200) + Math.min(ebike.rows.length, 200),
    atLeast: feedback.rows.length > 200 || ebike.rows.length > 200,
  }
}

/** 商品 / 评论总览计数（管理页顶部参数卡） */
export async function fetchModerationStats(): Promise<{
  goods: number | null; comments: number | null; offGoods: number | null
  goodsAtLeast: boolean; commentsAtLeast: boolean; offGoodsAtLeast: boolean
}> {
  try {
    const [goods, comments] = await Promise.all([fetchAllGoods(), fetchAllComments()])
    return {
      goods: goods.error ? null : goods.rows.length,
      comments: comments.error ? null : comments.rows.length,
      offGoods: goods.error ? null : goods.rows.filter((g) => g.status === 'off' || g.status === 'sold').length,
      goodsAtLeast: !!goods.truncated,
      commentsAtLeast: !!comments.truncated,
      offGoodsAtLeast: !!goods.truncated,
    }
  } catch {
    return { goods: null, comments: null, offGoods: null, goodsAtLeast: false, commentsAtLeast: false, offGoodsAtLeast: false }
  }
}

/** 会话探针：确认当前登录态能读到主表（失败时不阻塞页面渲染，只做提示） */
export async function probeRdb(): Promise<boolean> {
  const r = await queryRows<IdRow>('secondhand_items', undefined, 1)
  return !r.error
}
