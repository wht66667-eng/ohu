/**
 * 私人题库数据层（1.2.34 · 新四表结构）
 *
 * - 本机题库按登录账号保存；访客独立。旧版无归属缓存只在本人确认后恢复。
 * - 登录云端账号时尽力镜像 questions / papers / paper_questions / paper_attempts（RLS 仅本人）
 * - 云端 createdAt 较新者覆盖本地；由前端统一生成 text id，避免双写冲突
 */
import { cbRdb } from './cb'

export type QType = 'single_choice' | 'judge'

export interface QOption {
  key: string
  text: string
}

export interface QRow {
  id: string
  subject: string
  sourceType: string // paste | ai | cet4_2025_12 | doc
  sourceRef?: string
  qtype: QType
  stem: string
  options: QOption[]
  answer: string // 单选：'A'/'B'…；判断：'true'/'false'
  explanation: string
  difficulty: number
  tags: string[]
  contentHash: string
  createdAt: string
}

export interface AttemptRow {
  id: string
  answers: Record<string, string>
  score: number
  correctCount: number
  totalCount: number
  createdAt: string
}

export interface PaperRow {
  id: string
  title: string
  qids: string[]
  attempts: AttemptRow[]
  createdAt: string
}

const LEGACY_KEY = 'qbank.v2'
const LEGACY_OWNER_KEY = 'qbank.v2:restored-to'
type Any = any

type Store = {
  questions: QRow[]
  papers: PaperRow[]
}

/* ---------------- 本地 ---------------- */

let currentUid = ''
let identityRevision = 0
let storeRevision = 0
const subscribers = new Set<() => void>()

function storageKey(uid = currentUid): string {
  return uid ? `qbank.v3:uid:${encodeURIComponent(uid)}` : 'qbank.v3:guest'
}

function changed() {
  storeRevision++
  subscribers.forEach((notify) => notify())
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('ohhu-account-session-change'))
}

export const getQbankRevision = () => storeRevision
export function subscribeQbank(notify: () => void): () => void {
  subscribers.add(notify)
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === storageKey() || event.key === LEGACY_OWNER_KEY || event.key === LEGACY_KEY) changed()
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  return () => {
    subscribers.delete(notify)
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }
}

export function captureQbankSession() {
  return { uid: currentUid, revision: identityRevision }
}
export function isQbankSessionCurrent(session: ReturnType<typeof captureQbankSession>): boolean {
  return currentUid === session.uid && identityRevision === session.revision
}

export class QbankStorageError extends Error {
  constructor(message: string) { super(message); this.name = 'QbankStorageError' }
}

function readStore(key: string, strict = false): Store {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return { questions: [], papers: [] }
    const j = JSON.parse(raw) as Store
    return {
      questions: Array.isArray(j?.questions) ? j.questions : [],
      papers: Array.isArray(j?.papers) ? j.papers : [],
    }
  } catch {
    if (strict) throw new QbankStorageError('本机题库暂时无法读取，原记录仍保留，请重试。')
    return { questions: [], papers: [] }
  }
}

function loadStore(strict = false): Store {
  return readStore(storageKey(), strict)
}

function saveStore(s: Store) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(s))
    changed()
  } catch {
    throw new QbankStorageError('题库未能保存到本机，请释放一些空间后重试。')
  }
}

export function getLegacyQbankSummary(): { questions: number; papers: number } | null {
  try {
    if (localStorage.getItem(LEGACY_OWNER_KEY)) return null
    const old = readStore(LEGACY_KEY)
    return old.questions.length || old.papers.length ? { questions: old.questions.length, papers: old.papers.length } : null
  } catch {
    return null
  }
}

