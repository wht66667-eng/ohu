import type { TodoDraft, TodoRow } from './todo'
import { captureQbankSession } from './qbank'

/** 本机待办：云端不可用时仍可新增、完成、删除；不伪造云端同步。 */
const PREFIX = 'ohu.todo.local.v1:'

function key(uid = captureQbankSession().uid): string {
  return `${PREFIX}${uid || 'guest'}`
}

type LocalTodoRow = TodoRow & { importKey?: string }

function readAll(uid?: string, strict = false): LocalTodoRow[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key(uid)) || '[]') as unknown
    if (!Array.isArray(raw) || raw.some(row => !row || !Number.isSafeInteger(row.id))) {
      throw new Error('本机待办数据损坏，请保留数据并核对')
    }
    return raw as LocalTodoRow[]
  } catch (error) {
    if (strict) throw error
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

export function findLocalImportedTodo(importKey: string, uid: string): TodoRow | null {
  return readAll(uid, true).find(row => row.importKey === importKey) || null
}

export function createLocalTodo(draft: TodoDraft, options?: { uid: string; importKey: string }): TodoRow {
  const rows = readAll(options?.uid, !!options)
  const existing = options && rows.find(row => row.importKey === options.importKey)
  if (existing) return existing
  const now = new Date().toISOString()
  const row: LocalTodoRow = {
    id: Math.min(-Date.now(), ...rows.map(row => row.id - 1)),
    ...(options ? { importKey: options.importKey } : {}),
    title: draft.title.trim().slice(0, 120),
    note: (draft.note || '').slice(0, 2000),
    due_at: draft.due_at ? new Date(draft.due_at).toISOString() : null,
    done: false,
    done_at: null,
    created_at: now,
    load: 2,
  }
  if (options) localStorage.setItem(key(options.uid), JSON.stringify([row, ...rows]))
  else writeAll([row, ...rows])
  return row
}

export function updateLocalTodo(id: number, patch: Partial<Pick<TodoRow, 'title' | 'note' | 'due_at' | 'done' | 'load'>>): boolean {
  const rows = readAll()
  const index = rows.findIndex((row) => row.id === id)
  if (index < 0) return false
  const current = rows[index]
  rows[index] = {
    ...current,
    title: patch.title ?? current.title,
    note: patch.note ?? current.note,
    due_at: patch.due_at === undefined ? current.due_at : patch.due_at,
    done: patch.done ?? current.done,
    load: patch.load ?? current.load,
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
