/**
 * 匿名社区 · 目标墙
 *
 * 隐私约定（对应量力「个人信息仅在用户同意后展示」）：
 * - 表 energy_goals 的 RLS 只允许本人读写，uid 永远不出服务端；
 *   公共读走 SECURITY DEFINER 的 energy_goals_feed()，只返回脱敏字段。
 * - 发布默认匿名（reveal=false），此时服务端不落昵称头像，前端只显示服务端给的
 *   4 位匿名代号（uid 单向散列，同一作者稳定、不可反推）。
 * - 用户显式打开「显示我的昵称头像」后，才把昵称/头像写进 author_name/author_avatar；
 *   关掉时服务端立刻把这两列清空，已发出去的内容同步变回匿名。
 */
import { cbRdb } from './cb'
import { normLoad, DEFAULT_LOAD, type LoadValue } from './todo-energy'

type Any = any

export interface EnergyGoal {
  id: number
  text: string
  load: LoadValue
  cheers: number
  /** 我有没有鼓励过 */
  cheered: boolean
  /** 是不是我发的 */
  mine: boolean
  /** 作者是否同意展示身份 */
  reveal: boolean
  name: string | null
  avatar: string | null
  /** 匿名代号，如 3F2A */
  code: string
  at: string
}

const GOAL_MAX = 60

function errText(e: unknown): string {
  if (!e) return '操作失败，请稍后重试'
  const a = e as { message?: unknown; msg?: unknown }
  const m = typeof a.message === 'string' ? a.message : typeof a.msg === 'string' ? a.msg : ''
  return m || '操作失败，请稍后重试'
}

function readError(e: unknown): string | null {
  if (!e) return null
  if (typeof e === 'string') return e
  const msg = (e as { message?: string }).message
  return msg || null
}

/** jsonb 结果容错：数组 / JSON 字符串 / 单元素包装都可能出现 */
function toArray(v: unknown): Any[] {
  let x: unknown = v
  for (let i = 0; i < 3; i++) {
    if (typeof x === 'string') {
      try {
        x = JSON.parse(x)
        continue
      } catch {
        return []
      }
    }
    // 单元素且里面还是数组（PostgREST 有时这样包 jsonb）时再剥一层
    if (Array.isArray(x)) {
      if (x.length === 1 && Array.isArray(x[0])) {
        x = x[0]
        continue
      }
      return x as Any[]
    }
    if (x && typeof x === 'object') return [x as Any]
    break
  }
  return Array.isArray(x) ? (x as Any[]) : []
}

function norm(raw: Any): EnergyGoal {
  const reveal = !!raw?.reveal
  return {
    id: Number(raw?.id || 0),
    text: String(raw?.text || ''),
    load: normLoad(raw?.load ?? DEFAULT_LOAD),
    cheers: Math.max(0, Number(raw?.cheers) || 0),
    cheered: !!raw?.cheered,
    mine: !!raw?.mine,
    reveal,
    // 服务端只在 reveal=true 时返回这两列；这里再兜一道，防止历史脏数据
    name: reveal ? String(raw?.name || '') || null : null,
    avatar: reveal ? String(raw?.avatar || '') || null : null,
    code: String(raw?.code || '').toUpperCase().slice(0, 4) || '----',
    at: String(raw?.at || ''),
  }
}

/** 展示名：实名才给昵称，否则用匿名代号 */
export function authorLabel(g: EnergyGoal): string {
  if (g.reveal && g.name) return g.name
  return `匿名 · ${g.code}`
}

export async function fetchEnergyGoals(limit = 30): Promise<{ rows: EnergyGoal[]; error: string | null }> {
  try {
    const res: Any = await (cbRdb() as Any).rpc('energy_goals_feed', { p_limit: limit })
    const err = readError(res?.error)
    if (err) return { rows: [], error: err }
    return { rows: toArray(res?.data).map(norm), error: null }
  } catch (e) {
    return { rows: [], error: errText(e) }
  }
}

export interface GoalDraft {
  text: string
  load?: unknown
  /** 是否公开昵称头像；false 时下面两个字段一律不上传 */
  reveal?: boolean
  name?: string
  avatar?: string
}

export async function createEnergyGoal(d: GoalDraft): Promise<{ id: number | null; error: string | null }> {
  const text = String(d.text || '').trim()
  if (text.length < 2) return { id: null, error: '目标至少写 2 个字' }
  if (text.length > GOAL_MAX) return { id: null, error: `目标最多 ${GOAL_MAX} 字` }
  const reveal = !!d.reveal
  try {
    const res: Any = await (cbRdb() as Any).rpc('energy_goal_create', {
      p_body: text,
      p_load: normLoad(d.load ?? DEFAULT_LOAD),
      p_reveal: reveal,
      p_name: reveal ? String(d.name || '').trim() : null,
      p_avatar: reveal ? String(d.avatar || '').trim() : null,
    })
    const err = readError(res?.error)
    if (err) return { id: null, error: err }
    const id = Number(Array.isArray(res?.data) ? res.data[0] : res?.data)
    return { id: Number.isFinite(id) && id > 0 ? id : null, error: null }
  } catch (e) {
    return { id: null, error: errText(e) }
  }
}

/** 鼓励 / 取消鼓励，返回操作后的状态 */
export async function cheerEnergyGoal(goalId: number): Promise<{ cheered: boolean; error: string | null }> {
  try {
    const res: Any = await (cbRdb() as Any).rpc('energy_goal_cheer', { p_goal_id: goalId })
    const err = readError(res?.error)
    if (err) return { cheered: false, error: err }
    const raw = Array.isArray(res?.data) ? res.data[0] : res?.data
    return { cheered: raw === true || raw === 't' || raw === 'true', error: null }
  } catch (e) {
    return { cheered: false, error: errText(e) }
  }
}

export async function setEnergyGoalReveal(
  goalId: number,
  reveal: boolean,
  name?: string,
  avatar?: string,
): Promise<{ ok: boolean; error: string | null }> {
  try {
    const res: Any = await (cbRdb() as Any).rpc('energy_goal_set_reveal', {
      p_goal_id: goalId,
      p_reveal: !!reveal,
      p_name: reveal ? String(name || '').trim() : null,
      p_avatar: reveal ? String(avatar || '').trim() : null,
    })
    const err = readError(res?.error)
    if (err) return { ok: false, error: err }
    const raw = Array.isArray(res?.data) ? res.data[0] : res?.data
    return { ok: raw === true || raw === 't' || raw === 'true', error: null }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

/** 撤下自己的目标（软删除，已提交的举报仍可追溯） */
export async function hideEnergyGoal(goalId: number): Promise<{ ok: boolean; error: string | null }> {
  try {
    const res: Any = await (cbRdb() as Any).rpc('energy_goal_hide', { p_goal_id: goalId })
    const err = readError(res?.error)
    if (err) return { ok: false, error: err }
    const raw = Array.isArray(res?.data) ? res.data[0] : res?.data
    return { ok: raw === true || raw === 't' || raw === 'true', error: null }
  } catch (e) {
    return { ok: false, error: errText(e) }
  }
}

export const GOAL_TEXT_MAX = GOAL_MAX
