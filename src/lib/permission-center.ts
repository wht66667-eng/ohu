/**
 * 首次引导的「一键全部通过」：把本机需要的系统权限集中检查/申请。
 *
 * Android 的限制：
 * - 通知、相机、位置可以用系统弹框直接申请；
 * - 精确闹钟、电池优化、悬浮窗会跳到系统页面，用户必须自己打开开关，
 *   返回后这里再检查一次，没开就标成「需手动」。
 */
import { IS_NATIVE, PLATFORM } from './platform'
import { exactAlarmGranted, requestExactAlarm } from './alarm-notify'
import { isBatteryOptimizationIgnored, openBatteryOptimization } from './keep-alive'
import { getReminderOverlayState, requestReminderOverlayPermission } from './reminder-overlay'

export type PermissionKey = 'notify' | 'exactAlarm' | 'battery' | 'overlay' | 'camera' | 'location'
export type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'manual' | 'unsupported'
export type PermissionRow = { key: PermissionKey; status: PermissionStatus; detail?: string }

export const PERMISSION_ORDER: PermissionKey[] = ['notify', 'exactAlarm', 'battery', 'overlay', 'camera', 'location']

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function notificationStatus(): Promise<PermissionStatus> {
  if (!IS_NATIVE) {
    if (typeof Notification === 'undefined') return 'unsupported'
    return Notification.permission === 'granted' ? 'granted' : Notification.permission === 'denied' ? 'denied' : 'prompt'
  }
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const st = await LocalNotifications.checkPermissions()
    return st.display === 'granted' ? 'granted' : st.display === 'denied' ? 'denied' : 'prompt'
  } catch {
    return 'unsupported'
  }
}

async function exactAlarmStatus(): Promise<PermissionStatus> {
  if (!IS_NATIVE || PLATFORM.os !== 'android') return 'unsupported'
  return (await exactAlarmGranted()) ? 'granted' : 'manual'
}

async function batteryStatus(): Promise<PermissionStatus> {
  if (!IS_NATIVE || PLATFORM.os !== 'android') return 'unsupported'
  try {
    return (await isBatteryOptimizationIgnored()) ? 'granted' : 'manual'
  } catch {
    return 'unsupported'
  }
}

async function overlayStatus(): Promise<PermissionStatus> {
  if (!IS_NATIVE || PLATFORM.os !== 'android') return 'unsupported'
  try {
    const state = await getReminderOverlayState()
    if (!state.supported) return 'unsupported'
    return state.permissionGranted ? 'granted' : 'manual'
  } catch {
    return 'unsupported'
  }
}

async function cameraStatus(): Promise<PermissionStatus> {
  if (!IS_NATIVE) return 'unsupported'
  try {
    const { Camera } = await import('@capacitor/camera')
    const st = await Camera.checkPermissions()
    const ok = st.camera === 'granted' || st.camera === 'limited'
    const photos = st.photos === 'granted' || st.photos === 'limited'
    return ok && photos ? 'granted' : st.camera === 'denied' ? 'denied' : 'prompt'
  } catch {
    return 'unsupported'
  }
}

async function locationStatus(): Promise<PermissionStatus> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return 'unsupported'
  try {
    const permissions = navigator.permissions
    if (permissions?.query) {
      const state = await permissions.query({ name: 'geolocation' as PermissionName })
      return state.state === 'granted' ? 'granted' : state.state === 'denied' ? 'denied' : 'prompt'
    }
  } catch {
    /* 部分 WebView 不支持 permissions.query */
  }
  return 'prompt'
}

export async function checkPermission(key: PermissionKey): Promise<PermissionStatus> {
  switch (key) {
    case 'notify': return notificationStatus()
    case 'exactAlarm': return exactAlarmStatus()
    case 'battery': return batteryStatus()
    case 'overlay': return overlayStatus()
    case 'camera': return cameraStatus()
    case 'location': return locationStatus()
  }
}

export async function checkAllPermissions(): Promise<PermissionRow[]> {
  return Promise.all(PERMISSION_ORDER.map(async (key) => ({ key, status: await checkPermission(key) })))
}

async function requestLocation(): Promise<PermissionStatus> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return 'unsupported'
  return new Promise((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        () => resolve('granted'),
        (error) => resolve(error.code === error.PERMISSION_DENIED ? 'denied' : 'prompt'),
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
      )
    } catch {
      resolve('prompt')
    }
  })
}

export async function requestPermission(key: PermissionKey): Promise<PermissionStatus> {
  switch (key) {
    case 'notify': {
      if (!IS_NATIVE) {
        if (typeof Notification === 'undefined') return 'unsupported'
        return (await Notification.requestPermission()) === 'granted' ? 'granted' : 'denied'
      }
      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications')
        const st = await LocalNotifications.requestPermissions()
        return st.display === 'granted' ? 'granted' : 'denied'
      } catch {
        return 'unsupported'
      }
    }
    case 'exactAlarm': {
      if (!IS_NATIVE || PLATFORM.os !== 'android') return 'unsupported'
      // 打开系统「闹钟和提醒」页；返回后重新检查。
      await requestExactAlarm().catch(() => false)
      await sleep(500)
      return (await exactAlarmGranted()) ? 'granted' : 'manual'
    }
    case 'battery': {
      if (!IS_NATIVE || PLATFORM.os !== 'android') return 'unsupported'
      const opened = await openBatteryOptimization().catch(() => null)
      await sleep(600)
      if (!opened) return 'unsupported'
      return (await isBatteryOptimizationIgnored().catch(() => false)) ? 'granted' : 'manual'
    }
    case 'overlay': {
      if (!IS_NATIVE || PLATFORM.os !== 'android') return 'unsupported'
      try {
        const result = await requestReminderOverlayPermission()
        await sleep(600)
        return result.permissionGranted ? 'granted' : 'manual'
      } catch {
        return 'unsupported'
      }
    }
    case 'camera': {
      if (!IS_NATIVE) return 'unsupported'
      try {
        const { Camera } = await import('@capacitor/camera')
        const st = await Camera.requestPermissions({ permissions: ['camera', 'photos'] })
        return st.camera === 'granted' || st.camera === 'limited' ? 'granted' : 'denied'
      } catch {
        return 'unsupported'
      }
    }
    case 'location': return requestLocation()
  }
}

/** 按顺序申请全部权限；会依次弹出系统框/系统页，返回每一项的最终状态。 */
export async function requestAllPermissions(
  onChange?: (rows: PermissionRow[]) => void,
): Promise<PermissionRow[]> {
  const rows: PermissionRow[] = PERMISSION_ORDER.map((key) => ({ key, status: 'prompt' }))
  onChange?.([...rows])
  for (let index = 0; index < rows.length; index += 1) {
    const key = rows[index].key
    try {
      rows[index] = { key, status: await requestPermission(key) }
    } catch {
      rows[index] = { key, status: 'unsupported' }
    }
    onChange?.([...rows])
  }
  return rows
}
