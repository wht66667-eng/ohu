/**
 * App update check via CloudBase update.json (five-shell flavors).
 * Prefer hosting update.json; fallback to bundled public/update.json.
 */
import { Capacitor } from '@capacitor/core'
import { getAppShell, type AppShell } from './app-shell'
import { getNativeAppVersion, WEB_VERSION, WEB_BUILD } from './app-version'

/** Compatibility aliases for existing UI. These identify the Web bundle, never the installed APK. */
export const APP_VERSION = WEB_VERSION
export const APP_BUILD = WEB_BUILD

export type UpdateAsset = {
  url: string
  size?: number
  sha256?: string
}

export type UpdateManifest = {
  latestVersion: string
  latestBuild: number
  title?: string
  notes?: string[]
  downloadUrl?: string
  force?: boolean
  assets?: {
    androidArm64?: UpdateAsset
    androidUniversal?: UpdateAsset
  }
  flavors?: Partial<
    Record<
      AppShell,
      {
        androidArm64?: UpdateAsset
        androidUniversal?: UpdateAsset
        downloadUrl?: string
      }
    >
  >
}

export type UpdateCheckResult =
  | { status: 'up_to_date'; manifest: UpdateManifest; verifiedRemote: boolean }
  | { status: 'available'; manifest: UpdateManifest }
  | { status: 'forced'; manifest: UpdateManifest }
  | { status: 'error'; message: string }

const HOSTING_UPDATE =
  'https://jou-d4gq7a3cqf51e6caa-1394316826.tcloudbaseapp.com/update.json'
/** 学生端独立清单；共享清单含管理端，不随学生端单独发布。 */
const HOSTING_UPDATE_USER =
  'https://jou-d4gq7a3cqf51e6caa-1394316826.tcloudbaseapp.com/update-user.json'

async function fetchManifest(url: string, timeoutMs = 8000): Promise<UpdateManifest> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as UpdateManifest
    if (!data?.latestVersion || !Number.isSafeInteger(data.latestBuild) || data.latestBuild < 1) {
      throw new Error('invalid update.json')
    }
    return data
  } finally {
    clearTimeout(t)
  }
}

export async function checkAppUpdate(): Promise<UpdateCheckResult> {
  if (!Capacitor.isNativePlatform()) {
    return { status: 'error', message: '网页版通过网站更新，无需安装包更新' }
  }
  const installed = await getNativeAppVersion()
  if (!installed) return { status: 'error', message: '无法读取安装包版本，请重新打开 App 后重试' }
  const bundled = `${import.meta.env.BASE_URL}update.json`
  const urls = getAppShell() === 'user' ? [HOSTING_UPDATE_USER, HOSTING_UPDATE, bundled] : [HOSTING_UPDATE, bundled]
  let lastErr = 'update check failed'
  for (const url of urls) {
    try {
      const manifest = await fetchManifest(url)
      if (manifest.latestBuild <= installed.build) {
        return { status: 'up_to_date', manifest, verifiedRemote: url !== bundled }
      }
      return {
        status: manifest.force ? 'forced' : 'available',
        manifest,
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
    }
  }
  return { status: 'error', message: lastErr }
}

export function pickDownloadUrl(manifest: UpdateManifest, shell: AppShell = getAppShell()): string | undefined {
  const flav = manifest.flavors?.[shell]
  const own = flav?.androidArm64?.url || flav?.androidUniversal?.url || flav?.downloadUrl
  // A work app must never download the generic student package by fallback.
  const target = own || (shell === 'user' ? manifest.assets?.androidArm64?.url || manifest.assets?.androidUniversal?.url || manifest.downloadUrl : undefined)
  if (!target) return undefined
  try { return new URL(target).protocol === 'https:' ? target : undefined } catch { return undefined }
}

export function openUpdateDownload(manifest: UpdateManifest): boolean {
  const target = pickDownloadUrl(manifest)
  if (!target) return false
  if (Capacitor.isNativePlatform()) window.open(target, '_system')
  else window.open(target, '_blank', 'noopener,noreferrer')
  return true
}

export function formatNotes(manifest: UpdateManifest): string {
  const notes = manifest.notes?.filter(Boolean) ?? []
  if (!notes.length) return manifest.title || 'New version available'
  return notes.map((n) => '- ' + n).join('\n')
}
