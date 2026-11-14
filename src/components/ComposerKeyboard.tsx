import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { CHAT_EMOJIS } from '../lib/emoji'
import styles from './ComposerKeyboard.module.css'

const EMOJI_KEYS = ['📚', '📝', '☕', '📷', '🌿', '✨', ...CHAT_EMOJIS.slice(0, 18)]
const SYMBOL_KEYS = ['，', '。', '！', '？', '、', '；', '：', '…', '（', '）', '「', '」', '—', '·', '#', '@', '✓', '★', '♡', '→', ...'1234567890']

export function ComposerKeyboard({ field, value, onChange, disabled = false }: {
  field: RefObject<HTMLInputElement | HTMLTextAreaElement | null>
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}) {
  const [panel, setPanel] = useState<'emoji' | 'symbols' | null>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const caret = useRef<number | null>(null)
  const id = useId()

  useLayoutEffect(() => {
    if (caret.current !== null) {
      field.current?.setSelectionRange(caret.current, caret.current)
      caret.current = null
    }
  }, [field, value])

  useEffect(() => {
    const input = field.current
    if (!panel || !input) return
    const dialog = input.closest('dialog')
    const dismiss = () => setPanel(null)
    const onDismiss = (event: Event) => {
      event.preventDefault()
      dismiss()
      toggle.current?.focus({ preventScroll: true })
    }
    input.addEventListener('focus', dismiss)
    dialog?.addEventListener('app-dismiss-composer-keyboard', onDismiss)
    return () => {
      input.removeEventListener('focus', dismiss)
      dialog?.removeEventListener('app-dismiss-composer-keyboard', onDismiss)
    }
  }, [field, panel])

  function insert(key: string) {
    const input = field.current
    if (disabled || !input || input.disabled || input.readOnly) return
    const start = input.selectionStart ?? input.value.length
    const end = input.selectionEnd ?? start
    const next = input.value.slice(0, start) + key + input.value.slice(end)
    if (input.maxLength >= 0 && next.length > input.maxLength) return
    if (next === input.value) input.setSelectionRange(start + key.length, start + key.length)
    else {
      caret.current = start + key.length
      onChange(next)
    }
  }

  return <div className={styles.root} onKeyDown={event => {
    if (panel && event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      setPanel(null)
      toggle.current?.focus({ preventScroll: true })
    }
  }}>
    <div className={styles.controls}>
      <button ref={toggle} type="button" disabled={disabled} aria-expanded={!!panel} aria-controls={panel ? id : undefined}
        onClick={() => { field.current?.blur(); setPanel(current => current ? null : 'emoji') }}>表情与符号</button>
      {panel ? <button type="button" disabled={disabled} onClick={() => { setPanel(null); field.current?.focus({ preventScroll: true }) }}>返回文字键盘</button> : null}
    </div>
    {panel ? <section id={id} className={styles.panel} aria-label="哦狐表情与符号键盘">
      <div className={styles.controls}>
        <button type="button" disabled={disabled} aria-pressed={panel === 'emoji'} onClick={() => setPanel('emoji')}>表情</button>
        <button type="button" disabled={disabled} aria-pressed={panel === 'symbols'} onClick={() => setPanel('symbols')}>符号</button>
      </div>
      <div className={styles.keys}>{(panel === 'emoji' ? EMOJI_KEYS : SYMBOL_KEYS).map(key =>
        <button type="button" disabled={disabled} key={key} aria-label={'插入 ' + key} onClick={() => insert(key)}>{key}</button>
      )}</div>
    </section> : null}
  </div>
}
