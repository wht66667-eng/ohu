import { productImg, resolveAvatar, thumbImg, type ThumbKey } from '../data/images'
import styles from './Thumbs.module.css'

export function ProductArt({ kind }: { kind: string }) {
  const src =
    kind in productImg
      ? productImg[kind as keyof typeof productImg]
      : kind in thumbImg
        ? thumbImg[kind as ThumbKey]
        : undefined
  if (!src) return <div className={styles.art} />
  return <img className={styles.img} src={src} alt="" loading="lazy" />
}

/**
 * 用户头像：有上传图用上传图，否则按 seed（uid）分配预设动物头像。
 * seed 为空时退回到「首字 + 色块」。
 */
export function Avatar({
  name,
  hue,
  src,
  seed,
}: {
  name: string
  hue?: string
  src?: string
  seed?: string
}) {
  const avatarSrc = seed ? resolveAvatar(src, seed) : src
  if (avatarSrc) {
    return <img className={styles.avatar} src={avatarSrc} alt={name} />
  }
  return (
    <span className={styles.avatar} style={{ background: hue || '#c8ec8a' }}>
      {name.slice(0, 1)}
    </span>
  )
}
