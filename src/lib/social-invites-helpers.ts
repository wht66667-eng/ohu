/**
 * 社工端邀请码与课表共享 · 纯函数层（TASK-A2）。
 *
 * 被浏览器、Node 测试与 SQL 侧共用同一套口径：
 * - 邀请码 8 位大写字母数字 XXXX-XXXX，生成时剔除易混淆字符（I/O/0/1）；
 * - 服务端（docs/sql/social-invites-166.sql）生成的码与此处格式一致；
 * - 课表共享字段三档：time（上课时间）/ name（课程名）/ room（教室）。
 *
 * 本文件零运行时 import（Node 可直接加载做测试）；所有与 CloudBase 的交互在
 * social-invites.ts（rdb 封装）里。
 */

/** 邀请码字符集：大写字母 + 数字，剔除易混淆的 I、O、0、1（与 SQL 迁移一致，31 个字符） */
export const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** 规范展示格式：XXXX-XXXX */
export const INVITE_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/

/** 课表共享字段三档（缺省全开） */
export interface ShareFields {
  time: boolean
  name: boolean
  room: boolean
}

/** 供测试注入的随机字节源；缺省用 Web Crypto（浏览器与 Node ≥19 均有 globalThis.crypto） */
type RandomSource = (byteCount: number) => Uint8Array

function defaultRandom(byteCount: number): Uint8Array {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }
  if (g.crypto?.getRandomValues) {
    const bytes = new Uint8Array(byteCount)
    g.crypto.getRandomValues(bytes)
    return bytes
  }
  const bytes = new Uint8Array(byteCount)
  for (let i = 0; i < byteCount; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  return bytes
}

