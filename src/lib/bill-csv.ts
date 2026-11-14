/**
 * 微信／支付宝官方 CSV 账单解析（M2.5·B1，纯函数层）。
 *
 * 设计要点（见 docs/product/哦狐_账单自动记入手账方案.md）：
 * - 编码探测：UTF-8 BOM 直接剥；无 BOM 先按严格 UTF-8 解，失败回落 GBK（支付宝旧版导出）。
 * - 两套表头独立解析：微信「交易时间…收/支…金额(元)…交易单号」，支付宝「交易创建时间…金额（元）…交易号」。
 * - 清洗：只认首列能解析成日期的数据行，其余（说明头、汇总、空行）计 skipped；
 *   收/支为「/」或空、状态含「退款」的行跳过，不计入草稿。
 * - 去重键 sha256(channel|amountCents|merchantKey|minuteBucket)，与账本 externalId 对齐，
 *   重复导入与「通知/OCR 同一笔」都靠它挡；跨渠道 ≤120 秒同金额同商户标「疑似同一笔」。
 * 本模块零运行时 import，可在 Node 直接加载测试；解析全部在本机完成，文件不离开设备。
 */

export interface ParsedBillRow {
  /** 渠道；CSV 解析只产 wechat／alipay，bank／other 留给通知监听与 OCR 入口。 */
  channel: 'wechat' | 'alipay' | 'bank' | 'other'
  direction: 'out' | 'in'
  amountCents: number
  merchant: string
  note?: string
  occurredAt: number
  /** 渠道原始单号（交易单号/交易号），仅供展示；落库的 externalId 用去重键。 */
  rawId?: string
  /** 跨渠道疑似同一笔标记，由 flagSuspectedDuplicates 写入。 */
  suspect?: boolean
}

export interface ParsedBill {
  channel: 'wechat' | 'alipay'
  rows: ParsedBillRow[]
  skipped: number
}

const WECHAT_HEADER_KEYS = ['交易时间', '收/支', '金额']
const ALIPAY_HEADER_KEYS = ['交易创建时间', '收/支', '交易号']

/** 编码探测：BOM → 严格 UTF-8 → GBK；都失败时按宽松 UTF-8 兜底（坏字节替换）。 */
export function decodeBillText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3))
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    try {
      return new TextDecoder('gbk').decode(bytes)
    } catch {
      return new TextDecoder('utf-8').decode(bytes)
    }
  }
}

/** 商户名归一化：去空格与「-」，截断到前 8 字（方案 §4 的 merchantKey）。 */
export function merchantKey(merchant: string): string {
  return (merchant || '').replace(/[\s-]+/g, '').slice(0, 8)
}

/** 交易时间向下取整到分钟，避免秒级抖动造成同笔不同键。 */
export function minuteBucket(occurredAt: number): number {
  return Math.floor(occurredAt / 60_000)
}

