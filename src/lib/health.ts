/**
 * 运动中心 · 健康数据层
 *
 * 设计原则（合规）：
 * 1. 健康数据属于敏感个人信息，本地优先存储，不上传云端（除非用户另行同意）。
 * 2. 不爬取任何第三方页面；步数/健康数据仅来自：
 *    - 系统健康平台（iOS HealthKit / Android Health Connect，需原生插件接入，预留接口）
 *    - Android 原生计步传感器（TYPE_STEP_COUNTER，需 ACTIVITY_RECOGNITION 权限）
 *    - 浏览器 / WebView 运动传感器（DeviceMotion，粗略计步，降级方案）
 *    - 用户手动录入
 * 3. 授权必须显式弹窗说明用途，拒绝授权不影响其他功能。
 */

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { IS_NATIVE, PLATFORM } from './platform'
import { captureQbankSession, isQbankSessionCurrent, subscribeQbank } from './qbank'

const K_DAILY = 'xm_sports_daily'
const K_METRICS = 'xm_sports_metrics'
const K_SETTINGS = 'xm_sports_settings'
const K_STEP_BASE = 'xm_sports_step_base' // 今日首次开机步数基准

export type HealthSource = 'healthkit' | 'health_connect' | 'sensor' | 'manual'

export interface DailySteps {
  date: string // YYYY-MM-DD
  steps: number
  distance: number // km
  calories: number // kcal
  activeMinutes: number
  goal: number
  source: HealthSource
  updatedAt: number
  hasManualSteps?: boolean
}

export type MetricType = 'heart_rate' | 'sleep' | 'weight' | 'water'

export interface HealthMetric {
  type: MetricType
  value: number
  unit: string
  timestamp: number
  source: HealthSource
}

export interface SportsSettings {
  stepGoal: number
  units: 'km' | 'mi'
  visibleCards: MetricType[]
  dataSource: 'auto' | 'sensor' | 'manual'
}

const DEFAULT_SETTINGS: SportsSettings = {
  stepGoal: 10000,
  units: 'km',
  visibleCards: ['heart_rate', 'sleep', 'weight', 'water'],
  dataSource: 'manual',
}

function todayStr(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function read<T>(key: string, fallback: T, strict = false): T {
  try {
    const raw = localStorage.getItem(scopedKey(key))
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as T
    if (Array.isArray(fallback) && !Array.isArray(parsed) || fallback && typeof fallback === 'object' && !Array.isArray(fallback) && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) throw new Error('invalid storage shape')
    return parsed
  } catch {
    if (strict) throw new Error('本机运动记录暂时无法读取，原记录仍保留，请稍后重试。')
    return fallback
  }
}

function write<T>(key: string, val: T) {
  try {
    const target = scopedKey(key), encoded = JSON.stringify(val)
    localStorage.setItem(target, encoded)
    if (localStorage.getItem(target) !== encoded) throw new Error('storage unavailable')
  } catch {
    throw new Error('运动记录未能保存到本机，请检查可用存储后重试。')
  }
}

const sportsSubscribers = new Set<() => void>()
/** Legacy unowned keys are retained, but never attributed to the next signed-in person. */
export const getSportsScope = () => { const session = captureQbankSession(); return `${session.revision}:${session.uid}` }
function scopedKey(key: string) {
  const { uid } = captureQbankSession()
  return `${key}.v2:${uid ? `uid:${encodeURIComponent(uid)}` : 'guest'}`
}
export function subscribeSports(listener: () => void): () => void {
  sportsSubscribers.add(listener)
  return () => { sportsSubscribers.delete(listener) }
}
function notifySports() { sportsSubscribers.forEach((listener) => listener()) }

/* ———————————— 每日步数 ———————————— */

export function getTodaySteps(): DailySteps {
  const list = read<DailySteps[]>(K_DAILY, [])
  const today = todayStr()
  const found = list.find((d) => d.date === today)
  if (found) return found
  const settings = getSettings()
  const empty: DailySteps = {
    date: today,
    steps: 0,
    distance: 0,
    calories: 0,
    activeMinutes: 0,
    goal: settings.stepGoal,
    source: 'manual',
    updatedAt: Date.now(),
  }
  // Reading an empty day must not report a failed write during initial render.
  return empty
}

export function updateTodaySteps(patch: Partial<DailySteps>) {
  const list = read<DailySteps[]>(K_DAILY, [], true)
  const today = todayStr()
  const idx = list.findIndex((d) => d.date === today)
  const settings = getSettings()
  if (idx === -1) {
    list.push({
      date: today,
      steps: 0,
      distance: 0,
      calories: 0,
      activeMinutes: 0,
      goal: settings.stepGoal,
      source: 'manual',
      updatedAt: Date.now(),
      ...patch,
    })
  } else {
    list[idx] = { ...list[idx], ...patch, goal: settings.stepGoal, updatedAt: Date.now() }
  }
  write(K_DAILY, list)
  notifySports()
}

/** 最近 N 天的步数记录（含今天），用于趋势图 */
export function getRecentDays(n: number): DailySteps[] {
  const list = read<DailySteps[]>(K_DAILY, [])
  const out: DailySteps[] = []
  const today = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const key = `${d.getFullYear()}-${m}-${day}`
    const found = list.find((x) => x.date === key)
    out.push(
      found || {
        date: key,
        steps: 0,
        distance: 0,
        calories: 0,
        activeMinutes: 0,
        goal: getSettings().stepGoal,
        source: 'manual',
        updatedAt: 0,
      },
    )
  }
  return out
}

