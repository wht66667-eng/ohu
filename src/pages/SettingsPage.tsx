import { OhuSharePanel } from '../components/SharePosterSheet'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { CampusIcon } from '../components/CampusIcon'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { DialogLayer } from '../components/ui/DialogLayer'
import { clearLocalAppDataAndReload } from '../lib/local-data-reset'
import { useAuth } from '../lib/auth'
import { useToast } from '../context/ToastContext'
import { fetchModerationPendingCount } from '../lib/moderation'
import { applyTheme, getStoredTheme, type Theme } from '../lib/theme'
import { IS_FDROID_BUILD } from '../lib/build-channel'
import {
  APP_VERSION,
  checkAppUpdate,
  formatNotes,
  openUpdateDownload,
  type UpdateManifest,
} from '../lib/app-update'
import {
  currentBundleVersion,
  getOtaCompatibilityError,
  diagnoseOta,
  downloadAndQueueOta,
  fetchOtaManifest,
  shouldApplyOta,
  type OtaDiagnosis,
} from '../lib/live-update'
import { getNativeAppVersion, type NativeAppVersion } from '../lib/app-version'
import { exactAlarmGranted, requestExactAlarm } from '../lib/alarm-notify'
import {
  isAndroidNative,
  isBatteryOptimizationIgnored,
  isKeepAliveRunning,
  isKeepAliveWanted,
  openAutostartGuide,
  openBatteryOptimization,
  openChannelSettings,
  openNotificationSettings,
  startKeepAlive,
  stopKeepAlive,
} from '../lib/keep-alive'
import { isFoxDockOn, setFoxDockOn } from '../lib/fox-dock-pref'
import { getLauncherMoodError, isLauncherMoodEnabled, LAUNCHER_MOOD_STATUS_EVENT, refreshLauncherMoodStatus, setLauncherMoodEnabled } from '../lib/app-icon'
import { scheduleTestReminder } from '../lib/reminder-self-test'
import { ReminderDisplaySettings } from '../components/ReminderDisplaySettings'
import { PermissionCenterCard } from '../components/PermissionCenterCard'
import { CourseReminderSettings } from '../components/CourseReminderSettings'
import { PluginMarketplace } from '../components/PluginMarketplace'
import { ExamReminderSettings } from '../components/ExamReminderSettings'
import { rescheduleClassReminders } from '../lib/class-remind'
import { getReminderPresentation } from '../lib/reminder-presentation'
import {
  getAlertSpeakEnabled,
  getAlertVibrateEnabled,
  setAlertSpeakEnabled,
  setAlertVibrateEnabled,
} from '../lib/alert-effects'
import { getAppShell, isWorkShell } from '../lib/app-shell'
import { showStudentRemindSettings } from '../lib/shell-guard'
import { QuietLoginStreak } from '../components/StreakBar'
import styles from './me.module.css'
import settingStyles from './settings.module.css'
import { resolveSettingsSection, SETTINGS_SECTION_TITLES, type SettingsSection } from '../lib/settings-section'
import { Pressable } from '../components/ui/advanced'
import { IS_NATIVE } from '../lib/platform'
import { UiThemeSettings } from '../components/fox/UiThemeSettings'
import { isFoxFreeVariant, useUiVariant } from '../lib/ui-variant'
import { FoxAvatar } from '../components/fox/FoxAvatar'
import { StorageDiagnostics } from '../components/StorageDiagnostics'
import { UserServiceLinksSettings } from '../components/UserServiceLinksSettings'

function SettingsLink({ icon, title, detail, onClick }: { icon: string; title: string; detail: string; onClick: () => void }) {
  return <Pressable className={settingStyles.menuRow} onClick={onClick}>
    <span className={settingStyles.menuIcon}><CampusIcon name={icon} /></span>
    <span className={settingStyles.menuBody}><strong>{title}</strong><small>{detail}</small></span>
    <span className={settingStyles.menuArrow} aria-hidden="true">›</span>
  </Pressable>
}

/**
 * 设置：账号动作（登录 / 退出）与提醒 / 外观 / 关于等偏好。
 * 2026-10 功能缩减：角色申请、小店入驻、钱包与财务入口随交易链一并移除。
 */

/**
 * 设置：账号动作（登录 / 退出）与角色工作台入口
 *
 * 「我的角色」以服务端 role_members 为唯一事实来源（auth.roles）：
 * 已开通 -> 彩色入口卡直达工作台；未开通 -> 申请入口；被驳回 -> 展示原因并支持修改重提。
 * 管理员额外显示审核台入口与待审数量徽标。
 */
export function SettingsPage() {
  const auth = useAuth()
  return <SettingsForAccount key={auth.isSigned ? auth.user?.uid : 'guest'} />
}

