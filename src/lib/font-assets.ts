/** 字库按需下载：初始包不含字库（font-assets/ 不参与构建）。
 *  开发环境从仓库根 font-assets/ 读取；生产环境从 VITE_FONT_BASE 下载并写入 Cache Storage，二次使用离线可用。 */
const CACHE_NAME = 'ohu-fonts-v1'
const loaded = new Set<string>()
const inflight = new Map<string, Promise<void>>()

function assetUrl(path: string): string {
  if (import.meta.env.DEV) return `${import.meta.env.BASE_URL}font-assets/${path}`
  const base = String(import.meta.env.VITE_FONT_BASE || '').replace(/\/$/, '')
  if (!base) throw new Error('字体服务未配置（VITE_FONT_BASE），暂时无法下载字库')
  return `${base}/${path}`
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  let cache: Cache | null = null
  try { cache = await caches.open(CACHE_NAME) } catch { cache = null }
  const hit = cache ? await cache.match(url) : undefined
  if (hit) return hit.arrayBuffer()
  const response = await fetch(url)
  if (!response.ok) throw new Error(`字库下载失败（${response.status}）`)
  if (cache) { try { await cache.put(url, response.clone()) } catch { /* 存储超限时本次仍可用 */ } }
  return response.arrayBuffer()
}

export function isFontLoaded(family: string) { return loaded.has(family) }

export async function loadFontFile(family: string, path: string): Promise<void> {
  if (loaded.has(family)) return
  const running = inflight.get(family)
  if (running) return running
  const task = (async () => {
    const bytes = await fetchBytes(assetUrl(path))
    const face = new FontFace(family, bytes)
    await face.load()
    document.fonts.add(face)
    loaded.add(family)
  })().finally(() => { inflight.delete(family) })
  inflight.set(family, task)
  return task
}

export async function prefetchFonts(files: ReadonlyArray<{ family: string; path: string }>): Promise<void> {
  await Promise.all(files.map((file) => loadFontFile(file.family, file.path)))
}