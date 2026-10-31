/**
 * 好友 / 朋友圈写入用的当前用户快取。
 *
 * 这两个模块的 insert 都带 user_uid 类字段（NOT NULL + RLS 要求等于 auth.uid()），
 * 由页面逐个传 uid 容易漏传——Codex 分支最初的实现就是漏的，四个写入函数全部被
 * NOT NULL 和 RLS 双重拒掉。这里统一从 SDK 会话自查，与 RLS 的 auth.uid() 同源。
 */
import { cbAuth } from './cb'

export interface SocialActor {
  uid: string
  name: string
  avatar: string
}

/** 当前登录用户；游客 / 未登录 / 读取异常一律返回 null（调用方给出「请先登录」） */
export function currentActor(): SocialActor | null {
  try {
    const raw = cbAuth().currentUser as unknown as {
      id?: unknown
      uid?: unknown
      user_metadata?: {
        uid?: unknown
        username?: unknown
        nickName?: unknown
        nickname?: unknown
        name?: unknown
        avatar_url?: unknown
        avatarUrl?: unknown
        picture?: unknown
      }
    } | null | undefined
    if (!raw) return null
    const meta = raw.user_metadata || {}
    const uid = str(raw.id) || str(raw.uid) || str(meta.uid)
    if (!uid) return null
    return {
      uid,
      name: str(meta.username) || str(meta.nickName) || str(meta.nickname) || str(meta.name),
      avatar: str(meta.avatar_url) || str(meta.avatarUrl) || str(meta.picture),
    }
  } catch {
    return null
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}
