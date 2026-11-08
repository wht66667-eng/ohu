import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * 底部弹层：体测/PU 这类「独立账号连接」用它收一次密码，
 * 连接成功后折叠成页面里的一行状态，不再长期占版面。
 *
 * 注意：页面外壳（PageTransition）带 transform + overflow:hidden，
 * 弹层必须 portal 到 document.body，否则 position:fixed 会被裁在页面里。
 */
export function ActionSheet({ open, title, subtitle, onClose, children, footer }: {
  open: boolean
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, onClose])
  if (!open || typeof document === 'undefined') return null
  return createPortal(<div role="presentation" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,.38)', display: 'flex', alignItems: 'flex-end' }}>
    <style>{'@keyframes ohu-sheet-up{from{transform:translateY(26px);opacity:.5}to{transform:translateY(0);opacity:1}}'}</style>
    <section
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => event.stopPropagation()}
      style={{
        width: '100%', maxHeight: '86dvh', overflowY: 'auto', background: 'var(--card,#fff)',
        borderRadius: '22px 22px 0 0', padding: '18px 16px calc(18px + env(safe-area-inset-bottom))',
        display: 'grid', gap: 12, animation: 'ohu-sheet-up .22s cubic-bezier(.2,.8,.2,1)',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
          {subtitle ? <small style={{ display: 'block', marginTop: 4, color: 'var(--text-3,#777)', fontSize: 12, lineHeight: 1.5 }}>{subtitle}</small> : null}
        </div>
        <button type="button" aria-label="关闭" onClick={onClose} style={{ border: 0, background: 'transparent', fontSize: 24, lineHeight: 1, cursor: 'pointer', color: 'var(--text-2,#555)' }}>×</button>
      </header>
      {children}
      {footer}
    </section>
  </div>, document.body)
}
