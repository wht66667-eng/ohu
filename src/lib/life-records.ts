import { localDateKey } from './chat-fortune.ts'

export type LifeRecordKind = 'water' | 'meal' | 'expense' | 'note'
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export type MoneyDirection = 'out' | 'in'
export type PhotoPreset = 'cup' | 'meal' | 'photo'
/** 账单来源：手动记 / 通知监听 / 截图识别 / CSV 导入（M2.5·B4）。 */
export type ExpenseSource = 'manual' | 'notification' | 'ocr' | 'csv'
/** 支付渠道：去重键与「疑似同一笔」判定都依赖它。 */
export type PayChannel = 'wechat' | 'alipay' | 'bank' | 'other'
export const PAY_CHANNELS: readonly PayChannel[] = ['wechat', 'alipay', 'bank', 'other']

/** 原图与贴纸随记录稳定 ID 同存一条记录；edge／preset 是可重新编辑的处理参数。 */
export interface LifeRecordPhoto {
  id: string
  original: string
  sticker: string
  preset: PhotoPreset
  edge: 'none' | 'paper' | 'white' | 'torn'
}

interface LifeRecordBase {
  owner: string
  id: string
  day: string
  kind: LifeRecordKind
  createdAt: number
  updatedAt: number
  note?: string
  photo?: LifeRecordPhoto
}
export interface WaterRecord extends LifeRecordBase { kind: 'water'; ml: number }
export interface MealRecord extends LifeRecordBase { kind: 'meal'; mealType: MealType; name: string }
export interface ExpenseRecord extends LifeRecordBase {
  kind: 'expense'
  amountCents: number
  category: string
  direction: MoneyDirection
  /** 交易对方（解析/OCR 提取或手动填写）；录入时间在 createdAt，交易时间在这里，两者不混用。 */
  merchant?: string
  channel?: PayChannel
  source: ExpenseSource
  /** 去重键 sha256(channel|amountCents|merchantKey|minuteBucket)，见账单方案 §4；落库后不可变。 */
  externalId?: string
  occurredAt?: number
}
export interface NoteRecord extends LifeRecordBase { kind: 'note'; text: string }
export type LifeRecord = WaterRecord | MealRecord | ExpenseRecord | NoteRecord

export type LifeRecordInput = { owner: string; day?: string } & (
  | { kind: 'water'; ml: number; note?: string; photo?: LifeRecordPhoto }
  | { kind: 'meal'; mealType: MealType; name: string; note?: string; photo?: LifeRecordPhoto }
  | {
      kind: 'expense'
      amountCents: number
      category: string
      direction: MoneyDirection
      note?: string
      merchant?: string
      channel?: PayChannel
      source?: ExpenseSource
      externalId?: string
      occurredAt?: number
    }
  | { kind: 'note'; text: string }
)

export const MEAL_TYPES: { value: MealType; label: string }[] = [
  { value: 'breakfast', label: '早餐' },
  { value: 'lunch', label: '午餐' },
  { value: 'dinner', label: '晚餐' },
  { value: 'snack', label: '加餐' },
]
export const EXPENSE_CATEGORIES = ['餐饮', '交通', '学习', '日用', '娱乐', '医疗', '其他']
export const INCOME_CATEGORIES = ['生活费', '兼职', '报销', '其他']
export const WATER_PRESETS = [150, 250, 500]
export const PHOTO_PRESETS: { value: PhotoPreset; label: string }[] = [
  { value: 'cup', label: '饮水杯' },
  { value: 'meal', label: '餐食' },
  { value: 'photo', label: '普通照片' },
]
export const LIFE_RECORDS_CHANGED_EVENT = 'ohu-life-records-changed'

const MAX_AMOUNT_CENTS = 100_000_000
const MAX_WATER_ML = 10_000

export function lifeRecordId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** 金额以分存储：只接受最多两位小数的正数，拒绝静默四舍五入与溢出。 */
export function parseAmountCents(input: string): number | null {
  const cleaned = input.trim().replace(/^[¥￥]\s*/, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [yuan, frac = ''] = cleaned.split('.')
  const cents = Number(yuan) * 100 + Number((frac + '00').slice(0, 2))
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_AMOUNT_CENTS) return null
  return cents
}

export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2)
}

export function mealLabel(type: MealType): string {
  return MEAL_TYPES.find(item => item.value === type)?.label ?? type
}

