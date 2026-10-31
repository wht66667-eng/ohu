import { useLocation, useNavigate } from 'react-router-dom'
import { IconBack, IconSearch } from './Icons'
import { goBack } from '../lib/back'
import styles from './PageHeader.module.css'
import { useRef, type ReactNode } from 'react'
import { FoxSheetPose } from './fox/FoxSheetPose'

export function PageHeader({
  title,
  right,
  onBack,
}: {
  title: string
  right?: ReactNode
  onBack?: () => void
}) {
  const nav = useNavigate()
  const isAdmin = useLocation().pathname.startsWith('/admin')
  return (
    <header className={styles.head}>
      <button type="button" className={styles.back} onClick={onBack ?? (() => goBack(nav))} aria-label="返回">
        <IconBack />
      </button>
      <h1 className={styles.title}><span>{title}</span>{!isAdmin && <FoxSheetPose className={styles.foxMark} pose="waving" />}</h1>
      <div className={styles.right}>{right}</div>
    </header>
  )
}

export function SearchField({
  placeholder,
  value,
  onChange,
  onSubmit,
}: {
  placeholder: string
  value?: string
  onChange?: (v: string) => void
  onSubmit?: (v: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <label className={styles.search}>
      <IconSearch />
      <input
        ref={input}
        aria-label={placeholder.replace(/…$/, '')}
        type="search"
        name="page-search"
        autoComplete="off"
        enterKeyHint="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onSubmit?.((e.target as HTMLInputElement).value)
          }
        }}
      />
      {value && onChange ? <button type="button" className={styles.clearSearch} aria-label="清空搜索" onClick={() => { onChange(''); input.current?.focus() }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg></button> : null}
    </label>
  )
}

export function HeaderWithSearch({
  title,
  placeholder,
  value,
  onChange,
  onSubmit,
}: {
  title: string
  placeholder: string
  value?: string
  onChange?: (v: string) => void
  onSubmit?: (v: string) => void
}) {
  const nav = useNavigate()
  const isAdmin = useLocation().pathname.startsWith('/admin')
  return (
    <header className={`${styles.head} ${styles.withSearch}`}>
      <button type="button" className={styles.back} onClick={() => goBack(nav)} aria-label="返回">
        <IconBack />
      </button>
      <h1 className={`${styles.title} ${styles.left}`}>
        {title}{!isAdmin && <FoxSheetPose className={styles.foxMark} pose="waving" />}
      </h1>
      <SearchField placeholder={placeholder} value={value} onChange={onChange} onSubmit={onSubmit} />
    </header>
  )
}
