import { useState, type ReactNode } from 'react'

/**
 * 折叠卡：标题行常驻，点击后向下展开内容（成绩页的登录/连接、导入、手动录入都用它）。
 * 默认收起，把成绩内容顶到首屏；状态与标题仍然一眼可见。
 */
export function CollapsibleCard({ title, meta, status, tone = 'neutral', defaultOpen = false, children }: {
  title: string
  meta?: string
  status?: string
  tone?: 'neutral' | 'ok' | 'warn'
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const pillBg = tone === 'ok' ? 'var(--green-soft,#e9f2eb)' : tone === 'warn' ? 'var(--danger-soft,#fff1ee)' : 'rgba(0,0,0,.05)'
  const pillFg = tone === 'ok' ? 'var(--green-text,#16735b)' : tone === 'warn' ? 'var(--danger,#a3321b)' : 'var(--text-2,#556)'
  return <section style={{ border: '1px solid var(--line,#dce5dc)', borderRadius: 20, background: 'var(--card,#fff)', overflow: 'hidden' }}>
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      aria-expanded={open}
      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: 'transparent', border: 0, font: 'inherit', textAlign: 'left', cursor: 'pointer' }}
    >
      <span style={{ display: 'grid', gap: 2, flex: 1, minWidth: 0 }}>
        <b style={{ fontSize: 14 }}>{title}</b>
        {meta ? <small style={{ fontSize: 11.5, color: 'var(--text-3,#777)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</small> : null}
      </span>
      {status ? <span style={{ flex: 'none', padding: '4px 9px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: pillBg, color: pillFg }}>{status}</span> : null}
      <span aria-hidden="true" style={{ flex: 'none', fontSize: 16, color: 'var(--text-3,#888)', transition: 'transform .18s ease', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>›</span>
    </button>
    {open ? <div style={{ display: 'grid', gap: 12, padding: '14px 16px 16px', borderTop: '1px solid var(--line,#eee)' }}>{children}</div> : null}
  </section>
}
