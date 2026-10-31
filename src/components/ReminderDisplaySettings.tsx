import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CampusIcon } from './CampusIcon'
import { ReminderPopup } from './ReminderPopup'
import { IS_NATIVE } from '../lib/platform'
import { isAndroidNative, openAutostartGuide, openChannelSettings } from '../lib/keep-alive'
import { getReminderBootState, setReminderBootRestoreEnabled } from '../lib/reminder-boot'
import { getCourseReminderPlanState } from '../lib/reminder-plan'
import { scheduleTestReminder } from '../lib/reminder-self-test'
import { rescheduleClassReminders } from '../lib/class-remind'
import { getReminderStyle, prepareReminderPresentation, REMINDER_STYLE_OPTIONS, setReminderStyle, type ReminderStyle } from '../lib/reminder-presentation'
import { getReminderPopupStyle, REMINDER_POPUP_OPTIONS, setReminderPopupStyle, subscribeReminderPopup, type ReminderCard } from '../lib/reminder-popup'
import { getReminderOverlayState, requestReminderOverlayPermission, setReminderOverlayEnabled, showReminderOverlayPreview } from '../lib/reminder-overlay'
import { captureQbankSession, isQbankSessionCurrent, subscribeQbank } from '../lib/qbank'
import { checkReminderHealth, type ReminderHealth } from '../lib/notify-setup'
import { findScheduleSchool, readScheduleSchool } from '../lib/schedule-schools'
import styles from './ReminderDisplaySettings.module.css'

const sample: ReminderCard = { id: 'settings-preview', kind: 'class-soon', title: '样式预览 · 课前提醒', name: '下一节课程', detail: '课程时间 · 上课地点', hint: '这是界面预览，未安排通知，也不会播放声音或震动。', route: '/schedule', actionLabel: '查看课表' }
type PendingSummary = { type: string; at: number }
type ReminderDiagnostics = { uid: string; health: ReminderHealth; pendingCount: number | null; next: PendingSummary | null; error: string }
const reminderLabels: Record<string, string> = { class: '上课', exam: '考试', todo: '待办', cert: '考证' }

async function readReminderDiagnostics(session = captureQbankSession()): Promise<ReminderDiagnostics> {
  let error = '', pendingCount: number | null = null, next: PendingSummary | null = null
  let health: ReminderHealth
  try { health = await checkReminderHealth() }
  catch (cause) { health = { native: IS_NATIVE, display: 'unavailable', exactAlarm: null, canSchedule: false, error: (cause as Error)?.message || '无法读取提醒权限' } }
  if (IS_NATIVE && session.uid) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      const result = await LocalNotifications.getPending(), now = Date.now()
      const items = result.notifications.flatMap((item) => {
        const extra = item.extra as Record<string, unknown> | undefined
        const type = typeof extra?.type === 'string' ? extra.type : ''
        const at = item.schedule?.at ? new Date(item.schedule.at).getTime() : NaN
        return extra?.ownerUid === session.uid && Object.hasOwn(reminderLabels, type) && Number.isFinite(at) && at > now ? [{ type, at }] : []
      }).sort((a, b) => a.at - b.at)
      pendingCount = items.length
      next = items[0] ?? null
    } catch (cause) { error = (cause as Error)?.message || '无法读取手机已排提醒' }
  }
  return { uid: session.uid, health, pendingCount, next, error }
}

