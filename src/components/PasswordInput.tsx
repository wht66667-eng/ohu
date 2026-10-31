import { useState, type InputHTMLAttributes, type ReactNode } from 'react'

/**
 * 密码输入框：右侧小眼睛切换明文 / 密文，方便用户核对账号密码。
 * 默认密文；透传 className / placeholder / value / onChange 等全部原生属性。
 */
export interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** 自定义眼睛图标（默认内置 SVG） */
  eyeIcon?: ReactNode
}

export function IconEye({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.8" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}

export function IconEyeOff({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 4l16 16"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M9.9 5.4A10.6 10.6 0 0 1 12 5.1c6 0 9.5 6.5 9.5 6.5a17.6 17.6 0 0 1-3.2 3.9M6.1 7A17.3 17.3 0 0 0 2.5 11.6S6 18.1 12 18.1a10.4 10.4 0 0 0 4.3-.9"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 9.7a3.4 3.4 0 0 0 4.7 4.8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function PasswordInput({ className, eyeIcon, ...rest }: PasswordInputProps) {
  const [show, setShow] = useState(false)
  return (
    <span className="pwd-wrap">
      <input {...rest} type={show ? 'text' : 'password'} className={className} autoComplete="off" />
      <button
        type="button"
        className="pwd-eye"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? '隐藏密码' : '显示密码'}
        aria-pressed={show}
        title={show ? '隐藏密码' : '显示密码'}
      >
        {eyeIcon ?? (show ? <IconEyeOff /> : <IconEye />)}
      </button>
    </span>
  )
}
