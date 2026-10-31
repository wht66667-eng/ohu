import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  getRemindMinutes, isClassRemindEnabled, isClassSoonRemindEnabled, isClassStartRemindEnabled, isClassAlarmClockEnabled,
  rescheduleClassReminders, setClassRemindEnabled, setClassSoonRemindEnabled, setClassStartRemindEnabled, setClassAlarmClockEnabled, setRemindMinutes,
} from '../lib/class-remind'
import { captureQbankSession, isQbankSessionCurrent } from '../lib/qbank'
import { useQbankRevision } from '../lib/useQbankRevision'
import { IS_NATIVE } from '../lib/platform'
import { getClassReminderEffects, getReminderPresentation, REMINDER_STYLE_EVENT, setClassReminderEffects } from '../lib/reminder-presentation'
import { getReminderPermissionState, isAndroidNative, openAutostartGuide, openBatteryOptimization, openChannelSettings, openNotificationSettings } from '../lib/keep-alive'
import { requestExactAlarm } from '../lib/alarm-notify'
import styles from './CourseReminderSettings.module.css'

/** Keep in-flight feedback with the identity that started it, including A → B → A. */
export function CourseReminderSettings() {
  const revision = useQbankRevision()
  const session = captureQbankSession()
  return <CourseReminderContent key={`${session.uid}:${revision}`} />
}

