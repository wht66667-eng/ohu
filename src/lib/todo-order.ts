/**
 * 待办自定义排序：本地优先，登录后尝试同步到 CloudBase 表 client_prefs。
 * 若表不存在 / RLS 未开，静默回落 localStorage，不影响使用。
 *
 * 建表 SQL（管理员在 CloudBase 控制台执行一次即可）：
 *   create table if not exists client_prefs (
 *     uid text not null,
 *     pref_key text not null,
 *     pref_value jsonb not null default '{}'::jsonb,
 *     updated_at timestamptz not null default now(),
 *     primary key (uid, pref_key)
 *   );
 *   alter table client_prefs enable row level security;
 *   -- 策略：auth.uid()::text = uid 的 select/insert/update
 */
import { cbRdb } from './cb'
import { captureQbankSession, isQbankSessionCurrent } from './qbank'

// The legacy global todo.order is retained without assigning it to a new owner.
const localKey = (uid: string) => `todo.order.v2:${uid ? `uid:${encodeURIComponent(uid)}` : 'guest'}`
const PREF_KEY = 'todo_order'

type Any = any

function readLocal(uid = captureQbankSession().uid): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(localKey(uid)) || '[]')
    if (!Array.isArray(raw)) return []
    return raw.map(Number).filter((n) => Number.isFinite(n) && n > 0)
  } catch {
    return []
  }
}

function writeLocal(ids: number[], uid = captureQbankSession().uid) {
  try {
    localStorage.setItem(localKey(uid), JSON.stringify(ids))
  } catch {
    /* ignore */
  }
}

export function loadTodoOrderLocal(): number[] {
  return readLocal()
}

export function saveTodoOrderLocal(ids: number[]) {
  writeLocal(ids)
}

/** 登录后拉取云端排序，与本地合并（云端优先；云端空则用本地并回写） */
export async function pullTodoOrder(uid: string): Promise<number[]> {
  const session = captureQbankSession()
  if (uid !== session.uid) return []
  const local = readLocal(uid)
  if (!uid) return local
  try {
    const res: Any = await cbRdb()
      .from('client_prefs')
      .select('pref_value')
      .eq('uid', uid)
      .eq('pref_key', PREF_KEY)
      .limit(1)
    if (!isQbankSessionCurrent(session)) return []
    if (res?.error) return local
    const row = Array.isArray(res?.data) ? res.data[0] : res?.data
    const val = row?.pref_value
    const ids = Array.isArray(val?.ids)
      ? val.ids.map(Number).filter((n: number) => Number.isFinite(n) && n > 0)
      : Array.isArray(val)
        ? val.map(Number).filter((n: number) => Number.isFinite(n) && n > 0)
        : []
    if (ids.length) {
      writeLocal(ids, uid)
      return ids
    }
    if (local.length) void pushTodoOrder(uid, local)
    return local
  } catch {
    return isQbankSessionCurrent(session) ? local : []
  }
}

/** 写入云端；失败则仅保留本地 */
export async function pushTodoOrder(uid: string, ids: number[]): Promise<void> {
  const session = captureQbankSession()
  if (uid !== session.uid) return
  writeLocal(ids, uid)
  if (!uid) return
  try {
    const body = {
      uid,
      pref_key: PREF_KEY,
      pref_value: { ids },
      updated_at: new Date().toISOString(),
    }
    const existing: Any = await cbRdb()
      .from('client_prefs')
      .select('uid')
      .eq('uid', uid)
      .eq('pref_key', PREF_KEY)
      .limit(1)
    if (!isQbankSessionCurrent(session) || existing?.error) return
    const has = Array.isArray(existing?.data) ? existing.data.length > 0 : !!existing?.data
    if (has) {
      await cbRdb().from('client_prefs').update({ pref_value: body.pref_value, updated_at: body.updated_at }).eq('uid', uid).eq('pref_key', PREF_KEY)
    } else {
      await cbRdb().from('client_prefs').insert(body)
    }
  } catch {
    /* 表未建或无权限时忽略 */
  }
}
