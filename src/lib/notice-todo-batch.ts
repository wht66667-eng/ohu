import type { TodoDraft } from './todo'
import type { MutateRes } from './market'
import { notifyTodoDataChanged } from './todo-data-events'

export type NoticeSaveEntry = { index: number; title: string; date: string; time: string; link: string }
/** Keep original notice text out of the write payload; stop on an uncertain result. */
export async function saveNoticeBatch(entries: NoticeSaveEntry[], isCurrent: () => boolean, create: (draft: TodoDraft, options?: { notify?: boolean }) => Promise<MutateRes>, onSaved: (index: number) => void) {
  let saved = 0
  const finish = (changed: boolean, error: string | null) => {
    if (saved > 0 && isCurrent()) notifyTodoDataChanged()
    return { saved, changed, error }
  }
  for (const row of entries) {
    if (!isCurrent()) return finish(true, null)
    try {
      const result = await create({ title: row.title.trim(), note: row.link ? `作业链接：${new URL(row.link).href}` : '', due_at: row.date ? new Date(`${row.date}T${row.time}:00+08:00`).toISOString() : '' }, { notify: false })
      if (!isCurrent()) return finish(true, null)
      if (result.error) return finish(false, result.error)
      saved++; onSaved(row.index)
    } catch { return finish(!isCurrent(), '保存结果未确认') }
  }
  return finish(false, null)
}
