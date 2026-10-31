import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CampusIcon } from './CampusIcon'
import { DialogLayer } from './ui/DialogLayer'
import type { ReminderCard, ReminderPopupStyle } from '../lib/reminder-popup'
import styles from './ReminderPopup.module.css'

/** Presentation only. Notifications, permissions and sound remain the host's responsibility. */
export function ReminderPopup({ item, variant, remaining = 0, onDismiss, onQueue }: {
  item: ReminderCard; variant: ReminderPopupStyle; remaining?: number; onDismiss: () => void; onQueue?: () => void
}) {
  const [details, setDetails] = useState(false)
  const icon = item.kind.startsWith('class') ? 'cal' : item.kind === 'todo' ? 'task' : 'book'
  const actions = <div className={styles.actions}>
    <button type="button" className={styles.secondary} onClick={onDismiss}>知道了</button>
    <Link className={styles.primary} to={item.route} onClick={onDismiss}>{item.actionLabel}<span aria-hidden="true">↗</span></Link>
  </div>
  const count = remaining > 0 && onQueue ? <button type="button" className={styles.queue} onClick={onQueue}>还有 {remaining} 条提醒<span aria-hidden="true">›</span></button> : null
  const body = <>
    <div className={styles.heading}><span className={styles.icon}><CampusIcon name={icon} size={22} /></span><span className={styles.label}>{item.title}</span><button type="button" className={styles.close} aria-label="关闭这条提醒" onClick={onDismiss}>×</button></div>
    <h2 className={styles.name}>{item.name}</h2>
    {item.detail ? <p className={styles.detail}>{item.detail}</p> : null}
    {item.hint ? <p className={styles.hint}>{item.hint}</p> : null}
    {actions}{count}
  </>
  if (variant !== 'banner') return <DialogLayer title={item.title} onClose={onDismiss} className={`${styles.surface} ${variant === 'dialog' ? styles.center : ''}`}>{body}</DialogLayer>
  return <>
    <section className={styles.banner} aria-label={item.title}>
      <span className={styles.icon}><CampusIcon name={icon} size={22} /></span>
      <button type="button" className={styles.summary} onClick={() => setDetails(true)} aria-label={`${item.title}：${item.name}，查看详情`}>
        <span className={styles.label}>{item.title}</span><strong>{item.name}</strong><span className={styles.detail}>{item.detail || item.hint}</span>
      </button>
      <button type="button" className={styles.close} aria-label="关闭这条提醒" onClick={onDismiss}>×</button>
      <span className={styles.announcement} role="status" aria-live="polite" aria-atomic="true">{item.title}，{item.name}，{item.detail || item.hint}{remaining > 0 ? `，还有${remaining}条提醒` : ''}</span>
      {count}
    </section>
    {details ? <DialogLayer title={item.title} onClose={() => setDetails(false)} className={styles.surface}>{body}</DialogLayer> : null}
  </>
}
