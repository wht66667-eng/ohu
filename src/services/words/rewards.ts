/**
 * 单词模块奖励：宠物「经验果」随宠物模块一并归档，
 * 这里改为独立的「单词积分」本地账本，语义不变、不依赖 petdex。
 */

const KEY = 'words.points.v1'

type Ledger = Record<string, number>

function read(): Ledger {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    return raw && typeof raw === 'object' ? (raw as Ledger) : {}
  } catch {
    return {}
  }
}

/** 记入单词积分，返回累计值 */
export function grantWordPoints(uid: string, n: number): number {
  if (!uid || n <= 0) return 0
  const l = read()
  const next = (l[uid] || 0) + n
  l[uid] = next
  try {
    localStorage.setItem(KEY, JSON.stringify(l))
    window.dispatchEvent(new CustomEvent('words-points-change', { detail: next }))
  } catch {
    /* ignore */
  }
  return next
}

export function readWordPoints(uid: string): number {
  return read()[uid] || 0
}
