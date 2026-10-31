/**
 * 第二层 · 内联情绪位
 *
 * 挂在有情绪语义的位置：空状态 / 加载 / 成功 / 失败 / 引导。
 * 不动列表项内部布局，只在「本来就有留白」处补一只狐狸。
 *
 * 文案一律短句（≤18 字），符合去 AI 化要求。
 */
import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { FoxAvatar } from './FoxAvatar'
import { FoxLoader } from './FoxLoader'
import { useFoxState } from './useFoxState'
import { foxPoseForPath, type FoxPose } from '../../lib/fox-art'
import styles from './FoxInline.module.css'
import { isFoxFreeVariant, useUiVariant } from '../../lib/ui-variant'
import { useUiMotion } from '../../lib/motion-pref'
import { motion } from 'motion/react'

export type FoxVariant = 'empty' | 'loading' | 'success' | 'error' | 'guide'

const DEFAULT_TEXT: Record<FoxVariant, string> = {
  empty: '这里还空着',
  loading: '稍等一下…',
  success: '做得不错',
  error: '出了点小状况',
  guide: '我在这里',
}

export function FoxInline({
  variant = 'guide',
  size = 56,
  text,
  sub,
  action,
  pose,
  useMood = false,
  className = '',
  children,
}: {
  variant?: FoxVariant
  /** 狐狸头像尺寸 */
  size?: number
  /** 主文案，短句 */
  text?: string
  /** 次级说明（可选，短句） */
  sub?: string
  /** 行动按钮：文案 + 路由 / 回调 */
  action?: { label: string; to?: string; onClick?: () => void }
  pose?: FoxPose
  /** 个人表情位可选择跟随全局状态；默认按功能选择动作 */
  useMood?: boolean
  className?: string
  children?: ReactNode
}) {
  const eng = useFoxState()
  const ui = useUiVariant()
  const cute = ui === 'cute'
  const minimal = ui === 'minimal'
  const foxfree = isFoxFreeVariant(ui)
  const { pathname } = useLocation()
  const state = useMood && eng ? eng.iconState : undefined
  const contextPose = variant === 'loading' ? 'loading'
    : variant === 'error' ? 'puzzled'
      : variant === 'success' ? 'cheer'
        : pose || foxPoseForPath(pathname)

  const body = (
    <>
      {foxfree && variant !== 'loading' ? null
        : variant === 'loading' ? <FoxLoader size={minimal || foxfree ? 28 : size} label={text || DEFAULT_TEXT.loading} compact />
        : minimal && (variant === 'success' || variant === 'error' || (variant === 'guide' && contextPose !== 'welcome')) ? null
          : cute && (variant === 'success' || variant === 'error') ? <CuteFoxReaction warning={variant === 'error'} size={size} />
            : <span className={cute && variant === 'empty' ? styles.peek : undefined}><FoxAvatar state={state} pose={cute && variant === 'empty' ? 'welcome' : useMood && !pose && (variant === 'empty' || variant === 'guide') ? undefined : contextPose} size={minimal ? 28 : size} ring={false} className={styles.face} /></span>}
      <span className={styles.text}>
        <b>{text || (cute && variant === 'empty' ? '这里等着你的第一步～' : DEFAULT_TEXT[variant])}</b>
        {sub ? <i>{sub}</i> : null}
      </span>
    </>
  )

  return (
    <div className={`${styles.row} ${styles[variant] || ''} ${className}`}>
      {children || body}
      {action ? (
        action.to ? (
          <Link className={styles.act} to={action.to}>
            {action.label}
          </Link>
        ) : (
          <button type="button" className={styles.act} onClick={action.onClick}>
            {action.label}
          </button>
        )
      ) : null}
    </div>
  )
}

/** 轻量版：只要一只狐狸 + 一句话，用于紧凑位置（如卡片右上角） */
export function FoxNote({ text = '', size = 28, pose }: { text?: string; size?: number; pose?: FoxPose }) {
  const { pathname } = useLocation()
  const ui = useUiVariant()
  const minimal = ui === 'minimal'
  return (
    <span className={styles.note}>
      {!minimal && !isFoxFreeVariant(ui) ? <FoxAvatar pose={pose || foxPoseForPath(pathname)} size={size} ring={false} /> : null}
      {text ? <b>{text}</b> : null}
    </span>
  )
}

/** Feedback is driven by a real success or warning state, never an automatic demo. */
function CuteFoxReaction({ warning, size }: { warning: boolean; size: number }) {
  const reduce = useUiMotion()
  return <svg width={size} height={size} viewBox="0 0 72 64" aria-hidden="true" className={styles.reaction}>
    <motion.g style={{ transformOrigin: '50px 48px' }} animate={{ rotate: warning || reduce ? 0 : [-12, 10, 0] }} transition={{ duration: .35 }}>
      <path d="M48 50c14 3 14-13 20-18 5 13-1 25-13 24Z" fill="var(--fox)" />
      <path d="M68 32c3 7 4 10 2 14l-8-5Z" fill="var(--fox-belly)" />
    </motion.g>
    <path d={warning ? 'M12 21 3 16l5 21 12-9m32-7 9-5-5 21-12-9' : 'M11 29 9 7q11 2 19 16m20 6 3-22q-11 2-19 16'} fill="var(--fox)" />
    {!warning ? <path d="m13 13 3 13 8-4m22-9-3 13-8-4" fill="var(--fox-belly)" /> : null}
    <path d="M7 36c0-13 11-23 25-23s25 10 25 23c0 16-12 23-25 23S7 52 7 36Z" fill="var(--fox)" />
    <path d="M9 39q11-5 22 3 11-8 24-3c-4 11-12 17-23 17S14 50 9 39Z" fill="var(--fox-belly)" />
    <ellipse cx="18" cy="43" rx="5" ry="2.8" fill="var(--fox-blush)" opacity={warning ? .35 : .8} />
    <ellipse cx="46" cy="43" rx="5" ry="2.8" fill="var(--fox-blush)" opacity={warning ? .35 : .8} />
    <ellipse cx="22" cy="33" rx="3.3" ry="4.4" fill="var(--green-deep)" />
    {warning ? <ellipse cx="41" cy="33" rx="3.3" ry="4.4" fill="var(--green-deep)" /> : <motion.path d="M37 34q4-5 8 0" fill="none" stroke="var(--green-deep)" strokeWidth="2.8" strokeLinecap="round" animate={{ scaleY: reduce ? 1 : [1, .15, 1] }} transition={{ duration: .35 }} style={{ transformOrigin: '41px 33px' }} />}
    <path d="m28 42 4 3 4-3q-4-4-8 0Z" fill="var(--green-deep)" />
    <path d={warning ? 'M27 50q5-4 10 0' : 'M26 48q6 7 12 0'} stroke="var(--green-deep)" strokeWidth="2" fill="none" strokeLinecap="round" />
  </svg>
}
