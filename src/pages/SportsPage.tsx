import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { HomeServiceIcon } from '../components/HomeServiceIcon'
import { DialogLayer } from '../components/ui/DialogLayer'
import { useToast } from '../context/ToastContext'
import {
  addMetric,
  getLatestMetric,
  getRecentDays,
  getSettings,
  getTodaySteps,
  getSportsScope,
  isStepSensorSupported,
  isNativeStepEnvironment,
  requestActivityRecognition,
  startNativeStepListening,
  startStepSensor,
  stopNativeStepListening,
  subscribeSports,
  syncStepsFromNative,
  updateSettings,
  updateTodaySteps,
  type DailySteps,
  type HealthMetric,
  type MetricType,
  type SportsSettings,
} from '../lib/health'
import styles from './sports.module.css'
import panel from '../components/ui/panel.module.css'
import { IS_NATIVE } from '../lib/platform'
import { captureQbankSession, isQbankSessionCurrent } from '../lib/qbank'

const METRIC_META: Record<MetricType, { label: string; emoji: string; unit: string }> = {
  heart_rate: { label: '心率', emoji: '❤️', unit: 'bpm' },
  sleep: { label: '睡眠', emoji: '😴', unit: '小时' },
  weight: { label: '体重', emoji: '⚖️', unit: 'kg' },
  water: { label: '饮水', emoji: '💧', unit: '杯' },
}

/** SVG 环形进度 */
function Ring({ value, max, size = 140 }: { value: number; max: number; size?: number }) {
  const r = (size - 16) / 2
  const c = 2 * Math.PI * r
  const pct = max > 0 ? Math.min(value / max, 1) : 0
  const dash = c * pct
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={styles.ring}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line)" strokeWidth={10} fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke="var(--green)"
        strokeWidth={10}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c - dash}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  )
}

/** 周柱状图 */
function WeekChart({ days }: { days: DailySteps[] }) {
  const max = Math.max(...days.map((d) => d.steps), 1)
  return (
    <div className={styles.chart}>
      {days.map((d) => {
        const h = Math.max((d.steps / max) * 100, 3)
        const label = d.date.slice(5) // MM-DD
        return (
          <div key={d.date} className={styles.barCol}>
            <div className={styles.barFillWrap}>
              <div
                className={styles.barFill}
                style={{ height: `${h}%` }}
                title={`${d.steps} 步`}
              />
            </div>
            <span className={styles.barLabel}>{label}</span>
          </div>
        )
      })}
    </div>
  )
}

function MetricCard({ type }: { type: MetricType }) {
  const [tick, setTick] = useState(0)
  const meta = METRIC_META[type]
  const latest = useMemo(() => getLatestMetric(type), [tick, type])
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState('')
  const [error, setError] = useState('')

  const save = () => {
    const n = Number(val)
    if (!val.trim() || !Number.isFinite(n) || n < 0) { setError('请填写大于或等于0的数字'); return }
    const m: HealthMetric = {
      type,
      value: n,
      unit: meta.unit,
      timestamp: Date.now(),
      source: 'manual',
    }
    try {
      addMetric(m)
      setEditing(false)
      setVal('')
      setError('')
      setTick((t) => t + 1)
    } catch (failure) { setError((failure as Error).message || '本机记录保存失败，请重试') }
  }

  return (
    <div className={styles.metricCard}>
      <div className={styles.metricHead}>
        <span className={styles.metricEmoji}>{meta.emoji}</span>
        <span className={styles.metricLabel}>{meta.label}</span>
      </div>
      {latest ? (
        <div className={styles.metricValue}>
          <b>{latest.value}</b>
          <span>{meta.unit}</span>
        </div>
      ) : (
        <div className={styles.metricEmpty}>暂无记录</div>
      )}
      {editing ? (
        <div className={styles.metricEdit}>
          <input
            type="number"
            aria-label={`手动记录${meta.label}，单位${meta.unit}`}
            min="0"
            inputMode="decimal"
            placeholder={meta.unit}
            value={val}
            aria-invalid={!!error}
            aria-describedby={error ? `metric-error-${type}` : undefined}
            onChange={(e) => { setVal(e.target.value); setError('') }}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            autoFocus
          />
          <button type="button" onClick={save}>保存</button>
        </div>
      ) : (
        <button type="button" className={styles.metricAdd} onClick={() => setEditing(true)}>
          + 录入
        </button>
      )}
      {error ? <span id={`metric-error-${type}`} className={styles.metricError} role="alert">{error}</span> : null}
      <span className={styles.metricSource}>手动记录</span>
    </div>
  )
}

