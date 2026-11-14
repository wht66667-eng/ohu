import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { requestAgnes } from '../../lib/agnes-ai'
import styles from './PlayfulReadings.module.css'

export function TarotAiPanel({ active, reading }: { active: boolean; reading: string | null }) {
  return <>
    <TarotAiForm active={active} reading={null} />
    {reading ? <TarotAiForm key={reading} active={active} reading={reading} />
      : <p className={styles.aiDisclosure}>翻牌后可请 AI 解读当前牌面。</p>}
  </>
}

export function ZodiacAiPanel({ active }: { active: boolean }) {
  return <TarotAiForm active={active} reading={null} knowledge="星座" />
}

function TarotAiForm({ active, reading, knowledge = '塔罗' }: {
  active: boolean
  reading: string | null
  knowledge?: '塔罗' | '星座'
}) {
  const [draft, setDraft] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')
  const pending = useRef<AbortController | null>(null)
  const question = draft.trim()
  const canSubmit = active && consent && !busy && Boolean(reading || question)
  const title = reading ? '解读这次牌面' : `了解${knowledge}知识`

  useLayoutEffect(() => {
    if (!active) {
      setConsent(false)
      setBusy(false)
      setAnswer('')
      setError('')
    }
    return () => {
      pending.current?.abort()
      pending.current = null
    }
  }, [active])

  function clearResponse() {
    pending.current?.abort()
    pending.current = null
    setBusy(false)
    setAnswer('')
    setError('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit || pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setBusy(true)
    setAnswer('')
    setError('')

    const prompt = reading
      ? `请按以下已翻开的牌和牌阵位置提供一个反思角度，再给出一个可自行判断的小行动。\n${reading}${question ? `\n用户的问题：${question}` : ''}`
      : `请回答用户的${knowledge}文化或玩法问题，提供常见象征与玩法背景。\n用户的问题：${question}`

    try {
      const response = await requestAgnes('playful-reading', prompt, controller.signal)
      if (pending.current === controller) setAnswer(response)
    } catch (reason) {
      if (pending.current === controller) setError(reason instanceof Error ? reason.message : 'AI 暂时无法回应，请稍后重试。')
    } finally {
      if (pending.current === controller) {
        pending.current = null
        setBusy(false)
      }
    }
  }

  return <form className={styles.aiPrelude} aria-label={title} onSubmit={event => void submit(event)}>
    <label className={styles.label}>{reading ? '想结合牌面想一想的问题（可选）' : '想了解什么？'}
      <textarea className={styles.aiInput} rows={2} maxLength={reading ? 1000 : 3000} value={draft}
        placeholder={reading ? '例如，我这周可以先做好哪件事？'
          : knowledge === '星座' ? '例如，星座符号从哪里来？' : '例如，单张牌和三张牌阵有什么区别？'}
        onChange={event => { setDraft(event.target.value); setConsent(false); clearResponse() }} />
    </label>
    <p className={styles.aiDisclosure}>{reading ? '发送本次问题、牌名、位置及正逆位' : '发送本次问题'}给哦狐 AI 服务及模型服务商。请勿填写个人敏感信息。</p>
    <label className={styles.aiConsent}>
      <input type="checkbox" checked={consent} onChange={event => { setConsent(event.target.checked); if (!event.target.checked) clearResponse() }} />
      <span>{reading ? '同意发送本次问题和当前牌面' : `同意发送本次${knowledge}知识问题`}</span>
    </label>
    <button type="submit" className={styles.aiDraw} aria-disabled={!canSubmit}>
      {busy ? 'AI 正在回复…' : reading ? '用 AI 解读这次牌面' : `问 AI ${knowledge}知识`}
    </button>
    {error ? <p className={styles.aiError} role="alert">{error}</p> : null}
    <div aria-live="polite">
      {answer ? <div className={styles.aiReply}><b>哦狐 AI</b><span>{answer}</span><small>仅供娱乐与自我反思。</small></div> : null}
    </div>
  </form>
}
