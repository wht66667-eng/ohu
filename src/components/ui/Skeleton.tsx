import styles from './Skeleton.module.css'

/** 骨架屏基础块：宽度/高度由调用方通过 className 或 style 指定 */
export function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <span className={`${styles.block} ${className}`} style={style} aria-hidden="true" />
}

/** 列表行骨架：头像 + 两行文字 */
export function RowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className={styles.rows} role="status" aria-label="正在加载">
      {Array.from({ length: count }, (_, i) => (
        <div className={styles.row} key={i}>
          <Skeleton className={styles.avatar} />
          <div className={styles.rowLines}>
            <Skeleton className={styles.line} style={{ width: '42%' }} />
            <Skeleton className={styles.line} style={{ width: '88%' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** 广场动态卡片骨架：头像 + 标签行 + 两段正文 + 配图占位 */
export function PostCardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className={styles.cards} role="status" aria-label="正在加载">
      {Array.from({ length: count }, (_, i) => (
        <div className={styles.card} key={i}>
          <div className={styles.cardTop}>
            <Skeleton className={styles.avatar} />
            <div className={styles.rowLines}>
              <Skeleton className={styles.line} style={{ width: '30%' }} />
              <Skeleton className={styles.line} style={{ width: '20%' }} />
            </div>
          </div>
          <Skeleton className={styles.line} style={{ width: '92%' }} />
          <Skeleton className={styles.line} style={{ width: '64%' }} />
          <Skeleton className={styles.cover} />
        </div>
      ))}
    </div>
  )
}

/** 商品网格骨架 */
export function GoodsGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className={styles.grid} role="status" aria-label="正在加载">
      {Array.from({ length: count }, (_, i) => (
        <div className={styles.goodsCard} key={i}>
          <Skeleton className={styles.cover} />
          <Skeleton className={styles.line} style={{ width: '80%' }} />
          <Skeleton className={styles.line} style={{ width: '40%' }} />
        </div>
      ))}
    </div>
  )
}