/** Explicit local recovery; the unowned original is retained and never uploaded here. */
export function restoreLegacyQbank(): { ok: boolean; error?: string } {
  if (!getLegacyQbankSummary()) return { ok: false, error: '没有可恢复的旧版题库，或已恢复过。' }
  const key = storageKey()
  let previous: string | null = null
  let destinationWritten = false
  let ownerWritten = false
  try {
    previous = localStorage.getItem(key)
    const merged = mergedStore(loadStore(true), readStore(LEGACY_KEY))
    const encoded = JSON.stringify(merged)
    localStorage.setItem(key, encoded)
    destinationWritten = true
    if (localStorage.getItem(key) !== encoded) throw new Error('storage unavailable')
    localStorage.setItem(LEGACY_OWNER_KEY, key)
    ownerWritten = true
    if (localStorage.getItem(LEGACY_OWNER_KEY) !== key) throw new Error('storage unavailable')
    changed()
    return { ok: true }
  } catch {
    // Keep the legacy copy intact, and undo a partial destination write when possible.
    try {
      if (destinationWritten) {
        if (previous === null) localStorage.removeItem(key)
        else localStorage.setItem(key, previous)
      }
      if (ownerWritten && localStorage.getItem(LEGACY_OWNER_KEY) === key) localStorage.removeItem(LEGACY_OWNER_KEY)
    } catch { /* Original legacy data is still retained. */ }
    return { ok: false, error: '本机空间不足或存储不可用，旧题库仍保留，请稍后重试。' }
  }
}

export function newId(prefix = 'q'): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function listQuestionsLocal(): QRow[] {
  return loadStore().questions
}

export function listPapersLocal(): PaperRow[] {
  return loadStore().papers
}

export function questionByIdLocal(id: string): QRow | null {
  return loadStore().questions.find((q) => q.id === id) || null
}

export function paperByIdLocal(id: string): PaperRow | null {
  return loadStore().papers.find((p) => p.id === id) || null
}

export function existingHashesLocal(): Set<string> {
  return new Set(loadStore().questions.map((q) => q.contentHash))
}

export function addQuestionsLocal(rows: Omit<QRow, 'id' | 'createdAt'>[]): QRow[] {
  const s = loadStore(true)
  const now = new Date().toISOString()
  const full: QRow[] = rows.map((r) => ({ ...r, id: newId(), createdAt: now }))
  s.questions = [...full, ...s.questions]
  saveStore(s)
  return full
}

export function removeQuestionLocal(id: string) {
  const s = loadStore(true)
  s.questions = s.questions.filter((q) => q.id !== id)
  s.papers = s.papers.map((p) => (p.qids.includes(id) ? { ...p, qids: p.qids.filter((x) => x !== id) } : p))
  s.papers = s.papers.filter((p) => p.qids.length > 0)
  saveStore(s)
}

export function addPaperLocal(title: string, qids: string[]): PaperRow {
  const s = loadStore(true)
  const p: PaperRow = { id: newId('p'), title, qids, attempts: [], createdAt: new Date().toISOString() }
  s.papers = [p, ...s.papers]
  saveStore(s)
  return p
}

export function removePaperLocal(id: string) {
  const s = loadStore(true)
  s.papers = s.papers.filter((p) => p.id !== id)
  saveStore(s)
}

export function submitAttemptLocal(paperId: string, answers: Record<string, string>, score: number, correctCount: number, totalCount: number): AttemptRow | null {
  const s = loadStore(true)
  const p = s.papers.find((x) => x.id === paperId)
  if (!p) return null
  const a: AttemptRow = { id: newId('a'), answers, score, correctCount, totalCount, createdAt: new Date().toISOString() }
  p.attempts = [a, ...p.attempts].slice(0, 20)
  saveStore(s)
  return a
}

/* ---------------- 云端（尽力而为） ---------------- */

export function setQbankUid(uid: string | undefined | null) {
  const next = typeof uid === 'string' ? uid.trim() : ''
  if (next === currentUid) return
  identityRevision++
  currentUid = next
  changed()
}

export function cloudEnabled(): boolean {
  return !!currentUid && !currentUid.startsWith('local:')
}

