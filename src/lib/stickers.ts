/**
 * 我的表情包。
 *
 * 存储沿用项目里 client_prefs 的既有套路（见 todo-order.ts）：本地优先、登录后云端同步。
 * - 本地：localStorage，按 uid 分桶，换账号互不可见
 * - 云端：client_prefs 表的 pref_key='chat_stickers'，仅存 URL 列表（图片本体在 images 桶）
 * - 同步是「尽力而为」：云端拉不到就用本地，写不上去就只留本地，不阻塞发图
 *
 * 表情包本质上就是一张图，发送时复用图片消息通道，不需要新的服务端字段。
 */
import { cbRdb } from './cb'

const LS_KEY = 'sc.stickers.v1'
const PREF_KEY = 'chat_stickers'
/** 上限：表情包会常驻内存并在面板里铺开，太多既占内存也难翻找 */
export const STICKER_LIMIT = 30

export interface Sticker {
  id: string
  url: string
  /** 自制表情包保留原始文字，便于日后再次编辑；外部添加的为空 */
  text?: string
  at: number
}

const listeners = new Set<() => void>()
const cache = new Map<string, Sticker[]>()

function emit() {
  for (const fn of listeners) fn()
}

function safeUrl(raw: unknown): string {
  const url = String(raw || '').trim()
  if (!url || url.length > 1024) return ''
  if (!/^https:\/\/\S+$/.test(url)) return ''
  return url
}

function normalize(list: unknown, uid: string): Sticker[] {
  if (!Array.isArray(list)) return []
  const out: Sticker[] = []
  for (const row of list) {
    const url = safeUrl((row as { url?: unknown })?.url)
    if (!url) continue
    out.push({
      id: String((row as { id?: unknown })?.id || `${url.slice(-12)}-${out.length}`),
      url,
      text: String((row as { text?: unknown })?.text || '').slice(0, 60) || undefined,
      at: Number((row as { at?: unknown })?.at) || Date.now(),
    })
    if (out.length >= STICKER_LIMIT) break
  }
  return dedupe(out, uid)
}

function dedupe(list: Sticker[], uid: string): Sticker[] {
  const seen = new Set<string>()
  const out: Sticker[] = []
  for (const s of list) {
    if (seen.has(s.url)) continue
    seen.add(s.url)
    out.push(s)
  }
  writeLocal(uid, out)
  cache.set(uid, out)
  return out
}

function readLocal(uid: string): Sticker[] {
  if (cache.has(uid)) return cache.get(uid) || []
  let parsed: unknown = null
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) parsed = JSON.parse(raw)
  } catch {
    parsed = null
  }
  const bucket = (parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {})[uid]
  const list = normalize(bucket, uid)
  cache.set(uid, list)
  return list
}

function writeLocal(uid: string, list: Sticker[]) {
  cache.set(uid, list)
  try {
    let parsed: Record<string, unknown> = {}
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) {
        const j = JSON.parse(raw)
        if (j && typeof j === 'object') parsed = j as Record<string, unknown>
      }
    } catch {
      parsed = {}
    }
    parsed[uid] = list
    localStorage.setItem(LS_KEY, JSON.stringify(parsed))
  } catch {
    /* 隐私模式下写不进就算了，内存里仍可用 */
  }
}

/** 同步读取（面板渲染用） */
export function getStickers(uid: string): Sticker[] {
  if (!uid) return []
  return readLocal(uid)
}

/** 面板订阅：本地变更时重渲染 */
export function subscribeStickers(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function addSticker(uid: string, url: string, text = ''): Sticker[] {
  if (!uid) return []
  const safe = safeUrl(url)
  if (!safe) return getStickers(uid)
  const list = readLocal(uid)
  if (list.some((s) => s.url === safe)) return list
  const next = [{ id: `s${Date.now().toString(36)}`, url: safe, text: text.slice(0, 60) || undefined, at: Date.now() }, ...list].slice(0, STICKER_LIMIT)
  dedupe(next, uid)
  emit()
  void pushStickers(uid, next)
  return next
}

export function removeSticker(uid: string, id: string): Sticker[] {
  if (!uid) return []
  const next = readLocal(uid).filter((s) => s.id !== id)
  dedupe(next, uid)
  emit()
  void pushStickers(uid, next)
  return next
}

/** 登录后拉一次云端；失败或无数据都退回本地 */
export async function pullStickers(uid: string): Promise<Sticker[]> {
  if (!uid) return []
  try {
    const res = (await cbRdb()
      .from('client_prefs')
      .select('pref_value')
      .eq('uid', uid)
      .eq('pref_key', PREF_KEY)
      .limit(1)) as { data?: unknown; error?: unknown }
    if (res?.error) return readLocal(uid)
    const row = Array.isArray(res?.data) ? (res.data as unknown[])[0] : res?.data
    const value = (row as { pref_value?: unknown } | null)?.pref_value
    const remote = normalize(Array.isArray(value) ? value : (value as { items?: unknown })?.items, uid)
    const local = readLocal(uid)
    if (remote.length) return remote
    if (local.length) void pushStickers(uid, local)
    return local
  } catch {
    return readLocal(uid)
  }
}

/** 写入云端：upsert，失败只留本地 */
export async function pushStickers(uid: string, list: Sticker[]): Promise<void> {
  if (!uid) return
  writeLocal(uid, list)
  try {
    const body = { uid, pref_key: PREF_KEY, pref_value: { items: list }, updated_at: new Date().toISOString() }
    const existing = (await cbRdb()
      .from('client_prefs')
      .select('uid')
      .eq('uid', uid)
      .eq('pref_key', PREF_KEY)
      .limit(1)) as { data?: unknown; error?: unknown }
    if (Array.isArray(existing?.data) && existing.data.length) {
      await cbRdb().from('client_prefs').update(body).eq('uid', uid).eq('pref_key', PREF_KEY)
    } else {
      await cbRdb().from('client_prefs').insert(body)
    }
  } catch {
    /* 云端不可达不影响本地使用 */
  }
}