function CourseReminderContent() {
  const [enabled, setEnabled] = useState(isClassRemindEnabled)
  const [soon, setSoon] = useState(isClassSoonRemindEnabled)
  const [start, setStart] = useState(isClassStartRemindEnabled)
  const [alarmClock, setAlarmClock] = useState(isClassAlarmClockEnabled)
  const [minutes, setMinutes] = useState(getRemindMinutes)
  const [draft, setDraft] = useState(() => String(getRemindMinutes()))
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [effects, setEffects] = useState(getClassReminderEffects)
  const [permissions, setPermissions] = useState<Awaited<ReturnType<typeof getReminderPermissionState>> | null>(null)
  const alive = useRef(true)
  const running = useRef(false)
  const permissionRequest = useRef(0)
  useEffect(() => {
    alive.current = true
    const refresh = () => {
      setEffects(getClassReminderEffects())
      setAlarmClock(isClassAlarmClockEnabled())
      if (isAndroidNative()) {
        const request = ++permissionRequest.current, channelId = getReminderPresentation('class-soon').channelId
        void getReminderPermissionState(channelId).then((value) => { if (alive.current && request === permissionRequest.current && channelId === getReminderPresentation('class-soon').channelId) setPermissions(value) })
      }
    }
    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('native-reminder-resume', refresh)
    window.addEventListener(REMINDER_STYLE_EVENT, refresh)
    return () => { alive.current = false; window.removeEventListener('focus', refresh); window.removeEventListener('native-reminder-resume', refresh); window.removeEventListener(REMINDER_STYLE_EVENT, refresh) }
  }, [])

  async function update(key: string, persist: () => void, preflight?: () => Promise<void>) {
    if (running.current) return
    const owner = captureQbankSession()
    running.current = true
    setBusy(key); setError(''); setMessage('')
    let saved = false
    try {
      if (preflight) await preflight()
      if (!alive.current || !isQbankSessionCurrent(owner)) return
      persist()
      saved = true
      setEnabled(isClassRemindEnabled()); setSoon(isClassSoonRemindEnabled()); setStart(isClassStartRemindEnabled())
      setAlarmClock(isClassAlarmClockEnabled())
      setEffects(getClassReminderEffects())
      const nextMinutes = getRemindMinutes()
      setMinutes(nextMinutes)
      if (key === 'minutes') setDraft(String(nextMinutes))
      const result = await rescheduleClassReminders()
      if (alive.current && isQbankSessionCurrent(owner)) {
        if (/失败|未能|未授予|未允许|部分提醒/.test(result.message)) setError(`设置已保存，但提醒未能更新：${result.message}`)
        else setMessage(`设置已保存。${result.message}`)
        if (isAndroidNative()) {
          const request = ++permissionRequest.current, channelId = getReminderPresentation('class-soon').channelId
          const nextPermissions = await getReminderPermissionState(channelId)
          if (alive.current && isQbankSessionCurrent(owner) && request === permissionRequest.current && channelId === getReminderPresentation('class-soon').channelId) setPermissions(nextPermissions)
        }
      }
    } catch (cause) {
      if (alive.current && isQbankSessionCurrent(owner)) setError(`${saved ? '设置已保存，但提醒未能更新：' : ''}${(cause as Error).message || '请重试。'}`)
    } finally {
      running.current = false
      if (alive.current && isQbankSessionCurrent(owner)) setBusy('')
    }
  }

  function changeEffect(key: 'sound' | 'vibration') {
    void update(key, () => setClassReminderEffects({ sound: key === 'sound' ? !effects.sound : effects.sound, vibration: key === 'vibration' ? !effects.vibration : effects.vibration }), async () => {
      if (isAndroidNative()) {
        const capability = await getReminderPermissionState(getReminderPresentation('class-soon').channelId)
        if (!capability.supported) throw new Error(capability.error || '请先安装新版 APK，再单独设置铃声与震动。当前提醒计划未改变。')
        if (!capability.state?.courseChannelsSupported) throw new Error('当前安卓系统不支持独立课程通知渠道。请在系统通知设置中调整铃声与震动；原提醒设置与计划保留。')
      } else if (IS_NATIVE) throw new Error('当前手机请在系统通知设置中调整铃声与震动。')
    })
  }

  function changeAlarmClock() {
    void update('alarm-clock', () => setClassAlarmClockEnabled(!alarmClock), async () => {
      const capability = await getReminderPermissionState(getReminderPresentation('class-soon').channelId)
      if (!capability.supported || !capability.state) throw new Error(`${capability.error || '无法确认手机准时提醒能力，请返回后重试。'}原提醒计划未改变。`)
      if (!capability.state.courseAlarmClockSupported) throw new Error('请先安装 1.2.130 或更新版本 APK，才能设置系统闹钟准时提醒。原提醒计划未改变。')
    })
  }

  async function openSettings(key: string, action: () => Promise<string | null>) {
    if (running.current) return
    const owner = captureQbankSession()
    running.current = true; setBusy(key); setError(''); setMessage('')
    try {
      const reason = await action()
      if (reason) throw new Error(reason)
      if (alive.current && isQbankSessionCurrent(owner)) setMessage('已打开系统设置。完成后返回，页面会重新检查；系统是否允许以返回后的状态为准。')
    } catch (cause) { if (alive.current && isQbankSessionCurrent(owner)) setError((cause as Error).message || '无法打开设置，请重试。') }
    finally { running.current = false; if (alive.current && isQbankSessionCurrent(owner)) setBusy('') }
  }
  const phone = permissions?.state
  const stateLabel = (value: boolean | null | undefined, yes = '已允许', no = '未允许') => value == null ? '未确认' : value ? yes : no

  function saveMinutes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = Number(draft)
    if (!draft.trim() || !Number.isInteger(value) || value < 5 || value > 60) {
      setFieldError('请输入 5～60 之间的整数分钟。')
      return
    }
    setFieldError('')
    void update('minutes', () => setRemindMinutes(value))
  }

  return <section className={styles.panel} aria-labelledby="course-reminder-title" aria-busy={!!busy}>
    <h3 id="course-reminder-title">上课提醒</h3>
    <p className={styles.intro}>按自己的习惯选择课前、开课时提醒，或同时开启。</p>
    <button type="button" role="switch" aria-label="上课提醒" aria-checked={enabled} className={styles.row} disabled={!!busy} onClick={() => void update('enabled', () => setClassRemindEnabled(!enabled))}>
      <span><strong>上课提醒</strong><small>{enabled ? '已开启，按下面选择的时点提醒' : '已关闭，课程通知与 App 内提醒均不显示'}</small></span><span className={styles.state}>{enabled ? '开' : '关'}</span>
    </button>
    {enabled ? <>
      <button type="button" role="switch" aria-label="课前提醒" aria-checked={soon} className={styles.row} disabled={!!busy} onClick={() => void update('soon', () => setClassSoonRemindEnabled(!soon))}>
        <span><strong>课前提醒</strong><small>{soon ? `当前提前 ${minutes} 分钟，留出准备和去教室的时间` : '不提前提醒，可只保留开课时提醒'}</small></span><span className={styles.state}>{soon ? '开' : '关'}</span>
      </button>
      {soon ? <form className={styles.timeForm} onSubmit={saveMinutes} noValidate>
        <label htmlFor="course-reminder-minutes">课前提前时间</label>
        <div className={styles.timeInput}><input id="course-reminder-minutes" type="number" inputMode="numeric" min={5} max={60} step={1} value={draft} disabled={!!busy} aria-invalid={!!fieldError} aria-describedby="course-reminder-time-hint" onChange={(event) => { setDraft(event.target.value); setFieldError('') }} /><span>分钟</span></div>
        <p id="course-reminder-time-hint" role={fieldError ? 'alert' : undefined} className={fieldError ? styles.error : styles.hint}>{fieldError || '支持 5～60 分钟。输入或选择时间后，点击保存生效。'}</p>
        <div className={styles.presets} aria-label="常用提前时间">{[5, 10, 15, 20, 30, 60].map((value) => <button key={value} type="button" aria-pressed={draft === String(value)} disabled={!!busy} onClick={() => { setDraft(String(value)); setFieldError('') }}>{value} 分钟</button>)}</div>
        <button type="submit" className={styles.save} disabled={!!busy}>{busy === 'minutes' ? '正在更新提醒…' : '保存提前时间'}</button>
      </form> : null}
      <button type="button" role="switch" aria-label="开课时提醒" aria-checked={start} className={styles.row} disabled={!!busy} onClick={() => void update('start', () => setClassStartRemindEnabled(!start))}>
        <span><strong>开课时提醒</strong><small>{start ? '课程开始时再提醒一次' : '课程开始时不再提醒，减少打扰'}</small></span><span className={styles.state}>{start ? '开' : '关'}</span>
      </button>
      {!soon && !start ? <p className={styles.hint} role="status">两个时点均已关闭，目前不会安排课程提醒。可开启其中一项。</p> : null}
      {isAndroidNative() ? <>
        <button type="button" role="switch" aria-label="系统闹钟准时提醒" aria-checked={alarmClock} className={styles.row} disabled={!!busy} onClick={changeAlarmClock}><span><strong>系统闹钟准时提醒</strong><small>{alarmClock ? '允许精确闹钟后，课程使用系统闹钟方式，减少休眠合并延迟；系统会显示下次闹钟图标' : '使用普通课程通知排程，手机休眠时可能延后'}</small></span><span className={styles.state}>{alarmClock ? '开' : '关'}</span></button>
        {alarmClock && permissions?.supported && phone && !phone.courseAlarmClockSupported ? <p className={styles.warning} role="status">当前 APK 未提供新的准时排程能力，请先安装 1.2.130 或更新版本。原有课程通知继续按旧方式处理。</p> : alarmClock && (!permissions?.supported || !phone) ? <p className={styles.warning} role="status">尚未确认手机准时提醒能力，请等待检查或稍后重试。</p> : alarmClock && phone?.exactAlarmAllowed !== true ? <p className={styles.warning} role="status">{phone?.exactAlarmAllowed === false ? '精确闹钟未允许，暂按普通通知安排，系统可能延后。请在下面“闹钟和提醒”中允许。' : '精确闹钟权限尚未确认，暂不能确认系统闹钟准时方式已生效。'}</p> : null}
      </> : null}
      <div className={styles.effects} aria-labelledby="course-reminder-effects-title">
        <h4 id="course-reminder-effects-title">铃声与震动</h4>
        <button type="button" role="switch" aria-label="课程铃声提醒" aria-checked={effects.sound} className={styles.row} disabled={!!busy} onClick={() => changeEffect('sound')}><span><strong>铃声提醒</strong><small>{effects.sound ? '到点使用当前课程通知渠道的铃声' : '课程通知不播放铃声，可独立保留震动'}</small></span><span className={styles.state}>{effects.sound ? '开' : '关'}</span></button>
        <button type="button" role="switch" aria-label="课程震动提醒" aria-checked={effects.vibration} className={styles.row} disabled={!!busy} onClick={() => changeEffect('vibration')}><span><strong>震动提醒</strong><small>{effects.vibration ? '到点震动；需手机具备震动功能' : '课程通知不震动，可独立保留铃声'}</small></span><span className={styles.state}>{effects.vibration ? '开' : '关'}</span></button>
        <p className={styles.hint}>{effects.configured ? '已单独选择效果，优先于下方提醒样式的默认音效。两项都关仍保留通知。系统音量、静音、勿扰和渠道自定义仍会影响实际效果。' : '目前跟随原通知渠道，保留你在手机系统里选择的铃声与震动。修改开关后会为该组合使用独立课程渠道。'}</p>
        <button type="button" className={styles.settingsButton} disabled={!!busy || !isAndroidNative()} onClick={() => void openSettings('ringtone', async () => { const presentation = await import('../lib/reminder-presentation').then((module) => module.prepareReminderPresentation('class-soon')); return openChannelSettings(presentation.channelId) })}>选择具体铃声与锁屏显示<span aria-hidden="true">›</span></button>
        {!IS_NATIVE ? <p className={styles.hint}>网页版只在页面运行时尝试播放提示音和震动，浏览器可能需要先点击页面。手机后台与锁屏提醒请使用安卓 App。</p> : null}
      </div>
    </> : null}
    {isAndroidNative() ? <details className={styles.permissions} open><summary>手机权限与声音状态</summary>
      <p className={styles.hint}>返回哦狐时自动检查。只检查当前状态，不会替你改变手机音量或勿扰。</p>
      {permissions?.supported ? <>
        <button type="button" className={styles.permissionRow} disabled={!!busy} onClick={() => void openSettings('notify', openNotificationSettings)}><span><strong>通知权限</strong><small>允许横幅、通知栏与锁屏通知</small></span><span>{stateLabel(phone?.notificationsEnabled)} ›</span></button>
        <button type="button" className={styles.permissionRow} disabled={!!busy} onClick={() => void openSettings('exact', async () => await requestExactAlarm() ? null : '尚未允许精确闹钟，系统可能延后提醒。请在“闹钟和提醒”中允许。')}><span><strong>闹钟和提醒</strong><small>准点提醒所需的精确闹钟权限</small></span><span>{stateLabel(phone?.exactAlarmAllowed)} ›</span></button>
        <button type="button" className={styles.permissionRow} disabled={!!busy} onClick={() => void openSettings('battery', openBatteryOptimization)}><span><strong>电池与后台运行</strong><small>减少部分手机的后台限制</small></span><span>{stateLabel(phone?.batteryOptimizationIgnored, '不受优化限制', '受优化限制')} ›</span></button>
        <button type="button" className={styles.permissionRow} disabled={!!busy} onClick={() => void openSettings('channel', async () => { const presentation = await import('../lib/reminder-presentation').then((module) => module.prepareReminderPresentation('class-soon')); return openChannelSettings(presentation.channelId) })}><span><strong>当前课程渠道</strong><small>{phone?.channelExists ? `声音${stateLabel(phone.channelSoundEnabled, '已配置', '未配置')} · 震动${stateLabel(phone.channelVibrationEnabled, '开', '关')}${phone.channelImportance != null && phone.channelImportance > 0 && phone.channelImportance < 3 ? ' · 安静通知，不发声' : ''}` : '第一次安排提醒后创建，也可点此设置'}</small></span><span>{phone?.channelExists ? phone.channelImportance === 0 ? '已关闭' : phone.channelImportance != null && phone.channelImportance < 3 ? '安静通知' : '已创建' : phone?.channelExists === false ? '待创建' : '未确认'} ›</span></button>
        <p className={styles.phoneStatus}>手机状态：{phone?.ringerMode === 'normal' ? '正常响铃' : phone?.ringerMode === 'vibrate' ? '震动模式' : phone?.ringerMode === 'silent' ? '静音模式' : '响铃模式未确认'} · 通知音量 {phone?.notificationVolume == null || phone.notificationMaxVolume == null ? '未确认' : `${phone.notificationVolume}/${phone.notificationMaxVolume}`}。{phone?.interruptionFilter === 'all' ? '勿扰已关闭。' : phone?.interruptionFilter === 'unknown' || !phone ? '勿扰状态未确认。' : '勿扰已开启，可能拦截声音或震动。'}{phone?.hasVibrator === false ? '此设备未检测到震动硬件。' : ''}</p>
        {effects.configured && phone?.channelExists && ((effects.sound && phone.channelSoundEnabled === false) || (effects.vibration && phone.channelVibrationEnabled === false)) ? <p className={styles.warning} role="status">当前系统渠道与上面的选择不一致。请点“当前课程渠道”允许相应铃声或震动，再做一次自检。</p> : null}
      </> : <p className={styles.hint} role="status">{permissions?.error || (permissions ? '请安装新版 APK 查看详细状态。' : '正在检查手机提醒能力…')}</p>}
      <button type="button" className={styles.settingsButton} disabled={!!busy} onClick={() => void openSettings('autostart', openAutostartGuide)}>自启动与厂商后台设置<span aria-hidden="true">›</span></button>
    </details> : null}
    <p className={styles.hint}>课表同步或设置变化后会更新提醒计划。课程提醒到原定时间 1 分钟后作废；课前提醒最晚在开课时作废，开课提醒最晚在下课时作废。通知显示、铃声和震动仍以手机权限、音量与系统渠道设置为准。</p>
    {busy ? <p className={styles.hint} role="status">正在更新提醒计划…</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : message ? <p className={styles.feedback} role="status">{message}</p> : null}
  </section>
}
