/** Self-hosted, shell-specific Web updates. Installed APK and active Web versions are independent. */
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import { IS_NATIVE } from './platform'
import { getAppShell, SHELL_APP_ID, type AppShell } from './app-shell'
import { getNativeAppVersion, knownNativeAppVersion, WEB_VERSION, WEB_BUILD, type NativeAppVersion } from './app-version'

const OTA_BASE = import.meta.env.VITE_OTA_MANIFEST_URL ||
  'https://jou-d4gq7a3cqf51e6caa-1394316826.tcloudbaseapp.com/ota'

export function otaManifestUrl(shell: AppShell = getAppShell()): string {
  return `${String(OTA_BASE).replace(/\/+$/, '')}/${shell}/manifest.json`
}
export const LEGACY_MANIFEST_URL = `${String(OTA_BASE).replace(/\/+$/, '')}/manifest.json`

const LS_STAGED = 'sc.ota.staged.v2'
const LS_CONFIRMED = 'sc.ota.confirmed.v2'
const LS_ERR = 'sc.ota.lastError.v1'

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
  /** Updater's baked-in label; config.version may differ from the OS package version. */
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
type OtaSnapshot = {
  shell: AppShell
  bundleId: string
  version: string
  build: number
  checksum: string
  at: number
}
type BundleIdentity = { id: string; version: string; checksum?: string; status?: string }

function readStored<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) || 'null') as T | null } catch { return null }
}
function writeStored(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Storage may be unavailable. */ }
}
function removeStored(key: string): void {
  try { localStorage.removeItem(key) } catch { /* ignore */ }
}
export function rememberOtaError(msg: string, version?: string): void {
  writeStored(LS_ERR, { msg, version, at: Date.now() } satisfies OtaLastError)
}
export function readOtaError(): OtaLastError | null {
  const error = readStored<OtaLastError>(LS_ERR)
  return error?.msg ? error : null
}
export function clearOtaError(): void { removeStored(LS_ERR) }

function compareVersion(left: string, right: string): number {
  const parse = (v: string) => String(v).replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  const a = parse(left), b = parse(right)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const delta = (a[i] || 0) - (b[i] || 0)
    if (delta) return Math.sign(delta)
  }
  return 0
}
function checksum(value: unknown): string { return String(value || '').trim().toLowerCase() }
function validChecksum(value: unknown): boolean { return /^[a-f0-9]{64}$/i.test(String(value || '')) }
function validBuild(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0 }
function sameSnapshot(snap: OtaSnapshot | null, state: OtaRuntimeState): boolean {
  return !!snap && snap.shell === state.shell && snap.bundleId === state.bundleId &&
    snap.version === state.version && validBuild(snap.build) && validChecksum(snap.checksum) &&
    checksum(snap.checksum) === state.checksum
}

let lastRuntime: OtaRuntimeState | null = null

/** Read the package from the OS and the active Web bundle from the updater separately. */
export async function currentOtaRuntime(): Promise<OtaRuntimeState> {
  const native = await getNativeAppVersion()
  let bundleId = IS_NATIVE ? 'unknown' : 'builtin'
  let version = WEB_VERSION
  let digest = ''
  let builtinVersion = WEB_VERSION
  if (IS_NATIVE) {
    try {
      const cur = await CapacitorUpdater.current()
      bundleId = String(cur?.bundle?.id || 'builtin')
      builtinVersion = String(cur?.native || '').trim() || WEB_VERSION
      if (bundleId !== 'builtin') {
        version = String(cur?.bundle?.version || '').trim() || WEB_VERSION
        digest = checksum(cur?.bundle?.checksum)
      }
      // On builtin, the running JS's metadata is more reliable than a stale config.version label.
    } catch (e) {
      console.info('[ota] current() unavailable', e)
    }
  }
  const state: OtaRuntimeState = {
    shell: getAppShell(), native, bundleId, version, checksum: digest, builtinVersion,
    build: version === WEB_VERSION ? WEB_BUILD : null,
  }
  const confirmed = readStored<OtaSnapshot>(LS_CONFIRMED)
  if (confirmed && sameSnapshot(confirmed, state)) state.build = Math.max(state.build ?? 0, confirmed.build)
  lastRuntime = state
  return state
}

/** Call after currentBundleVersion()/currentOtaRuntime() when used from synchronous UI checks. */
export function getOtaCompatibilityError(remote: OtaManifest, state: OtaRuntimeState | null = lastRuntime): string | null {
  const shell = state?.shell || getAppShell()
  const native = state?.native || knownNativeAppVersion()
  if (remote.shell && remote.shell !== shell) return '更新包与当前应用端不匹配，请联系管理员'
  if (remote.channel && remote.channel !== 'production') return '更新包不属于当前正式更新渠道'
  if (native && native.appId !== SHELL_APP_ID[shell]) return '安装包与当前应用端不匹配，请重新打开 App'
  if (remote.minNativeBuild !== undefined) {
    if (!validBuild(remote.minNativeBuild)) return '更新清单的安装包兼容版本无效'
    if (!native) return '无法读取安装包版本，暂时不能确认此界面更新兼容'
    if (native.build < remote.minNativeBuild) {
      return `请先更新安装包（需要构建 ${remote.minNativeBuild}，当前 ${native.build}）`
    }
  }
  if (remote.minNativeVersion) {
    if (!native) return '无法读取安装包版本，暂时不能确认此界面更新兼容'
    if (compareVersion(native.version, remote.minNativeVersion) < 0) {
      return `请先更新安装包至 v${remote.minNativeVersion} 或更新版本`
    }
  }
  return null
}

