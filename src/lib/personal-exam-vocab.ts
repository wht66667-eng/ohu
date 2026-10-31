export const examLabels = { 'CET-4': '四级', 'CET-6': '六级', 'KAOYAN-1': '考研英语', 'KAOYAN-2': '考研英语二', IELTS: '雅思' } as const
export type ExamType = keyof typeof examLabels
export interface ExamWord { id: string; exam_type: ExamType; word: string; phonetic: string; meaning: string; example: string; source: string }
export interface ExamPack { exam_type: ExamType; title: string; count: number; bytes: number; sha256: string; file: string }
const PACK_BASE = (import.meta.env.VITE_PERSONAL_EXAM_PACK_BASE || 'https://jou-d4gq7a3cqf51e6caa-1394316826.tcloudbaseapp.com/personal-exam-packs').replace(/\/+$/, '')

export async function listExamPacks(signal: AbortSignal): Promise<ExamPack[]> {
  const response = await fetch(`${PACK_BASE}/manifest.json`, { signal, cache: 'no-cache' })
  if (!response.ok) throw new Error('词库列表暂时无法加载，请重试，或导入本地文件。')
  const manifest = await response.json()
  if (manifest.version !== 1 || !Array.isArray(manifest.packs) || manifest.packs.length > 10) throw new Error('词库目录格式不正确。')
  return manifest.packs.map((p: ExamPack) => {
    if (!Object.hasOwn(examLabels, p.exam_type) || typeof p.title !== 'string' || !Number.isInteger(p.count) || p.count < 1 || !Number.isInteger(p.bytes) || p.bytes < 1 || p.bytes > 30_000_000 || typeof p.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(p.sha256) || typeof p.file !== 'string' || !/^[a-z0-9-]+\.json$/.test(p.file)) throw new Error('词库目录包含无效下载信息。')
    return p
  })
}

export async function downloadExamPack(pack: ExamPack, signal: AbortSignal): Promise<ExamWord[]> {
  const response = await fetch(`${PACK_BASE}/${pack.file}`, { signal })
  if (!response.ok) throw new Error('词库下载失败，请检查网络后重试。')
  const declared = Number(response.headers.get('Content-Length'))
  if (declared > 30_000_000) throw new Error('词库文件过大。')
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength !== pack.bytes) throw new Error('下载不完整，请重新下载。')
  const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('')
  if (sha !== pack.sha256) throw new Error('词库校验失败，请重新下载。')
  const words = parsePersonalVocab(new TextDecoder().decode(bytes))
  if (words.length !== pack.count || words.some(w => w.exam_type !== pack.exam_type)) throw new Error('词库内容与目录不一致。')
  return words
}

export function parsePersonalVocab(text: string): ExamWord[] {
  const input = text.replace(/^\uFEFF/, '').trim()
  const records: unknown = input.startsWith('[') ? JSON.parse(input) : input.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
  if (!Array.isArray(records) || !records.length || records.length > 100_000) throw new Error('请选择包含 1–100000 条词汇的 JSON 或 JSONL 文件。')
  const unique = new Map<string, ExamWord>()
  for (const value of records) {
    if (!value || typeof value !== 'object') throw new Error('文件中存在无效词汇记录。')
    const row = value as Record<string, unknown>
    const str = (key: string, max: number) => {
      const v = row[key] ?? ''
      if (typeof v !== 'string' || v.length > max) throw new Error('词汇字段格式或长度不正确。')
      return v.trim()
    }
    const exam = str('exam_type', 20)
    if (!Object.hasOwn(examLabels, exam)) throw new Error('词库包含不支持的考试类型。')
    const word = str('word', 200), meaning = str('meaning', 5000)
    if (!word || !meaning) throw new Error('词汇缺少单词或释义。')
    const key = `${exam}:${word.toLowerCase()}`
    if (!unique.has(key)) unique.set(key, { id: key, exam_type: exam as ExamType, word, meaning, phonetic: str('phonetic', 500), example: str('example', 10000), source: str('source', 500) })
  }
  return [...unique.values()]
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('ohhu-personal-exam', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('library')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('无法打开设备存储，请检查存储权限。'))
    request.onblocked = () => reject(new Error('请关闭其他题库页面后重试。'))
  })
}

export async function readPersonalVocab(): Promise<ExamWord[]> {
  const db = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('library').objectStore('library').get('words')
      request.onsuccess = () => resolve(request.result ?? [])
      request.onerror = () => reject(new Error('读取词库失败，请重试。'))
    })
  } finally { db.close() }
}

export async function savePersonalVocab(words: ExamWord[]): Promise<void> {
  const db = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('library', 'readwrite')
      tx.objectStore('library').put(words, 'words')
      tx.oncomplete = () => resolve()
      tx.onabort = tx.onerror = () => reject(new Error('保存失败，设备存储可能已满。原词库未替换。'))
    })
  } finally { db.close() }
}