/** 去重键：sha256(channel|amountCents|merchantKey|minuteBucket)，与账本 externalId 对齐。 */
export async function billDedupeKey(channel: string, amountCents: number, merchant: string, occurredAt: number): Promise<string> {
  const material = `${channel}|${amountCents}|${merchantKey(merchant)}|${minuteBucket(occurredAt)}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function sniffBillChannel(text: string): 'wechat' | 'alipay' | null {
  if (text.includes('微信支付账单明细') || text.includes('微信支付账单列表')) return 'wechat'
  if (text.includes('支付宝') && (text.includes('交易流水明细') || text.includes('交易流水证明'))) return 'alipay'
  const head = text.slice(0, 8000)
  if (WECHAT_HEADER_KEYS.every(key => head.includes(key)) && head.includes('交易单号')) return 'wechat'
  if (ALIPAY_HEADER_KEYS.every(key => head.includes(key))) return 'alipay'
  return null
}

/** 解析一行 CSV（处理双引号包裹与引号内逗号）；输入不含换行。 */
function splitCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i += 1 }
        else quoted = false
      } else current += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { fields.push(current); current = '' }
    else current += ch
  }
  fields.push(current)
  return fields.map(field => field.trim())
}

/** 'YYYY-MM-DD HH:MM:SS' → 本地时间毫秒；非法返回 null。 */
function parseBillTime(value: string): number | null {
  const match = /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec((value || '').trim())
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second ?? '0'))
  return Number.isFinite(date.getTime()) ? date.getTime() : null
}

/** '¥1,234.56' / '1,234.56' → 分；非法返回 null。 */
function parseBillAmount(value: string): number | null {
  const cleaned = (value || '').replace(/[¥￥,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const [yuan, frac = ''] = cleaned.split('.')
  const cents = Number(yuan) * 100 + Number((frac + '00').slice(0, 2))
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null
}

function buildRow(channel: 'wechat' | 'alipay', get: (names: string[]) => string): ParsedBillRow | null {
  const occurredAt = parseBillTime(get(['交易时间', '交易创建时间', '付款时间']))
  const amountCents = parseBillAmount(get(['金额(元)', '金额（元）', '金额']))
  const incomeExpense = get(['收/支'])
  if (occurredAt === null || amountCents === null) return null
  if (incomeExpense !== '收入' && incomeExpense !== '支出') return null // 「/」、空、不计收支一律跳过
  const merchant = (get(['交易对方']) || get(['商品名称', '商品', '备注']) || '未知商户').slice(0, 60)
  const note = (get(['商品名称', '商品']) || get(['备注']) || '').slice(0, 80) || undefined
  const rawId = get(['交易单号', '交易号']) || undefined
  return {
    channel,
    direction: incomeExpense === '收入' ? 'in' : 'out',
    amountCents,
    merchant,
    note,
    occurredAt,
    rawId,
  }
}

function locateHeader(lines: string[], keys: string[]): { headerIndex: number; columns: Map<string, number> } | null {
  for (let i = 0; i < lines.length; i += 1) {
    if (!keys.every(key => lines[i].includes(key))) continue
    const fields = splitCsvLine(lines[i])
    const columns = new Map<string, number>()
    fields.forEach((name, index) => { if (name && !columns.has(name)) columns.set(name, index) })
    return { headerIndex: i, columns }
  }
  return null
}

function parseRows(text: string, channel: 'wechat' | 'alipay', headerKeys: string[]): ParsedBill {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const located = locateHeader(lines, headerKeys)
  if (!located) return { channel, rows: [], skipped: 0 }
  const { headerIndex, columns } = located
  const rows: ParsedBillRow[] = []
  let skipped = 0
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (!line) continue
    const fields = splitCsvLine(line)
    const get = (names: string[]): string => {
      for (const name of names) {
        const index = columns.get(name)
        if (index !== undefined) return fields[index] ?? ''
      }
      return ''
    }
    // 汇总行 / 备注行 / 分隔行：首列不是日期的直接计入 skipped。
    if (parseBillTime(get(['交易时间', '交易创建时间', '付款时间'])) === null) { skipped += 1; continue }
    const status = get(['当前状态', '交易状态'])
    if (status && (status.includes('退款') || status.includes('关闭') || status.includes('失败'))) { skipped += 1; continue }
    const row = buildRow(channel, get)
    if (row) rows.push(row)
    else skipped += 1
  }
  return { channel, rows, skipped }
}

export function parseWechatBill(text: string): ParsedBill {
  return parseRows(text, 'wechat', WECHAT_HEADER_KEYS)
}

export function parseAlipayBill(text: string): ParsedBill {
  return parseRows(text, 'alipay', ALIPAY_HEADER_KEYS)
}

export function parseBillCsv(text: string): ParsedBill | null {
  const channel = sniffBillChannel(text)
  if (channel === 'wechat') return parseWechatBill(text)
  if (channel === 'alipay') return parseAlipayBill(text)
  return null
}

/** 跨渠道宽限：同金额、同商户、时间差 ≤120 秒的不同渠道记录互相标「疑似同一笔」，交用户裁决。 */
export function flagSuspectedDuplicates(rows: ParsedBillRow[]): ParsedBillRow[] {
  const next = rows.map(row => ({ ...row }))
  for (let i = 0; i < next.length; i += 1) {
    for (let j = i + 1; j < next.length; j += 1) {
      const a = next[i], b = next[j]
      if (a.channel === b.channel || a.amountCents !== b.amountCents || a.direction !== b.direction) continue
      if (merchantKey(a.merchant) !== merchantKey(b.merchant) || !merchantKey(a.merchant)) continue
      if (Math.abs(a.occurredAt - b.occurredAt) > 120_000) continue
      a.suspect = true
      b.suspect = true
    }
  }
  return next
}