export async function pushQuestionsCloud(rows: QRow[]) {
  const session = captureQbankSession()
  if (!cloudEnabled() || !rows.length) return
  try {
    for (const q of rows) {
      if (!isQbankSessionCurrent(session)) return
      await (cbRdb().from('questions') as Any).insert({
        id: q.id,
        uid: session.uid,
        source_type: q.sourceType,
        source_ref: q.sourceRef || null,
        subject: q.subject,
        question_type: q.qtype,
        stem: q.stem,
        options: JSON.stringify(q.options),
        answer: q.answer,
        explanation: q.explanation,
        difficulty: q.difficulty,
        tags: q.tags,
        content_hash: q.contentHash,
        created_at: q.createdAt,
      })
    }
  } catch {
    /* 表未建 / 唯一冲突：本地仍可用 */
  }
}

export async function pushPaperCloud(p: PaperRow) {
  const session = captureQbankSession()
  if (!cloudEnabled()) return
  try {
    await (cbRdb().from('papers') as Any).insert({
      id: p.id,
      uid: session.uid,
      title: p.title,
      config: JSON.stringify({ qids: p.qids }),
      created_at: p.createdAt,
    })
    for (let i = 0; i < p.qids.length; i++) {
      if (!isQbankSessionCurrent(session)) return
      await (cbRdb().from('paper_questions') as Any).insert({
        id: newId('pq'),
        uid: session.uid,
        paper_id: p.id,
        question_id: p.qids[i],
        sort_order: i,
        score: 1,
      })
    }
  } catch {
    /* ignore */
  }
}

export async function pushAttemptCloud(paperId: string, a: AttemptRow) {
  const uid = currentUid
  if (!cloudEnabled()) return
  try {
    await (cbRdb().from('paper_attempts') as Any).insert({
      id: a.id,
      uid,
      paper_id: paperId,
      answers: JSON.stringify(a.answers),
      score: a.score,
      correct_count: a.correctCount,
      total_count: a.totalCount,
      created_at: a.createdAt,
    })
  } catch {
    /* ignore */
  }
}

export async function deleteQuestionCloud(id: string) {
  const uid = currentUid
  if (!cloudEnabled()) return
  try {
    await (cbRdb().from('questions') as Any).delete().eq('id', id).eq('uid', uid)
  } catch {
    /* ignore */
  }
}

export async function deletePaperCloud(id: string) {
  const uid = currentUid
  if (!cloudEnabled()) return
  try {
    await (cbRdb().from('papers') as Any).delete().eq('id', id).eq('uid', uid)
  } catch {
    /* ignore */
  }
}

/* ---------------- 云端拉取合并 ---------------- */

function cloudToQ(r: Any): QRow {
  let options: QOption[] = []
  try {
    const raw = typeof r.options === 'string' ? JSON.parse(r.options) : r.options || []
    if (Array.isArray(raw)) {
      options = raw
        .map((o: unknown, i: number) =>
          typeof o === 'string'
            ? { key: String.fromCharCode(65 + i), text: o }
            : { key: String((o as QOption)?.key || String.fromCharCode(65 + i)), text: String((o as QOption)?.text || '') },
        )
        .filter((o) => o.text)
    }
  } catch {
    /* ignore */
  }
  let tags: string[] = []
  try {
    tags = Array.isArray(r.tags) ? r.tags : []
  } catch {
    /* ignore */
  }
  return {
    id: r.id,
    subject: r.subject || '未分类',
    sourceType: r.source_type || 'paste',
    sourceRef: r.source_ref || undefined,
    qtype: r.question_type === 'judge' ? 'judge' : 'single_choice',
    stem: r.stem || '',
    options,
    answer: r.answer != null ? String(r.answer) : '',
    explanation: r.explanation || '',
    difficulty: Number(r.difficulty) || 3,
    tags,
    contentHash: r.content_hash || '',
    createdAt: String(r.created_at || ''),
  }
}