/* ———————————— 健康指标 ———————————— */

export function getLatestMetric(type: MetricType): HealthMetric | null {
  const list = read<HealthMetric[]>(K_METRICS, [])
  const same = list.filter((m) => m.type === type)
  if (!same.length) return null
  return same.reduce((a, b) => (a.timestamp > b.timestamp ? a : b))
}

export function addMetric(m: HealthMetric) {
  const list = read<HealthMetric[]>(K_METRICS, [], true)
  list.push(m)
  // 只保留最近 200 条，避免 localStorage 膨胀
  if (list.length > 200) list.splice(0, list.length - 200)
  write(K_METRICS, list)
  notifySports()
}

/* ———————————— 设置 ———————————— */

export function getSettings(): SportsSettings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<SportsSettings>>(K_SETTINGS, {}) }
}

export function updateSettings(patch: Partial<SportsSettings>) {
  const cur = { ...DEFAULT_SETTINGS, ...read<Partial<SportsSettings>>(K_SETTINGS, {}, true) }
  const next = { ...cur, ...patch }
  write(K_SETTINGS, next)
  // 同步今日目标
  const t = getTodaySteps()
  if (t.goal !== next.stepGoal) updateTodaySteps({ goal: next.stepGoal })
  else notifySports()
  return next
}

/* ———————————— 原生健康插件（Capacitor） ———————————— */

export interface HealthPlugin {
  requestActivityRecognition(): Promise<{ granted: boolean }>
  getStepCount(): Promise<{ available: boolean; steps: number }>
  startStepListening(): Promise<{ ok: boolean }>
  stopStepListening(): Promise<{ ok: boolean }>
  addListener(event: 'stepCount', callback: (event: { steps?: number }) => void): Promise<PluginListenerHandle>
}

/** 注册 Health 插件；H5 环境返回空实现，不调用原生 */
const Health = registerPlugin<HealthPlugin>('Health', {
  web: () =>
    Promise.resolve({
      requestActivityRecognition: () => Promise.resolve({ granted: false }),
      getStepCount: () => Promise.resolve({ available: false, steps: 0 }),
      startStepListening: () => Promise.resolve({ ok: false }),
      stopStepListening: () => Promise.resolve({ ok: true }),
    }),
})

/** The custom Health plugin currently implements Android counter sensors only. */
export function isNativeStepEnvironment(): boolean { return IS_NATIVE && PLATFORM.os === 'android' }

/**
 * 申请运动/活动识别权限。
 * - Android：弹系统权限框申请 ACTIVITY_RECOGNITION
 * - iOS：运动传感器由 NSMotionUsageDescription + Web API requestPermission 处理
 */
export async function requestActivityRecognition(): Promise<boolean> {
  // Android：走原生插件申请运行时权限
  if (IS_NATIVE && PLATFORM.os === 'android') {
    const { granted } = await Health.requestActivityRecognition()
    return granted
  }
  // iOS / Web：请求 DeviceMotion 权限
  return requestMotionPermission()
}

