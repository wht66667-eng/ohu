export interface UnreadSource { count: number | null; error: boolean; detail?: string }
export interface UnreadSnapshot { uid: string; notifications: UnreadSource; chats: UnreadSource; im?: UnreadSource }

export function unreadSource(count: unknown, error: unknown): UnreadSource {
  const valid = !error && typeof count === 'number' && Number.isFinite(count) && count >= 0
  return { count: valid ? Math.floor(count) : null, error: !valid, ...(typeof error === 'string' && error ? { detail: error } : {}) }
}

/** Failures belong to message data, never to the app update indicator. */
export function unreadFailures(uid: string, snapshot: UnreadSnapshot | null) {
  if (!uid || snapshot?.uid !== uid) return []
  const sources = [
    { source: snapshot.notifications, label: '通知', to: '/notify' },
    { source: snapshot.chats, label: '历史私信', to: '/chats' },
    ...(snapshot.im ? [{ source: snapshot.im, label: '即时私信', to: '/chats' }] : []),
  ]
  return sources.filter(({ source }) => source.error).map(({ source, label, to }) => ({
    label, to,
    message: /登录|凭证|签名|token|unauthorized|401/i.test(source.detail || '') ? '连接未成功，请重试；仍失败时重新登录'
      : /network|fetch|网络|超时|timeout/i.test(source.detail || '') ? '网络连接失败，请稍后重试'
      : '未读数量暂时无法读取，请重试',
  }))
}

/** A successful source remains usable when the other source is unknown or fails. */
export function summarizeUnread(uid: string, snapshot: UnreadSnapshot | null) {
  if (!uid || snapshot?.uid !== uid) return { count: null, incomplete: !!uid, error: false, hint: uid ? '同步中' : '' }
  const sources = [snapshot.notifications, snapshot.chats, ...(snapshot.im ? [snapshot.im] : [])]
  const known = sources.filter((source) => source.count !== null)
  const incomplete = known.length !== sources.length
  const error = sources.some((source) => source.error)
  return {
    count: known.length ? known.reduce((sum, source) => sum + source.count!, 0) : null,
    incomplete,
    error,
    hint: error ? known.length ? '部分消息暂时无法读取' : '消息暂时无法读取' : incomplete ? '同步中' : '',
  }
}