export function SportsPage() {
  const scope = useSyncExternalStore(subscribeSports, getSportsScope, getSportsScope)
  // A new identity gets fresh controls and cards, including pending permission/start state.
  return <SportsAccountPage key={scope} />
}

function SportsAccountPage() {
  const session = useRef(captureQbankSession()).current
  const toast = useToast()
  const [tick, setTick] = useState(0)
  const [sensorOn, setSensorOn] = useState(false)
  const [useNative, setUseNative] = useState(false)
  const [sensorBusy, setSensorBusy] = useState(false)
  const [sensorMessage, setSensorMessage] = useState('计步从首次开启后开始记录；手动记录可以单独使用。')
  const [showSettings, setShowSettings] = useState(false)
  const mounted = useRef(false)
  const busy = useRef(false)
  const operation = useRef(0)
  const sensor = useRef({ on: false, native: false })
  const ownsNative = useRef(false)
  const nativeOwner = useRef({})
  const stopWeb = useRef<(() => void) | null>(null)
  const resumeSync = useRef<Promise<void> | null>(null)

  const today = useMemo(() => getTodaySteps(), [tick])
  const week = useMemo(() => getRecentDays(7), [tick])
  const settings = useMemo<SportsSettings>(() => getSettings(), [tick])

  const weekTotal = useMemo(() => week.reduce((s, d) => s + d.steps, 0), [week])
  const weekAvg = Math.round(weekTotal / week.length)
  const weekMax = Math.max(...week.map((d) => d.steps), 0)

  const refresh = useCallback(() => setTick((t) => t + 1), [])

  const syncCurrentSteps = useCallback((allowStarting = false) => {
    if (!isQbankSessionCurrent(session)) return Promise.resolve()
    if (busy.current && !allowStarting) return Promise.resolve()
    if (resumeSync.current) return resumeSync.current
    refresh()
    if (!sensor.current.on || !sensor.current.native) return Promise.resolve()
    const job = syncStepsFromNative().then((result) => {
      if (!mounted.current || !isQbankSessionCurrent(session) || result.cancelled) return
      setSensorMessage(result.ok ? '系统计步已同步；回到应用时会补同步。' : '暂未读取到步数，走几步后重试；也可以检查系统运动权限。')
    }).catch((error) => {
      if (mounted.current && isQbankSessionCurrent(session)) setSensorMessage((error as Error).message || '暂时无法同步步数，请检查运动权限后重试。')
    }).finally(() => { if (resumeSync.current === job) resumeSync.current = null })
    resumeSync.current = job
    return job
  }, [refresh, session])

  useEffect(() => {
    mounted.current = true
    const unsubscribe = subscribeSports(refresh)
    const visible = () => { if (document.visibilityState === 'visible') void syncCurrentSteps() }
    document.addEventListener('visibilitychange', visible)
    let cancelled = false
    let removeResume: (() => Promise<void>) | undefined
    if (IS_NATIVE) void import('@capacitor/app').then(async ({ App }) => {
      if (cancelled) return
      const handle = await App.addListener('appStateChange', ({ isActive }) => { if (isActive) void syncCurrentSteps() })
      if (cancelled) await handle.remove()
      else removeResume = () => handle.remove()
    }).catch(() => { if (mounted.current) setSensorMessage('无法监听应用恢复状态，可用「同步步数」手动刷新。') })
    return () => {
      mounted.current = false; cancelled = true; ++operation.current
      unsubscribe(); document.removeEventListener('visibilitychange', visible)
      void removeResume?.().catch(() => {})
      stopWeb.current?.(); stopWeb.current = null
      if (ownsNative.current) { ownsNative.current = false; void stopNativeStepListening(nativeOwner.current).catch(() => {}) }
      sensor.current = { on: false, native: false }
    }
  }, [refresh, syncCurrentSteps])

  const toggleSensor = async () => {
    if (busy.current) return
    busy.current = true; setSensorBusy(true)
    const token = ++operation.current
    const current = () => mounted.current && token === operation.current && isQbankSessionCurrent(session)
    const stopping = sensor.current.on
    try {
      if (stopping) {
        setSensorMessage('正在停止计步…')
        if (sensor.current.native) await stopNativeStepListening(nativeOwner.current)
        else { stopWeb.current?.(); stopWeb.current = null }
        if (!current()) return
        ownsNative.current = false; sensor.current = { on: false, native: false }
        setSensorOn(false); setUseNative(false)
        setSensorMessage('计步已停止，已有记录保留在本机。')
        return
      }
      setSensorMessage('正在请求运动权限…')
      const granted = await requestActivityRecognition()
      if (!current()) return
      if (!granted) {
        setSensorMessage('运动权限未获允许，请在系统设置中开启后重试；也可以手动录入。')
        toast.warn('运动权限未获允许')
        return
      }
      if (isNativeStepEnvironment()) {
        ownsNative.current = true
        const started = await startNativeStepListening(
          () => { if (current()) setSensorMessage('系统计步正在更新；回到应用时会补同步。') },
          () => { if (current()) setSensorMessage('计步读数更新失败，请检查运动权限或点击同步步数重试。') },
          nativeOwner.current,
        )
        if (!current()) return
        if (!started) {
          ownsNative.current = false
          setSensorMessage('系统计步未能启动：设备可能没有计步传感器，或权限已撤回。可重试或手动录入。')
          toast.warn('系统计步未能启动')
          return
        }
        sensor.current = { on: true, native: true }; setUseNative(true); setSensorOn(true)
        await syncCurrentSteps(true)
        if (current()) toast.ok('已开启系统计步')
        return
      }
      if (!isStepSensorSupported()) {
        setSensorMessage('当前设备不提供运动传感器，请手动录入步数。')
        toast.warn('当前设备不支持运动传感器，请手动录入步数')
        return
      }
      stopWeb.current = startStepSensor(() => {
        if (!current() || !sensor.current.on) return
        const cur = getTodaySteps(), steps = cur.steps + 1
        try {
          updateTodaySteps({ steps, distance: +(steps * .0007).toFixed(3), calories: +(steps * .04).toFixed(2), activeMinutes: Math.floor(steps / 100), source: 'sensor', hasManualSteps: !!cur.hasManualSteps || cur.steps > 0 && cur.source === 'manual' })
        } catch (error) {
          stopWeb.current?.(); stopWeb.current = null
          sensor.current = { on: false, native: false }; setSensorOn(false)
          setSensorMessage((error as Error).message || '本机记录保存失败，计步已暂停，请重试。')
        }
      })
      sensor.current = { on: true, native: false }; setUseNative(false); setSensorOn(true)
      setSensorMessage('前台运动传感器已开启；这是粗略估计，后台不会持续记录。')
      toast.ok('已开启传感器计步（粗略）')
    } catch {
      if (!current()) return
      if (!stopping && ownsNative.current) {
        await stopNativeStepListening(nativeOwner.current).catch(() => {})
        ownsNative.current = false
      }
      if (!current()) return
      setSensorMessage(stopping ? '停止计步失败，请重试；本次监听更新已暂停。' : '计步启动失败，请检查运动权限与设备支持后重试，也可以手动录入。')
      toast.warn(stopping ? '停止计步失败，请重试' : '计步启动失败，请重试')
    } finally {
      if (current()) { busy.current = false; setSensorBusy(false) }
    }
  }

  const addSteps = (delta: number) => {
    if (!isQbankSessionCurrent(session)) return
    const cur = getTodaySteps()
    const steps = Math.max(0, cur.steps + delta)
    try { updateTodaySteps({
      steps,
      distance: +(steps * 0.0007).toFixed(3),
      calories: +(steps * 0.04).toFixed(2),
      activeMinutes: Math.floor(steps / 100),
      source: 'manual',
      hasManualSteps: steps > 0,
    }); refresh() }
    catch (error) { setSensorMessage((error as Error).message || '本机记录保存失败，请重试'); toast.warn('步数未能保存，请重试') }
  }

  const setGoal = (goal: number) => {
    try { updateSettings({ stepGoal: goal }); refresh(); toast.ok(`目标已设为 ${goal} 步`) }
    catch (error) { toast.warn((error as Error).message || '目标保存失败，请重试') }
  }

  const toggleCard = (type: MetricType) => {
    const cur = settings.visibleCards
    const next = cur.includes(type) ? cur.filter((c) => c !== type) : [...cur, type]
    try { updateSettings({ visibleCards: next }); refresh() }
    catch (error) { toast.warn((error as Error).message || '运动设置保存失败，请重试') }
  }

  return (
    <div className={panel.shell} style={{ minHeight: '100%', paddingBottom: 48 }}>
      <PageHeader
        title="运动中心"
        right={
          <button type="button" className={panel.legacyLink} onClick={() => setShowSettings(true)}>
            ⚙ 设置
          </button>
        }
      />

      <div className={panel.main}>
        {/* 今日概览 */}
        <div className={styles.hero}>
          <div className={styles.ringWrap}>
            <Ring value={today.steps} max={today.goal} size={150} />
            <div className={styles.ringCenter}>
              <div className={styles.stepNum}>{today.steps.toLocaleString()}</div>
              <div className={styles.stepGoal}>目标 {today.goal.toLocaleString()}</div>
            </div>
          </div>
          <div className={styles.heroStats}>
            <div className={styles.statBox}>
              <span className={styles.statEmoji}>📏</span>
              <div>
                <b>{(settings.units === 'mi' ? today.distance / 1.609344 : today.distance).toFixed(2)}</b>
                <span>{settings.units}</span>
              </div>
            </div>
            <div className={styles.statBox}>
              <span className={styles.statEmoji}>🔥</span>
              <div>
                <b>{today.calories.toFixed(0)}</b>
                <span>kcal</span>
              </div>
            </div>
            <div className={styles.statBox}>
              <span className={styles.statEmoji}>⏱</span>
              <div>
                <b>{today.activeMinutes}</b>
                <span>估算分钟</span>
              </div>
            </div>
          </div>
        </div>

        {/* 数据源 + 手动调整 */}
        <div className={styles.sourceBar}>
          <span className={styles.sourceTag}>
            {sensorOn ? (useNative ? '系统传感器计步' : '传感器计步 · 粗略估计') : today.source === 'sensor' ? '传感器计步记录' : today.source === 'healthkit' || today.source === 'health_connect' ? '系统健康记录' : '手动记录'}{today.hasManualSteps && today.source === 'sensor' ? ' · 含手动记录' : ''}
          </span>
          <button type="button" className={styles.sensorBtn} disabled={sensorBusy} aria-busy={sensorBusy} onClick={toggleSensor}>
            {sensorBusy ? sensorOn ? '正在停止…' : '正在开启…' : sensorOn ? '停止计步' : '开启计步'}
          </button>
          {sensorOn && useNative ? <button type="button" className={styles.sensorBtn} disabled={sensorBusy} onClick={() => void syncCurrentSteps()}>同步步数</button> : null}
          <div className={styles.stepAdjust}>
            <button type="button" disabled={sensorBusy || sensorOn} aria-label="手动减少100步" onClick={() => addSteps(-100)}>−100</button>
            <button type="button" disabled={sensorBusy || sensorOn} aria-label="手动增加100步" onClick={() => addSteps(100)}>+100</button>
            <button type="button" disabled={sensorBusy || sensorOn} aria-label="手动增加1000步" onClick={() => addSteps(1000)}>+1000</button>
          </div>
        </div>
        <p className={styles.sensorStatus} role="status" aria-live="polite">{sensorMessage}</p>
        <p className={styles.estimateHint}>距离、热量与活动分钟按步数估算；停止计步后可手动调整。本版不记录轨迹或实时配速。</p>

        <Link to="/sports/teams" className={styles.teamEntry}>
          <span className={styles.teamIcon}><HomeServiceIcon title="运动中心" /></span>
          <span><b>阳光跑小队</b><small>找到同校搭子，一起出发</small></span>
          <span aria-hidden="true">›</span>
        </Link>

        <Link to="/sports/results" className={styles.teamEntry}>
          <span className={styles.teamIcon}><HomeServiceIcon title="体测成绩" /></span>
          <span><b>体测成绩与趋势</b><small>官方查询后粘贴记录，查看最好成绩与变化</small></span>
          <span aria-hidden="true">›</span>
        </Link>

        {/* 周趋势 */}
        <div className={panel.section}>
          <div className={panel.sectionHead}>
            <h2 className={panel.sectionTitle}>本周步数</h2>
            <span className={panel.sectionHint}>日均 {weekAvg.toLocaleString()}</span>
          </div>
          <div className={styles.weekCard}>
            <WeekChart days={week} />
            <div className={styles.weekSummary}>
              <span>总计 <b>{weekTotal.toLocaleString()}</b> 步</span>
              <span>最高 <b>{weekMax.toLocaleString()}</b> 步</span>
            </div>
          </div>
        </div>

        {/* 健康卡片 */}
        <div className={panel.section}>
          <div className={panel.sectionHead}>
            <h2 className={panel.sectionTitle}>健康数据</h2>
            <span className={panel.sectionHint}>手动录入</span>
          </div>
          <div className={styles.metricGrid}>
            {settings.visibleCards.map((type) => (
              <MetricCard key={type} type={type} />
            ))}
          </div>
        </div>

        {/* 合规提示 */}
        <div className={panel.banner}>
          <b>本机记录：</b>运动与健康数据按当前账号保存在这台设备，访客记录单独保存。本版未接入 Apple 健康或 Health Connect。
        </div>
      </div>

      {/* 设置面板 */}
      {showSettings ? (
        <DialogLayer title="运动设置" className={styles.settingsSheet} onClose={() => setShowSettings(false)}>
            <h3>运动设置</h3>

            <div className={styles.setRow}>
              <label>每日步数目标</label>
              <div className={styles.goalBtns}>
                {[5000, 8000, 10000, 12000, 15000].map((g) => (
                  <button
                    type="button"
                    key={g}
                    aria-pressed={settings.stepGoal === g}
                    className={settings.stepGoal === g ? styles.goalOn : ''}
                    onClick={() => setGoal(g)}
                  >
                    {g >= 1000 ? `${g / 1000}k` : g}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.setRow}>
              <label>显示卡片</label>
              <div className={styles.cardToggles}>
                {(Object.keys(METRIC_META) as MetricType[]).map((type) => (
                  <button
                    type="button"
                    key={type}
                    aria-pressed={settings.visibleCards.includes(type)}
                    className={settings.visibleCards.includes(type) ? styles.toggleOn : ''}
                    onClick={() => toggleCard(type)}
                  >
                    {METRIC_META[type].emoji} {METRIC_META[type].label}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.setRow}>
              <label>距离单位</label>
              <div className={styles.unitBtns}>
                {(['km', 'mi'] as const).map((u) => (
                  <button
                    type="button"
                    key={u}
                    aria-pressed={settings.units === u}
                    className={settings.units === u ? styles.toggleOn : ''}
                    onClick={() => {
                      try { updateSettings({ units: u }); refresh() }
                      catch (error) { toast.warn((error as Error).message || '单位保存失败，请重试') }
                    }}
                  >
                    {u === 'km' ? '公里' : '英里'}
                  </button>
                ))}
              </div>
            </div>

            <button type="button" className={styles.settingsClose} onClick={(event) => event.currentTarget.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))}>
              完成
            </button>
        </DialogLayer>
      ) : null}
    </div>
  )
}
