import { useEffect, useRef, useState } from 'react'
import { CAN_NATIVE_EXPRESS_JUMP, QUICK_JUMP_ENTRIES, openQuickJumpEntry, type QuickJumpEntry, type QuickJumpResult } from '../lib/express-quick-jump'
import styles from './ExpressQuickJump.module.css'

export function ExpressQuickJump() {
  const [pending, setPending] = useState('')
  const [feedback, setFeedback] = useState<{ entry: QuickJumpEntry; result: QuickJumpResult } | null>(null)
  const running = useRef(false)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  async function open(entry: QuickJumpEntry) {
    if (running.current) return
    running.current = true
    setPending(entry.id)
    setFeedback(null)
    try {
      const result = await openQuickJumpEntry(entry.id)
      if (mounted.current) setFeedback({ entry, result })
    } finally {
      running.current = false
      if (mounted.current) setPending('')
    }
  }

  function card(entry: QuickJumpEntry) {
    const content = <><span className={styles.mark} aria-hidden="true">{entry.mark}</span><span className={styles.label}><strong>{entry.title}</strong><small>{pending === entry.id ? '正在打开…' : !CAN_NATIVE_EXPRESS_JUMP ? entry.webUrl ? '打开平台网页' : '仅安卓 App 支持' : entry.hint}</small></span><span className={styles.arrow} aria-hidden="true">↗</span></>
    if (!CAN_NATIVE_EXPRESS_JUMP && entry.webUrl) return <a key={entry.id} className={styles.entry} href={entry.webUrl}>{content}</a>
    return <button key={entry.id} className={styles.entry} type="button" disabled={!CAN_NATIVE_EXPRESS_JUMP || !!pending} aria-busy={pending === entry.id} onClick={() => void open(entry)}>{content}</button>
  }

  return <section className={styles.panel} aria-label="快递快捷入口">
    <p className={styles.intro}>{CAN_NATIVE_EXPRESS_JUMP ? '不用输单号，打开对应 App 出示身份码或查看包裹。' : '电脑和浏览器打开平台网页；部分取件功能仍需在手机 App 内使用。'}</p>
    <h3>取件身份码</h3>
    <div className={styles.grid}>{QUICK_JUMP_ENTRIES.filter(entry => entry.group === 'code').map(card)}</div>
    <h3>待取与订单</h3>
    <div className={styles.grid}>{QUICK_JUMP_ENTRIES.filter(entry => entry.group === 'orders').map(card)}</div>
    {feedback ? <div className={styles.feedback} role={feedback.result.ok ? 'status' : 'alert'}>
      <p>{feedback.result.message}</p>
      {!feedback.result.ok && feedback.entry.webUrl ? <a href={feedback.entry.webUrl}>打开{feedback.entry.brand}平台网页 ↗</a> : null}
    </div> : null}
    <p className={styles.note}>身份码、放大和刷新由平台页面提供，需登录本人平台账号。</p>
  </section>
}
