/**
 * PU 二课（口袋校园）解析 · 纯函数，不碰 DOM / localStorage。
 *
 * 两种来源共用一套模型（与 Flutter 版 `features/pu/parser.dart` 口径一致）：
 *  1. 成绩明细页复制的文字（`class.pocketuni.net/r#/score/detail`）；
 *  2. `apis.pocketuni.net/apis/credit/{index,activity,apply}` 的 JSON。
 *
 * 三条硬规则：
 *  - `null` 表示「没读到」，和 0 分严格区分；
 *  - 0 分分类不进明细与合计（明细页里大量 0 分类只是噪声）；
 *  - 没有「【…】」或「前缀·名字」结构的行不采信，宁可只存总数。
 *
 * 这里是纯模块：不 import 任何本地文件，方便 `node --test` 直接回归。
 */

export type PuClass = 'a' | 'b' | 'c' | 'labor' | 'other'
export type PuBucket = 'activity' | 'apply' | 'unknown'

export interface PuCreditRow {
  /** 原始名称，保留「【素质拓展B类】…」前缀，便于对照官网。 */
  name: string
  /** 去前缀后的分类名。 */
  category: string
  puClass: PuClass
  bucket: PuBucket
  credit: number
}

export interface PuSummary {
  totalCredit: number | null
  activityCredit: number | null
  applyCredit: number | null
  rows: PuCreditRow[]
  /** 0 = 全部学年；否则是学年起始年。 */
  year: number
  source: 'pocketuni'
  /** 毫秒时间戳；0 表示未知。 */
  syncedAt: number
}

export const PU_CLASS_LABEL: Record<PuClass, string> = {
  a: 'A 类',
  b: 'B 类',
  c: 'C 类',
  labor: '劳动教育',
  other: '其他',
}

export const PU_BUCKET_LABEL: Record<PuBucket, string> = {
  activity: '活动',
  apply: '成果',
  unknown: '未标注',
}

const PU_CLASS_ORDER: PuClass[] = ['a', 'b', 'c', 'labor', 'other']
const PU_NOISE = /勿选|已停用/

function emptySummary(): PuSummary {
  return {
    totalCredit: null,
    activityCredit: null,
    applyCredit: null,
    rows: [],
    year: 0,
    source: 'pocketuni',
    syncedAt: Date.now(),
  }
}

/** 数字字段：接口可能给 number，也可能给带单位的字符串。无法识别返回 null。 */
export function puNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const text = String(value).replace(/[^0-9.-]/g, '').trim()
  if (!text || !/\d/.test(text)) return null
  const parsed = Number.parseFloat(text)
  return Number.isFinite(parsed) ? parsed : null
}

/** 把「【素质拓展B类】团员主题教育」「素质拓展B类·团员主题教育」拆成（前缀，分类名）。 */
export function splitPuTitle(raw: string): [prefix: string, name: string] {
  const text = raw.trim()
  const bracket = text.match(/^【([^】]{1,30})】\s*(.*)$/)
  if (bracket) return [bracket[1].trim(), bracket[2].trim()]
  const dot = text.indexOf('·')
  if (dot > 0) return [text.slice(0, dot).trim(), text.slice(dot + 1).trim()]
  return ['', text]
}

/** A/B/C 优先于「劳动」字样：`【素质拓展C类】日常性劳动` 必须判 C 类。 */
export function classifyPu(raw: string): PuClass {
  const text = raw.replace(/\s+/g, '')
  const letter = text.match(/([ABCabc])类/)
  if (letter) {
    const upper = letter[1].toUpperCase()
    return upper === 'A' ? 'a' : upper === 'B' ? 'b' : 'c'
  }
  if (text.includes('劳动')) return 'labor'
  return 'other'
}

/** 取一行末尾的学分：「…（0.85）」「… 0.85」「0.85」。 */
function trailingCredit(rest: string): { name: string; credit: number | null } {
  const text = rest.trim()
  if (!text) return { name: '', credit: null }
  const bracketed = text.match(/[（(]\s*(-?\d+(?:\.\d+)?)\s*[）)]\s*$/)
  if (bracketed) {
    return { name: text.slice(0, bracketed.index).trim(), credit: Number.parseFloat(bracketed[1]) }
  }
  const bare = text.match(/^(.+?)[\s:：]+(-?\d+(?:\.\d+)?)\s*$/)
  if (bare) return { name: bare[1].trim(), credit: Number.parseFloat(bare[2]) }
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return { name: '', credit: Number.parseFloat(text) }
  return { name: text, credit: null }
}

