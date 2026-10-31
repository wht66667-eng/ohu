/** File generation is a separate server-verified product; ordinary study stays free. */
import { cbAuth } from '../../lib/cb'
import { API_BASE } from '../../lib/gateway'
import type { GenType, TransDir } from './generate'
import { parseAIQuestionsJson, type ParsedQuestion } from './parse'

export interface FileGenerationConfig {
  enabled: boolean
  canPurchase: boolean
  priceCent: number
  questionsPerJob: number
  creditsPerJob: number
  maxBytes: number
  maxChars: number
  formats: string[]
}
export interface FileGenerationRequest {
  requestId: string
  fileName: string
  ext: string
  base64: string
  subject: string
  type: GenType
  dir: TransDir
}
export type FileQuestion = ParsedQuestion & { sourceRef: string }
export class FileGenerationError extends Error {
  code: string
  constructor(message: string, code: string) { super(message); this.name = 'FileGenerationError'; this.code = code }
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
export type PendingFileGeneration = Omit<FileGenerationRequest, 'base64'> & { questionsPerJob: number }
const pendingKey = (uid: string) => `ohhu.file-generation.pending:${encodeURIComponent(uid)}`
export function readPendingFileGeneration(uid: string): PendingFileGeneration | null {
  try {
    const raw = JSON.parse(localStorage.getItem(pendingKey(uid)) || 'null')
    return raw && UUID.test(raw.requestId) && typeof raw.fileName === 'string' && typeof raw.subject === 'string' && ['mix', 'single', 'judge', 'trans'].includes(raw.type) && ['both', 'zh2en', 'en2zh'].includes(raw.dir) && ['txt', 'docx', 'pdf'].includes(raw.ext) && Number.isInteger(raw.questionsPerJob) && raw.questionsPerJob >= 3 && raw.questionsPerJob <= 10 ? raw : null
  } catch { return null }
}
export function rememberFileGeneration(uid: string, input: FileGenerationRequest, count: number): void {
  const { base64: _content, ...metadata } = input
  const encoded = JSON.stringify({ ...metadata, questionsPerJob: count })
  try {
    localStorage.setItem(pendingKey(uid), encoded)
    if (localStorage.getItem(pendingKey(uid)) !== encoded) throw new Error('storage unavailable')
  } catch { throw new FileGenerationError('无法保存任务编号，暂未开始出题。请释放本机空间后重试。', 'PENDING_STORAGE') }
}
export function forgetFileGeneration(uid: string): void { try { localStorage.removeItem(pendingKey(uid)) } catch { /* An already saved result can be recovered and deduplicated again. */ } }

async function token(): Promise<string> {
  const auth = cbAuth() as unknown as { getAccessToken?: () => unknown }
  const raw = await auth.getAccessToken?.()
  const value = typeof raw === 'string' ? raw : (raw as { accessToken?: string; token?: string } | null)?.accessToken || (raw as { token?: string } | null)?.token
  if (!value || typeof value !== 'string') throw new FileGenerationError('请先登录后使用文件出题', 'AUTH_REQUIRED')
  return value
}

async function request(path: string, body?: FileGenerationRequest, signal?: AbortSignal, authenticated = false): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (authenticated) headers.Authorization = `Bearer ${await token()}`
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) controller.abort()
  const timer = setTimeout(abort, body ? 55000 : 12000)
  try {
    const res = await fetch(`${API_BASE}/api/exam-generator/${path}`, {
      method: body ? 'POST' : 'GET', headers, signal: controller.signal,
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const data: unknown = await res.json().catch(() => null)
    if (!data || typeof data !== 'object') throw new FileGenerationError('文件出题服务暂时无法连接，请重试', 'UNAVAILABLE')
    const record = data as Record<string, unknown>
    if (!res.ok || record.ok !== true) throw new FileGenerationError(typeof record.message === 'string' ? record.message : '文件出题服务暂时不可用', typeof record.code === 'string' ? record.code : 'UNAVAILABLE')
    return record
  } catch (error) {
    if (error instanceof FileGenerationError) throw error
    throw new FileGenerationError(body ? '连接中断，结果尚未确认。请点重试，继续查询本次任务。' : '暂时无法读取文件出题配置，请重试', 'NETWORK')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

export async function loadFileGenerationConfig(signal?: AbortSignal): Promise<FileGenerationConfig> {
  const data = await request('config', undefined, signal)
  const values = ['priceCent', 'questionsPerJob', 'creditsPerJob', 'maxBytes', 'maxChars'] as const
  if (values.some(key => !Number.isSafeInteger(data[key]) || Number(data[key]) < 0) || !Array.isArray(data.formats) || data.formats.some(ext => !['txt', 'docx', 'pdf'].includes(String(ext)))) throw new FileGenerationError('服务配置暂时不可用，请稍后重试', 'INVALID_CONFIG')
  if (Number(data.questionsPerJob) < 3 || Number(data.questionsPerJob) > 10 || Number(data.creditsPerJob) !== 1 || Number(data.maxBytes) > 2 * 1024 * 1024 || Number(data.maxChars) > 12000 || Number(data.maxBytes) === 0 || Number(data.maxChars) === 0 || (data.enabled === true && Number(data.priceCent) === 0)) throw new FileGenerationError('服务配置暂时不可用，请稍后重试', 'INVALID_CONFIG')
  return {
    enabled: data.enabled === true, canPurchase: data.canPurchase === true,
    priceCent: Number(data.priceCent), questionsPerJob: Number(data.questionsPerJob),
    creditsPerJob: Number(data.creditsPerJob), maxBytes: Number(data.maxBytes),
    maxChars: Number(data.maxChars), formats: data.formats as string[],
  }
}

export async function loadFileGenerationCredits(signal?: AbortSignal): Promise<number> {
  const data = await request('status', undefined, signal, true)
  if (!Number.isSafeInteger(data.credits) || Number(data.credits) < 0) throw new FileGenerationError('暂时无法读取剩余次数', 'INVALID_STATUS')
  return Number(data.credits)
}

export async function prepareFileGeneration(file: File, config: FileGenerationConfig, options: { subject: string; type: GenType; dir: TransDir }): Promise<FileGenerationRequest> {
  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  if (!config.formats.includes(ext)) throw new FileGenerationError('请选择 TXT、DOCX 或文字版 PDF', 'UNSUPPORTED_FILE')
  if (!file.size || file.size > config.maxBytes) throw new FileGenerationError('文件需在 2 MB 以内，请先精简资料', 'FILE_TOO_LARGE')
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '')
    reader.onerror = () => reject(new FileGenerationError('文件读取失败，请重新选择', 'FILE_READ_FAILED'))
    reader.readAsDataURL(file)
  })
  return { requestId: crypto.randomUUID(), fileName: file.name, ext, base64, subject: options.subject.trim() || '未分类', type: options.type, dir: options.dir }
}

