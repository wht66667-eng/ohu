import { useEffect, useMemo, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { getAppShell, isWorkShell } from '../lib/app-shell'
import { activityDay, launcherIconPreviewUrl, isLauncherMoodEnabled, supportsLauncherMood, type IconStateKey } from '../lib/app-icon'
import { AWAY_SNAPSHOT_EVENT } from '../lib/engagement'
import { isFoxFreeVariant, useUiVariant } from '../lib/ui-variant'
import { useAuth } from '../lib/auth'
import { DialogLayer } from './ui/DialogLayer'
import styles from './AwayLoginHost.module.css'

const LS_POP = 'sc.away.login.pop.v2'
const SS_BEFORE = 'sc.away.before.v2'

const AWAY_FRAMES: IconStateKey[] = [
  'away_2',
  'away_5',
  'away_8',
  'away_12',
  'away_15',
  'away_20',
  'away_25',
  'away_30',
]


type BeforeSnap = {
  uid: string
  /** 本机无打卡记录的首次登录：走欢迎弹窗，不报「多少天没来」 */
  first?: boolean
  days: number
  icon: IconStateKey
  label: string
}

function dayCopy(n: number, label: string): { title: string; body: string } {
  if (n >= 30) {
    return {
      title: `已经 ${n} 天没来了！！`,
      body: '桌面那只狐狸快气炸了——今天打开就算报到，表情会立刻变回来。',
    }
  }
  if (n >= 15) {
    return {
      title: `${n} 天没登录哦狐`,
      body: `${label} 越久不来，桌面狐狸越委屈。回来登录一下，表情马上变回开心。`,
    }
  }
  if (n >= 5) {
    return {
      title: `你有 ${n} 天没出现了`,
      body: `${label} 狐狸一直在桌面望着你——打开 App 就算回来。`,
    }
  }
  return {
    title: `已经 ${n} 天没登录了`,
    body: `${label} 轻轻戳你一下：今天打开就算报到，桌面表情会跟着变。`,
  }
}

function readBefore(): BeforeSnap | null {
  try {
    const j = JSON.parse(sessionStorage.getItem(SS_BEFORE) || 'null') as BeforeSnap | null
    if (!j || typeof j.uid !== 'string' || !j.uid || typeof j.days !== 'number') return null
    return j
  } catch {
    return null
  }
}

/**
 * 学生端：登录前已离开 ≥2 天 → 满幅变脸狐狸弹窗（帧动画）
 * 每天同一离开天数最多弹一次；工作端不显示。
 */
export function AwayLoginHost() {
  const shell = getAppShell()
  const auth = useAuth()
  const ui = useUiVariant()
  const reducedMotion = useReducedMotion()
  const [open, setOpen] = useState(false)
  const [snap, setSnap] = useState<BeforeSnap | null>(null)
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    if (isWorkShell(shell) || !supportsLauncherMood()) return

    const tryOpen = () => {
      if (!auth.isSigned || !auth.user?.uid) return
      const before = readBefore()
      if (!before || before.uid !== auth.user.uid) return
      /* 首次登录不邀请开启；桌面图标变脸只在设置页由用户主动开启。 */
      if (before.first) return
      if (before.days < 2 || !isLauncherMoodEnabled()) return
      const today = activityDay(new Date().toISOString())!
      try {
        const raw = localStorage.getItem(`${LS_POP}:${shell}:${encodeURIComponent(before.uid)}`)
        const j = raw ? (JSON.parse(raw) as { date?: string; days?: number }) : {}
        if (j.date === today && j.days === before.days) return
      } catch {
        /* ignore */
      }
      setSnap(before)
      setOpen(true)
    }

    const t = window.setTimeout(tryOpen, 700)
    const onVis = () => {
      if (document.visibilityState === 'visible') tryOpen()
    }
    window.addEventListener('focus', onVis)
    window.addEventListener(AWAY_SNAPSHOT_EVENT, tryOpen)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('focus', onVis)
      window.removeEventListener(AWAY_SNAPSHOT_EVENT, tryOpen)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [shell, auth.isSigned, auth.user?.uid])

  useEffect(() => {
    if (!open || reducedMotion || ui === 'minimal') return
    const id = window.setInterval(() => setFrame((f) => f + 1), 480)
    return () => window.clearInterval(id)
  }, [open, reducedMotion, ui])

  const frames = useMemo(() => {
    if (!snap) return AWAY_FRAMES
    const idx = AWAY_FRAMES.indexOf(snap.icon)
    if (idx < 0) {
      /* streak / default → 从轻微提醒播到 away_5 */
      return AWAY_FRAMES.slice(0, 3)
    }
    const start = Math.max(0, idx - 1)
    const end = Math.min(AWAY_FRAMES.length, idx + 2)
    return AWAY_FRAMES.slice(start, end)
  }, [snap])

  if (!open || !snap || !auth.isSigned || auth.user?.uid !== snap.uid || isWorkShell(shell) || !supportsLauncherMood() || isFoxFreeVariant(ui)) return null

  const previewIndex = reducedMotion || ui === 'minimal' ? Math.max(0, frames.indexOf(snap.icon)) : frame % frames.length
  const copy = dayCopy(snap.days, snap.label || '好久不见')

  function dismiss() {
    const today = activityDay(new Date().toISOString())!
    try {
      localStorage.setItem(`${LS_POP}:${shell}:${encodeURIComponent(snap!.uid)}`, JSON.stringify({ date: today, days: snap!.days }))
    } catch {
      /* ignore */
    }
    setOpen(false)
  }

  return (
    <DialogLayer title="登录提醒" onClose={dismiss} className={styles.dialogSurface}>
      <div className={styles.card}>
        <div className={styles.stage}>
          {frames.map((k, i) => (
            <img
              key={k}
              className={`${styles.scene} ${i === previewIndex ? styles.sceneOn : ''}`}
              src={launcherIconPreviewUrl(k)}
              alt=""
            />
          ))}
          <span className={styles.badge}>{snap.days} 天</span>
        </div>
        <h2 className={styles.title}>{copy.title}</h2>
        <p className={styles.body}>{copy.body}</p>
        <p className={styles.hint}>
          桌面图标变脸可随时在设置里关闭
        </p>
        <div className={styles.actions}>
          <button type="button" className={styles.ghost} onClick={dismiss}>
            知道了
          </button>
          <button type="button" className={styles.main} onClick={dismiss}>
            我回来了
          </button>
        </div>
      </div>
    </DialogLayer>
  )
}