function SettingsForAccount() {
  const uiVariant = useUiVariant()
  const auth = useAuth()
  const toast = useToast()
  const nav = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const shell = getAppShell()
  const work = isWorkShell(shell)
  const studentRemind = showStudentRemindSettings(shell)
  const signed = auth.isSigned
  const isAdmin = auth.isSigned && !!(auth.profile?.isAdmin || auth.profile?.isSuperAdmin)
  const isSuperAdmin = !!auth.profile?.isSuperAdmin
  const showAdminBlock = signed && isAdmin && (shell === 'user' || shell === 'admin')
  const section = resolveSettingsSection(params.get('section'), { studentRemind, showAdminBlock, showData: !work, showLinks: !work, showInstall: !work })
  function openSection(next: SettingsSection) {
    const query = new URLSearchParams(params)
    query.set('section', next)
    setParams(query, { state: { settingsFromOverview: true } })
  }
  function backToSettings() {
    if (location.state?.settingsFromOverview) { nav(-1); return }
    const query = new URLSearchParams(params)
    query.delete('section')
    setParams(query, { replace: true })
  }

  const [modPending, setModPending] = useState<{ count: number | null; atLeast: boolean }>({ count: 0, atLeast: false })
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme())
  const [updateBusy, setUpdateBusy] = useState(false)
  const [availableUpdate, setAvailableUpdate] = useState<UpdateManifest | null>(null)
  const [nativeVersion, setNativeVersion] = useState<NativeAppVersion | null>(null)
  const [versionLoaded, setVersionLoaded] = useState(false)
  const [webVersion, setWebVersion] = useState(APP_VERSION)
  useEffect(() => {
    let alive = true
    void Promise.all([getNativeAppVersion(), currentBundleVersion()]).then(([native, web]) => {
      if (!alive) return
      setNativeVersion(native)
      setWebVersion(web)
      setVersionLoaded(true)
    }).catch(() => { if (alive) setVersionLoaded(true) })
    return () => { alive = false }
  }, [])
  const [remindBusy, setRemindBusy] = useState(false)
  const [alertVibrate, setAlertVibrate] = useState(() => getAlertVibrateEnabled())
  const [alertSpeak, setAlertSpeak] = useState(() => getAlertSpeakEnabled())
  const [foxOn, setFoxOn] = useState(() => isFoxDockOn())
  const [iconMoodOn, setIconMoodOn] = useState(() => isLauncherMoodEnabled())
  const [iconMoodBusy, setIconMoodBusy] = useState(false)
  const [iconMoodError, setIconMoodError] = useState(() => getLauncherMoodError())
  useEffect(() => {
    if (!isAndroidNative() || work) return
    const refresh = () => {
      setIconMoodError(getLauncherMoodError())
      setIconMoodOn(isLauncherMoodEnabled())
    }
    const onFocus = () => { void refreshLauncherMoodStatus() }
    window.addEventListener(LAUNCHER_MOOD_STATUS_EVENT, refresh)
    window.addEventListener('focus', onFocus)
    void refreshLauncherMoodStatus()
    return () => {
      window.removeEventListener(LAUNCHER_MOOD_STATUS_EVENT, refresh)
      window.removeEventListener('focus', onFocus)
    }
  }, [work])
  /** Android 提醒健康状态：系统闹钟负责准点响，常驻服务负责让进程活着（弹层 / 语音）。 */
  const isAndroidApp = isAndroidNative()
  const [keepAliveOn, setKeepAliveOn] = useState(() => isKeepAliveWanted())
  const [keepAliveRunning, setKeepAliveRunning] = useState(false)
  const [keepAliveBusy, setKeepAliveBusy] = useState(false)
  const [permCheck, setPermCheck] = useState<{
    notify: boolean | null
    exact: boolean | null
    battery: boolean | null
  }>({ notify: null, exact: null, battery: null })

  async function runPermCheck() {
    if (!isAndroidApp) return
    let notify: boolean | null = null
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      const st = await LocalNotifications.checkPermissions()
      notify = st.display === 'granted'
    } catch {
      notify = null
    }
    const exact = await exactAlarmGranted().catch(() => null)
    const battery = await isBatteryOptimizationIgnored()
    setPermCheck({ notify, exact, battery })
    setKeepAliveRunning(await isKeepAliveRunning())
    setKeepAliveOn(isKeepAliveWanted())
  }

  useEffect(() => {
    if (section !== 'reminders' || !isAndroidApp) return
    void runPermCheck()
    /* 从系统设置返回本页时刷新一次状态 */
    const onFocus = () => void runPermCheck()
    window.addEventListener('focus', onFocus)
    window.addEventListener('native-reminder-resume', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('native-reminder-resume', onFocus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, isAndroidApp])

  async function onCheckUpdate() {
    if (updateBusy || !IS_NATIVE) return
    setUpdateBusy(true)
    try {
      const r = await checkAppUpdate()
      if (r.status === 'error') {
        toast.err(`检查失败：${r.message}`)
        return
      }
      if (r.status === 'up_to_date') {
        const installed = await getNativeAppVersion()
        const version = installed ? `v${installed.version}（${installed.build}）` : '当前安装包'
        if (r.verifiedRemote) toast.ok(`${version} 已是最新安装包`)
        else toast(version + '，暂时无法确认线上最新版')
        return
      }
      setAvailableUpdate(r.manifest)
    } catch {
      toast.err('暂时无法检查新版本，请检查网络后重试。')
    } finally {
      setUpdateBusy(false)
    }
  }

  const [diag, setDiag] = useState<OtaDiagnosis | null>(null)
  const [diagBusy, setDiagBusy] = useState(false)
  const [diagOpen, setDiagOpen] = useState(false)
  const [diagError, setDiagError] = useState('')

  async function refreshDiag() {
    if (diagBusy) return
    setDiagBusy(true)
    setDiagError('')
    try {
      setDiag(await diagnoseOta())
    } catch {
      setDiagError('暂时无法读取更新状态，请检查网络后重试。')
    } finally {
      setDiagBusy(false)
    }
  }

  useEffect(() => {
    if (section !== 'about') setDiagOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section])

  async function onCheckOta() {
    if (updateBusy || !IS_NATIVE) return
    setUpdateBusy(true)
    try {
      const remote = await fetchOtaManifest()
      if (!remote) {
        toast('暂时连不上更新服务')
        return
      }
      const local = await currentBundleVersion()
      const compatibilityError = getOtaCompatibilityError(remote)
      if (compatibilityError) {
        toast.err(compatibilityError)
        return
      }
      if (!shouldApplyOta(remote, local)) {
        toast.ok('界面已是最新')
        return
      }
      toast(`发现界面更新 ${remote.version}，开始下载…`)
      const r = await downloadAndQueueOta(remote)
      if (r.ok) toast.ok('界面已切换到新版本')
      else toast.err(r.error)
    } catch {
      toast.err('界面更新未完成，请检查网络后重试。')
    } finally {
      setUpdateBusy(false)
    }
  }
  /** 游客点登录：走统一登录门控，成功后留在当前页 */
  async function login() {
    const ok = await auth.ensureSignedIn('登录后可发布闲置、接单与收藏')
    if (ok) toast.ok('登录成功')
  }

  /* 退出登录是不可逆操作，先二次确认，避免误触清空登录态 */
  const [askLogout, setAskLogout] = useState(false)
  const [askClearData, setAskClearData] = useState(false)

  async function logout() {
    await auth.logout()
    toast.ok('已退出登录')
  }

  useEffect(() => {
    if (!showAdminBlock || section !== 'admin') {
      setModPending({ count: 0, atLeast: false })
      return
    }
    let alive = true
    const load = async () => {
      const mc = await fetchModerationPendingCount()
      if (!alive) return
      setModPending(mc)
    }
    load()
    return () => {
      alive = false
    }
  }, [showAdminBlock, section])

  return (
    <div className={`${styles.page} ${settingStyles.page}`}>
      <PageHeader title={SETTINGS_SECTION_TITLES[section]} onBack={section === 'overview' ? undefined : backToSettings} />

      {section === 'overview' ? <>
        <p className={settingStyles.intro}>常用设置，按需调整。</p>
        <section className={settingStyles.menu} aria-label="应用设置分类">
          <SettingsLink icon="sun" title="外观与陪伴" detail={theme === 'system' ? '跟随系统主题' : theme === 'dark' ? '深色模式' : '浅色模式'} onClick={() => openSection('appearance')} />
          {studentRemind ? <SettingsLink icon="bell" title="通知与提醒" detail="提醒时点、弹窗样式与系统权限" onClick={() => openSection('reminders')} /> : null}
          <SettingsLink icon="shield" title="账号与安全" detail={signed ? '学号身份与退出' : '用学号开始'} onClick={() => openSection('account')} />
          {!work ? <SettingsLink icon="box" title="数据与缓存" detail="查看本机存储估算，不会自动清理" onClick={() => openSection('data')} /> : null}
          {!work ? <SettingsLink icon="update" title="更新数据" detail="重新登录校园系统，更新课表、成绩、考试" onClick={() => nav('/study/oneclick')} /> : null}
          <SettingsLink icon="update" title="哦狐科技" detail={`插件共创 · 管理员审核 · v${APP_VERSION}`} onClick={() => openSection('about')} />
          {!work ? <SettingsLink icon="link" title="网页快捷入口" detail="管理自己添加的校园网页" onClick={() => openSection('links')} /> : null}
          {!work ? <SettingsLink icon="link" title="安装与分享" detail="二维码、分享图与安装说明" onClick={() => openSection('install')} /> : null}
        </section>
        {showAdminBlock ? <section className={settingStyles.menu} aria-label="管理">
          <SettingsLink icon="flag" title="管理工作台" detail={isSuperAdmin ? '内容治理、举报与成员管理' : '内容治理与举报处理'} onClick={() => openSection('admin')} />
        </section> : null}
      </> : null}

      {section === 'links' && !work ? <>
        <p className={settingStyles.intro}>把常用的校园网页放在一起，入口只保存在这台设备上。</p>
        <UserServiceLinksSettings />
      </> : null}

      {section === 'install' && !work ? <OhuSharePanel /> : null}

      {section === 'appearance' ? (
      <section className={styles.sec} style={{ paddingTop: 6 }}>
        <h3>外观</h3>
        {work ? null : <UiThemeSettings />}
        <div className={settingStyles.themeChoices} role="group" aria-label="主题模式">
          {(['light', 'dark', 'system'] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              className={settingStyles.themeChoice}
              aria-pressed={theme === opt}
              onClick={() => {
                setTheme(opt)
                applyTheme(opt)
              }}
            >
              <CampusIcon name={opt === 'light' ? 'sun' : opt === 'dark' ? 'moon' : 'grid'} size={20} />
              {opt === 'light' ? '浅色' : opt === 'dark' ? '深色' : '跟随系统'}
            </button>
          ))}
        </div>
        {!work ? <button type="button" className={styles.setRow} onClick={() => nav('/?customize=home')}>
          <span className={styles.setIc} style={{ background: 'var(--green-soft)' }}><CampusIcon name="grid" /></span>
          <span className={styles.setGrow}><b>首页内容卡片</b><span>选择首页显示内容并调整顺序</span></span>
          <span className={styles.setArrow}>›</span>
        </button> : null}
        {work || uiVariant === 'minimal' ? null : (
          <button
            type="button"
            className={styles.setRow}
            style={{ marginTop: 12 }}
            onClick={() => {
              const next = !foxOn
              setFoxDockOn(next)
              setFoxOn(next)
              toast(next ? '陪伴已显示' : '陪伴已收起')
            }}
          >
            <span className={styles.setIc} style={{ background: uiVariant === 'cute' ? 'var(--fox-paw)' : '#fff3e0' }}>
              <FoxAvatar pose="chat" size={32} ring={false} alt="" />
            </span>
            <span className={styles.setGrow}>
              <b>陪伴角色</b>
              <span>
                {foxOn
                  ? '已开启：各皮肤均显示宠物，可拖动、点开菜单或自定义图片'
                  : '已收起：打开后显示宠物，外观设置支持更换图片'}
              </span>
            </span>
            <span className={styles.setArrow}>{foxOn ? '开' : '关'}</span>
          </button>
        )}
        {!work && isAndroidApp && !isFoxFreeVariant(uiVariant) ? (
          <button
            type="button"
            className={styles.setRow}
            style={{ marginTop: 12 }}
            disabled={iconMoodBusy}
            aria-pressed={iconMoodOn}
            onClick={async () => {
              if (iconMoodBusy) return
              const next = !iconMoodOn
              setIconMoodBusy(true)
              try {
                const result = await setLauncherMoodEnabled(next)
                setIconMoodOn(next)
                toast(result.pending
                  ? `${next ? '变脸已开启' : '变脸已关闭'}，回到桌面后更新图标`
                  : next ? '桌面图标变脸已开启' : '桌面图标变脸已关闭')
              } catch (error) {
                setIconMoodOn(isLauncherMoodEnabled())
                toast(error instanceof Error ? error.message : '桌面图标设置未成功，请重试')
              } finally {
                setIconMoodBusy(false)
              }
            }}
          >
            <span className={styles.setIc} style={{ background: uiVariant === 'minimal' ? 'var(--mint)' : uiVariant === 'cute' ? 'var(--fox-paw)' : '#fff3e0' }}>
              {uiVariant === 'minimal' ? <CampusIcon name="grid" size={24} /> : <FoxAvatar pose="avatar" size={32} ring={false} alt="" />}
            </span>
            <span className={styles.setGrow}>
              <b>桌面图标变脸</b>
              <span>
                {iconMoodError || (iconMoodOn
                  ? '已开启：常来是元气脸，几天没来会换成想念脸'
                  : '默认关闭；主动开启后，桌面图标才会随陪伴变化')}
              </span>
            </span>
            <span className={styles.setArrow}>{iconMoodBusy ? '设置中' : iconMoodOn ? '开' : '关'}</span>
          </button>
        ) : null}
      </section>
      ) : null}

      {section === 'reminders' && studentRemind ? (
      <section className={styles.sec} style={{ paddingTop: 6 }}>
        <CourseReminderSettings />
        <ExamReminderSettings />
        <ReminderDisplaySettings />
        <PermissionCenterCard />
        <button
          type="button"
          className={styles.setRow}
          disabled={remindBusy}
          onClick={async () => {
            if (remindBusy) return
            setRemindBusy(true)
            try {
              const r = await scheduleTestReminder(60)
              if (r.ok) toast.ok(r.message)
              else toast(r.message)
            } finally {
              setRemindBusy(false)
            }
          }}
        >
          <span className={styles.setIc} style={{ background: '#eef5ff' }}>
            <CampusIcon name="shield" size={20} />
          </span>
          <span className={styles.setGrow}>
            <b>自检提醒</b>
            <span>安排 1 分钟后的通知，分别观察锁屏、后台和划掉 App 后的实际到达时间</span>
          </span>
          <span className={styles.setArrow}>›</span>
        </button>
        <button
          type="button"
          className={styles.setRow}
          style={{ marginTop: 10 }}
          onClick={() => {
            const next = !alertVibrate
            setAlertVibrateEnabled(next)
            setAlertVibrate(next)
            toast(next ? '网页版震动反馈已开' : '网页版震动反馈已关')
          }}
        >
          <span className={styles.setIc} style={{ background: '#fff0e6' }}>
            <CampusIcon name="flash" size={20} />
          </span>
          <span className={styles.setGrow}>
            <b>网页版内的震动反馈</b>
            <span>网页版打开时的短震动；安卓 App 的声音与震动使用上面的系统通知渠道设置</span>
          </span>
          <span className={styles.setArrow}>{alertVibrate ? '开' : '关'}</span>
        </button>
        <button
          type="button"
          className={styles.setRow}
          disabled={remindBusy}
          onClick={async () => {
            setRemindBusy(true)
            try {
              const before = await exactAlarmGranted()
              const ok = before || (await requestExactAlarm())
              if (ok) {
                const r = await rescheduleClassReminders()
                toast(r.message || '精确闹钟已允许')
              } else {
                toast('还没允许精确闹钟，到点可能被系统推迟')
              }
            } catch (e) {
              toast((e as Error).message || '无法打开闹钟权限')
            } finally {
              setRemindBusy(false)
            }
          }}
        >
          <span className={styles.setIc} style={{ background: '#e7f6d8' }}>
            ⏰
          </span>
          <span className={styles.setGrow}>
            <b>允许精确闹钟</b>
            <span>关闭 App 后仍准时震动。安卓 12 以上需要在系统里点允许</span>
          </span>
          <span className={styles.setArrow}>›</span>
        </button>
        <button
          type="button"
          className={styles.setRow}
          disabled={keepAliveBusy}
          onClick={async () => {
            if (keepAliveBusy) return
            setKeepAliveBusy(true)
            try {
              if (keepAliveOn) {
                const r = await stopKeepAlive()
                if (!r.ok) { toast(r.error || '关闭常驻提醒失败'); return }
                setKeepAliveOn(false)
                setKeepAliveRunning(false)
                toast.ok('常驻提醒已关闭')
                return
              }
              const r = await startKeepAlive()
              if (!r.ok) { toast(r.error || '开启常驻提醒失败'); return }
              setKeepAliveOn(true)
              setKeepAliveRunning(await isKeepAliveRunning())
              toast.ok('常驻提醒已开启')
            } finally {
              setKeepAliveBusy(false)
            }
          }}
        >
          <span className={styles.setIc} style={{ background: '#eef5ff' }}>
            <CampusIcon name="bell" size={20} />
          </span>
          <span className={styles.setGrow}>
            <b>常驻提醒通知</b>
            <span>
              {keepAliveOn
                ? keepAliveRunning
                  ? '运行中：通知栏常驻「下次提醒」，App 在后台也会弹窗与播报'
                  : '已开启但服务未运行，重新打开 App 会自动挂回'
                : '可选：把进程留在后台，App 内弹层与语音也能到点触发'}
            </span>
          </span>
          <span className={styles.setArrow}>{keepAliveOn ? '开' : '关'}</span>
        </button>
        <button
          type="button"
          className={styles.setRow}
          onClick={() => {
            const next = !alertSpeak
            setAlertSpeakEnabled(next)
            setAlertSpeak(next)
            toast(next ? '提醒语音已开' : '提醒语音已关')
          }}
        >
          <span className={styles.setIc} style={{ background: '#eef5ff' }}>
            🔊
          </span>
          <span className={styles.setGrow}>
            <b>提醒语音</b>
            <span>弹窗时朗读提醒内容（安静场合可关）</span>
          </span>
          <span className={styles.setArrow}>{alertSpeak ? '开' : '关'}</span>
        </button>

        {isAndroidApp ? (
          <>
            <div className={styles.setRow}>
              <span className={styles.setIc} style={{ background: '#e6f7ef' }}>
                🛡️
              </span>
              <span className={styles.setGrow}>
                <b>后台系统提醒</b>
                <span>
                  提醒交由系统计划，到点无需应用常驻。请允许通知；未允许精确闹钟时可能延迟。
                </span>
              </span>
              <span className={styles.setArrow}>{permCheck.notify === null ? '检查中' : permCheck.notify ? '已允许通知' : '待授权'}</span>
            </div>

            <p className={styles.hint} style={{ marginTop: 10 }}>
              通知权限体检（系统强行停止、渠道关闭和系统限制仍可能影响提醒）
            </p>
            {(
              [
                {
                  key: 'notify',
                  icon: '🔔',
                  label: '通知权限',
                  ok: permCheck.notify,
                  okText: '已允许',
                  noText: '未允许',
                  desc: '所有提醒的总开关',
                  onGo: async () => {
                    const err = await openNotificationSettings()
                    if (err) toast(err)
                  },
                },
                {
                  key: 'exact',
                  icon: '⏰',
                  label: '精确闹钟',
                  ok: permCheck.exact,
                  okText: '已允许',
                  noText: '未允许',
                   desc: '安卓 12+ 到点提醒所需；未允许时可能延迟',
                  onGo: async () => {
                    const ok = await requestExactAlarm()
                    if (!ok) toast('还没允许精确闹钟，到点可能被系统推迟')
                    await runPermCheck()
                  },
                },
                {
                  key: 'battery',
                  icon: '🔋',
                  label: '电池优化',
                  ok: permCheck.battery,
                  okText: '已设为无限制',
                  noText: '受系统限制',
                   desc: '可减少部分机型的后台限制，由你按需要设置',
                  onGo: async () => {
                    const err = await openBatteryOptimization()
                    if (err) toast(err)
                  },
                },
              ] as const
            ).map((item) => (
              <div key={item.key} className={styles.setRow} style={{ cursor: 'default' }}>
                <span
                  className={styles.setIc}
                  style={{ background: item.ok ? '#e6f7ef' : item.ok === false ? '#fdecec' : '#eef1f6' }}
                >
                  {item.icon}
                </span>
                <span className={styles.setGrow}>
                  <b>
                    {item.label}
                    <span style={{ marginLeft: 6, fontWeight: 400, color: item.ok ? '#2f8f46' : '#c0453a' }}>
                      {item.ok === null ? '…' : item.ok ? `· ${item.okText}` : `· ${item.noText}`}
                    </span>
                  </b>
                  <span>{item.desc}</span>
                </span>
                {item.ok === true ? (
                  <span className={styles.setArrow}>✓</span>
                ) : (
                  <button
                    type="button"
                    style={{
                      flex: 'none',
                      border: 'none',
                      borderRadius: 999,
                      padding: '6px 12px',
                      background: 'var(--green)',
                      color: '#fff',
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                    onClick={() => void item.onGo()}
                  >
                    去开启
                  </button>
                )}
              </div>
            ))}

            <button
              type="button"
              className={styles.setRow}
              onClick={() => {
                // 直达「上课闹钟」渠道详情页：悬浮通知 / 声音 / 振动 / 锁屏显示都在这一页。
                void openChannelSettings(getReminderPresentation('class-soon').channelId).then((err) => err && toast(err))
              }}
            >
              <span className={styles.setIc} style={{ background: '#eef1f6' }}>
                <CampusIcon name="bell" size={20} />
              </span>
              <span className={styles.setGrow}>
                <b>上课闹钟渠道（悬浮 / 声音 / 振动 / 锁屏）</b>
                <span>在当前上课通知渠道中选择横幅、声音、震动与锁屏显示；实际选项以手机系统为准</span>
              </span>
              <span className={styles.setArrow}>›</span>
            </button>
            <button
              type="button"
              className={styles.setRow}
              onClick={() => {
                void openAutostartGuide().then((err) => err && toast(err))
              }}
            >
              <span className={styles.setIc} style={{ background: '#eef1f6' }}>
                🚀
              </span>
              <span className={styles.setGrow}>
                <b>自启动 / 后台运行</b>
                <span>小米、华为、OPPO 需手动允许，否则长期不开 App 后闹钟可能推迟</span>
              </span>
              <span className={styles.setArrow}>›</span>
            </button>
          </>
        ) : null}
      </section>
      ) : work && section === 'overview' ? (
      <section className={styles.sec} style={{ paddingTop: 6 }}>
        <h3>管理台</h3>
        <p className={styles.hint} style={{ marginBottom: 10 }}>
          管理端专注内容治理与举报处理，不含学生校园首页能力。
        </p>
        <button type="button" className={styles.setRow} onClick={() => nav('/admin/reports')}>
          <span className={styles.setIc} style={{ background: '#ffe8e0' }}>
            ⚑
          </span>
          <span className={styles.setGrow}>
            <b>举报台</b>
            <span>处理广场与内容举报</span>
          </span>
          <span className={styles.setArrow}>›</span>
        </button>
        <p className={styles.hint} style={{ marginTop: 10 }}>
          业务提醒：举报处理进度会以横幅与系统通知提示（需通知权限）。
        </p>
      </section>
      ) : null}

      {section === 'account' ? (
      <section className={styles.sec} style={{ paddingTop: 6 }}>
        <h3>账号</h3>
        {signed ? (
          <>
            {!work && signed ? <QuietLoginStreak /> : null}
            <button type="button" className={styles.setRow} onClick={() => void login()}>
              <span className={styles.setIc} style={{ background: 'var(--green-soft)' }}>
                <CampusIcon name="key" />
              </span>
              <span className={styles.setGrow}>
                <b>学号身份</b>
                <span>{auth.user?.loginName || auth.profile?.studentId || '本机'}</span>
              </span>
              <span className={styles.setArrow}>›</span>
            </button>
            <button type="button" className={styles.setRow} onClick={() => setAskLogout(true)}>
              <span className={styles.setIc} style={{ background: '#ffe0e6' }}>
                <CampusIcon name="logout" />
              </span>
              <span className={styles.setGrow}>
                <b>{auth.profile?.username || '已登录'}</b>
                <span>退出后回到游客状态</span>
              </span>
              <span className={styles.setArrow}>›</span>
            </button>
          </>
        ) : (
          <>
          <button type="button" className={styles.setRow} onClick={login}>
            <span className={styles.setIc} style={{ background: 'var(--green-soft)' }}>
              ⚙
            </span>
            <span className={styles.setGrow}>
              <b>用学号开始</b>
              <span>学号 + 校园网 + 统一认证</span>
            </span>
            <span className={styles.setArrow}>›</span>
          </button>
          <button type="button" className={styles.setRow} onClick={() => setAskLogout(true)}>
            <span className={styles.setIc} style={{ background: '#ffe0e6' }}>
              <CampusIcon name="logout" />
            </span>
            <span className={styles.setGrow}>
              <b>退出登录</b>
              <span>可选是否清空本机缓存</span>
            </span>
            <span className={styles.setArrow}>›</span>
          </button>
          </>
        )}
      </section>
      ) : null}

      {section === 'data' && !work ? <>
        <p className={settingStyles.intro}>查看当前浏览器或 App 可报告的本机存储信息。</p>
        <StorageDiagnostics />
        <section className={settingStyles.menu} aria-label="本机数据操作" style={{ marginTop: 14 }}>
          <SettingsLink icon="update" title="一键更新本机数据" detail="重新登录校园系统，更新课表、成绩、考试" onClick={() => nav('/study/oneclick')} />
          <SettingsLink icon="box" title="一键清空本机数据" detail="清空身份、缓存与设置，回到首次认证" onClick={() => setAskClearData(true)} />
        </section>
      </> : null}

      {section === 'about' ? (
      <section className={styles.sec} style={{ paddingTop: 10 }}>
        <h3>哦狐科技</h3>
        <div className={styles.hint}>
          插件内容会标明官方或非官方；审核通过的轻量模块随 App 发布。开源项目链接仅供参考，不会自动安装。
        </div>
        <PluginMarketplace />
        <h3 style={{ marginTop: 22 }}>版本与更新</h3>
        {IS_FDROID_BUILD ? (
          <p className={styles.hint} role="note">此构建不使用哦狐热更新。通过 F-Droid 安装后，请在 F-Droid 客户端更新；收录完成前请从哦狐官网获取新版安装包。</p>
        ) : <>
        <p className={styles.hint}>界面版本 v{webVersion}{IS_NATIVE ? nativeVersion ? ` · 安装包 v${nativeVersion.version}（${nativeVersion.build}）` : versionLoaded ? ' · 安装包版本暂时无法读取' : ' · 正在读取安装包版本…' : ' · 电脑网页版'}</p>
        <button type="button" className={styles.setRow} onClick={onCheckUpdate} disabled={updateBusy || !IS_NATIVE}>
          <span className={styles.setIc} style={{ background: '#e6efff' }}>
            <CampusIcon name="update" />
          </span>
          <span className={styles.setGrow}>
            <b>{updateBusy ? '正在检查…' : '检查安装包更新'}</b>
            <span>{IS_NATIVE ? '原生能力更新后，下载对应端的新版 APK' : '电脑后台通过网页发布更新，无需安装 APK'}</span>
          </span>
          <span className={styles.setArrow}>›</span>
        </button>
        <button type="button" className={styles.setRow} onClick={() => IS_NATIVE ? void onCheckOta() : window.location.reload()} disabled={updateBusy}>
          <span className={styles.setIc} style={{ background: '#e8fff0' }}>
            <CampusIcon name="box" />
          </span>
          <span className={styles.setGrow}>
            <b>{IS_NATIVE ? '检查界面更新' : '重新加载网页'}</b>
            <span>{IS_NATIVE ? '校验通过后重新载入界面' : '重新加载已部署的电脑后台'}</span>
          </span>
          <span className={styles.setArrow}>›</span>
        </button>
        <details className={settingStyles.diagnostics} open={diagOpen} onToggle={(event) => {
          const open = event.currentTarget.open
          setDiagOpen(open)
          if (open && !diag && !diagBusy) void refreshDiag()
        }}>
          <summary>更新遇到问题？</summary>
          <p>查看更新状态，或将结果反馈给管理员。</p>
        <button
          type="button"
          className={styles.setRow}
          onClick={() => void refreshDiag()}
          disabled={diagBusy}
        >
          <span className={styles.setIc} style={{ background: '#fff2e0' }}>
            <CampusIcon name="task" />
          </span>
          <span className={styles.setGrow}>
            <b>{diagBusy ? '正在检查更新状态…' : '重新检查更新状态'}</b>
            <span>
              {diagBusy
                ? '正在读取…'
                : diag
                  ? `本机 ${diag.localVersion || '内置包'} · 线上 ${diag.remoteVersion || '读不到'}`
                  : '检查本机与线上版本'}
            </span>
          </span>
          <span className={styles.setArrow}>›</span>
        </button>
        {diagError ? <p className={settingStyles.diagnosticError} role="alert">{diagError}</p> : null}
        {diag ? (
          <p className={styles.hint} style={{ marginTop: 6 }}>
            {[
              diag.native ? `安装包 ${diag.nativeVersion || '未知'}（${diag.nativeBuild || '未知'}）` : '浏览器（通过网站部署更新）',
              diag.manifestOk
                ? `清单已读到 ${diag.remoteVersion}${diag.remoteSizeMb ? ` · ${diag.remoteSizeMb}MB` : ''}`
                : '清单读不到：网络不通或被拦截',
              diag.compatibilityError || (diag.manifestOk ? diag.needUpdate ? '有可用更新' : '无需界面更新' : '尚未确认线上版本'),
              diag.pendingVersion ? `已下载待切换：${diag.pendingVersion}` : '',
              diag.lastError ? `上次失败：${diag.lastError.msg}` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        ) : null}
        </details>
        <p className={styles.hint} style={{ marginTop: 8 }}>
          桌面图标等系统能力变更，需要安装新版本安装包。
        </p>
        </>}
      </section>
      ) : null}

      {showAdminBlock && section === 'admin' ? (
        <section className={styles.sec} style={{ paddingTop: 12 }}>
          <h3>管理员</h3>
          <button type="button" className={styles.setRow} onClick={() => nav('/admin/news')}>
            <span className={styles.setIc} style={{ background: '#e6f3ff' }}>
              📣
            </span>
            <span className={styles.setGrow}>
              <b>公告</b>
              <span>起草、发布、下架和置顶。需要时再给学生发站内信</span>
            </span>
            <span className={styles.setArrow}>›</span>
          </button>
          <button type="button" className={styles.setRow} onClick={() => nav('/admin/content')}>
            <span className={styles.setIc} style={{ background: '#e6efff' }}>
              🧹
            </span>
            <span className={styles.setGrow}>
              <b>内容管理</b>
              <span>下架违规帖与二手闲置，删除或回复评论，删除违规任务与求助</span>
            </span>
            {modPending.count == null ? (
              <span className={styles.count} title="待处理数量暂时无法读取">?</span>
            ) : modPending.count > 0 ? (
              <span className={styles.count} title={modPending.atLeast ? '至少为此数量' : '待处理数量'}>
                {modPending.atLeast ? `≥${modPending.count}` : modPending.count}
              </span>
            ) : null}
            <span className={styles.setArrow}>›</span>
          </button>
          <button type="button" className={styles.setRow} onClick={() => nav('/admin/reports')}>
            <span className={styles.setIc} style={{ background: '#ffe0e6' }}>
              🚩
            </span>
            <span className={styles.setGrow}>
              <b>举报处理</b>
              <span>处理学生端广场等内容举报，完成后更新状态</span>
            </span>
            <span className={styles.setArrow}>›</span>
          </button>
          {isSuperAdmin ? (
            <button type="button" className={styles.setRow} onClick={() => nav('/admin/members')}>
              <span className={styles.setIc} style={{ background: '#ffe9c9' }}>
                👑
              </span>
              <span className={styles.setGrow}>
                <b>成员治理</b>
                <span>站长专属：搜索用户、添加 / 移除普通管理员</span>
              </span>
              <span className={styles.setArrow}>›</span>
            </button>
          ) : null}
        </section>
      ) : null}

      {askLogout ? (
        <DialogLayer title="退出登录？" onClose={() => setAskLogout(false)}>
          <p style={{ margin: '0 0 14px', fontSize: 14, lineHeight: 1.6 }}>退出后回到游客状态，发布与消息需要重新登录。</p>
          <div style={{ display: 'grid', gap: 10 }}>
            <button type="button" style={{ minHeight: 46, borderRadius: 12, border: 0, background: 'var(--green, #16735b)', color: '#fff', fontSize: 15, fontWeight: 600 }} onClick={async () => { setAskLogout(false); try { localStorage.removeItem('ohu.campus-gate.v1') } catch { /* 忽略 */ } await logout(); window.setTimeout(() => window.location.reload(), 150) }}>仅退出（保留本机缓存）</button>
            <button type="button" style={{ minHeight: 46, borderRadius: 12, border: '1px solid var(--danger, #b83b3b)', background: 'transparent', color: 'var(--danger, #b83b3b)', fontSize: 15, fontWeight: 600 }} onClick={async () => { setAskLogout(false); await auth.logout(); await clearLocalAppDataAndReload() }}>退出并清空本机缓存</button>
            <button type="button" style={{ minHeight: 44, borderRadius: 12, border: 0, background: 'transparent', color: 'var(--text-2, #4b5e7a)', fontSize: 14 }} onClick={() => setAskLogout(false)}>取消</button>
          </div>
        </DialogLayer>
      ) : null}

      {askClearData ? (
        <ConfirmSheet
          title="清空本机数据？"
          desc="会删除本机登录身份、课表、成绩、考试、待办和设置，并回到首次认证页。此操作不可撤销。"
          confirmText="清空并重新认证"
          danger
          onClose={() => setAskClearData(false)}
          onConfirm={async () => { setAskClearData(false); await clearLocalAppDataAndReload() }}
        />
      ) : null}
      {availableUpdate ? (
        <ConfirmSheet
          title={availableUpdate.title || '发现新版本'}
          desc={formatNotes(availableUpdate)}
          confirmText="打开下载"
          cancelText="稍后更新"
          onClose={() => setAvailableUpdate(null)}
          onConfirm={() => {
            if (openUpdateDownload(availableUpdate)) setAvailableUpdate(null)
            else toast.err('当前端的下载地址尚未配置，请联系管理员')
          }}
        />
      ) : null}
    </div>
  )
}
