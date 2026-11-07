import { useSyncExternalStore } from 'react'
import { FOX_PACK_HASHES } from './fox-pack-manifest'
import { NEW_UI_PACK_HASHES } from './ui-pack-manifest'
import { IMMERSIVE_PACK_HASHES } from './immersive-pack-manifest'

/** 无狐新皮肤（迁入自 ui-design-preview 五套设计：清简/花间/澄光/晴野/星栖）。
 *  纯 CSS 令牌主题，无需 .ohfox 包，选即用；不渲染任何狐狸角色。 */
export type SkinVariant = 'companion' | 'pure' | 'bloom' | 'glass' | 'meadow' | 'night'
export type UiVariant = 'classic' | 'fox' | 'cute' | 'minimal' | 'immersive' | SkinVariant
export type PackVariant = Exclude<UiVariant, 'classic' | SkinVariant>
export const UI_SKINS = [
  { id: 'companion', title: '微绿版', description: '白色背景 · 绿色操作 · 自定义陪伴' },
  { id: 'pure', title: '第 6 版 · 清简', description: '从容克制 · 细线分隔 · 无狐' },
  { id: 'bloom', title: '第 7 版 · 花间', description: '花瓣粉 · 随身手账 · 无狐' },
  { id: 'glass', title: '第 8 版 · 澄光', description: '轻盈通透 · 磨砂浮层 · 无狐' },
  { id: 'meadow', title: '第 9 版 · 晴野', description: '森林绿 · 明快活力 · 无狐' },
  { id: 'night', title: '第 10 版 · 星栖', description: '墨蓝夜色 · 沉浸阅读 · 无狐' },
] as const
const SKIN_IDS: readonly string[] = UI_SKINS.map(s => s.id)
/** 无狐皮肤：界面中不允许出现狐狸角色、狐徽与陪伴文案。 */
export function isFoxFreeVariant(v: UiVariant | string | null | undefined): boolean {
  return !!v && SKIN_IDS.includes(v)
}
export const UI_PACKS = [
  { id: 'fox', title: '第 2 版 · 狐狸主题', description: '校园绿与狐狸插画', file: 'ohfox-theme-v1.ohfox' },
  { id: 'cute', title: '第 3 版 · 软萌几何', description: '圆润卡片 · 软萌反馈', file: 'ohfox-cute-v3.ohfox' },
  { id: 'minimal', title: '第 4 版 · 极简大气', description: '克制配色 · 清晰层级', file: 'ohfox-minimal-v4.ohfox' },
  { id: 'immersive', title: '第 5 版 · 阿狐陪伴', description: '温暖校园 · 骨骼互动', file: 'ohfox-immersive-v5.ohfox' },
] as const
const KEY = 'ohfox.ui.variant.v1', DB = 'ohfox-ui-packs-v1', EVENT = 'ohfox-ui-variant'
const hashes: Record<PackVariant, Record<string, string>> = { fox: FOX_PACK_HASHES, ...NEW_UI_PACK_HASHES, immersive: IMMERSIVE_PACK_HASHES }
let variant: UiVariant = 'companion'
let installed: Record<PackVariant, boolean> = { fox: false, cute: false, minimal: false, immersive: false }
let restoration: Promise<void> | undefined
const urls: Record<PackVariant, Record<string, string>> = { fox: {}, cute: {}, minimal: {}, immersive: {} }
export function foxCampusAssetUrl(name: string) {
  if (variant !== 'fox' && variant !== 'cute' && variant !== 'minimal' && variant !== 'immersive') return ''
  return urls[variant === 'cute' ? 'cute' : 'fox'][name] || ''
}
export function themeAssetUrl(name: string) {
  if (variant === 'classic' || isFoxFreeVariant(variant)) return ''
  return (urls as Record<string, Record<string, string>>)[variant]?.[name] || ''
}
export function getUiVariant() { return variant }
function emit() { document.documentElement.dataset.uiVariant = variant; window.dispatchEvent(new Event(EVENT)) }
const subscribe = (cb: () => void) => { window.addEventListener(EVENT, cb); return () => window.removeEventListener(EVENT, cb) }
export function useUiVariant() { return useSyncExternalStore(subscribe, getUiVariant, () => 'companion' as UiVariant) }
export function useUiPackInstalled(id: PackVariant) { return useSyncExternalStore(subscribe, () => installed[id], () => false) }
export function useFoxPackInstalled() { return useUiPackInstalled('fox') }
export function useInstalledUiPacks() { return useSyncExternalStore(subscribe, () => installed, () => installed) }
type Pack = { format: string; version: number; id?: PackVariant; assets: Record<string, string> }
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore('packs')
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(new Error('此设备暂时无法保存主题包'))
  })
}
function decode(value: string) { const data = atob(value); return Uint8Array.from(data, c => c.charCodeAt(0)) }
async function validate(pack: Pack): Promise<PackVariant> {
  const id = pack.id ?? 'fox'
  if (pack.format !== 'ohfox-ui-pack' || pack.version !== 1 || !Object.hasOwn(hashes, id) || !pack.assets || typeof pack.assets !== 'object') throw new Error('请选择哦狐主题安装包')
  const expectedAssets = hashes[id]
  if (Object.keys(pack.assets).length !== Object.keys(expectedAssets).length) throw new Error('主题包资源缺失或不匹配，请重新下载')
  for (const [name, expected] of Object.entries(expectedAssets)) {
    const encoded = pack.assets[name]
    if (typeof encoded !== 'string' || encoded.length > (id === 'immersive' ? 8_000_000 : 2_000_000)) throw new Error('主题包资源缺失或过大')
    const bytes = decode(encoded), digest = await crypto.subtle.digest('SHA-256', bytes)
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
    if (hash !== expected) throw new Error('主题包校验失败，请重新下载当前版本')
  }
  return id
}
function prepare(pack: Pack, id: PackVariant) {
  for (const name of Object.keys(hashes[id])) {
    if (urls[id][name]) URL.revokeObjectURL(urls[id][name])
    const type = name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.json') ? 'application/json' : name.endsWith('.glb') ? 'model/gltf-binary' : name.endsWith('.png') ? 'image/png' : 'image/webp'
    urls[id][name] = URL.createObjectURL(new Blob([decode(pack.assets[name])], { type }))
  }
  installed = { ...installed, [id]: true }
}
export async function installUiPack(file: File): Promise<PackVariant> {
  if (file.size > 14_000_000) throw new Error('安装包大小超出限制')
  let pack: Pack
  try { pack = JSON.parse(await file.text()) as Pack } catch { throw new Error('主题包无法读取，请重新下载') }
  if (!pack) throw new Error('主题包无法读取，请重新下载')
  const id = await validate(pack)
  if (id !== 'immersive' && file.size > 8_000_000) throw new Error('安装包大小超出限制')
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('packs', 'readwrite'); tx.objectStore('packs').put(pack, id)
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(new Error('主题包保存失败')); tx.onabort = () => reject(new Error('主题包保存失败'))
    })
  } finally { db.close() }
  prepare(pack, id); emit(); return id
}
export const installFoxPack = installUiPack
export function chooseUiVariant(next: UiVariant) {
  if (next !== 'classic' && next !== 'pure' && next !== 'companion') throw new Error('该界面版本已不再提供，请选择经典版、简单版或微绿版')
  localStorage.setItem(KEY, next); variant = next; emit()
}
async function restore() {
  try {
    const saved = localStorage.getItem(KEY)
    variant = saved === 'classic' || saved === 'pure' || saved === 'companion' ? saved : 'companion'
    if (saved && saved !== variant) localStorage.setItem(KEY, variant)
  } catch { variant = 'companion' }
  emit()
}
export function restoreUiVariant() { return restoration ??= restore() }