/** 汇总词与数值：同一行（`活动类 4.25`）或下一行（`活动类\n4.25`）都支持。 */
function summaryNumber(lines: string[], labels: string[]): number | null {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    for (const label of labels) {
      if (!line.includes(label)) continue
      const sameLine = line.match(new RegExp(`${label}[^0-9-]{0,8}(-?\\d+(?:\\.\\d+)?)`))
      if (sameLine) return Number.parseFloat(sameLine[1])
      for (let probe = index + 1; probe < Math.min(index + 3, lines.length); probe += 1) {
        const next = lines[probe].trim()
        if (/^-?\d+(?:\.\d+)?$/.test(next)) return Number.parseFloat(next)
        if (next) break
      }
    }
  }
  return null
}

/**
 * 解析「成绩明细」页复制出来的文字。
 *
 * 兼容两种常见形态：
 * ```
 * 活动类 4.25 + 成果类 0.6 = 总成绩 4.85
 * 【素质拓展B类】团员主题教育（0.85）
 * ```
 * 以及移动端全选复制后「一行一个节点」的形态。
 */
export function parsePuPageText(text: string): PuSummary {
  const summary = emptySummary()
  const lines = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\u00a0\u3000]/g, ' ').trim())
    .filter(Boolean)

  summary.totalCredit = summaryNumber(lines, ['总成绩', '总学分', '总得分'])
  summary.activityCredit = summaryNumber(lines, ['活动类'])
  summary.applyCredit = summaryNumber(lines, ['成果类'])

  const seen = new Set<string>()
  const rows: PuCreditRow[] = []
  for (const line of lines) {
    if (PU_NOISE.test(line)) continue
    let prefix = ''
    let rest = ''
    const bracket = line.match(/^【([^】]{1,30})】\s*(.*)$/)
    if (bracket) {
      prefix = bracket[1].trim()
      rest = bracket[2]
    } else if (line.includes('·')) {
      ;[prefix, rest] = splitPuTitle(line)
    } else {
      continue
    }
    const { name: parsedName, credit } = trailingCredit(rest)
    if (credit === null || credit <= 0) continue
    const category = parsedName || prefix
    if (!category || PU_NOISE.test(category) || PU_NOISE.test(prefix)) continue
    const key = `${line}|${credit}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      name: (prefix ? `【${prefix}】${category}` : line).slice(0, 120),
      category: category.slice(0, 120),
      puClass: classifyPu(prefix || line),
      bucket: 'unknown',
      credit,
    })
  }

  summary.rows = rows
  summary.totalCredit ??=
    summary.activityCredit !== null || summary.applyCredit !== null
      ? (summary.activityCredit ?? 0) + (summary.applyCredit ?? 0)
      : rows.length
        ? round2(rows.reduce((sum, row) => sum + row.credit, 0))
        : null
  return summary
}

function unwrap(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>
  const data = record.data
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : record
}

function collectRows(body: unknown, bucket: PuBucket, seen: Set<string>, rows: PuCreditRow[]) {
  const list = unwrap(body).list
  if (!Array.isArray(list)) return
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const name = String(record.name ?? '').trim()
    const credit = puNumber(record.credit)
    if (!name || credit === null || credit <= 0 || PU_NOISE.test(name)) continue
    const [prefix, rest] = splitPuTitle(name)
    const key = `${name}|${credit}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      name: name.slice(0, 120),
      category: (rest || prefix || name).slice(0, 120),
      puClass: classifyPu(prefix || name),
      bucket,
      credit,
    })
  }
}

/**
 * 解析口袋校园接口 JSON。三个入参接受完整响应（带 `data`）或已剥壳的 `data`，
 * 两种形态在真实抓包里都出现过。
 */
export function parsePuCreditJson(input: {
  index: unknown
  activity?: unknown
  apply?: unknown
  year?: number
}): PuSummary {
  const summary = emptySummary()
  const head = unwrap(input.index)
  summary.totalCredit = puNumber(head.totalCredit)
  summary.activityCredit = puNumber(head.activityCredit)
  summary.applyCredit = puNumber(head.applyCredit)
  summary.year = typeof input.year === 'number' && Number.isFinite(input.year) ? input.year : 0
  const seen = new Set<string>()
  const rows: PuCreditRow[] = []
  collectRows(input.activity, 'activity', seen, rows)
  collectRows(input.apply, 'apply', seen, rows)
  summary.rows = rows
  return summary
}

/**
 * 统一入口：先按 JSON 解析（成绩单接口的响应 / 手写对象），失败再按页面文字。
 * 返回 `summary` 和实际采用的通道，UI 据此提示「接口」还是「页面文字」。
 */
