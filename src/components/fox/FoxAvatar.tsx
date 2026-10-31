/**
 * 小狐狸表情头像：全 App 狐狸的最小渲染单元。
 * 功能动作优先；个人表情仍跟随 engagement 状态。
 */
import type { IconStateKey } from '../../lib/app-icon'
import { FOX_MOOD_POSES, type FoxPose } from '../../lib/fox-art'
import type { FoxPoseId } from '../../lib/fox-sheet'
import { FoxSheetPose } from './FoxSheetPose'
import styles from './FoxAvatar.module.css'
import { isFoxFreeVariant, useUiVariant } from '../../lib/ui-variant'

const SHEET_POSES: Record<FoxPose,FoxPoseId> = {
  avatar:'waving',welcome:'waving',reading:'reading',focus:'studying',parcel:'walking',shopping:'phone',guide:'map',search:'thinking',chat:'phone',loading:'thinking',food:'tea',contact:'phone',cheer:'cheering',trophy:'cool',jump:'yay',waiting:'thinking',encourage:'cheering',puzzled:'thinking',sad:'sleepy',determined:'studying',lonely:'resting',calling:'phone',pleading:'love',
}

export function FoxAvatar({
  state,
  pose,
  size = 40,
  wave = false,
  ring = true,
  alt = '阳光狐狸',
  className = '',
  onClick,
}: {
  state?: IconStateKey
  pose?: FoxPose
  size?: number
  /** 是否带呼吸起伏（用于常驻浮岛 / 内联位） */
  wave?: boolean
  /** 是否描边 */
  ring?: boolean
  alt?: string
  className?: string
  onClick?: () => void
}) {
  const key = state || 'default'
  const variant = useUiVariant()
  if (isFoxFreeVariant(variant)) return null
  const minimal = variant === 'minimal'
  return (
    <span
      className={`${styles.wrap} ${wave && !minimal ? styles.wave : ''} ${ring ? styles.ring : ''} ${className}`}
      style={{ width: size, height: size }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      } : undefined}
    >
      {minimal ? <FoxSilhouette size={size} label={alt} className={styles.img} /> : <FoxSheetPose className={styles.img} pose={SHEET_POSES[pose || FOX_MOOD_POSES[key]]} title={alt} />}
    </span>
  )
}

/** One-color mark keeps the fourth theme recognizable without character animation. */
export function FoxSilhouette({ size = 32, label, className = '' }: { size?: number; label?: string; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 64 64" role={label ? 'img' : undefined} aria-label={label} aria-hidden={!label} fill="currentColor">
    <path d="M10 7c7 0 14 6 22 10C40 13 47 7 54 7l3 29-9 14-16 8-16-8-9-14Z" />
    <path d="m13 30 19 9 19-9-6 14-13 9-13-9Z" fill="var(--card)" />
    <path d="m27 39 5 4 5-4-5-2Z" />
  </svg>
}