/**
 * 从 Android 原生计步传感器同步今日步数。
 * TYPE_STEP_COUNTER 返回自开机以来的累计步数，需记录当日基准值。
 */
type StepBase = { start: number; last: number; carried: number; manual: boolean }
let nativeGeneration = 0
let nativeReadRevision = 0
let nativeListener: PluginListenerHandle | null = null
let nativeActive = false
let nativeOwner: object | undefined
let nativeQueue: Promise<void> = Promise.resolve()
let nativeStarting: { generation: number; promise: Promise<boolean> } | null = null
let onNativeUpdate: (() => void) | undefined
let onNativeError: ((error: unknown) => void) | undefined

/** Serialize plugin start/stop so a late start cannot survive unmount or stop a newer session. */
function nativeOperation<T>(run: () => Promise<T>): Promise<T> {
  const result = nativeQueue.then(run, run)
  nativeQueue = result.then(() => {}, () => {})
  return result
}
async function clearNativeListener() {
  let failure: unknown
  const handle = nativeListener
  if (handle) {
    try { await handle.remove(); if (nativeListener === handle) nativeListener = null }
    catch (error) { failure = error }
  }
  try {
    const result = await Health.stopStepListening()
    if (!result.ok) throw new Error('系统未确认计步已停止')
  } catch (error) { failure ??= error }
  if (failure) throw failure
}

/** A native event already contains the total: avoid a second 1.5-second sensor registration. */
export async function syncStepsFromNative(eventTotal?: number): Promise<{ ok: boolean; steps: number; cancelled?: boolean }> {
  if (!isNativeStepEnvironment()) return { ok: false, steps: 0 }
  const generation = nativeGeneration
  const session = captureQbankSession()
  const revision = ++nativeReadRevision
  const value = typeof eventTotal === 'number' ? { available: true, steps: eventTotal } : await Health.getStepCount()
  if (!isQbankSessionCurrent(session) || generation !== nativeGeneration || revision !== nativeReadRevision) return { ok: false, steps: getTodaySteps().steps, cancelled: true }
  if (!value.available || !Number.isFinite(value.steps) || value.steps < 0) return { ok: false, steps: getTodaySteps().steps }
  const total = Math.floor(value.steps)
  const current = getTodaySteps()
  const key = `${K_STEP_BASE}:${todayStr()}`
  const stored = read<number | StepBase | null>(key, null)
  let base: StepBase
  if (typeof stored === 'number' && Number.isFinite(stored) && stored >= 0) base = { start: stored, last: stored, carried: 0, manual: false }
  else if (stored && typeof stored === 'object' && Number.isFinite(stored.start) && stored.start >= 0 && Number.isFinite(stored.last) && stored.last >= 0 && Number.isFinite(stored.carried) && stored.carried >= 0) base = stored
  else base = { start: total, last: total, carried: current.steps, manual: current.steps > 0 && current.source === 'manual' }
  if (current.source === 'manual' && (current.steps > 0 || current.hasManualSteps === false)) {
    base = { start: total, last: total, carried: current.steps, manual: current.steps > 0 }
  }
  // A reboot resets TYPE_STEP_COUNTER; keep already saved daily steps and establish a new baseline.
  if (total < base.last) base = { start: total, last: total, carried: current.steps, manual: !!current.hasManualSteps }
  base.last = total
  const steps = Math.max(0, Math.floor(base.carried + total - base.start))
  write(key, base)
  updateTodaySteps({ steps, distance: +(steps * .0007).toFixed(3), calories: +(steps * .04).toFixed(2), activeMinutes: Math.floor(steps / 100), source: 'sensor', hasManualSteps: base.manual })
  return { ok: true, steps }
}

