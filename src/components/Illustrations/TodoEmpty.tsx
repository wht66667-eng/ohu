/**
 * 待办空态 SVG 插画（4 变体）
 * idle / done / overdue / signin — 纯 SVG，无外部资源
 */
import type { CSSProperties } from 'react'

export type TodoEmptyVariant = 'idle' | 'done' | 'overdue' | 'signin'

export interface TodoEmptyProps {
  variant?: TodoEmptyVariant
  size?: number
  className?: string
}

const LABELS: Record<TodoEmptyVariant, string> = {
  idle: '待办为空',
  done: '暂无完成记录',
  overdue: '有逾期待办',
  signin: '登录后使用待办',
}

function Clipboard({ checked, redChecks = 0 }: { checked: boolean; redChecks?: number }) {
  return (
    <g transform="translate(36 28) rotate(-8 34 40)">
      <rect x="8" y="4" width="52" height="72" rx="8" fill="var(--card)" stroke="var(--green)" strokeWidth="2.2" />
      <rect x="22" y="0" width="24" height="10" rx="4" fill="var(--green-soft)" stroke="var(--green)" strokeWidth="1.6" />
      {[0, 1, 2].map((i) => {
        const y = 22 + i * 16
        const isChecked = checked || i < redChecks
        const stroke = redChecks > 0 && i < redChecks ? '#f47c7c' : 'var(--green)'
        return (
          <g key={i}>
            <rect x="16" y={y} width="12" height="12" rx="3" fill="var(--mint)" stroke={stroke} strokeWidth="1.6" />
            {isChecked ? (
              <path
                d={`M18 ${y + 6} l3 3 l5 -6`}
                fill="none"
                stroke={stroke}
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
            <rect x="34" y={y + 3} width="18" height="6" rx="2" fill="var(--line)" />
          </g>
        )
      })}
    </g>
  )
}

function IdleScene() {
  return (
    <>
      <rect width="140" height="140" rx="16" fill="var(--mint)" opacity="0.55" />
      {/* floating cards */}
      <rect x="18" y="18" width="22" height="14" rx="4" fill="var(--card)" stroke="var(--leaf)" strokeWidth="1.2" opacity="0.85" />
      <rect x="98" y="22" width="20" height="12" rx="4" fill="var(--card)" stroke="var(--orange)" strokeWidth="1.2" opacity="0.7" />
      <rect x="108" y="48" width="16" height="10" rx="3" fill="var(--card)" stroke="var(--green)" strokeWidth="1.2" opacity="0.65" />
      <Clipboard checked={false} />
      {/* pencil */}
      <g transform="translate(92 42) rotate(35)">
        <rect x="0" y="0" width="28" height="6" rx="2" fill="var(--yellow)" stroke="var(--orange)" strokeWidth="1" />
        <polygon points="28,0 34,3 28,6" fill="var(--orange)" />
      </g>
      {/* sleeping cat */}
      <g transform="translate(22 98)">
        <ellipse cx="18" cy="10" rx="16" ry="9" fill="var(--orange)" opacity="0.85" />
        <circle cx="8" cy="6" r="5" fill="var(--orange)" opacity="0.9" />
        <circle cx="6.5" cy="5" r="1" fill="var(--text)" opacity="0.35" />
        <path d="M28 8 q6 -6 10 -2" fill="none" stroke="var(--orange)" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
        {/* Z marks as abstract arcs */}
        <path d="M36 0 q3 -4 6 0" fill="none" stroke="var(--text-3)" strokeWidth="1.4" strokeLinecap="round" opacity="0.5" />
        <path d="M42 -6 q3 -4 6 0" fill="none" stroke="var(--text-3)" strokeWidth="1.2" strokeLinecap="round" opacity="0.4" />
      </g>
    </>
  )
}

function DoneScene() {
  return (
    <>
      <rect width="140" height="140" rx="16" fill="var(--mint)" opacity="0.5" />
      {/* confetti */}
      {[
        [18, 16, 'var(--green)'],
        [42, 10, 'var(--orange)'],
        [70, 8, 'var(--yellow)'],
        [100, 14, 'var(--green)'],
        [118, 28, 'var(--orange)'],
        [28, 36, 'var(--yellow)'],
      ].map(([x, y, c], i) => (
        <rect key={i} x={x as number} y={y as number} width={i % 2 ? 6 : 8} height={i % 2 ? 8 : 5} rx="1" fill={c as string} opacity="0.75" transform={`rotate(${i * 18} ${x} ${y})`} />
      ))}
      {/* medal */}
      <g transform="translate(55 6)">
        <path d="M8 18 L2 34 L12 28 L18 34 L12 18" fill="var(--orange)" opacity="0.85" />
        <circle cx="15" cy="14" r="12" fill="var(--yellow)" stroke="var(--orange)" strokeWidth="2" />
        <circle cx="15" cy="14" r="6" fill="#fff7e6" opacity="0.9" />
        <path d="M11 14 l3 3 l5 -6" fill="none" stroke="var(--orange)" strokeWidth="1.8" strokeLinecap="round" />
      </g>
      <g transform="translate(0 18)">
        <Clipboard checked />
      </g>
      {/* check sticker */}
      <g transform="translate(96 96)">
        <circle cx="14" cy="14" r="14" fill="var(--green)" />
        <path d="M7 14 l4 4 l10 -10" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </>
  )
}

function OverdueScene() {
  return (
    <>
      <rect width="140" height="140" rx="16" fill="#fff5ec" />
      {/* alarm clock */}
      <g transform="translate(42 10)">
        <circle cx="12" cy="6" r="5" fill="#f47c7c" />
        <circle cx="44" cy="6" r="5" fill="#f47c7c" />
        <rect x="8" y="10" width="40" height="36" rx="10" fill="#f47c7c" />
        <circle cx="28" cy="28" r="12" fill="#fff7e6" />
        <line x1="28" y1="28" x2="28" y2="18" stroke="#f47c7c" strokeWidth="2" strokeLinecap="round" />
        <line x1="28" y1="28" x2="36" y2="32" stroke="#f47c7c" strokeWidth="2" strokeLinecap="round" />
      </g>
      <g transform="translate(0 22)">
        <Clipboard checked={false} redChecks={2} />
      </g>
      {/* red ribbon tag */}
      <g transform="translate(88 48)">
        <rect x="0" y="0" width="18" height="10" rx="2" fill="#f47c7c" />
        <polygon points="18,0 24,5 18,10" fill="#f47c7c" />
      </g>
    </>
  )
}

function SigninScene() {
  return (
    <>
      <rect width="140" height="140" rx="16" fill="var(--mint)" opacity="0.55" />
      {/* sparkles */}
      {[
        [28, 28],
        [108, 32],
        [24, 100],
        [112, 96],
      ].map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y})`} opacity={0.7}>
          <path d="M0 -6 L1.2 -1.2 L6 0 L1.2 1.2 L0 6 L-1.2 1.2 L-6 0 L-1.2 -1.2 Z" fill={i % 2 ? 'var(--yellow)' : 'var(--green)'} />
        </g>
      ))}
      {/* key */}
      <g transform="translate(48 28) rotate(-25 22 10)">
        <circle cx="10" cy="10" r="9" fill="none" stroke="var(--orange)" strokeWidth="3" />
        <circle cx="10" cy="10" r="3.5" fill="var(--mint)" />
        <rect x="18" y="7" width="28" height="6" rx="2" fill="var(--yellow)" stroke="var(--orange)" strokeWidth="1.4" />
        <rect x="38" y="13" width="4" height="8" rx="1" fill="var(--yellow)" stroke="var(--orange)" strokeWidth="1" />
        <rect x="44" y="13" width="4" height="6" rx="1" fill="var(--yellow)" stroke="var(--orange)" strokeWidth="1" />
      </g>
      {/* padlock */}
      <g transform="translate(48 68)">
        <path d="M14 22 v-10 a16 16 0 0 1 32 0 v10" fill="none" stroke="var(--green)" strokeWidth="4" strokeLinecap="round" />
        <rect x="8" y="20" width="44" height="36" rx="10" fill="var(--mint)" stroke="var(--green)" strokeWidth="2.4" />
        <circle cx="30" cy="36" r="5" fill="var(--green)" />
        <rect x="28" y="40" width="4" height="8" rx="1.5" fill="var(--green)" />
      </g>
    </>
  )
}

export function TodoEmpty({ variant = 'idle', size = 140, className }: TodoEmptyProps) {
  const style: CSSProperties | undefined = className ? undefined : { display: 'block' }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 140 140"
      className={className}
      style={style}
      role="img"
      aria-label={LABELS[variant]}
    >
      {variant === 'idle' && <IdleScene />}
      {variant === 'done' && <DoneScene />}
      {variant === 'overdue' && <OverdueScene />}
      {variant === 'signin' && <SigninScene />}
    </svg>
  )
}
