/** Read polling only: one request at a time, with foreground and network gating. */
export interface AdaptivePollingHost {
  now: () => number
  random: () => number
  setTimeout: (callback: () => void, delayMs: number) => unknown
  clearTimeout: (handle: unknown) => void
  isActive: () => boolean
  /** Notify on activity/connectivity changes, including pauses as well as resumes. */
  subscribeResume: (listener: () => void) => () => void
}

export interface AdaptivePollingOptions {
  intervalMs?: number
  maxIntervalMs?: number
  /** Only positive jitter is used; values are clamped to 0–0.2. */
  jitterRatio?: number
  resumeCooldownMs?: number
  host?: Partial<AdaptivePollingHost>
}

export interface AdaptivePollingController {
  /** Reset backoff and share an existing request; inactive/stopped hosts do no work. */
  refresh: () => Promise<void>
  /** Cancels scheduling/listeners; an already running read is allowed to settle. */
  stop: () => void
}

function browserActive(): boolean {
  return (typeof document === 'undefined' || document.visibilityState !== 'hidden') &&
    (typeof navigator === 'undefined' || navigator.onLine !== false)
}

function browserSubscribe(listener: () => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  document.addEventListener('visibilitychange', listener)
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  window.addEventListener('focus', listener)
  return () => {
    document.removeEventListener('visibilitychange', listener)
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
    window.removeEventListener('focus', listener)
  }
}

function positive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0 ? Math.max(1, value!) : fallback
}

/**
 * Starts an immediate foreground read. A false result or exception backs off the
 * next read exponentially; successful reads restore the ordinary interval.
 * maxIntervalMs caps the backoff before positive jitter (default maximum 144s).
 * Timers are scheduled after settlement, so a slow read never builds a backlog.
 */
export function startAdaptivePolling(
  run: () => Promise<void | boolean>,
  options: AdaptivePollingOptions = {},
): AdaptivePollingController {
  const host: AdaptivePollingHost = {
    now: () => Date.now(), random: () => Math.random(),
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    isActive: browserActive, subscribeResume: browserSubscribe,
    ...options.host,
  }
  const interval = positive(options.intervalMs, 15000)
  const maximum = Math.max(interval, positive(options.maxIntervalMs, 120000))
  const jitter = Number.isFinite(options.jitterRatio) ? Math.min(.2, Math.max(0, options.jitterRatio!)) : .2
  const cooldown = positive(options.resumeCooldownMs, 1000)
  let stopped = false
  let flight: Promise<void> | null = null
  let timer: unknown = null
  let hasTimer = false
  let failures = 0
  let activeAtLastSignal = host.isActive()
  let resumeAt: number | null = null
  let unsubscribe = () => {}

  function cancelTimer() {
    if (hasTimer) host.clearTimeout(timer)
    timer = null
    hasTimer = false
  }

  function schedule(delay: number) {
    cancelTimer()
    if (stopped || !host.isActive()) return
    timer = host.setTimeout(() => {
      hasTimer = false
      timer = null
      if (stopped) return
      if (!host.isActive()) { activeAtLastSignal = false; return }
      resumeAt = null
      void read()
    }, delay)
    hasTimer = true
  }

  function scheduleNext() {
    if (stopped || !host.isActive()) return
    const base = Math.min(maximum, interval * 2 ** Math.min(failures, 30))
    const sample = host.random()
    const random = Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 0
    schedule(base * (1 + random * jitter))
  }

  function read(): Promise<void> {
    if (stopped) return Promise.resolve()
    if (flight) return flight
    if (!host.isActive()) { activeAtLastSignal = false; cancelTimer(); return Promise.resolve() }
    cancelTimer()
    resumeAt = null
    // Assign the flight before invoking user code, including synchronous/reentrant code.
    flight = Promise.resolve().then(async () => {
      if (stopped || !host.isActive()) return
      try {
        failures = (await run()) === false ? failures + 1 : 0
      } catch {
        failures++
      }
    }).then(() => {
      flight = null
      scheduleNext()
    })
    return flight
  }

  function onActivity() {
    if (stopped) return
    const active = host.isActive()
    const resumed = active && !activeAtLastSignal
    activeAtLastSignal = active
    if (!active) { resumeAt = null; cancelTimer(); return }
    // A read already underway covers the resume. Repeated focus/online events
    // while active do not create an additional request or postpone a pending one.
    if (!resumed || flight || resumeAt !== null) return
    resumeAt = host.now() + cooldown
    schedule(Math.max(0, resumeAt - host.now()))
  }

  function refresh(): Promise<void> {
    if (stopped) return Promise.resolve()
    failures = 0
    cancelTimer()
    resumeAt = null
    return read()
  }

  function stop() {
    if (stopped) return
    stopped = true
    cancelTimer()
    resumeAt = null
    unsubscribe()
  }

  unsubscribe = host.subscribeResume(onActivity)
  void read()
  return { refresh, stop }
}
