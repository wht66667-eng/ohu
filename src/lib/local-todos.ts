import type { TodoDraft, TodoRow } from './todo'
import { captureQbankSession } from './qbank'

/** 本机待办：云端不可用时仍可新增、完成、删除；不伪造云端同步。 */
const PREFIX = 'ohu.todo.local.v1:'

function key(uid = captureQbankSession().uid): string {
  return `${PREFIX}${uid || 'guest'}`
}

function readAll(uid?: string): TodoRow[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key(uid)) || '[]') as unknown
    return Array.isArray(raw) ? raw.filter((row): row is TodoRow => !!row && typeof (row as TodoRow).id === 'number') : []
  } catch {
    return []
  }
}

function writeAll(rows: TodoRow[], uid?: string): void {
  try { localStorage.setItem(key(uid), JSON.stringify(rows)) } catch { /* storage full */ }
}

export function listLocalTodos(): TodoRow[] {
  return readAll().sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1
    return String(a.due_at || '9999').localeCompare(String(b.due_at || '9999'))
  })
}

export function createLocalTodo(draft: TodoDraft): TodoRow {
  const now = new Date().toISOString()
  const row: TodoRow = {
    id: -Date.now(),
    title: draft.title.trim().slice(0, 120),
    note: (draft.note || '').slice(0, 2000),
    due_at: draft.due_at ? new Date(draft.due_at).toISOString() : null,
    done: false,
    done_at: null,
    created_at: now,
    load: 2,
  }
  const rows = readAll()
  writeAll([row, ...rows])
  return row
}

export function updateLocalTodo(id: number, patch: Partial<Pick<TodoRow, 'title' | 'note' | 'due_at' | 'done'>>): boolean {
  const rows = readAll()
  const index = rows.findIndex((row) => row.id === id)
  if (index < 0) return false
  const current = rows[index]
  rows[index] = {
    ...current,
    ...patch,
    done_at: patch.done === undefined ? current.done_at : patch.done ? new Date().toISOString() : null,
  }
  writeAll(rows)
  return true
}

export function deleteLocalTodo(id: number): boolean {
  const rows = readAll()
  const next = rows.filter((row) => row.id !== id)
  if (next.length === rows.length) return false
  writeAll(next)
  return true
}