export function parsePocketUniPayload(text: string): { summary: PuSummary; channel: 'json' | 'text' } {
  const raw = String(text ?? '').trim()
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        /* 抓包数组（[{url,body}]）不是成绩数据，交回文字解析，避免误判为「读到了空成绩」。 */
        return { summary: parsePuPageText(raw), channel: 'text' }
      }
      const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
      const hasIndex = 'index' in record || 'totalCredit' in record || 'data' in record
      if (hasIndex) {
        return {
          summary: parsePuCreditJson({
            index: record.index ?? record,
            activity: record.activity,
            apply: record.apply,
            year: puNumber(record.year) ?? 0,
          }),
          channel: 'json',
        }
      }
    } catch {
      /* 不是合法 JSON，按文字处理 */
    }
  }
  return { summary: parsePuPageText(raw), channel: 'text' }
}

export function puRowsWithCredit(summary: PuSummary): PuCreditRow[] {
  return summary.rows.filter((row) => row.credit > 0)
}

/** 展示用总分：接口值 → 活动 + 成果 → 明细求和；都没有才是 null。 */
export function puDisplayTotal(summary: PuSummary): number | null {
  if (summary.totalCredit !== null) return round2(summary.totalCredit)
  if (summary.activityCredit !== null || summary.applyCredit !== null) {
    return round2((summary.activityCredit ?? 0) + (summary.applyCredit ?? 0))
  }
  const rows = puRowsWithCredit(summary)
  return rows.length ? round2(rows.reduce((sum, row) => sum + row.credit, 0)) : null
}

export function puCreditOf(summary: PuSummary, puClass: PuClass): number {
  return round2(
    puRowsWithCredit(summary)
      .filter((row) => row.puClass === puClass)
      .reduce((sum, row) => sum + row.credit, 0),
  )
}

export function puClassesPresent(summary: PuSummary): PuClass[] {
  const rows = puRowsWithCredit(summary)
  return PU_CLASS_ORDER.filter((value) => rows.some((row) => row.puClass === value))
}

export function puIsEmpty(summary: PuSummary): boolean {
  return (
    summary.totalCredit === null &&
    summary.activityCredit === null &&
    summary.applyCredit === null &&
    puRowsWithCredit(summary).length === 0
  )
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const text = String(value).trim()
  if (!text) return null
  const parsed = Number.parseFloat(text)
  return Number.isFinite(parsed) ? parsed : null
}

const CLASS_CODES: PuClass[] = ['a', 'b', 'c', 'labor', 'other']
const BUCKET_CODES: PuBucket[] = ['activity', 'apply', 'unknown']

/** 读取本机缓存时的整体校验：任何一条不合法就整份丢弃，不拼半份假数据。 */
export function puSummaryFromJson(value: unknown): PuSummary | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const rowsRaw = Array.isArray(record.rows) ? record.rows : []
  const rows: PuCreditRow[] = []
  for (const item of rowsRaw) {
    if (!item || typeof item !== 'object') return null
    const row = item as Record<string, unknown>
    const name = typeof row.name === 'string' ? row.name : ''
    const credit = optionalNumber(row.credit)
    const puClass = CLASS_CODES.includes(row.class as PuClass) ? (row.class as PuClass) : null
    if (!name || name.length > 120 || credit === null || credit < 0 || credit > 200 || !puClass) return null
    const bucket = BUCKET_CODES.includes(row.bucket as PuBucket) ? (row.bucket as PuBucket) : 'unknown'
    rows.push({
      name,
      category: typeof row.category === 'string' ? row.category.slice(0, 120) : '',
      puClass,
      bucket,
      credit,
    })
  }
  const total = optionalNumber(record.totalCredit)
  const activity = optionalNumber(record.activityCredit)
  const apply = optionalNumber(record.applyCredit)
  if (total !== null && (total < 0 || total > 200)) return null
  if (activity !== null && (activity < 0 || activity > 200)) return null
  if (apply !== null && (apply < 0 || apply > 200)) return null
  return {
    totalCredit: total,
    activityCredit: activity,
    applyCredit: apply,
    rows,
    year: typeof record.year === 'number' && Number.isFinite(record.year) ? record.year : 0,
    source: 'pocketuni',
    syncedAt: optionalNumber(record.syncedAt) ?? 0,
  }
}

export function puSummaryToJson(summary: PuSummary): Record<string, unknown> {
  return {
    totalCredit: summary.totalCredit,
    activityCredit: summary.activityCredit,
    applyCredit: summary.applyCredit,
    rows: summary.rows.map((row) => ({
      name: row.name,
      category: row.category,
      class: row.puClass,
      bucket: row.bucket,
      credit: row.credit,
    })),
    year: summary.year,
    syncedAt: summary.syncedAt,
  }
}
