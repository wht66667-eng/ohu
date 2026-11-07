/**
 * 校园档案「第二课堂 / 公选学分」解析 · 纯函数。
 *
 * 数据来自实践系统 7058 的 `personalFiles` 接口（抓包实测）：
 * ```
 * { statusCode: 10000, data: {
 *   totalCredit: "4.25", creditType1: "0", creditType2: "3.05", creditType3: "1.2",
 *   level: "2024", rn: "3614", sameLevelAvgCredit: "8.3", totalCreditPercent: "35.42",
 *   detailB1..B12, detailC1..C7,
 *   personalQualityJson: "[{semesterId, semesterTotalCredit, semesterCreditType2:{...}}]"
 * }}
 * ```
 * 这里的学分与 PU（口袋校园）不是同一口径，页面必须分开显示、不能相加。
 */

export type QualityRecord = { name: string; credit: number }

export type QualitySemester = {
  id: string
  total: number
  records: QualityRecord[]
}

export type QualitySummary = {
  totalCredit: number
  type1: number
  type2: number
  type3: number
  level: string
  rank: string
  sameLevelAvg: number
  percent: string
  semesters: QualitySemester[]
  details: Array<{ name: string; credit: number }>
  syncedAt: number
}

function num(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const parsed = Number.parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)
}

/** personalFiles 请求体（抓包实证）：{"outid":"<学号>"}。 */
export function qualityPersonalFilesBody(studentId: string): string {
  return JSON.stringify({ outid: String(studentId ?? '').trim() })
}
export function parseQualityPayload(raw: unknown): QualitySummary | null {
  if (!raw || typeof raw !== 'object') return null
  const root = raw as Record<string, unknown>
  const data = root.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : root
  if (!('totalCredit' in data) && !('personalQualityJson' in data)) return null

  const semesters: QualitySemester[] = []
  const jsonText = str(data.personalQualityJson)
  if (jsonText) {
    try {
      const list: unknown = JSON.parse(jsonText)
      if (Array.isArray(list)) {
        for (const item of list) {
          if (!item || typeof item !== 'object') continue
          const semester = item as Record<string, unknown>
          const records: QualityRecord[] = []
          for (const key of ['semesterCreditType1', 'semesterCreditType2', 'semesterCreditType3']) {
            const bucket = semester[key]
            if (!bucket || typeof bucket !== 'object') continue
            const listRaw = (bucket as Record<string, unknown>).secondClassRecords
            if (!Array.isArray(listRaw)) continue
            for (const record of listRaw) {
              if (!record || typeof record !== 'object') continue
              const value = record as Record<string, unknown>
              const name = str(value.secondClass).trim()
              const credit = num(value.credit)
              if (name) records.push({ name, credit })
            }
          }
          semesters.push({ id: str(semester.semesterId), total: num(semester.semesterTotalCredit), records })
        }
      }
    } catch {
      /* 字符串损坏时只保留汇总 */
    }
  }

  const details: Array<{ name: string; credit: number }> = []
  const detailLabels: Array<[string, string]> = [
    ['A', 'A 类'], ['B', 'B 类'], ['C', 'C 类'],
  ]
  for (const [prefix, label] of detailLabels) {
    for (let index = 1; index <= 12; index += 1) {
      const value = num(data[`detail${prefix}${index}`])
      if (value > 0) details.push({ name: `${label} 明细 ${index}`, credit: value })
    }
  }

  return {
    totalCredit: num(data.totalCredit),
    type1: num(data.creditType1),
    type2: num(data.creditType2),
    type3: num(data.creditType3),
    level: str(data.level),
    rank: str(data.rn),
    sameLevelAvg: num(data.sameLevelAvgCredit),
    percent: str(data.totalCreditPercent),
    semesters,
    details,
    syncedAt: Date.now(),
  }
}

export function qualityFromJson(value: unknown): QualitySummary | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const total = num(record.totalCredit)
  if (!Number.isFinite(total) || total < 0 || total > 200) return null
  const semesters: QualitySemester[] = []
  if (Array.isArray(record.semesters)) {
    for (const item of record.semesters) {
      if (!item || typeof item !== 'object') return null
      const semester = item as Record<string, unknown>
      const records: QualityRecord[] = []
      if (Array.isArray(semester.records)) {
        for (const entry of semester.records) {
          if (!entry || typeof entry !== 'object') return null
          const row = entry as Record<string, unknown>
          records.push({ name: String(row.name ?? '').slice(0, 80), credit: num(row.credit) })
        }
      }
      semesters.push({ id: String(semester.id ?? '').slice(0, 40), total: num(semester.total), records })
    }
  }
  const details: Array<{ name: string; credit: number }> = []
  if (Array.isArray(record.details)) {
    for (const item of record.details) {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      details.push({ name: String(row.name ?? '').slice(0, 80), credit: num(row.credit) })
    }
  }
  return {
    totalCredit: total,
    type1: num(record.type1), type2: num(record.type2), type3: num(record.type3),
    level: String(record.level ?? '').slice(0, 20),
    rank: String(record.rank ?? '').slice(0, 20),
    sameLevelAvg: num(record.sameLevelAvg),
    percent: String(record.percent ?? '').slice(0, 20),
    semesters,
    details,
    syncedAt: num(record.syncedAt),
  }
}

export function qualityToJson(summary: QualitySummary): Record<string, unknown> {
  return {
    totalCredit: summary.totalCredit, type1: summary.type1, type2: summary.type2, type3: summary.type3,
    level: summary.level, rank: summary.rank, sameLevelAvg: summary.sameLevelAvg, percent: summary.percent,
    semesters: summary.semesters, details: summary.details, syncedAt: summary.syncedAt,
  }
}
