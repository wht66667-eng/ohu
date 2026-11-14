import { useId, type CSSProperties } from 'react'
import { FOX_POSES, FOX_SHEETS, FOX_SHEET_SIZE, foxPoseClipPoints, type FoxPoseId } from '../../lib/fox-sheet'
import { isFoxFreeVariant, useUiVariant } from '../../lib/ui-variant'

/** Display one pose from the supplied transparent sheet without a runtime upload. */
export function FoxSheetPose({ pose, className, title, style }: { pose: FoxPoseId; className?: string; title?: string; style?: CSSProperties }) {
  const item = FOX_POSES[pose]
  const clipId = `ohu-pose-${useId().replaceAll(':', '')}`
  const variant = useUiVariant()
  if (isFoxFreeVariant(variant)) return null
  if (variant === 'handdrawn') {
    const src = pose === 'reading' || pose === 'studying' || pose === 'writing'
      ? '/brand/handdrawn/fox-reading-scene.png'
      : pose === 'waving' ? '/brand/handdrawn/fox-avatar.png' : '/brand/handdrawn/fox-greeting.png'
    return <img className={className} src={src} alt={title || ''} aria-hidden={title ? undefined : true} draggable={false} style={{ objectFit: 'contain', ...style }} />
  }
  return <svg className={className} viewBox={`0 0 ${item.width} ${item.height}`} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false" style={style}>
    <defs><clipPath id={clipId}><polygon points={foxPoseClipPoints(pose)} /></clipPath></defs>
    <g clipPath={`url(#${clipId})`}><image href={FOX_SHEETS[item.sheet]} x={-item.x} y={-item.y} width={FOX_SHEET_SIZE} height={FOX_SHEET_SIZE} /></g>
  </svg>
}
