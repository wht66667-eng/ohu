/**
 * 二手成交数据层：成交意向 / 商品留言 / 成交评价
 *
 * - 成交意向 secondhand_deals：RLS 保证只能读到「我参与」的意向；先到先得由部分唯一索引兜底。
 * - 留言 secondhand_item_comments：公开读走 v_secondhand_item_comments_public（匿名可见），写主表需登录。
 * - 评价 secondhand_evaluations：成交 done 后由买家评卖家（ratee=商品发布者），聚合读 v_secondhand_ratings_public。
 */
import type { ItemStatus } from './market'
import { fetchRowsByIds, mutateRows, queryRows } from './market'

export type DealStatus = 'requested' | 'accepted' | 'done' | 'cancelled' | 'rejected'

export const DEAL_STATUS_TEXT: Record<DealStatus, string> = {
  requested: '待卖家回复',
  accepted: '卖家已同意',
  done: '已成交',
  cancelled: '已取消',
  rejected: '卖家未接受',
}

export const DEAL_STATUS_HINT: Record<DealStatus, string> = {
  requested: '意向已发出，等卖家确认后当面交易。',
  accepted: '卖家已同意这笔交易，请按卖家备注联系交接。',
  done: '当面交易已完成，记得互相打个招呼～',
  cancelled: '这笔意向已取消。',
  rejected: '卖家暂时没有接受这笔报价，可再去逛逛别的。',
}

export interface Deal {
  id: number
  item_id: number
  buyer_uid: string
  seller_uid: string
  price: number
  note: string
  seller_reply: string
  status: DealStatus
  finished_at: string | null
  created_at: string
  updated_at: string
}

/** 成交记录 + 商品摘要（本地 join secondhand_items 主表） */
export interface DealRow extends Deal {
  item_title?: string
  item_price?: number
  item_category?: string
  item_building?: string
  item_images?: string[]
  item_status?: ItemStatus
  item_creator_name?: string
}

export interface DealComment {
  id: number
  item_id: number
  creator_uid?: string
  creator_name: string
  content: string
  created_at: string
}

export interface DealEval {
  id: number
  deal_id: number
  item_id: number
  rater_uid?: string
  ratee_uid: string
  score: number
  content: string
  created_at: string
}

export interface ItemRating {
  item_id: number
  rating_count: number
  rating_avg: number
  created_at?: string
}

/** 我的全部成交意向：先取主表（RLS 只回我参与的），再用商品主表做本地 join 补摘要 */
export async function fetchMyDeals(uid: string): Promise<{ rows: DealRow[]; error: string | null }> {
  if (!uid) return { rows: [], error: null }
  const r = await queryRows<Deal>('secondhand_deals', undefined, 300)
  if (r.error) return { rows: [], error: r.error }
  const ids = Array.from(new Set(r.rows.map((d) => Number(d.item_id))))
  const itemRes = await fetchRowsByIds<{
    id: number
    title: string
    price?: number
    category?: string
    building?: string
    images?: string[]
    status?: ItemStatus
    creator_name?: string
  }>('secondhand_items', ids)
  const map = new Map<number, (typeof itemRes.rows)[number]>()
  for (const it of itemRes.rows) map.set(Number(it.id), it)
  const rows: DealRow[] = r.rows.map((d) => {
    const it = map.get(Number(d.item_id))
    return {
      ...d,
      item_title: it?.title,
      item_price: it?.price,
      item_category: it?.category,
      item_building: it?.building,
      item_images: it?.images,
      item_status: it?.status,
      item_creator_name: it?.creator_name,
    }
  })
  return { rows, error: null }
}

/** 某个商品下「我参与」的意向（详情页展示当前状态用；他人意向不可见） */
export async function fetchDealByItem(itemId: number): Promise<{ row: Deal | null; error: string | null }> {
  const r = await queryRows<Deal>('secondhand_deals', { item_id: itemId }, 1)
  if (r.error) return { row: null, error: r.error }
  return { row: r.rows[0] || null, error: null }
}

