/**
 * 番茄专注：原生锁屏 / 勿扰桥（Android FocusLock 插件）。
 */
import { Capacitor, registerPlugin } from '@capacitor/core'
import { IS_NATIVE } from './platform'

export type FocusOpenResult = {
  ok: boolean
  opened?: string
  step?: string
  hasDndAccess?: boolean
  hint?: string
  error?: string
}

interface FocusLockPlugin {
  hasDndAccess(): Promise<{ granted: boolean }>
  openDndAccessSettings(): Promise<{ ok: boolean; opened?: string; hasDndAccess?: boolean }>
  openDndSettings(): Promise<{ ok: boolean; opened?: string; hasDndAccess?: boolean }>
  openScreenPinningSettings(): Promise<{ ok: boolean; opened?: string }>
  openSetupStep(opts: { step?: string }): Promise<{
    ok: boolean
    opened?: string
    step?: string
    hasDndAccess?: boolean
    hint?: string
  }>
  enterFocus(opts: { dnd?: boolean; lockTask?: boolean; sessionId?: string; endsAt?: number }): Promise<{
    ok: boolean
    dndApplied: boolean
    lockApplied: boolean
    hasDndAccess: boolean
  }>
  exitFocus(): Promise<void>
  syncFocusSession(opts: { sessionId: string; endsAt: number }): Promise<void>
  ensureReminderChannels(): Promise<{ channels: FocusReminderChannel[] }>
  scheduleFocusNotifications(opts: { notifications: FocusNativeNotification[]; reminder: 'sound' | 'vibrate' }): Promise<{ scheduledIds: number[]; exact: boolean }>
  cancelFocusNotifications(): Promise<void>
  consumeNotificationRoute(): Promise<{ route: string | null }>
}

export type FocusReminderChannel = { id: string; importance: number; soundAllowed: boolean; vibration: boolean }
export type FocusNativeNotification = { id: number; at: number; title: string; body: string; phase: 'focus' | 'break'; sessionId: string }

const FocusLock = registerPlugin<FocusLockPlugin>('FocusLock')

function isAndroidNative(): boolean {
  return IS_NATIVE && Capacitor.getPlatform() === 'android'
}

export async function focusHasDndAccess(): Promise<boolean> {
  if (!isAndroidNative()) return false
  try {
    const r = await FocusLock.hasDndAccess()
    return !!r.granted
  } catch {
    return false
  }
}

async function wrapOpen(
  run: () => Promise<{ ok?: boolean; opened?: string; hasDndAccess?: boolean; hint?: string; step?: string }>,
  fallbackErr: string,
): Promise<FocusOpenResult> {
  if (!isAndroidNative()) {
    return { ok: false, error: '请在 Android App 中设置' }
  }
  try {
    const r = await run()
    return {
      ok: r.ok !== false,
      opened: r.opened,
      hasDndAccess: r.hasDndAccess,
      hint: r.hint,
      step: r.step,
    }
  } catch (e) {
    const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: string }).message) : ''
    return { ok: false, error: msg || fallbackErr }
  }
}

export async function focusOpenDndAccessSettings(): Promise<FocusOpenResult> {
  return wrapOpen(() => FocusLock.openDndAccessSettings(), '无法打开勿扰授权页')
}

export async function focusOpenDndSettings(): Promise<FocusOpenResult> {
  return wrapOpen(() => FocusLock.openDndSettings(), '无法打开勿扰详细设置')
}

export async function focusOpenPinSettings(): Promise<FocusOpenResult> {
  return wrapOpen(() => FocusLock.openScreenPinningSettings(), '无法打开屏幕固定设置')
}

/** 一键：未授权先跳勿扰授权，已授权跳屏幕固定 */
export async function focusOpenSetupStep(step: 'auto' | 'dnd' | 'dndDetail' | 'pin' = 'auto'): Promise<FocusOpenResult> {
  return wrapOpen(() => FocusLock.openSetupStep({ step }), '无法打开系统设置')
}

export async function focusEnterNative(opts: {
  dnd: boolean
  lockTask: boolean
  sessionId?: string
  endsAt?: number
}): Promise<{ dndApplied: boolean; lockApplied: boolean }> {
  if (!isAndroidNative()) {
    try {
      const { StatusBar } = await import('@capacitor/status-bar')
      await StatusBar.hide()
    } catch {
      /* ignore */
    }
    try {
      await webWakeLock?.release()
      webWakeLock = await navigator.wakeLock?.request?.('screen') || null
    } catch {
      /* ignore */
    }
    return { dndApplied: false, lockApplied: false }
  }
  try {
    const r = await FocusLock.enterFocus(opts)
    try {
      const { StatusBar } = await import('@capacitor/status-bar')
      await StatusBar.hide()
    } catch {
      /* ignore */
    }
    return { dndApplied: !!r.dndApplied, lockApplied: !!r.lockApplied }
  } catch {
    return { dndApplied: false, lockApplied: false }
  }
}

export async function focusExitNative(): Promise<void> {
  try { await webWakeLock?.release() } catch { /* An already released lock is harmless. */ }
  webWakeLock = null
  try {
    const { StatusBar } = await import('@capacitor/status-bar')
    await StatusBar.show()
  } catch {
    /* ignore */
  }
  if (!isAndroidNative()) return
  try {
    await FocusLock.exitFocus()
  } catch {
    /* ignore */
  }
}

let webWakeLock: WakeLockSentinel | null = null

/** null cancels the native deadline while paused; a future deadline reschedules resume/extension. */
export async function focusSyncNativeSession(sessionId: string, endsAt: number | null): Promise<void> {
  if (!isAndroidNative()) return
  await FocusLock.syncFocusSession({ sessionId, endsAt: endsAt ?? 0 })
}

export async function focusEnsureReminderChannels(): Promise<{ channels: FocusReminderChannel[] }> {
  if (!isAndroidNative()) return { channels: [] }
  return FocusLock.ensureReminderChannels()
}

export async function focusScheduleNotifications(opts: { notifications: FocusNativeNotification[]; reminder: 'sound' | 'vibrate' }): Promise<{ scheduledIds: number[]; exact: boolean }> {
  if (!isAndroidNative()) return { scheduledIds: [], exact: false }
  return FocusLock.scheduleFocusNotifications(opts)
}

export async function focusCancelNotifications(): Promise<void> {
  if (isAndroidNative()) await FocusLock.cancelFocusNotifications()
}

export async function focusConsumeNotificationRoute(): Promise<string | null> {
  if (!isAndroidNative()) return null
  try { return (await FocusLock.consumeNotificationRoute()).route } catch { return null }
}
