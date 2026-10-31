export type MapLocation = {
  lng: number
  lat: number
  /** Horizontal uncertainty radius in metres, supplied by the device. */
  accuracy: number
  /** Optional for compatibility with older native/QA callers. */
  timestamp?: number
  approximate?: boolean
}
export type MapLocationOptions = {
  signal?: AbortSignal
  /** Best valid fix so far; a later fix may refine it before the Promise settles. */
  onProgress?: (position: MapLocation) => void
}

const ACQUISITION_MS = 15000
const TARGET_ACCURACY_M = 50
const MAX_USABLE_ACCURACY_M = 1000
const MAX_FIX_AGE_MS = 30000
const GEO_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: ACQUISITION_MS, maximumAge: 0 }
const TIMEOUT_MESSAGE = '定位超时，请确认已开启手机定位服务，到窗边或室外重试；也可以在地图上选点'
const COARSE_MESSAGE = '当前只能取得大范围位置，无法准确落点。请为哦狐开启精确位置，或到信号较好的地方重试；也可以在地图上选点'

function abortError() {
  const error = new Error('已取消定位')
  error.name = 'AbortError'
  return error
}
function readFix(position: GeolocationPosition, requestedAt: number): MapLocation {
  const { longitude: lng, latitude: lat, accuracy } = position.coords
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90
    || !Number.isFinite(accuracy) || accuracy < 0) {
    throw new Error('定位结果无效，请重试或在地图上选点')
  }
  const timestamp = Number.isFinite(position.timestamp) ? position.timestamp : Date.now()
  if (timestamp < requestedAt - MAX_FIX_AGE_MS || timestamp > Date.now() + MAX_FIX_AGE_MS) {
    throw new Error('设备返回了过期位置，请重新定位或在地图上选点')
  }
  return { lng, lat, accuracy, timestamp, approximate: accuracy > TARGET_ACCURACY_M }
}

/**
 * A short-lived high-accuracy watch refines the initial Wi-Fi/cell fix, then
 * releases GPS immediately. W3C's native timeout excludes permission/visibility
 * waiting, so a separate wall-clock deadline also bounds the visible spinner.
 * Coordinates remain the browser's WGS84 coordinates; no provider conversion.
 */
export function getCurrentMapLocation(options: MapLocationOptions = {}): Promise<MapLocation> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(abortError()); return }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('当前设备不支持定位，请在地图上选点')); return
    }
    if (typeof isSecureContext === 'boolean' && !isSecureContext) {
      reject(new Error('当前网页未使用安全连接，无法定位。请使用 HTTPS 打开，或在地图上选点')); return
    }
    const geo = navigator.geolocation
    const canWatch = typeof geo.watchPosition === 'function' && typeof geo.clearWatch === 'function'
    const requestedAt = Date.now()
    let settled = false
    let watchId: number | null = null
    let deadline: ReturnType<typeof setTimeout> | undefined
    let best: MapLocation | undefined
    let lastIssue: Error | undefined

    function cleanup() {
      if (deadline != null) clearTimeout(deadline)
      if (watchId != null) { geo.clearWatch(watchId); watchId = null }
      options.signal?.removeEventListener('abort', onAbort)
    }
    function finish(value?: MapLocation, error?: Error) {
      if (settled) return
      settled = true; cleanup()
      if (value) resolve(value)
      else reject(error || new Error(TIMEOUT_MESSAGE))
    }
    function finishBest() {
      if (best && best.accuracy <= MAX_USABLE_ACCURACY_M) finish(best)
      else finish(undefined, best ? new Error(COARSE_MESSAGE) : lastIssue || new Error(TIMEOUT_MESSAGE))
    }
    function onAbort() { finish(undefined, abortError()) }
    function success(position: GeolocationPosition) {
      if (settled) return
      let fix: MapLocation
      try { fix = readFix(position, requestedAt) }
      catch (error) {
        lastIssue = error as Error
        if (!canWatch) finish(undefined, lastIssue)
        return
      }
      if (!best || fix.accuracy < best.accuracy || (fix.accuracy === best.accuracy && fix.timestamp! > best.timestamp!)) {
        best = fix
        if (fix.accuracy <= MAX_USABLE_ACCURACY_M) {
          // Display callbacks must not prevent releasing the device's location watch.
          try { options.onProgress?.(fix) } catch { /* rendering is independent of acquisition */ }
        }
      }
      if (fix.accuracy <= TARGET_ACCURACY_M) finish(fix)
      else if (!canWatch) finishBest()
    }
    function failure(error: GeolocationPositionError) {
      if (settled) return
      if (error.code === 1) finish(undefined, new Error('定位权限未允许，请在系统或浏览器设置中允许哦狐使用位置，并开启精确位置；也可以在地图上选点'))
      else if (error.code === 3) finishBest()
      else if (best) finishBest()
      else finish(undefined, new Error('暂时无法定位，请开启手机定位服务、检查网络后重试；也可以在地图上选点'))
    }

    options.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      if (canWatch) {
        watchId = geo.watchPosition(success, failure, GEO_OPTIONS)
        // A mock/native adapter may invoke its callback before returning an ID.
        if (settled && watchId != null) { geo.clearWatch(watchId); watchId = null }
      } else geo.getCurrentPosition(success, failure, GEO_OPTIONS)
      if (!settled) deadline = setTimeout(finishBest, ACQUISITION_MS)
    } catch (error) {
      finish(undefined, new Error(error instanceof Error && error.name === 'SecurityError'
        ? '定位被系统或网页权限策略阻止，请检查位置权限或在地图上选点'
        : '无法启动定位，请检查位置权限和定位服务后重试'))
    }
  })
}
