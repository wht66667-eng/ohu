/**
 * 第三层 · 瞬态变脸
 *
 * 多邻国那一下的关键：让用户「亲眼看见」表情变化。
 * - 今日首次打卡 → 底部卡片：旧表情交叉淡入到新表情 + 连击天数
 * - 连击里程碑 3 / 7 / 14 天 → 同款卡片但更大更久
 * - 缺勤回归（away → streak）→ 委屈过渡回开心
 *
 * 同一天、同一档位只播一次，不骚扰。
 */
import { useEffect, useRef, useState } from 'react'
import { getAppShell, isWorkShell } from '../../lib/app-shell'
import { activityDay, iconAssetUrl, type IconStateKey } from '../../lib/app-icon'
import { FOX_LABELS, FOX_MILESTONES } from '../../lib/fox-labels'
import { useFoxState } from './useFoxState'
import { markCodexSeen } from './FoxCodex'
import styles from './FoxMoment.module.css'
import { isFoxFreeVariant, useUiVariant } from '../../lib/ui-variant'

const LS_SEEN = 'sc.fox.moment.v1'

type Moment = {
  from: IconStateKey
  to: IconStateKey
  title: string
  body: string
  milestone: boolean
}

function readSeen(): { date?: string; state?: string } {
  try {
    return JSON.parse(localStorage.getItem(LS_SEEN) || '{}') as { date?: string; state?: string }
  } catch {
    return {}
  }
}

function writeSeen(v: { date: string; state: string }) {
  try {
    localStorage.setItem(LS_SEEN, JSON.stringify(v))
  } catch {
    /* ignore */
  }
}

export function FoxMoment() {
  const shell = getAppShell()
  const work = isWorkShell(shell)
  const eng = useFoxState()
  const variant = useUiVariant()
  const [moment, setMoment] = useState<Moment | null>(null)
  const prevRef = useRef<IconStateKey | null>(null)
  const timer = useRef(0)

  useEffect(() => {
    if (!eng) return
    /* 图鉴解锁记录（每次拿到新档位就记一笔） */
    markCodexSeen(eng.iconState)
    /* 多邻国式变脸仅学生端；工作端与无狐皮肤不打扰 */
    if (work || variant === 'minimal' || isFoxFreeVariant(variant)) {
      prevRef.current = eng.iconState
      setMoment(null)
      window.clearTimeout(timer.current)
      return
    }

    const cur = eng.iconState
    const prev = prevRef.current
    prevRef.current = cur

    /* 首帧只记录基线，不播动画（避免一进 App 就弹） */
    if (!prev || prev === cur) return

    const today = activityDay(new Date().toISOString())!
    const seen = readSeen()
    if (seen.date === today && seen.state === cur) return
    writeSeen({ date: today, state: cur })

    const streak = Math.max(0, eng.streakCurrent || 0)
    const milestone = FOX_MILESTONES.some((m) => m.day === streak)
    const back = prev.startsWith('away_') && cur.startsWith('streak_')

    let title = FOX_LABELS[cur]
    let body = streak > 0 ? `连续登录 ${streak} 天` : '今天也来了'
    if (back) {
      title = '你回来啦！'
      body = FOX_LABELS[cur]
    } else if (milestone) {
      title = `${streak} 天连击！`
      body = FOX_LABELS[cur]
    }

    setMoment({ from: prev, to: cur, title, body, milestone })
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMoment(null), milestone ? 3200 : 2600)
    return () => window.clearTimeout(timer.current)
  }, [eng, work, variant])

  if (!moment || variant === 'minimal' || isFoxFreeVariant(variant)) return null

  return (
    <div
      className={`${styles.card} ${moment.milestone ? styles.big : ''}`}
      role="status"
      aria-live="polite"
      onClick={() => setMoment(null)}
    >
      <span className={styles.stage}>
        <img className={`${styles.face} ${styles.faceOut}`} src={iconAssetUrl(moment.from)} alt="" />
        <img className={`${styles.face} ${styles.faceIn}`} src={iconAssetUrl(moment.to)} alt="" />
      </span>
      <span className={styles.text}>
        <b>{moment.title}</b>
        <i>{moment.body}</i>
      </span>
    </div>
  )
}
