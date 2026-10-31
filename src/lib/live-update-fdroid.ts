/**
 * F-Droid build adapter. Updates are delivered by the F-Droid repository;
 * this build must never fetch executable JavaScript bundles from a separate OTA server.
 */
import { getAppShell, type AppShell } from './app-shell'
import { getNativeAppVersion, WEB_VERSION, type NativeAppVersion } from './app-version'

export type OtaLastError = { msg: string; version?: string; at: number }
export type OtaManifest = {
  version: string
  build?: number
  url: string
  checksum?: string
  size?: number
  notes?: string[]
  updatedAt?: string
  channel?: string
  shell?: AppShell
  minNativeBuild?: number
  minNativeVersion?: string
}
export type OtaPhase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'none'
export type DownloadProgress = { percent: number }
export type OtaRuntimeState = {
  shell: AppShell
  native: NativeAppVersion | null
  bundleId: string
  version: string
  build: number | null
  checksum: string
  builtinVersion: string
}
export type OtaDiagnosis = {
  native: boolean
  shell: AppShell
  manifestUrl: string
  localVersion: string
  remoteVersion: string
  remoteSizeMb: number
  manifestOk: boolean
  needUpdate: boolean
  pendingVersion: string | null
  lastError: OtaLastError | null
  nativeVersion: string
  nativeBuild: number | null
  webBuild: number | null
  bundleId: string
  builtinVersion: string
  compatibilityError: string | null
}
export type OtaDownloadResult = { ok: true; alreadyCurrent?: boolean } | { ok: false; error: string }

export const LEGACY_MANIFEST_URL = ''
export function otaManifestUrl(_shell: AppShell = getAppShell()): string { return '' }
export function rememberOtaError(_msg: string, _version?: string): void {}
export function readOtaError(): OtaLastError | null { return null }
export function clearOtaError(): void {}
export async function currentOtaRuntime(): Promise<OtaRuntimeState> {
  const native = await getNativeAppVersion()
  return {
    shell: getAppShell(), native, bundleId: 'fdroid', version: WEB_VERSION,
    build: null, checksum: '', builtinVersion: WEB_VERSION,
  }
}
export function getOtaCompatibilityError(_remote: OtaManifest, _state?: OtaRuntimeState | null): string | null { return null }
export function shouldApplyOta(_remote: OtaManifest, _localVer: string, _state?: OtaRuntimeState | null): boolean { return false }
export function errText(error: unknown): string { return error instanceof Error ? error.message : String(error || '') }
export async function fetchOtaManifest(_shell?: AppShell): Promise<OtaManifest | null> { return null }
export async function currentBundleVersion(): Promise<string> { return WEB_VERSION }
export async function pendingBundleVersion(): Promise<string | null> { return null }
export async function diagnoseOta(): Promise<OtaDiagnosis> {
  const runtime = await currentOtaRuntime()
  return {
    native: true, shell: runtime.shell, manifestUrl: '', localVersion: runtime.version,
    remoteVersion: '', remoteSizeMb: 0, manifestOk: false, needUpdate: false,
    pendingVersion: null, lastError: null, nativeVersion: runtime.native?.version || '',
    nativeBuild: runtime.native?.build ?? null, webBuild: null,
    bundleId: runtime.bundleId, builtinVersion: runtime.builtinVersion, compatibilityError: null,
  }
}
export async function hasMatchingPendingOta(_remote: OtaManifest): Promise<boolean> { return false }
export async function confirmCurrentOtaBundle(): Promise<void> {}
export function isLiveUpdateConfigured(): boolean { return false }
export async function initLiveUpdate(): Promise<void> {}
export async function downloadAndQueueOta(_remote: OtaManifest, _onProgress?: (progress: DownloadProgress) => void): Promise<OtaDownloadResult> {
  return { ok: false, error: '此版本通过 F-Droid 更新，请使用 F-Droid 更新来源。' }
}
export async function applyPendingOta(_remote?: OtaManifest): Promise<void> {
  throw new Error('此版本通过 F-Droid 更新。')
}
export async function checkAndQueueOta(_opts?: { silent?: boolean }): Promise<'none' | 'queued' | 'error' | { remote: OtaManifest }> {
  return 'none'
}
