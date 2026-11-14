import { useSyncExternalStore } from 'react'
import { SERVICE_CATALOG } from './service-catalog'

export type ServiceLayoutMode = 'auto' | 'grid' | 'list'
export type ServicePresentation = Exclude<ServiceLayoutMode, 'auto'> | 'classic' | 'companion' | 'pure' | 'handdrawn' | 'ink'
export type ServiceLayoutPreferences = {
  mode: ServiceLayoutMode
  /** null 表示仍使用该皮肤的默认快捷入口。 */
  pinned: readonly string[] | null
}

export const SERVICE_PIN_LIMIT = 6
const DEFAULT_PINS = ['schedule', 'todo', 'map', 'nearby-food', 'ai', 'bus'] as const
const INK_PINS = ['schedule', 'todo', 'academics', 'library', 'map', 'meet'] as const
const DEFAULT: ServiceLayoutPreferences = { mode: 'auto', pinned: null }
const PREFIX = 'ohu.services.layout.v1:'
const EVENT = 'ohu-service-layout-changed'
const validServiceIds = new Set(SERVICE_CATALOG.map(item => item.id))
const cache = new Map<string, { raw: string; value: ServiceLayoutPreferences }>()
const temporary = new Map<string, ServiceLayoutPreferences>()

export function defaultServicePins(skin: string) {
  return skin === 'ink' ? INK_PINS : DEFAULT_PINS
}

export function resolveServicePresentation(skin: string, mode: ServiceLayoutMode): ServicePresentation {
  if (mode !== 'auto') return mode
  switch (skin) {
    case 'classic':
    case 'companion':
    case 'pure':
    case 'handdrawn':
    case 'ink':
      return skin
    default:
      return 'classic'
  }
}

function normalize(value: unknown): ServiceLayoutPreferences {
  if (!value || typeof value !== 'object') return DEFAULT
  const { mode, pinned } = value as Partial<ServiceLayoutPreferences>
  const safeMode = mode === 'grid' || mode === 'list' ? mode : 'auto'
  const ids = Array.isArray(pinned)
    ? [...new Set(pinned.filter((id): id is string => typeof id === 'string' && validServiceIds.has(id)))].slice(0, SERVICE_PIN_LIMIT)
    : []
  return { mode: safeMode, pinned: ids.length ? ids : null }
}

export function getServiceLayoutPreferences(skin: string): ServiceLayoutPreferences {
  const key = PREFIX + skin
  const unsaved = temporary.get(key)
  if (unsaved) return unsaved
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return DEFAULT
    const previous = cache.get(key)
    if (previous?.raw === raw) return previous.value
    const value = normalize(JSON.parse(raw))
    cache.set(key, { raw, value })
    return value
  } catch {
    return DEFAULT
  }
}

/** 存储被禁用时，当前会话仍可应用布局。返回值表示刷新后能否保留。 */
export function saveServiceLayoutPreferences(skin: string, preferences: ServiceLayoutPreferences): boolean {
  const key = PREFIX + skin
  const value = normalize(preferences)
  let saved = false
  try {
    const raw = JSON.stringify(value)
    localStorage.setItem(key, raw)
    cache.set(key, { raw, value })
    temporary.delete(key)
    saved = true
  } catch {
    temporary.set(key, value)
  }
  window.dispatchEvent(new Event(EVENT))
  return saved
}

const subscribe = (callback: () => void) => {
  const storageChanged = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(PREFIX)) callback()
  }
  window.addEventListener(EVENT, callback)
  window.addEventListener('storage', storageChanged)
  return () => {
    window.removeEventListener(EVENT, callback)
    window.removeEventListener('storage', storageChanged)
  }
}

export function useServiceLayoutPreferences(skin: string) {
  return useSyncExternalStore(subscribe, () => getServiceLayoutPreferences(skin), () => DEFAULT)
}
