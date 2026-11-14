/**
 * 账单草稿箱（M2.5·B1）：三条入口（通知监听／截图 OCR／CSV 导入）共用的「待确认」层。
 *
 * 铁律（方案 §5）：草稿绝不静默入账，也不进首页汇总——
 * `summarizeLifeRecords` 只读 `ohu-life-records`，本库独立为 `ohu-bill-inbox`，
 * 只有用户在草稿箱点确认后才调 `addLifeRecord`（source 带入口类型，externalId 带去重键）。
 * 去重：草稿间互挡 + 与已确认账本（[owner, externalId] 索引）互挡；跨渠道 ≤120 秒
 * 同金额同商户标「疑似同一笔」由用户裁决。草稿保留 7 天，过期清理时提示一次。
 */
import { addLifeRecord, listExpenseExternalIds, type PayChannel } from './life-records.ts'
import { billDedupeKey, flagSuspectedDuplicates, type ParsedBillRow } from './bill-csv.ts'

export interface BillDraft {
  owner: string
  id: string
  createdAt: number
  channel: PayChannel
  direction: 'out' | 'in'
  amountCents: number
  merchant: string
  note?: string
  occurredAt: number
  /** 去重键（=账本 externalId），落库后不可变。 */
  externalId: string
  rawId?: string
  suspect?: boolean
}

export const BILL_INBOX_CHANGED_EVENT = 'ohu-bill-inbox-changed'
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function billDraftId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** 草稿所属「本地日期」键（YYYY-MM-DD），供草稿箱按天分组；与账本 day 同口径。 */
export function dayKeyOf(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function openBillInbox(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ohu-bill-inbox', 1)
    let blocked = false
    request.onupgradeneeded = () => {
      const drafts = request.result.createObjectStore('drafts', { keyPath: ['owner', 'id'] })
      drafts.createIndex('owner', 'owner')
    }
    request.onsuccess = () => {
      if (blocked) request.result.close()
      else resolve(request.result)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => {
      blocked = true
      reject(new Error('请关闭其他哦狐页面后重试'))
    }
  })
}

function notifyInboxChanged(owner: string) {
  window.dispatchEvent(new CustomEvent(BILL_INBOX_CHANGED_EVENT, { detail: { owner } }))
}

export interface ImportBillResult { added: number; duplicates: number }

/** 解析行 → 草稿；跳过与待确认草稿、已确认账本重复的行，其余入库。
 *  「疑似同一笔」在全草稿箱范围重算（存量＋新批次），跨渠道 ≤120 秒同金额同商户互相标记。 */
export async function addBillDrafts(owner: string, rows: ParsedBillRow[]): Promise<ImportBillResult> {
  const existing = await listBillDrafts(owner, { prune: false })
  const [inboxKeys, confirmedKeys] = await Promise.all([Promise.resolve(new Set(existing.map(draft => draft.externalId))), listExpenseExternalIds(owner)])
  const drafts: BillDraft[] = []
  let duplicates = 0
  for (const row of rows) {
    const externalId = await billDedupeKey(row.channel, row.amountCents, row.merchant, row.occurredAt)
    if (inboxKeys.has(externalId) || confirmedKeys.has(externalId)) { duplicates += 1; continue }
    if (drafts.some(draft => draft.externalId === externalId)) { duplicates += 1; continue }
    drafts.push({
      owner,
      id: billDraftId(),
      createdAt: Date.now(),
      channel: row.channel,
      direction: row.direction,
      amountCents: row.amountCents,
      merchant: row.merchant,
      note: row.note,
      occurredAt: row.occurredAt,
      externalId,
      rawId: row.rawId,
    })
  }
  // 全箱重算疑似标记：新批次与存量草稿互相影响，变化的存量也要写回。
  const union = [...existing.map(({ suspect: _ignored, ...draft }) => draft), ...drafts]
  const flagged = flagSuspectedDuplicates(union.map(draft => ({
    channel: draft.channel as 'wechat' | 'alipay' | 'bank' | 'other',
    direction: draft.direction,
    amountCents: draft.amountCents,
    merchant: draft.merchant,
    note: draft.note,
    occurredAt: draft.occurredAt,
    rawId: draft.rawId,
  })))
  const suspectById = new Map(flagged.map((row, index) => [union[index].id, row.suspect === true]))
  const writes = [...drafts.map(draft => ({ ...draft, suspect: suspectById.get(draft.id) === true }))]
  for (const draft of existing) {
    const suspect = suspectById.get(draft.id) === true
    if (suspect !== draft.suspect) writes.push({ ...draft, suspect })
  }
  if (writes.length) {
    const db = await openBillInbox()
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('drafts', 'readwrite')
        const store = transaction.objectStore('drafts')
        writes.forEach(draft => store.put(draft))
        transaction.oncomplete = () => resolve()
        transaction.onabort = () => reject(transaction.error ?? new Error('账单草稿保存失败'))
      })
    } finally { db.close() }
    notifyInboxChanged(owner)
  }
  return { added: drafts.length, duplicates }
}

