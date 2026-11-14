/**
 * 手账纸页彩笔 · 附页数据层（P1-05b TASK-E1）。
 * 笔迹是矢量路径，存独立本机库 `ohu-paper-layers` v1（store pages，keyPath ['owner','entryId']），
 * 不动日记加密存储结构：启用了日记锁的账号，其日记笔迹会被整体清除（防明文旁路）。
 * 导出/分享时才把笔迹渲染成纸面合成图（renderPaperStrokes）。
 */
import { drawStrokePath, normalizeStrokes, type PaperStroke } from './paper-layer-helpers'

const DB_NAME = 'ohu-paper-layers'
const DB_VERSION = 1
const STORE = 'pages'
const MIN_ASPECT = 0.4
const MAX_ASPECT = 4

export interface PaperLayerRecord {
  owner: string
  entryId: string
  updatedAt: number
  /** 落笔时纸页宽高比（宽/高），供导出合成按原比例还原。 */
  aspect: number
  strokes: PaperStroke[]
}

export const PAPER_EXPORT_WIDTH = 760

function clampAspect(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_ASPECT && value <= MAX_ASPECT ? value : 0.75
}

function openPaperLayers(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    let blocked = false
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: ['owner', 'entryId'] })
      store.createIndex('owner', 'owner')
    }
    request.onsuccess = () => {
      if (blocked) request.result.close()
      else resolve(request.result)
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => {
      blocked = true
      reject(new Error('请关闭其他哦狐页面后重试'))
    }
  })
}

async function paperRequest<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openPaperLayers()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode)
      const request = operation(transaction.objectStore(STORE))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error ?? request.error)
    })
  } finally { db.close() }
}

export async function loadPaperLayer(owner: string, entryId: string): Promise<PaperLayerRecord | null> {
  const row = await paperRequest('readonly', store => store.get([owner, entryId])) as PaperLayerRecord | undefined
  if (!row || !Array.isArray(row.strokes)) return null
  return { owner, entryId, updatedAt: row.updatedAt ?? 0, aspect: clampAspect(row.aspect), strokes: normalizeStrokes(row.strokes) }
}

/** 空笔迹时删除记录，保持本机库干净。 */
export async function savePaperLayer(owner: string, entryId: string, strokes: PaperStroke[], aspect: number) {
  const clean = normalizeStrokes(strokes)
  if (!clean.length) return void await deletePaperLayer(owner, entryId)
  const row: PaperLayerRecord = { owner, entryId, updatedAt: Date.now(), aspect: clampAspect(aspect), strokes: clean }
  await paperRequest('readwrite', store => store.put(row))
}

export function deletePaperLayer(owner: string, entryId: string) {
  return paperRequest('readwrite', store => store.delete([owner, entryId]))
}

/** 批量删除（启用日记锁时清除该账号全部日记笔迹；删记录时清理对应附页）。 */
export async function deletePaperLayers(owner: string, entryIds: string[]) {
  const ids = [...new Set(entryIds.filter(id => typeof id === 'string' && id))]
  if (!ids.length) return
  const db = await openPaperLayers()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite')
      const store = transaction.objectStore(STORE)
      for (const entryId of ids) store.delete([owner, entryId])
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error ?? new Error('笔迹清理失败，请重试。'))
    })
  } finally { db.close() }
}

/** 孤儿附页回收：清掉没有对应记录/草稿影子的笔迹行（中途中断留下的）。 */
export async function gcPaperLayers(owner: string, keepEntryIds: string[]) {
  const db = await openPaperLayers()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite')
      const store = transaction.objectStore(STORE)
      const request = store.index('owner').getAllKeys(owner)
      request.onsuccess = () => {
        const keep = new Set(keepEntryIds)
        for (const key of request.result) {
          const entryId = (key as string[])[1]
          if (!keep.has(entryId)) store.delete(key)
        }
      }
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error ?? new Error('笔迹清理失败，请重试。'))
    })
  } finally { db.close() }
}

/**
 * 导出/分享合成：把矢量笔迹按落笔时比例渲染成 PNG（浏览器环境专用）。
 * background 传纸面色即可得到「纸+笔迹」合成图；不传则输出透明底笔迹图。
 */
export function renderPaperStrokes(strokes: PaperStroke[], aspect: number, options?: { width?: number; background?: string }): string {
  if (typeof document === 'undefined') throw new Error('纸页合成需要浏览器环境。')
  const clean = normalizeStrokes(strokes)
  if (!clean.length) throw new Error('没有可合成的笔迹。')
  const width = Math.min(1600, Math.max(80, Math.round(options?.width ?? PAPER_EXPORT_WIDTH)))
  const height = Math.max(80, Math.round(width / clampAspect(aspect)))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前设备无法完成纸页合成。')
  if (options?.background) {
    ctx.fillStyle = options.background
    ctx.fillRect(0, 0, width, height)
  }
  for (const stroke of clean) drawStrokePath(ctx, stroke, width, height)
  return canvas.toDataURL('image/png')
}

/** 读取当前皮肤纸面色（计算值已解析 var 引用），供导出合成上底色。 */
export function paperSurfaceColor(fallback = '#ffffff') {
  if (typeof document === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue('--paper-bg').trim() || fallback
}