function decodeResult(data: Record<string, unknown>, count: number): { jobId: string; questions: FileQuestion[] } {
  if (typeof data.jobId !== 'string' || !UUID.test(data.jobId) || data.status !== 'succeeded' || !Array.isArray(data.questions) || data.questions.length !== count) throw new FileGenerationError('本次结果尚未确认，请重试查询同一任务', 'INVALID_RESULT')
  const questions = data.questions.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new FileGenerationError('题目格式异常，请重试查询同一任务', 'INVALID_RESULT')
    const q = raw as Record<string, unknown>
    if (!['single_choice', 'judge'].includes(String(q.qtype)) || typeof q.stem !== 'string' || !q.stem.trim() || typeof q.explanation !== 'string' || !q.explanation.trim() || (q.qtype === 'judge' && !['true', 'false'].includes(String(q.answer)))) throw new FileGenerationError('题目格式异常，请重试查询同一任务', 'INVALID_RESULT')
    if (q.qtype === 'single_choice') {
      const options = q.options as { key: string; text: string }[]
      if (!Array.isArray(options) || options.length !== 4 || new Set(options.map(o => o?.key)).size !== 4 || new Set(options.map(o => o?.text?.trim())).size !== 4 || options.some(o => !o || !['A', 'B', 'C', 'D'].includes(o.key) || typeof o.text !== 'string' || !o.text.trim()) || !options.some(o => o.key === q.answer)) throw new FileGenerationError('题目选项异常，请重试查询同一任务', 'INVALID_RESULT')
    }
    const parsed = parseAIQuestionsJson(JSON.stringify([{ ...q, question_type: q.qtype }]))
    if (!parsed.ok || parsed.questions.length !== 1 || typeof q.sourceRef !== 'string' || !q.sourceRef.trim()) throw new FileGenerationError('题目结果尚未确认，请重试同一任务', 'INVALID_RESULT')
    return { ...parsed.questions[0], sourceRef: q.sourceRef }
  })
  if (new Set(questions.map(q => q.stem.trim().toLowerCase())).size !== count) throw new FileGenerationError('题目包含重复内容，请重试查询同一任务', 'INVALID_RESULT')
  return { jobId: data.jobId, questions }
}

export async function generatePaidFile(input: FileGenerationRequest, count: number, signal?: AbortSignal): Promise<{ jobId: string; questions: FileQuestion[] }> {
  return decodeResult(await request('generate', input, signal, true), count)
}

export async function recoverFileGeneration(pending: PendingFileGeneration, signal?: AbortSignal): Promise<{ status: 'running' } | { status: 'succeeded'; subject: string; jobId: string; questions: FileQuestion[] }> {
  const data = await request(`jobs/${pending.requestId}`, undefined, signal, true)
  if (data.status === 'running') return { status: 'running' }
  if (typeof data.subject !== 'string' || data.questionsPerJob !== pending.questionsPerJob) throw new FileGenerationError('任务结果尚未确认，请重试查询', 'INVALID_RESULT')
  return { status: 'succeeded', subject: data.subject, ...decodeResult(data, pending.questionsPerJob) }
}