export function ReminderDisplaySettings() {
  const popup = useSyncExternalStore(subscribeReminderPopup, getReminderPopupStyle, () => 'banner' as const)
  const [style, setStyle] = useState(getReminderStyle)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [overlay, setOverlay] = useState<Awaited<ReturnType<typeof getReminderOverlayState>> | null>(null)
  const [boot, setBoot] = useState<Awaited<ReturnType<typeof getReminderBootState>> | null>(null)
  const [plan, setPlan] = useState<Awaited<ReturnType<typeof getCourseReminderPlanState>> | null>(null)
  const [diagnostics, setDiagnostics] = useState<ReminderDiagnostics | null>(null)
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false)
  const school = findScheduleSchool(readScheduleSchool())
  const alive = useRef(true)
  const diagnosticsRevision = useRef(0)
  const refreshDiagnostics = useCallback(() => {
    const revision = ++diagnosticsRevision.current
    const session = captureQbankSession()
    setDiagnosticsBusy(true)
    void readReminderDiagnostics(session).then((result) => {
      if (alive.current && revision === diagnosticsRevision.current && isQbankSessionCurrent(session)) setDiagnostics(result)
    }).catch((cause) => { if (alive.current) setError((cause as Error)?.message || '刷新提醒诊断失败') })
      .finally(() => { if (alive.current && revision === diagnosticsRevision.current) setDiagnosticsBusy(false) })
  }, [])
  useEffect(() => {
    alive.current = true
    const refresh = () => {
      void getReminderOverlayState().then((state) => { if (alive.current) setOverlay(state) }).catch(() => { if (alive.current) setError('暂时无法读取桌面覆盖状态，请重试。') })
      void getReminderBootState().then((state) => { if (alive.current) setBoot(state) }).catch(() => { if (alive.current) setError('暂时无法读取开机恢复设置，请重试。') })
      void getCourseReminderPlanState().then((state) => { if (alive.current) setPlan(state) }).catch(() => { if (alive.current) setError('暂时无法读取后台提醒计划，请重试。') })
    }
    refresh()
    refreshDiagnostics()
    const refreshAll = () => { refresh(); refreshDiagnostics() }
    window.addEventListener('focus', refreshAll)
    window.addEventListener('native-reminder-resume', refreshAll)
    const unsubscribeQbank = subscribeQbank(() => { setDiagnostics(null); refreshAll() })
    return () => { alive.current = false; unsubscribeQbank(); window.removeEventListener('focus', refreshAll); window.removeEventListener('native-reminder-resume', refreshAll) }
  }, [refreshDiagnostics])
  async function run(key: string, operation: () => Promise<string>) {
    if (busy) return
    setBusy(key); setError(''); setMessage('')
    try {
      const result = await operation()
      const currentPlan = await getCourseReminderPlanState().catch(() => null)
      if (alive.current) { setMessage(result); if (currentPlan) setPlan(currentPlan) }
    }
    catch (e) { if (alive.current) setError((e as Error).message || '操作未完成，请重试。') }
    finally { if (alive.current) setBusy('') }
  }
  const loading = (key: string, label: string) => busy === key ? <><span className={styles.spinner} aria-hidden="true" />正在处理…</> : label
  async function chooseStyle(next: ReminderStyle) {
    await run('style', async () => {
      setReminderStyle(next)
      if (alive.current) setStyle(next)
      const result = await rescheduleClassReminders()
      return result.message || '样式已保存，课表提醒计划已刷新。'
    })
  }
  const displayPermission = diagnostics?.health.display === 'granted' ? '已允许' : diagnostics?.health.display === 'denied' ? '已拒绝' : diagnostics?.health.display === 'prompt' ? '尚未授权' : diagnostics ? '无法读取' : '检查中'
  const exactPermission = diagnostics?.health.exactAlarm === true ? '已允许' : diagnostics?.health.exactAlarm === false ? '未允许，系统可能延后' : IS_NATIVE ? '未确认' : '网页不适用'
  const currentUid = diagnostics?.uid || ''
  const lastError = (plan?.ownerUid === currentUid ? plan.lastError : null) || (boot?.ownerUid === currentUid ? boot.lastError : null) || (overlay?.ownerUid === currentUid ? overlay.lastError : null) || ''
  return <div className={styles.panel} aria-busy={!!busy}>
    <h3>提醒的显示与声音</h3>
    <fieldset className={styles.group}>
      <legend>提醒诊断</legend>
      <p>查看当前账号、课表学校、系统权限和手机已保存的下一条提醒。此处只读取状态，不会自动请求权限或改动计划。</p>
      <div className={styles.row}><span className={styles.icon}><CampusIcon name="shield" size={22} /></span><span><strong>当前账号与学校</strong><small>{diagnostics?.uid ? `账号 ${diagnostics.uid.length > 10 ? `${diagnostics.uid.slice(0, 3)}…${diagnostics.uid.slice(-4)}` : diagnostics.uid} · 课表学校：${school?.name || '未选择'}` : `未登录或正在恢复账号 · 课表学校：${school?.name || '未选择'}`}</small></span></div>
      <div className={styles.row}><span className={styles.icon}><CampusIcon name="bell" size={22} /></span><span><strong>通知与准点能力</strong><small>通知权限：{displayPermission} · 精确闹钟：{exactPermission}</small></span></div>
      <div className={styles.row}><span className={styles.icon}><CampusIcon name="update" size={22} /></span><span><strong>下一条已排提醒</strong><small>{!IS_NATIVE ? '网页无法读取手机闹钟；关闭页面后不保证准点提醒。' : !diagnostics?.uid ? '登录当前账号后可检查其提醒计划。' : diagnostics?.next ? `${reminderLabels[diagnostics.next.type]} · ${new Date(diagnostics.next.at).toLocaleString()}` : diagnostics?.pendingCount === 0 ? '当前账号没有未来的系统提醒。' : '正在检查手机已保存的提醒…'}</small></span></div>
      {IS_NATIVE && diagnostics?.uid ? <p className={styles.note}>{diagnostics?.pendingCount === null ? '无法读取系统提醒数量。' : `手机已保存 ${diagnostics.pendingCount} 条当前账号的未来提醒。`}{plan?.supported && plan.ownerUid === diagnostics.uid ? ` 后台课表计划 ${plan.plannedCount} 条，活动 ${plan.activeCount} 条。` : ''}</p> : null}
      {lastError ? <p className={styles.error} role="status">最近的提醒计划错误：{lastError}</p> : null}
      {diagnostics?.error ? <p className={styles.error} role="status">状态读取失败：{diagnostics.error}</p> : null}
      <button type="button" className={styles.link} disabled={diagnosticsBusy} onClick={refreshDiagnostics}>{diagnosticsBusy ? '正在检查…' : '刷新诊断'}<span aria-hidden="true">↻</span></button>
    </fieldset>
    <fieldset className={styles.group}><legend>App 内显示</legend><p>默认轻量横幅；多条提醒依次展示，其余保留在列表。</p>
      <div className={styles.options}>{REMINDER_POPUP_OPTIONS.map((option) => <button key={option.value} type="button" aria-pressed={popup === option.value} onClick={() => { try { setReminderPopupStyle(option.value); setError(''); setMessage(`已选择${option.label}`) } catch { setError('无法保存样式，请重试。') } }}><strong>{option.label}</strong><small>{option.hint}</small></button>)}</div>
      <button type="button" className={styles.link} onClick={() => setPreview(true)}>预览当前弹窗<span aria-hidden="true">↗</span></button>
    </fieldset>
    <fieldset className={styles.group}><legend>安卓上课通知</legend><p>选择通知重要程度。铃声与震动可在上方单独开关；具体铃声在手机系统中选择。</p>
      <div className={styles.options}>{REMINDER_STYLE_OPTIONS.map((option) => <button key={option.value} type="button" disabled={!!busy} aria-pressed={style === option.value} onClick={() => void chooseStyle(option.value)}><strong>{option.label}</strong><small>{option.hint}</small></button>)}</div>
      <button type="button" className={styles.row} disabled={!!busy || !isAndroidNative()} onClick={() => void run('sound', async () => {
        const presentation = await prepareReminderPresentation('class-soon')
        const reason = await openChannelSettings(presentation.channelId)
        if (reason) throw new Error(reason)
        return '已打开系统通知设置。请选择声音与震动，返回后可安排自检。'
      })}><span className={styles.icon}><CampusIcon name="bell" size={22} /></span><span><strong>{loading('sound', '选择铃声、音乐与震动')}</strong><small>使用系统的声音选项；是否可选本地闹钟音乐以手机提供的功能为准</small></span><span aria-hidden="true">›</span></button>
      {!IS_NATIVE ? <p className={styles.note}>声音与震动的系统设置请在安卓 App 中使用。下面的弹窗预览可直接体验。</p> : <p className={styles.note}>普通、安静和重要使用不同通知渠道。已单独选择铃声或震动时，该选择优先于样式默认值；更换样式后可核对当前渠道，勿扰仍由手机控制。</p>}
    </fieldset>
    <fieldset className={styles.group}><legend>关机重启与后台提醒</legend>
      <div className={styles.row}><span className={styles.icon}><CampusIcon name="update" size={22} /></span><span><strong>开机恢复提醒</strong><small>{boot ? !boot.supported ? '请在新版安卓 App 中设置' : boot.enabled ? '已开启：重启后恢复已保存的未来提醒' : '已关闭：重启后需要打开 App 重新安排' : '正在读取状态…'}</small></span><button type="button" className={styles.switch} role="switch" aria-label="开机恢复提醒" aria-checked={boot?.enabled ?? false} disabled={!!busy || !boot?.supported} onClick={() => void run('boot', async () => {
        const desired = !boot?.enabled
        const state = await setReminderBootRestoreEnabled(desired)
        if (alive.current) setBoot(state)
        if (state.lastError || state.enabled !== desired) throw new Error(state.lastError || '开机恢复设置未保存，请重试。')
        return state.enabled ? '开机恢复已开启，重启后会恢复已保存、尚未过期的提醒。' : '开机恢复已关闭；当前已安排提醒仍保留，重启后请重新打开 App。'
      })}>{busy === 'boot' ? '…' : boot?.enabled ? '开' : '关'}</button></div>
      <button type="button" className={styles.row} disabled={!!busy || !isAndroidNative()} onClick={() => void run('autostart', async () => {
        const reason = await openAutostartGuide()
        if (reason) throw new Error(reason)
        return '已打开手机自启动设置，请允许哦狐自启动；具体名称以手机系统为准。'
      })}><span className={styles.icon}><CampusIcon name="shield" size={22} /></span><span><strong>{loading('autostart', '允许手机厂商自启动')}</strong><small>在手机设置中允许自启动与必要的后台运行，再返回检查</small></span><span aria-hidden="true">›</span></button>
      <button type="button" className={styles.link} disabled={!!busy || !boot?.supported || !boot.enabled} onClick={() => void run('reboot-test', async () => {
        const result = await scheduleTestReminder(180, { restoreAfterReboot: true })
        if (!result.ok) throw new Error(result.message)
        return result.message
      })}>{loading('reboot-test', '安排 3 分钟后的重启自检')}<span aria-hidden="true">↗</span></button>
      <p className={styles.note}>{plan?.supported ? plan.plannedCount ? `本机已保存 ${plan.plannedCount} 条未来课程提醒，手机后台滚动补排；当前活动计划 ${plan.activeCount} 条。` : '后台补排已支持。请同步课表并开启上课提醒，保存本学期计划。' : IS_NATIVE ? '此版本仅预排未来 7 天；更新安卓 App 后可使用后续后台补排。' : '网页版没有关闭后的后台提醒；请在新版安卓 App 使用课表自动补排。'}</p>
      {plan?.lastError ? <p className={styles.error} role="status">{plan.lastError}</p> : null}
      <details className={styles.guide}><summary>怎样设置，关闭 App 后也能提醒</summary>
        <ol><li>同步当前账号的课表，开启上课提醒，核对“已安排”数量。</li><li>允许通知与“闹钟和提醒”；在上课渠道中选择铃声、震动和锁屏显示。</li><li>开启“开机恢复提醒”。手机有自启动、后台运行或电池限制时，按系统页面允许哦狐。</li><li>用 1 分钟自检分别验证锁屏、后台和划掉最近任务；重启验证请选择上面的“3 分钟重启自检”，在到点前重启并解锁。</li></ol>
        <p>关机期间无法响铃。重启仅恢复已保存的未来计划，已过期提醒不补发；不会自动打开 App 首页。系统设置里的“强行停止”会暂停提醒，重新打开 App 后恢复。</p>
        <p>{plan?.supported ? '课表会保存已同步的本学期未来课程，手机后台每天滚动安排未来 7 天。' : '新版安卓 App 支持已同步学期课表的后台补排，旧版需打开 App 刷新未来 7 天计划。'}更改课表或进入新学期后，请重新同步；自启动不会自动获取新的云端课表。</p>
      </details>
      {boot?.lastError ? <p className={styles.error} role="status">{boot.lastError}</p> : null}
    </fieldset>
    <fieldset className={styles.group}><legend>覆盖手机桌面的提醒</legend><p>显示可关闭的小卡片，12 秒后收起。仅在亮屏且已解锁时显示。</p>
      <div className={styles.row}><span className={styles.icon}><CampusIcon name="grid" size={22} /></span><span><strong>桌面覆盖</strong><small>{overlay ? overlay.enabled ? `已开启 · ${overlay.pendingCount} 条待触发` : '默认关闭，开启前需要系统授权' : '正在读取状态…'}</small></span><button type="button" className={styles.switch} role="switch" aria-label="桌面覆盖提醒" aria-checked={overlay?.enabled ?? false} disabled={!!busy || !overlay?.supported || (!overlay.enabled && !overlay.permissionGranted)} onClick={() => void run('overlay', async () => {
        const desired = !overlay?.enabled
        const state = await setReminderOverlayEnabled(desired)
        if (alive.current) setOverlay(state)
        if (state.lastError || state.enabled !== desired) throw new Error(state.lastError || '开关未生效，请检查授权与登录状态。')
        if (state.enabled) {
          const result = await rescheduleClassReminders()
          const current = await getReminderOverlayState()
          if (alive.current) setOverlay(current)
          if (result.overlay?.status === 'failed') throw new Error(result.overlay.message)
          if (!current.enabled) throw new Error(current.lastError || '覆盖开关未保留，请检查课表提醒与系统权限后重试。')
          if (!current.pendingCount) return '桌面覆盖已开启，目前没有待触发的课程；保存有效课表并开启课表提醒后会安排计划。'
          return '已开启桌面覆盖，后续课程按当前课表计划触发。'
        }
        return '桌面覆盖已关闭，待触发的覆盖提醒已清理。'
      })}>{busy === 'overlay' ? '…' : overlay?.enabled ? '开' : '关'}</button></div>
      <div className={styles.buttons}><button type="button" disabled={!!busy || !overlay?.supported} onClick={() => void run('permission', async () => {
        const state = await requestReminderOverlayPermission()
        if (alive.current) setOverlay(state)
        if (state.lastError || (!state.permissionGranted && !state.openedSettings)) throw new Error(state.lastError || '未能打开系统授权，请在手机设置中手动检查。')
        return state.permissionGranted ? '系统已允许覆盖显示。可手动开启桌面覆盖。' : '已打开系统授权页面；允许后返回，再开启桌面覆盖。'
      })}>{loading('permission', overlay?.permissionGranted ? '检查覆盖权限' : '打开系统授权')}</button><button type="button" disabled={!!busy || !overlay?.supported || !overlay.permissionGranted || !overlay.enabled} onClick={() => void run('overlay-preview', async () => {
        const result = await showReminderOverlayPreview()
        if (alive.current) setOverlay(result.state)
        if (!result.shown) throw new Error(result.reason || '覆盖预览未显示，请检查权限与开关。')
        return '已显示桌面覆盖样例，本次预览没有声音、震动或后台通知。'
      })}>{loading('overlay-preview', '预览桌面覆盖')}</button></div>
      <p className={styles.note}>覆盖卡片和系统通知共用课程计划，不另发铃声。切换账号会关闭覆盖并清理计划。锁屏、强行停止与系统后台限制需在实际手机验证。</p>
      {overlay?.lastError ? <p className={styles.error} role="status">{overlay.lastError}</p> : null}
    </fieldset>
    {busy ? <p className={styles.note} role="status"><span className={styles.spinner} aria-hidden="true" />正在更新，请稍候…</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : message ? <p className={styles.feedback} role="status">{message}</p> : null}
    {preview ? <ReminderPopup item={sample} variant={popup} onDismiss={() => setPreview(false)} /> : null}
  </div>
}
