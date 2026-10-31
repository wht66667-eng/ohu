/** Audio files stay on this device; settings store an ID rather than a Blob URL. */
export type FocusMusic = { id: string; name: string; size: number; type: string; importedAt: number; duration: number | null }
type StoredMusic = FocusMusic & { blob: Blob }
export const FOCUS_MUSIC_LIMIT = 50 * 1024 * 1024
export const FOCUS_MUSIC_ACCEPT = '.mp3,.m4a,.wav,.ogg,.flac,audio/mpeg,audio/mp4,audio/wav,audio/ogg,audio/flac'
const DATABASE = 'sunshine-focus-music'
const STORE = 'tracks'
const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/wav', 'audio/wave', 'audio/x-wav', 'audio/ogg', 'audio/flac', 'audio/x-flac'])
export const isFocusMusicId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
export function isFocusMusicRecord(value: unknown): value is StoredMusic {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<StoredMusic>
  return typeof row.id === 'string' && isFocusMusicId(row.id) && typeof row.name === 'string' && typeof row.type === 'string' && Number.isFinite(row.importedAt) && Number.isFinite(row.size) && row.size! > 0 && row.size! <= FOCUS_MUSIC_LIMIT && row.blob instanceof Blob && row.blob.size === row.size && (row.duration === null || (Number.isFinite(row.duration) && row.duration! >= 0))
}
let database: Promise<IDBDatabase> | null = null
const cached = new Map<string, StoredMusic>()
export const peekFocusMusic = (id: string): StoredMusic | null => cached.get(id) || null
function remember(record: StoredMusic) { cached.delete(record.id); cached.set(record.id, record); while (cached.size > 2) cached.delete(cached.keys().next().value!) }

export function validateFocusMusic(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  if (!Number.isFinite(file.size) || file.size <= 0) return '文件为空，请选择其他音频'
  if (file.size > FOCUS_MUSIC_LIMIT) return '单个音频不能超过 50 MB'
  const type = file.type.toLowerCase().split(';')[0]
  const extension = /\.(mp3|m4a|wav|ogg|flac)$/i.test(file.name)
  if (type && !type.startsWith('audio/') && type !== 'application/octet-stream') return '请选择音频文件，不能导入视频或其他文件'
  if (!extension && !AUDIO_TYPES.has(type)) return '支持 MP3、M4A、WAV、OGG 和 FLAC 音频'
  return null
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('当前环境不支持保存本地音频，请使用 HTTPS 音频链接'))
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    let rejected = false
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' }) }
    request.onerror = () => { database = null; reject(new Error('本地音频库打不开，请检查设备存储权限')) }
    request.onblocked = () => { rejected = true; database = null; reject(new Error('音频库正在被其他页面使用，请关闭其他页面后重试')) }
    request.onsuccess = () => {
      const db = request.result
      if (rejected) { db.close(); return }
      db.onversionchange = () => { db.close(); database = null }
      resolve(db)
    }
  })
  return database
}

function inspectAudio(file: File): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const audio = new Audio()
    const url = URL.createObjectURL(file)
    const cleanup = () => { window.clearTimeout(timeout); audio.onloadedmetadata = null; audio.onerror = null; audio.pause(); audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url) }
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error('读取音频超时，请重试或换一个文件')) }, 12000)
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => { const duration = Number.isFinite(audio.duration) ? audio.duration : null; cleanup(); resolve(duration) }
    audio.onerror = () => { cleanup(); reject(new Error('设备无法读取这个音频，请换成 MP3 或 M4A 后重试')) }
    audio.src = url
  })
}

export async function importFocusMusic(file: File): Promise<FocusMusic> {
  const error = validateFocusMusic(file)
  if (error) throw new Error(error)
  const duration = await inspectAudio(file)
  const db = await openDatabase()
  const metadata: FocusMusic = { id: crypto.randomUUID(), name: file.name.replace(/\.(mp3|m4a|wav|ogg|flac)$/i, '').slice(0, 120) || '导入音乐', size: file.size, type: file.type, importedAt: Date.now(), duration }
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    transaction.objectStore(STORE).put({ ...metadata, blob: file } satisfies StoredMusic)
    transaction.oncomplete = () => { resolve(); window.dispatchEvent(new Event('focus-music-change')) }
    transaction.onerror = () => reject(new Error(transaction.error?.name === 'QuotaExceededError' ? '设备存储空间不足，音乐未导入，请先释放空间' : '音乐保存失败，请检查设备存储后重试'))
    transaction.onabort = () => reject(new Error('音乐保存中断，文件未导入，请重试'))
  })
  remember({ ...metadata, blob: file })
  return metadata
}

export async function listFocusMusic(): Promise<FocusMusic[]> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly')
    const request = transaction.objectStore(STORE).getAll()
    request.onsuccess = () => resolve((request.result as unknown[]).filter(isFocusMusicRecord).map(({ blob: _blob, ...metadata }) => metadata).sort((a, b) => b.importedAt - a.importedAt))
    request.onerror = () => reject(new Error('导入音乐列表暂时无法读取，请重试'))
  })
}

export async function readFocusMusic(id: string): Promise<StoredMusic | null> {
  if (!isFocusMusicId(id)) return null
  const record = peekFocusMusic(id)
  if (record) return record
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(id)
    request.onsuccess = () => { const record = isFocusMusicRecord(request.result) ? request.result : null; if (record) remember(record); resolve(record) }
    request.onerror = () => reject(new Error('本地音乐读取失败，请重新导入'))
  })
}

export function formatMusicSize(bytes: number) { return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB` }
export function formatMusicDuration(seconds: number | null) { if (seconds == null) return '时长未知'; return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` }
