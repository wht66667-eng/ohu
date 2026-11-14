import type { CoachTask, TaskContract } from '../services/coach/contract.ts'

export const TODO_IMPORT_PREFIX = 'ohu.todo.import.v1:'
const LEDGER_CAP = 500

export type ImportStatus = 'pending' | 'created' | 'failed'
export type ImportResultStatus = 'created' | 'duplicate' | 'pending' | 'failed' | 'skipped'

export interface TodoImportRecord {
  key: string
  taskId: string
  title: string
  date: string
  status: ImportStatus
  todoId: number | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface ImportTaskResult {
  key: string
  taskId: string
  title: string
  date: string
  status: ImportResultStatus
  todoId: number | null
  error: string | null
}

export interface ImportWriterResult {
  id: number | null
  inserted: boolean
  error: string | null
}

export type ImportWriter = (task: CoachTask, key: string) => Promise<ImportWriterResult>

export interface ImportOptions {
  uid?: string
  write: ImportWriter
  /** 返回 true 表示账号会话已变化，编排立即停止且不把未知结果当成功。 */
  sessionChanged?: () => boolean
}

export interface ImportOutcome {
  results: ImportTaskResult[]
  created: number
  duplicate: number
  pending: number
  failed: number
  skipped: number
  stopped: boolean
}

function ledgerKey(uid?: string): string {
  return `${TODO_IMPORT_PREFIX}${uid || 'guest'}`
}

export function readImportLedger(uid?: string): TodoImportRecord[] {
  const raw: unknown = JSON.parse(localStorage.getItem(ledgerKey(uid)) || '[]')
  if (!Array.isArray(raw) || raw.some(r => !r || typeof r.key !== 'string'
    || !['pending', 'created', 'failed'].includes(r.status)
    || typeof r.taskId !== 'string' || typeof r.title !== 'string'
    || typeof r.date !== 'string' || typeof r.updatedAt !== 'string'
    || typeof r.createdAt !== 'string'
    || (r.todoId !== null && (!Number.isSafeInteger(r.todoId) || r.todoId === 0)))) {
    throw new Error('导入凭证损坏，请保留本机数据并核对待办')
  }
  return raw as TodoImportRecord[]
}

function writeImportLedger(records: TodoImportRecord[], uid?: string): void {
  if (records.length > LEDGER_CAP) throw new Error('导入凭证已满，未写入新任务；旧凭证不会自动删除')
  localStorage.setItem(ledgerKey(uid), JSON.stringify(records))
}

export function findImportRecord(key: string, uid?: string): TodoImportRecord | null {
  return readImportLedger(uid).find((r) => r.key === key) || null
}

function upsert(record: TodoImportRecord, uid?: string): void {
  const rows = readImportLedger(uid).filter((r) => r.key !== record.key)
  writeImportLedger([record, ...rows], uid)
}

export function markImportPending(
  key: string,
  meta: { taskId: string; title: string; date: string },
  error: string | null = null,
  uid?: string,
  todoId: number | null = null,
): void {
  const now = new Date().toISOString()
  const prev = findImportRecord(key, uid)
  upsert({
    key,
    taskId: meta.taskId,
    title: meta.title,
    date: meta.date,
    status: 'pending',
    todoId: todoId ?? prev?.todoId ?? null,
    error,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  }, uid)
}

export function markImportCreated(key: string, todoId: number, uid?: string): void {
  const prev = findImportRecord(key, uid)
  if (!prev) return
  upsert({ ...prev, status: 'created', todoId, error: null, updatedAt: new Date().toISOString() }, uid)
}

export function markImportFailed(key: string, error: string | null, uid?: string): void {
  const prev = findImportRecord(key, uid)
  if (!prev) return
  upsert({ ...prev, status: 'failed', error, updatedAt: new Date().toISOString() }, uid)
}

/** 用户人工核对未知结果后落定：给出真实待办 ID 记为已写入；给 null 表示确认未写入、清除账本允许重试。 */
export function resolveImportPending(key: string, todoId: number | null, uid?: string): boolean {
  const prev = findImportRecord(key, uid)
  if (!prev || prev.status !== 'pending') return false
  if (todoId == null || !Number.isSafeInteger(todoId) || todoId === 0) return false
  upsert({ ...prev, status: 'created', todoId, error: null, updatedAt: new Date().toISOString() }, uid)
  return true
}

export function listImportRecords(uid?: string): TodoImportRecord[] {
  return readImportLedger(uid).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function summarizeImport(records: TodoImportRecord[]): {
  created: TodoImportRecord[]
  pending: TodoImportRecord[]
  failed: TodoImportRecord[]
} {
  return {
    created: records.filter((r) => r.status === 'created'),
    pending: records.filter((r) => r.status === 'pending'),
    failed: records.filter((r) => r.status === 'failed'),
  }
}

/** 导入键：sha256(coach|卷标题|horizon|任务id|任务标题|任务日期)，与账单 billDedupeKey 同一哈希约定。 */
export async function todoImportKey(contract: TaskContract, task: CoachTask): Promise<string> {
  const material = JSON.stringify(['local-coach', contract.version, contract.title,
    contract.horizon.start, contract.horizon.end, task.id, task.title, task.date])
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function errText(e: unknown): string {
  const m = (e as { message?: unknown })?.message
  return typeof m === 'string' && m ? m : '写入失败，请稍后重试'
}

/**
 * 幂等编排：created→去重跳过；pending→不重写、返回待处理供查询；failed/无记录→尝试写入。
 * 写入返回 inserted 但无确认 ID 时记 pending（结果未知），绝不自动重试造成重复。
 */
export async function importContractTasks(
  contract: TaskContract,
  tasks: CoachTask[],
  opts: ImportOptions,
): Promise<ImportOutcome> {
  if (!globalThis.navigator?.locks) throw new Error('当前环境不支持安全导入锁，尚未写入')
  return navigator.locks.request(ledgerKey(opts.uid), async () => {
  const results: ImportTaskResult[] = []
  let stopped = false
  for (const task of tasks) {
    const base = { taskId: task.id, title: task.title, date: task.date }
    if (stopped || opts.sessionChanged?.()) {
      stopped = true
      results.push({ key: '', ...base, status: 'skipped', todoId: null, error: null })
      continue
    }
    const key = await todoImportKey(contract, task)
    let existing: TodoImportRecord | null
    try {
      existing = findImportRecord(key, opts.uid)
      if (!existing || existing.status === 'failed') markImportPending(key, base, null, opts.uid)
    } catch (e) {
      results.push({ key, ...base, status: 'failed', todoId: null, error: `无法保存导入凭证，未写入：${errText(e)}` })
      continue
    }
    if (existing?.status === 'created') {
      results.push({ key, ...base, status: 'duplicate', todoId: existing.todoId, error: null })
      continue
    }
    if (existing?.status === 'pending') {
      results.push({ key, ...base, status: 'pending', todoId: existing.todoId, error: existing.error })
      continue
    }
    if (opts.sessionChanged?.()) {
      stopped = true
      markImportFailed(key, '账号已切换，尚未写入', opts.uid)
      results.push({ key, ...base, status: 'skipped', todoId: null, error: '账号已切换；尚未写入，请回原账号重试。' })
      continue
    }
    let wr: ImportWriterResult
    try {
      wr = await opts.write(task, key)
    } catch (e) {
      wr = { id: null, inserted: true, error: errText(e) }
    }
    let status: ImportStatus = 'pending'
    let error = wr.error
    if (opts.sessionChanged?.()) {
      stopped = true
      error = '账号已切换；写入结果未知，请回原账号核对。'
    } else if (wr.error == null && Number.isSafeInteger(wr.id) && wr.id !== null && wr.id !== 0) {
      status = 'created'
    } else if (!wr.inserted) {
      status = 'failed'
    }
    try {
      if (status === 'created') markImportCreated(key, wr.id!, opts.uid)
      else if (status === 'failed') markImportFailed(key, error, opts.uid)
      else markImportPending(key, base, error, opts.uid, wr.id)
    } catch {
      status = 'pending'
      error = '结果凭证未能更新，请核对本机待办；不会自动重写'
    }
    results.push({ key, ...base, status, todoId: wr.id, error })
  }
  const count = (s: ImportResultStatus) => results.filter((r) => r.status === s).length
  return {
    results,
    created: count('created'),
    duplicate: count('duplicate'),
    pending: count('pending'),
    failed: count('failed'),
    skipped: count('skipped'),
    stopped,
  }
  })
}