/** Listener setup is required for a successful start; errors are visible to the active owner. */
export function startNativeStepListening(onUpdate?: () => void, onError?: (error: unknown) => void, owner?: object): Promise<boolean> {
  if (!isNativeStepEnvironment()) return Promise.resolve(false)
  nativeOwner = owner
  onNativeUpdate = onUpdate; onNativeError = onError
  if (nativeActive) return Promise.resolve(true)
  if (nativeStarting?.generation === nativeGeneration) return nativeStarting.promise
  const generation = ++nativeGeneration
  const promise = nativeOperation(async () => {
    if (generation !== nativeGeneration) return false
    try {
      if (nativeListener) await clearNativeListener()
      nativeListener = await Health.addListener('stepCount', (event) => {
        if (generation !== nativeGeneration || !nativeActive) return
        void syncStepsFromNative(event.steps).then((result) => {
          if (generation !== nativeGeneration || !nativeActive || result.cancelled) return
          if (result.ok) onNativeUpdate?.()
          else onNativeError?.(new Error('暂时无法读取系统步数'))
        }).catch((error) => { if (generation === nativeGeneration && nativeActive) onNativeError?.(error) })
      })
      if (generation !== nativeGeneration) { await clearNativeListener(); return false }
      const result = await Health.startStepListening()
      if (!result.ok || generation !== nativeGeneration) { await clearNativeListener(); return false }
      nativeActive = true
      return true
    } catch (error) {
      await clearNativeListener().catch(() => {})
      throw error
    }
  })
  nativeStarting = { generation, promise }
  void promise.finally(() => { if (nativeStarting?.generation === generation) nativeStarting = null }).catch(() => {})
  return promise
}

export function stopNativeStepListening(owner?: object): Promise<void> {
  // An older route's delayed cleanup must not stop the new route's session.
  if (owner && owner !== nativeOwner) return Promise.resolve()
  nativeOwner = undefined
  ++nativeGeneration; ++nativeReadRevision; nativeActive = false
  onNativeUpdate = undefined; onNativeError = undefined
  if (!isNativeStepEnvironment()) return Promise.resolve()
  return nativeOperation(clearNativeListener)
}

/** 原生计步传感器是否可用（Android） */
export async function isNativeStepAvailable(): Promise<boolean> {
  if (!IS_NATIVE) return false
  const { available } = await Health.getStepCount()
  return available
}

/* ———————————— 传感器计步（Web / WebView，降级方案） ———————————— */

let motionListener: ((event: DeviceMotionEvent) => void) | null = null
let stepPeak = 0

/**
 * 启动 DeviceMotion 粗略计步（Web API 降级方案）。
 * 浏览器需 HTTPS 且用户授权；原生 WebView 视权限而定。
 * 不保证精度，仅作降级兜底。
 */
export function startStepSensor(onStep: () => void): () => void {
  stopStepSensor()
  if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) return () => {}

  const handler = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity
    if (!a || a.x == null || a.y == null || a.z == null) return
    const mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
    // 简单峰值检测：阈值 12.5 m/s²（重力 9.8 + 摆动）
    if (mag > 12.5 && stepPeak === 0) {
      stepPeak = 1
      onStep()
    } else if (mag < 10) {
      stepPeak = 0
    }
  }

  window.addEventListener('devicemotion', handler)
  motionListener = handler
  return () => {
    window.removeEventListener('devicemotion', handler)
    if (motionListener === handler) { motionListener = null; stepPeak = 0 }
  }
}

export function stopStepSensor() {
  if (motionListener && typeof window !== 'undefined') window.removeEventListener('devicemotion', motionListener)
  motionListener = null; stepPeak = 0
}

export function isStepSensorSupported(): boolean {
  return typeof window !== 'undefined' && 'DeviceMotionEvent' in window
}

/**
 * iOS Safari 需要用户手势触发后才能请求 DeviceMotion 权限。
 * 调用前需确保在用户点击事件内。
 */
export async function requestMotionPermission(): Promise<boolean> {
  try {
    const dme = DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<string>
    }
    if (dme.requestPermission) {
      const res = await dme.requestPermission()
      return res === 'granted'
    }
    return true // 非 iOS 默认可用
  } catch {
    return false
  }
}

/* ———————————— 健康平台原生接口（预留） ———————————— */

/**
 * 预留：未来接入 HealthKit / Health Connect 时实现。
 * 当前返回空，页面会降级到手动录入 + 传感器。
 */
export async function fetchNativeHealth(): Promise<{ steps?: number; distance?: number; calories?: number } | null> {
  return null
}

let sportsIdentity = captureQbankSession()
subscribeQbank(() => {
  const next = captureQbankSession()
  if (next.uid === sportsIdentity.uid && next.revision === sportsIdentity.revision) return
  sportsIdentity = next
  // Invalidate pending native reads synchronously; stop physical listeners through their queue.
  stopStepSensor()
  void stopNativeStepListening().catch((error) => console.error('[sports] 账号切换时停止计步失败', error))
  notifySports()
})