/** 杯子／餐食默认纸边相片贴纸，普通照片默认无白边；自动抠图属后续阶段。 */
export function defaultEdgeForPreset(preset: PhotoPreset): LifeRecordPhoto['edge'] {
  return preset === 'photo' ? 'none' : 'paper'
}

/** 列表用的一句话描述，纯函数，便于测试与复用。 */
export function describeLifeRecord(record: LifeRecord): string {
  if (record.kind === 'water') return `喝水 ${record.ml} mL`
  if (record.kind === 'meal') return `${mealLabel(record.mealType)} · ${record.name}`
  if (record.kind === 'expense') return `${record.direction === 'in' ? '收入' : '支出'} ¥${formatCents(record.amountCents)} · ${record.category}`
  return record.text
}

export function formatRecordTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function clampWaterMl(ml: number): number | null {
  if (!Number.isInteger(ml) || ml <= 0 || ml > MAX_WATER_ML) return null
  return ml
}

export interface DaySummary {
  count: number
  waterMl: number
  mealCount: number
  expenseOutCents: number
  expenseInCents: number
  noteCount: number
}

/** 汇总始终由记录重算：重复打开当天页面、重拍或更换贴纸都不会增加总量。 */
export function summarizeLifeRecords(records: LifeRecord[]): DaySummary {
  const summary: DaySummary = { count: 0, waterMl: 0, mealCount: 0, expenseOutCents: 0, expenseInCents: 0, noteCount: 0 }
  for (const record of records) {
    summary.count += 1
    if (record.kind === 'water') summary.waterMl += record.ml
    else if (record.kind === 'meal') summary.mealCount += 1
    else if (record.kind === 'note') summary.noteCount += 1
    else if (record.direction === 'in') summary.expenseInCents += record.amountCents
    else summary.expenseOutCents += record.amountCents
  }
  return summary
}

function validate(input: LifeRecordInput) {
  if (input.kind === 'water') {
    if (clampWaterMl(input.ml) === null) throw new Error('饮水量需为 1–10000 之间的整数毫升。')
  } else if (input.kind === 'meal') {
    if (!MEAL_TYPES.some(type => type.value === input.mealType)) throw new Error('请选择餐次。')
    if (!input.name.trim()) throw new Error('请填写餐名。')
  } else if (input.kind === 'expense') {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > MAX_AMOUNT_CENTS) throw new Error('金额无效，请填写大于 0 的数字。')
    if (input.direction !== 'out' && input.direction !== 'in') throw new Error('请选择收支方向。')
    if (!input.category.trim()) throw new Error('请选择分类。')
    if (input.source !== undefined && !['manual', 'notification', 'ocr', 'csv'].includes(input.source)) throw new Error('账单来源无效。')
    if (input.channel !== undefined && !PAY_CHANNELS.includes(input.channel)) throw new Error('支付渠道无效。')
    if (input.occurredAt !== undefined && (!Number.isSafeInteger(input.occurredAt) || input.occurredAt <= 0)) throw new Error('交易时间无效。')
    if (input.externalId !== undefined && (!input.externalId.trim() || input.externalId.length > 128)) throw new Error('账单去重标识无效。')
  } else if (input.kind === 'note') {
    if (!input.text.trim()) throw new Error('请先写一句话。')
  }
}

function openLifeRecords(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // v2（M2.5·B4）：ExpenseRecord 增来源与去重字段；升级时给存量记录补 source:'manual'，
    // 并加 [owner, externalId] 索引供账单导入去重查询。旧字段一律不动。
    const request = indexedDB.open('ohu-life-records', 2)
    let blocked = false
    request.onupgradeneeded = event => {
      const oldVersion = event.oldVersion
      const db = request.result
      const records = db.objectStoreNames.contains('records')
        ? request.transaction!.objectStore('records')
        : db.createObjectStore('records', { keyPath: ['owner', 'id'] })
      if (!records.indexNames.contains('owner')) records.createIndex('owner', 'owner')
      if (!records.indexNames.contains('ownerDay')) records.createIndex('ownerDay', ['owner', 'day'])
      if (!records.indexNames.contains('ownerExternal')) records.createIndex('ownerExternal', ['owner', 'externalId'])
      if (oldVersion < 1) return
      const cursor = records.openCursor()
      cursor.onsuccess = () => {
        const at = cursor.result
        if (!at) return
        const row = at.value as LifeRecord
        if (row.kind === 'expense' && !row.source) at.update({ ...row, source: 'manual' })
        at.continue()
      }
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

async function lifeRequest<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openLifeRecords()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('records', mode)
      const request = operation(transaction.objectStore('records'))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error ?? request.error)
    })
  } finally { db.close() }
}

