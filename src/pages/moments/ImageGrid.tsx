import styles from './MomentsPage.module.css'

interface ImageGridProps {
  images: string[]
  onImageClick?: (index: number) => void
}

export function ImageGrid({ images, onImageClick }: ImageGridProps) {
  if (!images || images.length === 0) return null

  const count = Math.min(images.length, 9)
  const gridClass = count === 1 ? styles.grid1 : count === 2 ? styles.grid2 : count === 3 ? styles.grid3 : count === 4 ? styles.grid4 : styles.grid9

  return (
    <div className={`${styles.imageGrid} ${gridClass}`}>
      {images.slice(0, 9).map((url, index) => (
        <button
          type="button"
          key={index}
          className={styles.imageItem}
          onClick={() => onImageClick?.(index)}
          aria-label={`查看第 ${index + 1} 张图片`}
        >
          <img src={url} alt="" loading="lazy" />
        </button>
      ))}
    </div>
  )
}