export function shouldApplyOta(remote: OtaManifest, localVer: string, state: OtaRuntimeState | null = lastRuntime): boolean {
  if (!IS_NATIVE || !remote?.version || getOtaCompatibilityError(remote, state)) return false
  const local = localVer && localVer !== 'builtin' ? localVer : WEB_VERSION
  const order = compareVersion(remote.version, local)
  if (order) return order > 0
  const current = state?.version === local ? state : null
  // A downloaded bundle's checksum identifies the exact bytes, even if browser storage was cleared.
  if (validChecksum(remote.checksum) && current?.checksum === checksum(remote.checksum)) return false
  const localBuild = current?.build ?? (compareVersion(local, WEB_VERSION) === 0 ? WEB_BUILD : 0)
  return validBuild(remote.build) && remote.build > localBuild
}

export function errText(e: unknown): string {
  if (!e) return ''
  if (typeof e === 'string') return e
  const error = e as { message?: string; errorMessage?: string }
  return String(error.message || error.errorMessage || '')
}

export async function fetchOtaManifest(shell: AppShell = getAppShell()): Promise<OtaManifest | null> {
  const ctrl = new AbortController()
  const timer = window.setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(`${otaManifestUrl(shell)}?t=${Date.now()}`, { signal: ctrl.signal, cache: 'no-store' })
    if (!res.ok) return null
    const value = await res.json() as OtaManifest
    if (typeof value?.version !== 'string' || !value.version || typeof value.url !== 'string' || !value.url) return null
    if (new URL(value.url).protocol !== 'https:') return null
    if (value.build !== undefined && !validBuild(value.build)) return null
    // Missing shell/minNativeBuild remain supported for already-published legacy manifests.
    return value
  } catch (e) {
    console.info('[ota] manifest fetch failed', e)
    return null
  } finally {
    window.clearTimeout(timer)
  }
}

export async function currentBundleVersion(): Promise<string> { return (await currentOtaRuntime()).version }
export async function pendingBundleVersion(): Promise<string | null> {
  if (!IS_NATIVE) return null
  try { return (await CapacitorUpdater.getNextBundle())?.version || null } catch { return null }
}
export async function diagnoseOta(): Promise<OtaDiagnosis> {
  const runtime = await currentOtaRuntime()
  const remote = await fetchOtaManifest(runtime.shell)
  const compatibilityError = remote ? getOtaCompatibilityError(remote, runtime) : null
  return {
    native: IS_NATIVE, shell: runtime.shell, manifestUrl: otaManifestUrl(runtime.shell),
    localVersion: runtime.version, remoteVersion: remote?.version || '',
    remoteSizeMb: remote?.size ? Math.max(1, Math.round(remote.size / 1024 / 1024)) : 0,
    manifestOk: !!remote, needUpdate: !!remote && shouldApplyOta(remote, runtime.version, runtime),
    pendingVersion: await pendingBundleVersion(), lastError: readOtaError(),
    nativeVersion: runtime.native?.version || '', nativeBuild: runtime.native?.build ?? null,
    webBuild: runtime.build, bundleId: runtime.bundleId, builtinVersion: runtime.builtinVersion,
    compatibilityError,
  }
}

function matchesRemote(bundle: BundleIdentity | null | undefined, remote: OtaManifest): bundle is BundleIdentity {
  return !!bundle?.id && bundle.id !== 'builtin' && bundle.version === remote.version &&
    bundle.status !== 'error' && bundle.status !== 'downloading' && validChecksum(remote.checksum) &&
    checksum(bundle.checksum) === checksum(remote.checksum)
}
export async function hasMatchingPendingOta(remote: OtaManifest): Promise<boolean> {
  if (!IS_NATIVE) return false
  try { return matchesRemote(await CapacitorUpdater.getNextBundle(), remote) } catch { return false }
}
function stageBundle(bundle: BundleIdentity, remote: OtaManifest): void {
  writeStored(LS_STAGED, {
    shell: getAppShell(), bundleId: bundle.id, version: remote.version,
    build: remote.build ?? 0, checksum: checksum(remote.checksum), at: Date.now(),
  } satisfies OtaSnapshot)
}