function notifyChanged(owner: string, day: string) {
  window.dispatchEvent(new CustomEvent(LIFE_RECORDS_CHANGED_EVENT, { detail: { owner, day } }))
}

export async function addLifeRecord(input: LifeRecordInput): Promise<LifeRecord> {
  validate(input)
  const now = Date.now()
  const day = input.day ?? localDateKey()
  const note = input.kind === 'note' ? undefined : input.note?.trim() || undefined
  const base = { owner: input.owner, id: lifeRecordId(), day, createdAt: now, updatedAt: now, note }
  let record: LifeRecord
  if (input.kind === 'water') record = { ...base, kind: 'water', ml: input.ml, photo: input.photo }
  else if (input.kind === 'meal') record = { ...base, kind: 'meal', mealType: input.mealType, name: input.name.trim(), photo: input.photo }
  else if (input.kind === 'expense') record = {
    ...base,
    kind: 'expense',
    amountCents: input.amountCents,
    category: input.category.trim(),
    direction: input.direction,
    source: input.source ?? 'manual',
    ...(input.merchant?.trim() ? { merchant: input.merchant.trim().slice(0, 60) } : {}),
    ...(input.channel ? { channel: input.channel } : {}),
    ...(input.externalId?.trim() ? { externalId: input.externalId.trim() } : {}),
    ...(input.occurredAt !== undefined ? { occurredAt: input.occurredAt } : {}),
  }
  else record = { ...base, kind: 'note', text: input.text.trim() }
  await lifeRequest('readwrite', store => store.put(record))
  notifyChanged(record.owner, record.day)
  return record
}

export async function updateLifeRecord(record: LifeRecord): Promise<LifeRecord> {
  validate(record)
  const next = { ...record, updatedAt: Date.now() }
  await lifeRequest('readwrite', store => store.put(next))
  notifyChanged(next.owner, next.day)
  return next
}

export function deleteLifeRecord(owner: string, id: string, day?: string) {
  return lifeRequest('readwrite', store => store.delete([owner, id])).then(() => {
    if (day) notifyChanged(owner, day)
  })
}

export async function listLifeRecordsByDay(owner: string, day: string): Promise<LifeRecord[]> {
  const rows = await lifeRequest('readonly', store => store.index('ownerDay').getAll([owner, day])) as LifeRecord[]
  return rows.sort((a, b) => a.createdAt - b.createdAt)
}

export async function listLifeRecords(owner: string): Promise<LifeRecord[]> {
  const rows = await lifeRequest('readonly', store => store.index('owner').getAll(owner)) as LifeRecord[]
  return rows.sort((a, b) => b.day.localeCompare(a.day) || b.createdAt - a.createdAt)
}

/** 已确认账单的去重键集合（v2 索引 [owner, externalId]），供草稿箱挡「重复导入 / 与已记账同笔」。 */
export async function listExpenseExternalIds(owner: string): Promise<Set<string>> {
  const db = await openLifeRecords()
  try {
    // 注意：IDBIndex.getAllKeys() 返回的是主键（[owner, id]），不是索引键；
    // 索引键要用 openKeyCursor 的 cursor.key 读。
    const keys = await new Promise<Set<string>>((resolve, reject) => {
      const transaction = db.transaction('records', 'readonly')
      const request = transaction.objectStore('records').index('ownerExternal').openKeyCursor(
        IDBKeyRange.bound([owner, ''], [owner, '\uffff']),
      )
      const found = new Set<string>()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) { resolve(found); return }
        const key = cursor.key as [string, string]
        if (Array.isArray(key) && key[1]) found.add(String(key[1]))
        cursor.continue()
      }
      request.onerror = () => reject(request.error)
      transaction.onabort = () => reject(transaction.error ?? request.error)
    })
    return keys
  } finally { db.close() }
}

export async function summarizeDay(owner: string, day: string): Promise<DaySummary> {
  return summarizeLifeRecords(await listLifeRecordsByDay(owner, day))
}