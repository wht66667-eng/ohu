import { useId, useRef, useState } from 'react'
import { DialogLayer } from './ui/DialogLayer'
import styles from '../pages/work.module.css'

/**
 * 二次确认弹层（管理端写操作统一使用）。
 *
 * 支持两种形态：
 * - 普通确认（通过并已打款、强制打烊等）：仅需点确认
 * - 带原因确认（驳回提现等）：`reasonLabel` 非空时展示输入框，可要求必填
 */
export function ConfirmSheet({
  title,
  desc,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  reasonLabel,
  reasonPlaceholder = '',
  reasonRequired = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string
  desc?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  reasonLabel?: string
  reasonPlaceholder?: string
  reasonRequired?: boolean
  busy?: boolean
  onConfirm: (reason: string) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const reasonId = useId()
  const errorId = useId()
  const reasonInput = useRef<HTMLInputElement>(null)

  function submit() {
    if (busy) return
    if (reasonLabel && reasonRequired && reason.trim().length < 2) {
      setErr('请填写至少 2 个字的原因，便于申请人了解处理结果')
      reasonInput.current?.focus()
      return
    }
    setErr('')
    onConfirm(reason.trim())
  }

  return (
    <DialogLayer title={title} onClose={onClose} allowClose={!busy}>
        <div className={styles.handle} aria-hidden="true" />
        <h4 className={styles.sheetTitle}>{title}</h4>
        {desc ? <p className={styles.wdTip}>{desc}</p> : null}

        {reasonLabel ? (
          <div className={styles.field}>
            <label htmlFor={reasonId}>{reasonLabel}</label>
            <input
              id={reasonId}
              ref={reasonInput}
              aria-invalid={!!err}
              aria-describedby={err ? errorId : undefined}
              disabled={busy}
              className={styles.input}
              maxLength={60}
              placeholder={reasonPlaceholder}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        ) : null}

        {err ? <p id={errorId} role="alert" className={styles.err}>{err}</p> : null}

        <div className={styles.btnRow}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnBlk} ${styles.btnN}`}
            onClick={(event) => event.currentTarget.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))}
            disabled={busy}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnBlk} ${danger ? styles.btnD : styles.btnP}`}
            onClick={submit}
            disabled={busy}
          >
            {busy ? '处理中…' : confirmText}
          </button>
        </div>
    </DialogLayer>
  )
}