export interface DealDraft {
  itemId: number
  sellerUid: string
  price: number
  note: string
}

/** 买家发起成交意向（RLS 校验商品在售、卖家=发布者、非本人） */
export async function createDeal(d: DealDraft): Promise<{ error: string | null }> {
  return mutateRows(
    'secondhand_deals',
    'insert',
    {
      item_id: d.itemId,
      seller_uid: d.sellerUid,
      price: d.price,
      note: d.note,
      status: 'requested',
    } as unknown as Record<string, unknown>,
  )
}

/** 推进意向状态：买家取消 / 卖家同意或拒绝（可附言） / 卖家标记成交 */
export async function setDealStatus(
  id: number,
  status: DealStatus,
  sellerReply?: string,
): Promise<{ error: string | null }> {
  const body: Record<string, unknown> = { status }
  if (status === 'done') body.finished_at = new Date().toISOString()
  if (sellerReply != null) body.seller_reply = sellerReply
  return mutateRows('secondhand_deals', 'update', body, id)
}

/** 取消进行中的意向（仅 requested 允许前端引导；服务端不做阶段强校验，靠人工自觉） */
export async function cancelDeal(id: number): Promise<{ error: string | null }> {
  return mutateRows('secondhand_deals', 'update', { status: 'cancelled' } as unknown as Record<string, unknown>, id)
}

/* ---------------- 商品留言 ---------------- */

export async function fetchItemComments(
  itemId: number,
  mainTable = false,
): Promise<{ rows: DealComment[]; error: string | null }> {
  // 已登录读主表可获得 creator_uid（用于“删除我的留言”）；游客只能读脱敏视图
  const name = mainTable ? 'secondhand_item_comments' : 'v_secondhand_item_comments_public'
  const r = await queryRows<DealComment>(name, { item_id: itemId }, 80)
  if (r.error) return { rows: [], error: r.error }
  // 时间升序（最新在底部），阅读顺序自然
  r.rows.reverse()
  return r
}

export async function addItemComment(itemId: number, creatorName: string, content: string): Promise<{ error: string | null }> {
  return mutateRows(
    'secondhand_item_comments',
    'insert',
    { item_id: itemId, creator_name: creatorName, content } as unknown as Record<string, unknown>,
  )
}

export async function deleteItemComment(id: number): Promise<{ error: string | null }> {
  return mutateRows('secondhand_item_comments', 'delete', undefined, id)
}

/* ---------------- 成交评价（买家评卖家） ---------------- */

export async function fetchItemRating(itemId: number): Promise<{ rating: ItemRating | null; error: string | null }> {
  const r = await queryRows<ItemRating>('v_secondhand_ratings_public', { item_id: itemId }, 1)
  if (r.error) return { rating: null, error: r.error }
  return { rating: r.rows[0] || null, error: null }
}

/** 我在某笔成交里写的评价（有则不允许重复评） */
export async function fetchMyDealEval(dealId: number): Promise<{ row: DealEval | null; error: string | null }> {
  const r = await queryRows<DealEval>('secondhand_evaluations', { deal_id: dealId }, 1)
  if (r.error) return { row: null, error: r.error }
  return { row: r.rows[0] || null, error: null }
}

/** 新增评价：rateeUid 传商品卖家（= 交易对手）；服务端策略校验「成交 done + 本人参与 + ratee=发布者」 */
export async function addEvaluation(
  deal: DealRow,
  rateeUid: string,
  score: number,
  content: string,
): Promise<{ error: string | null }> {
  return mutateRows(
    'secondhand_evaluations',
    'insert',
    {
      deal_id: deal.id,
      item_id: deal.item_id,
      ratee_uid: rateeUid,
      score,
      content,
    } as unknown as Record<string, unknown>,
  )
}