/** Invoked only after a usable React screen mounted; download/set alone never confirms success. */
export async function confirmCurrentOtaBundle(): Promise<void> {
  if (!IS_NATIVE) return
  const runtime = await currentOtaRuntime()
  await CapacitorUpdater.notifyAppReady()
  const staged = readStored<OtaSnapshot>(LS_STAGED)
  if (staged && sameSnapshot(staged, runtime)) {
    writeStored(LS_CONFIRMED, staged)
    removeStored(LS_STAGED)
    lastRuntime = { ...runtime, build: Math.max(runtime.build ?? 0, staged.build) }
    clearOtaError()
  } else if (staged && runtime.bundleId !== 'unknown') {
    // A different active bundle means a rollback or another installation won the race.
    removeStored(LS_STAGED)
    if (!readOtaError()) rememberOtaError('上次界面更新未启动成功，已恢复此前界面', staged.version)
  }
}

export function isLiveUpdateConfigured(): boolean { return IS_NATIVE }
/** Warm native metadata; readiness is confirmed by ota-ready after a real screen mounts. */
export async function initLiveUpdate(): Promise<void> { if (IS_NATIVE) await currentOtaRuntime() }

async function purgeFailed(version: string): Promise<void> {
  try {
    const list = await CapacitorUpdater.list()
    for (const bundle of list.bundles || []) {
      if (bundle.version === version && (bundle.status === 'error' || bundle.status === 'downloading')) {
        try { await CapacitorUpdater.delete({ id: bundle.id }) } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }
}

type OtaDownloadResult = { ok: true; alreadyCurrent?: boolean } | { ok: false; error: string }
let downloadRunning = false

export async function downloadAndQueueOta(remote: OtaManifest, onProgress?: (p: DownloadProgress) => void): Promise<OtaDownloadResult> {
  if (!IS_NATIVE) return { ok: false, error: '非 App 环境' }
  if (downloadRunning) return { ok: false, error: '已有界面更新正在处理，请稍候' }
  downloadRunning = true
  let sub: { remove: () => Promise<void> } | null = null
  try {
    if (!validChecksum(remote.checksum)) throw new Error('更新清单缺少有效校验码')
    if (new URL(remote.url).protocol !== 'https:') throw new Error('更新包必须使用 HTTPS 下载地址')
    const runtime = await currentOtaRuntime()
    const incompatible = getOtaCompatibilityError(remote, runtime)
    if (incompatible) throw new Error(incompatible)
    if (!shouldApplyOta(remote, runtime.version, runtime)) return { ok: true, alreadyCurrent: true }

    // Reuse pending bytes only when both the version and content checksum match this manifest.
    let pending: BundleIdentity | null = null
    try { pending = await CapacitorUpdater.getNextBundle() } catch { /* download below */ }
    if (matchesRemote(pending, remote)) {
      stageBundle(pending, remote)
      onProgress?.({ percent: 100 })
      await CapacitorUpdater.set({ id: pending.id })
      return { ok: true }
    }
    await purgeFailed(remote.version)
    try {
      sub = await CapacitorUpdater.addListener('download', (event) => {
        onProgress?.({ percent: Math.max(0, Math.min(100, Number(event.percent) || 0)) })
      })
    } catch { /* Progress events are optional. */ }
    onProgress?.({ percent: 2 })
    const bundle = await CapacitorUpdater.download({ url: remote.url, version: remote.version, checksum: checksum(remote.checksum) })
    if (!matchesRemote(bundle, remote)) throw new Error('下载包身份或 checksum 与更新清单不一致')
    stageBundle(bundle, remote)
    onProgress?.({ percent: 98 })
    await CapacitorUpdater.set({ id: bundle.id })
    onProgress?.({ percent: 100 })
    return { ok: true }
  } catch (e) {
    const detail = errText(e) || '未知错误'
    rememberOtaError(detail, remote.version)
    if (/checksum/i.test(detail)) return { ok: false, error: '更新包校验失败' }
    if (/timeout|timed out|超时/i.test(detail)) return { ok: false, error: '下载超时，请换 Wi-Fi 重试' }
    if (/space|storage|磁盘|空间/i.test(detail)) return { ok: false, error: '手机存储空间不足' }
    return { ok: false, error: detail }
  } finally {
    downloadRunning = false
    try { await sub?.remove() } catch { /* ignore */ }
  }
}

/** Recheck the current manifest instead of applying any queued version blindly. */
export async function applyPendingOta(remote?: OtaManifest): Promise<void> {
  if (!IS_NATIVE) return
  const manifest = remote || await fetchOtaManifest()
  if (!manifest) throw new Error('暂时无法读取界面更新清单，请稍后重试')
  const result = await downloadAndQueueOta(manifest)
  if (!result.ok) throw new Error(result.error)
}

export async function checkAndQueueOta(opts?: { silent?: boolean }): Promise<'none' | 'queued' | 'error' | { remote: OtaManifest }> {
  if (!IS_NATIVE) return 'none'
  const remote = await fetchOtaManifest()
  if (!remote) return 'error'
  const runtime = await currentOtaRuntime()
  const incompatible = getOtaCompatibilityError(remote, runtime)
  if (incompatible) { rememberOtaError(incompatible, remote.version); return 'error' }
  if (!shouldApplyOta(remote, runtime.version, runtime)) return 'none'
  if (opts?.silent) return { remote }
  const result = await downloadAndQueueOta(remote)
  return result.ok ? (result.alreadyCurrent ? 'none' : 'queued') : 'error'
}