function cloudToPaper(r: Any, attempts: AttemptRow[]): PaperRow {
  let qids: string[] = []
  try {
    const cfg = typeof r.config === 'string' ? JSON.parse(r.config) : r.config || {}
    qids = Array.isArray(cfg?.qids) ? cfg.qids : []
  } catch {
    /* ignore */
  }
  return {
    id: r.id,
    title: r.title || '未命名试卷',
    qids,
    attempts,
    createdAt: String(r.created_at || ''),
  }
}

function cloudToAttempt(r: Any): AttemptRow {
  let answers: Record<string, string> = {}
  try {
    answers = typeof r.answers === 'string' ? JSON.parse(r.answers) : r.answers || {}
  } catch {
    /* ignore */
  }
  return {
    id: r.id,
    answers,
    score: Number(r.score) || 0,
    correctCount: Number(r.correct_count) || 0,
    totalCount: Number(r.total_count) || 0,
    createdAt: String(r.created_at || ''),
  }
}

/** 拉云端并按 id 合并（云端 createdAt 较新者覆盖），返回是否拉到数据 */
export async function pullCloud(): Promise<boolean> {
  const uid = currentUid
  const revision = identityRevision
  if (!cloudEnabled()) return false
  try {
    const [qs, ps, pa] = await Promise.all([
      (cbRdb().from('questions') as Any).select('*').eq('uid', uid).limit(500),
      (cbRdb().from('papers') as Any).select('*').eq('uid', uid).limit(200),
      (cbRdb().from('paper_attempts') as Any).select('*').eq('uid', uid).limit(500),
    ])
    if (identityRevision !== revision || currentUid !== uid || qs?.error || ps?.error || pa?.error) return false
    const qRows: QRow[] = (Array.isArray(qs?.data) ? qs.data : []).map(cloudToQ).filter((q: QRow) => q.stem)
    const paperRows = Array.isArray(ps?.data) ? ps.data : []
    const attemptsByPaper = new Map<string, AttemptRow[]>()
    for (const raw of Array.isArray(pa?.data) ? pa.data : []) {
      if (typeof raw.paper_id !== 'string' || !raw.paper_id) continue
      const list = attemptsByPaper.get(raw.paper_id) || []
      list.push(cloudToAttempt(raw))
      attemptsByPaper.set(raw.paper_id, list)
    }
    const pRows: PaperRow[] = paperRows.map((r: Any) => cloudToPaper(r, attemptsByPaper.get(r.id) || []))
    // An empty successful read is still a verified sync; it never erases local content.
    mergeCloud(qRows, pRows)
    return true
  } catch {
    return false
  }
}

function mergedStore(s: Store, incoming: Store): Store {
  const time = (value: string) => Date.parse(value) || 0
  const qById = new Map(s.questions.map((q) => [q.id, q]))
  for (const q of incoming.questions) {
    const old = qById.get(q.id)
    if (!old || time(q.createdAt) > time(old.createdAt)) qById.set(q.id, q)
  }
  const pById = new Map(s.papers.map((p) => [p.id, p]))
  for (const p of incoming.papers) {
    const old = pById.get(p.id)
    if (!old) { pById.set(p.id, p); continue }
    const attempts = new Map(old.attempts.map((attempt) => [attempt.id, attempt]))
    for (const attempt of p.attempts) attempts.set(attempt.id, attempt)
    pById.set(p.id, {
      ...(time(p.createdAt) > time(old.createdAt) ? p : old),
      attempts: [...attempts.values()].sort((a, b) => time(b.createdAt) - time(a.createdAt)).slice(0, 20),
    })
  }
  return {
    questions: [...qById.values()].sort((a, b) => time(b.createdAt) - time(a.createdAt)),
    papers: [...pById.values()].sort((a, b) => time(b.createdAt) - time(a.createdAt)),
  }
}

function mergeCloud(qRows: QRow[], pRows: PaperRow[]) {
  saveStore(mergedStore(loadStore(true), { questions: qRows, papers: pRows }))
}
