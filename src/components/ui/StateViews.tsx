import { FoxSheetPose } from '../fox/FoxSheetPose'
import type { ReactNode } from 'react'
import styles from './StateViews.module.css'
import { isFoxFreeVariant, useUiVariant } from '../../lib/ui-variant'

/** 哦狐统一页面状态：加载 / 无数据 / 失败 / 成功 / 无权限（阶段三·异常状态规范） */
export type StateKind = 'loading' | 'empty' | 'error' | 'success' | 'denied'

type StateViewProps = {
  kind?: StateKind
  title?: string
  hint?: string
  action?: ReactNode
  /** 紧凑模式：用于卡片内部或列表上方的短状态 */
  compact?: boolean
  className?: string
}

const DEFAULTS: Record<StateKind, { icon: string; title: string; hint: string }> = {
  loading: { icon: '', title: '正在加载…', hint: '阿狐马上就好' },
  empty: { icon: '', title: '这里空空的', hint: '暂时没有内容，去别处逛逛吧' },
  error: { icon: '', title: '加载失败了', hint: '网络似乎不太顺畅，稍后再试试' },
  success: { icon: '🎉', title: '已完成', hint: '' },
  denied: { icon: '🔒', title: '暂无权限', hint: '当前账号还看不到这部分内容' },
}

export function StateView({ kind = 'loading', title, hint, action, compact = false, className }: StateViewProps) {
  const foxFree = isFoxFreeVariant(useUiVariant())
  const preset = DEFAULTS[kind]
  const shownHint = hint !== undefined ? hint : preset.hint
  return (
    <section
      className={`${styles.wrap} ${compact ? styles.compact : ''} ${className ?? ''}`}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      {kind === 'loading' ? (
        <span className={styles.spin} aria-hidden="true" />
      ) : (kind === 'empty' || kind === 'error') && foxFree ? null : kind === 'empty' || kind === 'error' ? (
        <span className={`${styles.foxIcon} ${kind === 'error' ? styles.foxError : ''}`} aria-hidden="true">
          <FoxSheetPose pose="waving" />
        </span>
      ) : (
        <span className={styles.icon} aria-hidden="true">{preset.icon}</span>
      )}
      <p className={styles.title}>{title ?? preset.title}</p>
      {shownHint ? <p className={styles.hint}>{shownHint}</p> : null}
      {action ? <div className={styles.actionRow}>{action}</div> : null}
    </section>
  )
}

export function LoadingState(props: Omit<StateViewProps, 'kind'>) {
  return <StateView kind="loading" {...props} />
}

export function EmptyState(props: Omit<StateViewProps, 'kind'>) {
  return <StateView kind="empty" {...props} />
}

export function ErrorState(props: Omit<StateViewProps, 'kind'>) {
  return <StateView kind="error" {...props} />
}

export function SuccessState(props: Omit<StateViewProps, 'kind'>) {
  return <StateView kind="success" {...props} />
}

export function DeniedState(props: Omit<StateViewProps, 'kind'>) {
  return <StateView kind="denied" {...props} />
}
