import { useSyncExternalStore } from 'react'
import { prefetchFonts } from './font-assets'

/** 字体库：设备级偏好，全部皮肤可用；字库不随包分发，选中时按需下载并缓存。 */
export type FontFamilyPref = 'default' | 'huiting' | 'xiaolai' | 'kuaile' | 'wenkai'
export type FontLoadState = 'idle' | 'loading' | 'ready' | 'failed'

export const FONT_CHOICES: ReadonlyArray<{ id: FontFamilyPref; title: string; description: string; family: string; size: string }> = [
  { id: 'default', title: '默认字体', description: '系统无衬线 · 课表成绩最可读', family: '', size: '' },
  { id: 'huiting', title: '笔刷标题', description: '包参谋慧庭 · 仅标题与品牌手写', family: '"OHU-HuiTing", "Kaiti SC", STKaiti, KaiTi, system-ui, sans-serif', size: '10.3 MB' },
  { id: 'xiaolai', title: '手账手写', description: '小赖字体 · 全界面手账感', family: '"OHU-Xiaolai", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif', size: '22.2 MB' },
  { id: 'kuaile', title: '可爱涂鸦', description: '站酷快乐体 · 活泼贴纸感', family: '"OhuZcoolKuaiLe", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif', size: '0.9 MB' },
  { id: 'wenkai', title: '文楷阅读', description: '霞鹜文楷 Lite · 安静笔记感', family: '"OHU-WenKaiLite", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif', size: '13.9 MB' },
]

type FontFile = { family: string; path: string }
const TIER_ASSETS: Record<Exclude<FontFamilyPref, 'default'>, ReadonlyArray<FontFile>> = {
  huiting: [{ family: 'OHU-HuiTing', path: 'fonts/BaoCanMouHuiTing-Regular.woff2' }],
  xiaolai: [{ family: 'OHU-Xiaolai', path: 'fonts/Xiaolai-Regular.ttf' }],
  kuaile: [{ family: 'OhuZcoolKuaiLe', path: 'moment-editor/fonts/zcoolkuaile/font.woff2' }],
  wenkai: [{ family: 'OHU-WenKaiLite', path: 'fonts/LXGWWenKaiLite-Regular.ttf' }],
}
/** 手绘版皮肤的字层：慧庭标题 + 小赖标签。 */
const HAMDRAWN_ASSETS: ReadonlyArray<FontFile> = [TIER_ASSETS.huiting[0], TIER_ASSETS.xiaolai[0]]

const KEY = 'ohu.font.family.v1'
const EVENT = 'ohu-font-family'
let pref: FontFamilyPref = 'default'
const loadState: Record<FontFamilyPref, FontLoadState> = { default: 'ready', huiting: 'idle', xiaolai: 'idle', kuaile: 'idle', wenkai: 'idle' }
let version = 0

function valid(value: string | null): FontFamilyPref {
  return value === 'huiting' || value === 'xiaolai' || value === 'kuaile' || value === 'wenkai' ? value : 'default'
}

function emit() {
  document.documentElement.dataset.fontFamily = pref
  window.dispatchEvent(new Event(EVENT))
}

const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb)
  return () => window.removeEventListener(EVENT, cb)
}

export function getFontFamilyPref() { return pref }
export function useFontFamilyPref() {
  return useSyncExternalStore(subscribe, getFontFamilyPref, () => 'default' as FontFamilyPref)
}
export function getFontLoadVersion() { return version }
export function useFontLoadVersion() {
  return useSyncExternalStore(subscribe, getFontLoadVersion, () => 0)
}
export function getFontLoadState(target: FontFamilyPref) { return loadState[target] }

/** 选中即触发下载；失败返回 rejected，调用方需自行提示或重试。 */
export function ensureFontDownload(target: FontFamilyPref): Promise<void> {
  if (target === 'default' || loadState[target] === 'ready' || loadState[target] === 'loading') return Promise.resolve()
  loadState[target] = 'loading'; version++; emit()
  return prefetchFonts(TIER_ASSETS[target])
    .then(() => { loadState[target] = 'ready' })
    .catch((error) => { loadState[target] = 'failed'; throw error })
    .finally(() => { version++; emit() })
}

/** 手绘版皮肤默认字层（慧庭+小赖）；失败时静默回退系统字体。 */
export function ensureHanddrawnFonts(): Promise<void> {
  return prefetchFonts(HAMDRAWN_ASSETS).catch(() => undefined)
}

export function chooseFontFamily(next: FontFamilyPref) {
  try { localStorage.setItem(KEY, next) } catch { /* private browsing */ }
  pref = next
  emit()
  if (next !== 'default') void ensureFontDownload(next).catch(() => undefined)
}

export function retryFontDownload(next: FontFamilyPref) {
  loadState[next] = 'idle'
  void ensureFontDownload(next).catch(() => undefined)
}

export function restoreFontPref() {
  try { pref = valid(localStorage.getItem(KEY)) } catch { pref = 'default' }
  emit()
}