/** 生成 XXXX-XXXX 邀请码（去易混淆字符；随机源可注入便于测试） */
export function genInviteCode(random: RandomSource = defaultRandom): string {
  const bytes = random(8)
  let raw = ''
  for (let i = 0; i < 8; i += 1) {
    raw += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length]
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`
}

/** 归一化用户输入：去空白与分隔符、转大写、8 位有效时补成 XXXX-XXXX；否则空串 */
export function normalizeInviteCodeInput(raw: string): string {
  const stripped = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (stripped.length !== 8) return ''
  return `${stripped.slice(0, 4)}-${stripped.slice(4, 8)}`
}

/** 输入是否是可用格式的邀请码（8 位有效字符，连字符可有可无） */
export function validateInviteCodeFormat(raw: string): boolean {
  return normalizeInviteCodeInput(raw) !== ''
}

/** 是否与生成侧完全一致的规范形态（XXXX-XXXX，且不含易混淆字符） */
export function isCanonicalInviteCode(raw: string): boolean {
  return INVITE_CODE_PATTERN.test(String(raw ?? ''))
}

/** 兑换结果文案（SQL 返回 {ok, remaining}；remaining=null 表示不限次数） */
export function redeemResultText(ok: boolean, remaining: number | null): string {
  if (!ok) return '绑定未成功，请核对邀请码后重试'
  if (remaining == null) return '绑定成功，该邀请码可不限次使用'
  if (remaining <= 0) return '绑定成功，该邀请码的使用名额已用完'
  return `绑定成功，该邀请码还可使用 ${remaining} 次`
}

/** 由任意输入（RPC jsonb / 用户勾选）收敛出合法的三档字段开关，缺省 true */
export function shareFieldsFrom(parts: unknown): ShareFields {
  const src = (parts ?? {}) as Record<string, unknown>
  return {
    time: src.time !== false,
    name: src.name !== false,
    room: src.room !== false,
  }
}

/** 三档字段开关的人类可读文案 */
export function shareFieldsText(fields: ShareFields): string {
  const parts: string[] = []
  if (fields.time) parts.push('上课时间')
  if (fields.name) parts.push('课程名')
  if (fields.room) parts.push('教室')
  if (!parts.length) return '不共享任何内容'
  return parts.join(' · ')
}

export function shareFieldsEqual(a: ShareFields, b: ShareFields): boolean {
  return a.time === b.time && a.name === b.name && a.room === b.room
}

/** social_invite_status 返回的单条邀请码视图 */
export interface InviteRowView {
  code: string
  usedCount: number
  maxUses: number | null
  expiresAt: string | null
  revoked: boolean
  note: string
  createdAt: string
  relation: SpaceRelation
  relationLabel: string
}

/** 把 RPC 返回的 jsonb 行收敛成视图；字段非法时尽力取值（不抛错） */
export function inviteRowFromJson(raw: unknown): InviteRowView | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const code = typeof r.code === 'string' ? r.code : ''
  if (!code) return null
  const usedCount = Number(r.used_count)
  const maxUsesRaw = r.max_uses
  const relation = String(r.relation || 'friend')
  return {
    code,
    usedCount: Number.isFinite(usedCount) ? usedCount : 0,
    maxUses: maxUsesRaw == null ? null : Number(maxUsesRaw) || null,
    expiresAt: typeof r.expires_at === 'string' && r.expires_at ? r.expires_at : null,
    revoked: r.revoked === true,
    note: typeof r.note === 'string' ? r.note : '',
    createdAt: typeof r.created_at === 'string' ? r.created_at : '',
    relation: (RELATION_OPTIONS.some((o) => o.value === relation) ? relation : 'friend') as SpaceRelation,
    relationLabel: relationLabel(relation, typeof r.relation_label === 'string' ? r.relation_label : ''),
  }
}

/** 邀请码当前是否仍然有效（未撤销、未过期、未用尽；max_uses=null 不限次数） */
export function inviteActive(invite: InviteRowView, now = Date.now()): boolean {
  if (invite.revoked) return false
  if (invite.maxUses != null && invite.usedCount >= invite.maxUses) return false
  if (invite.expiresAt) {
    const t = new Date(invite.expiresAt).getTime()
    if (!Number.isFinite(t) || t <= now) return false
  }
  return true
}

/** 邀请码用量/状态一句话 */
export function inviteUsageText(invite: InviteRowView, now = Date.now()): string {
  if (invite.revoked) return '已撤销'
  if (invite.expiresAt) {
    const t = new Date(invite.expiresAt).getTime()
    if (Number.isFinite(t) && t <= now) return '已过期'
  }
  const limit = invite.maxUses == null ? '不限次数' : `${invite.usedCount}/${invite.maxUses} 次`
  if (invite.maxUses != null && invite.usedCount >= invite.maxUses) return '已用尽'
  return invite.maxUses == null ? `已用 ${invite.usedCount} 次 · ${limit}` : `已用 ${limit}`
}

/** RPC 缺失（未部署迁移）识别：42883 / function not found / PGRST202 */
export function isRpcMissingError(err: unknown): boolean {
  if (!err) return false
  const code = typeof (err as { code?: unknown }).code === 'string' ? (err as { code: string }).code : ''
  if (code === '42883' || code === 'PGRST202') return true
  const text = typeof err === 'string'
    ? err
    : `${(err as { message?: unknown }).message ?? ''} ${(err as { msg?: unknown }).msg ?? ''}`
  return /42883|does not exist|could not find the function|function .* not .*found|schema cache/i.test(text)
}

/** 提取可读错误文案（CloudBase 的 message / msg / 字符串本身） */
export function readableError(err: unknown, fallback = '操作失败，请稍后重试'): string {
  if (!err) return fallback
  if (typeof err === 'string' && err.trim()) return err.trim()
  const anyErr = err as { message?: unknown; msg?: unknown }
  const text = typeof anyErr.message === 'string' && anyErr.message ? anyErr.message : typeof anyErr.msg === 'string' ? anyErr.msg : ''
  return text.trim() || fallback
}

/** 共享课表里的一行课程（宽容解析，解析失败的行直接丢弃） */
export interface SharedCourseRow {
  week: number
  day: number
  sections: number[]
  name: string
  room: string
  teacher: string
}

const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function toInt(value: unknown): number {
  const n = Number(value)
  return Number.isInteger(n) ? n : Number.NaN
}

/**
 * 解析 schedule_share_read 返回的 snapshot（timetable_snapshots 行 jsonb，列格式●推断）。
 * 兼容三种形态：行数组 / {rows: [...]} / 单行对象内嵌数组字段；字段名按课表通用键名
 * week/day/sections/name/room/teacher 尽力映射，无法识别时返回空数组（调用方给空态）。
 */
export function parseSharedSnapshot(snapshot: unknown): SharedCourseRow[] {
  let list: unknown[] | null = null
  if (Array.isArray(snapshot)) list = snapshot
  else if (snapshot && typeof snapshot === 'object') {
    const obj = snapshot as Record<string, unknown>
    const inner = Array.isArray(obj.rows) ? obj.rows : Array.isArray(obj.courses) ? obj.courses : Array.isArray(obj.data) ? obj.data : null
    if (inner) list = inner
    else list = [snapshot]
  }
  if (!list) return []
  const out: SharedCourseRow[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const week = toInt(r.week)
    const day = toInt(r.day ?? r.weekday)
    const sectionsRaw = Array.isArray(r.sections) ? r.sections : Array.isArray(r.jie) ? r.jie : []
    const sections = sectionsRaw.map(toInt).filter((n) => Number.isInteger(n) && n >= 1 && n <= 14)
    const name = typeof r.name === 'string' ? r.name : typeof r.course === 'string' ? r.course : typeof r.course_name === 'string' ? r.course_name : ''
    if (!Number.isInteger(week) || week < 1 || !Number.isInteger(day) || day < 1 || day > 7 || !sections.length || !name.trim()) continue
    out.push({
      week,
      day,
      sections,
      name: name.trim(),
      room: typeof r.room === 'string' ? r.room : typeof r.classroom === 'string' ? r.classroom : '',
      teacher: typeof r.teacher === 'string' ? r.teacher : '',
    })
  }
  return out.sort((a, b) => a.day - b.day || Math.min(...a.sections) - Math.min(...b.sections) || a.name.localeCompare(b.name))
}

/** 一行课的"时间"文案（第 N-M 节 · 周X） */
export function courseRowTimeText(row: SharedCourseRow): string {
  const start = Math.min(...row.sections)
  const end = Math.max(...row.sections)
  const span = start === end ? `第 ${start} 节` : `第 ${start}-${end} 节`
  return `${DAY_NAMES[row.day - 1] ?? `周${row.day}`} ${span}`
}

/** 星期文案（1=周一 … 7=周日；越界回退「周N」） */
export function courseDayLabel(day: number): string {
  const d = Math.round(day)
  return d >= 1 && d <= 7 ? DAY_NAMES[d - 1] : `周${d}`
}

/** 按天分组后的课表（组内按起始节次升序；组按周一→周日排列） */
export interface CourseDayGroup {
  day: number
  label: string
  rows: SharedCourseRow[]
}

/**
 * 按天分组共享课表（TASK-A6）：fields 关闭后渲染为空串的行直接剔除——
 * 关闭的字段连占位都不留；全字段关闭的行不出现在分组里。
 */
export function groupCoursesByDay(rows: SharedCourseRow[], fields: ShareFields): CourseDayGroup[] {
  const byDay = new Map<number, SharedCourseRow[]>()
  for (const row of rows) {
    if (!courseRowText(row, fields).trim()) continue
    const list = byDay.get(row.day)
    if (list) list.push(row)
    else byDay.set(row.day, [row])
  }
  return Array.from(byDay.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([day, list]) => ({
      day,
      label: courseDayLabel(day),
      rows: list.slice().sort((a, b) => Math.min(...a.sections) - Math.min(...b.sections) || a.name.localeCompare(b.name)),
    }))
}

/** 按学生的三档开关渲染一行课；未授权的字段不出现在文案里 */
export function courseRowText(row: SharedCourseRow, fields: ShareFields): string {
  const parts: string[] = []
  if (fields.time) parts.push(courseRowTimeText(row))
  if (fields.name) parts.push(row.name)
  if (fields.room && row.room) parts.push(row.room)
  return parts.join(' · ')
}

/** 屏蔽社工用户 uid 的中段（列表展示用）：保留前后 4 位 */
export function maskSocialUid(uid: string): string {
  const u = String(uid ?? '')
  if (u.length <= 10) return u
  return `${u.slice(0, 6)}…${u.slice(-4)}`
}

/* ===== 双人空间（P2-04b 首轮：邀请→配对→关系类型→纪念日第 1 天） ===== */

/** 关系类型：只影响称呼与装饰（P2-04b）；custom 使用自定义称呼 */
export type SpaceRelation = 'lover' | 'brother' | 'bestie' | 'buddy' | 'friend' | 'custom'

export const RELATION_OPTIONS: Array<{ value: SpaceRelation; label: string }> = [
  { value: 'lover', label: '恋人' },
  { value: 'brother', label: '兄弟' },
  { value: 'buddy', label: '死党' },
  { value: 'bestie', label: '闺蜜' },
  { value: 'friend', label: '好友' },
  { value: 'custom', label: '自定义' },
]

const RELATION_FALLBACK: Record<string, string> = {
  lover: '恋人',
  brother: '兄弟',
  bestie: '闺蜜',
  buddy: '死党',
  friend: '好友',
  custom: '好友',
}

/** 关系称呼：custom 用自定义称呼（为空回退「好友」），未知类型回退映射表 */
export function relationLabel(relation: string, customLabel: string): string {
  const rel = String(relation ?? 'friend')
  if (rel === 'custom') {
    const label = String(customLabel ?? '').trim()
    return label || '好友'
  }
  return RELATION_FALLBACK[rel] ?? '好友'
}

/** 双人空间行（social_invite_status.spaces / redeem.space） */
export interface SpaceView {
  id: number
  partnerUid: string
  /** student=我是学生侧（发起方）；social=我是社工侧 */
  side: 'student' | 'social'
  relation: SpaceRelation
  relationLabel: string
  status: 'active' | 'dissolved' | 'blocked'
  anniversaryAt: string
  updatedAt: string
}

/** 解析 status 返回的空间行；字段非法时尽力取值（不抛错） */
export function spaceFromJson(raw: unknown): SpaceView | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = Number(r.id)
  const partnerUid = typeof r.partner_uid === 'string' ? r.partner_uid : ''
  const side = r.side === 'student' ? 'student' : 'social'
  const relation = String(r.relation || 'friend')
  return {
    id: Number.isFinite(id) ? id : 0,
    partnerUid,
    side,
    relation: (RELATION_OPTIONS.some((o) => o.value === relation) ? relation : 'friend') as SpaceRelation,
    relationLabel: relationLabel(relation, typeof r.relation_label === 'string' ? r.relation_label : ''),
    status: r.status === 'dissolved' || r.status === 'blocked' ? r.status : 'active',
    anniversaryAt: typeof r.anniversary_at === 'string' && r.anniversary_at ? r.anniversary_at : '',
    updatedAt: typeof r.updated_at === 'string' ? r.updated_at : '',
  }
}

const BEIJING_OFFSET_MS = 8 * 3_600_000

/** 北京时区（UTC+8）的日历日序号（用于纪念日跨日判定，首期默认北京时间） */
export function beijingDayNumber(ts: number): number {
  return Math.floor((ts + BEIJING_OFFSET_MS) / 86_400_000)
}

/** 相伴天数（已过整日数）：配对当天为 0；无效日期返回 -1 */
export function companionDays(anniversaryIso: string, now = Date.now()): number {
  const t = new Date(anniversaryIso).getTime()
  if (!Number.isFinite(t)) return -1
  const diff = beijingDayNumber(now) - beijingDayNumber(t)
  return diff < 0 ? 0 : diff
}

/** 纪念日文案：配对当天显示「第 1 天」；非恋人关系由调用方改称「相伴」 */
export function companionDayText(anniversaryIso: string, now = Date.now()): string {
  const days = companionDays(anniversaryIso, now)
  if (days < 0) return '纪念日待确认'
  return `第 ${days + 1} 天`
}

/** 空间一句话：恋人显示「相恋天数 第 N 天」，其余关系显示「相伴天数 第 N 天」 */
export function spaceDayText(space: SpaceView, now = Date.now()): string {
  const day = companionDayText(space.anniversaryAt, now)
  const prefix = space.relation === 'lover' ? '相恋天数' : '相伴天数'
  return `${prefix} · ${day}`
}

/** 邀请码生成时可传的关系参数 */
export function normalizeRelationInput(relation: string, customLabel: string): { relation: SpaceRelation; label: string } {
  const rel = String(relation ?? 'friend')
  const known = RELATION_OPTIONS.find((o) => o.value === rel)
  const value: SpaceRelation = known ? known.value : 'friend'
  const label = String(customLabel ?? '').trim().slice(0, 12)
  return { relation: value, label: value === 'custom' ? label : '' }
}