export async function listBillDrafts(owner: string, options: { prune?: boolean } = {}): Promise<BillDraft[]> {
  const db = await openBillInbox()
  try {
    const rows = await new Promise<BillDraft[]>((resolve, reject) => {
      const transaction = db.transaction('drafts', 'readwrite')
      const index = transaction.objectStore('drafts').index('owner')
      const request = index.getAll(owner)
      transaction.oncomplete = () => resolve(request.result as BillDraft[])
      transaction.onabort = () => reject(transaction.error ?? new Error('账单草稿读取失败'))
    })
    const now = Date.now()
    const expired = rows.filter(row => now - row.createdAt > DRAFT_TTL_MS)
    if (options.prune !== false && expired.length) {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('drafts', 'readwrite')
        const store = transaction.objectStore('drafts')
        expired.forEach(row => store.delete([owner, row.id]))
        transaction.oncomplete = () => resolve()
        transaction.onabort = () => reject(transaction.error ?? new Error('账单草稿清理失败'))
      })
    }
    const kept = options.prune === false ? rows : rows.filter(row => now - row.createdAt <= DRAFT_TTL_MS)
    return kept.sort((a, b) => b.occurredAt - a.occurredAt)
  } finally { db.close() }
}

export interface ConfirmBillResult { confirmed: number; failed: Array<{ id: string; reason: string }> }

/** 确认草稿 → addLifeRecord（source 按入口；category 暂归「其他」，可后续编辑）。 */
export async function confirmBillDrafts(owner: string, ids: string[], source: BillDraftSource = 'csv'): Promise<ConfirmBillResult> {
  const drafts = await listBillDrafts(owner, { prune: false })
  const byId = new Map(drafts.map(draft => [draft.id, draft]))
  const confirmed: BillDraft[] = []
  const failed: Array<{ id: string; reason: string }> = []
  for (const id of ids) {
    const draft = byId.get(id)
    if (!draft) continue
    try {
      await addLifeRecord({
        owner,
        day: dayKeyOf(draft.occurredAt),
        kind: 'expense',
        amountCents: draft.amountCents,
        category: '其他',
        direction: draft.direction,
        note: draft.note,
        merchant: draft.merchant,
        channel: draft.channel,
        source,
        externalId: draft.externalId,
        occurredAt: draft.occurredAt,
      })
      confirmed.push(draft)
    } catch (reason) {
      failed.push({ id, reason: reason instanceof Error ? reason.message : '入账失败，请重试。' })
    }
  }
  if (confirmed.length) {
    const db = await openBillInbox()
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('drafts', 'readwrite')
        const store = transaction.objectStore('drafts')
        confirmed.forEach(draft => store.delete([owner, draft.id]))
        transaction.oncomplete = () => resolve()
        transaction.onabort = () => reject(transaction.error ?? new Error('账单草稿更新失败'))
      })
    } finally { db.close() }
    notifyInboxChanged(owner)
  }
  return { confirmed: confirmed.length, failed }
}

export type BillDraftSource = 'csv' | 'notification' | 'ocr'

export async function dismissBillDrafts(owner: string, ids: string[]): Promise<number> {
  if (!ids.length) return 0
  const db = await openBillInbox()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('drafts', 'readwrite')
      const store = transaction.objectStore('drafts')
      ids.forEach(id => store.delete([owner, id]))
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error ?? new Error('账单草稿丢弃失败'))
    })
  } finally { db.close() }
  notifyInboxChanged(owner)
  return ids.length
}
