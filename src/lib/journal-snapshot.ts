/**
 * 「结果页 → 今天手账」共享快照通道（M2-②）。
 *
 * 各结果页（课表今日卡、待办、星座/塔罗等）用同一入口把一段文字快照
 * 以 kind:'journal' 写进当天手账明文库（不触碰日记加密保险库）；
 * 账号口径与手账页一致（登录 user:<uid>，未登录 guest）。
 */
import { journalId, saveJournal } from './campus-journal.ts'
import { localDateKey } from './chat-fortune.ts'
import { toast } from './toast'

export function journalOwnerOf(isSigned: boolean, uid: string | undefined): string {
  return isSigned && uid ? `user:${uid}` : 'guest'
}

/** 把一段结果快照写进今天手账；成功 toast 由这里统一给出。 */
export async function saveSnapshotToJournal(owner: string, title: string, body: string): Promise<void> {
  const now = Date.now()
  await saveJournal({
    owner, id: journalId(), day: localDateKey(), kind: 'journal', title, body,
    mood: '', photos: [], pinned: false, createdAt: now, updatedAt: now,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
  toast.ok('已存入今天的手账')
}
