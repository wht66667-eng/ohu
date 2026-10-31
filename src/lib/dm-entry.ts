/**
 * 私信入口：先拿到会话线 id，再跳 `/chats/{id}`。
 *
 * 历史：这里原本走腾讯 IM 的 `/im/dm/{peerUid}`（imDmPath）。IM 按 MAU 计费且不打算续，
 * 私信改回自建 PG 链路（chat_threads / chat_messages + RPC），于是入口变成两步：
 * 先 chat_thread_open（服务端按「话题 + 一对参与者」复用同一条线，重复点是安全的），
 * 再跳自建会话页。话题类型决定了会话头能不能跳回详情页（见 chatTopicPath）。
 */
import { chatOpenThread } from './chat'

export interface DmEntryInput {
  peerUid: string
  peerName?: string
  /** secondhand / task / shop / stall / plaza_post / plaza_user，缺省 plaza_user */
  topicType?: string
  topicId?: number | null
  /** 会话头展示的话题标题，缺省「私聊 · 昵称」 */
  topicTitle?: string
}

export async function openDmThread(input: DmEntryInput): Promise<{ path: string; error: string | null }> {
  const peerUid = String(input.peerUid || '').trim()
  if (!peerUid) return { path: '', error: '暂时联系不上这位同学' }
  const name = (input.peerName || '').trim() || '同学'
  const r = await chatOpenThread({
    topicType: input.topicType || 'plaza_user',
    topicId: input.topicId ?? null,
    topicTitle: (input.topicTitle || `私聊 · ${name}`).trim().slice(0, 40),
    peerUid,
    peerName: name,
  })
  if (r.error || !r.data?.thread?.id) return { path: '', error: r.error || '会话建立失败，请稍后再试' }
  return { path: `/chats/${r.data.thread.id}`, error: null }
}
