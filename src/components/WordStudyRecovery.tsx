import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ConfirmSheet } from './ConfirmSheet'
import { PageHeader } from './PageHeader'
import { ErrorState } from './ui/StateViews'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../lib/auth'
import { captureQbankSession, isQbankSessionCurrent } from '../lib/qbank'
import { useWordStudy } from '../lib/useWordStudy'
import { getLegacyWordStudySummary, restoreLegacyWordStudy } from '../services/words/study-storage'
import styles from './WordStudyRecovery.module.css'

export function WordStudyReadError({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return <div className={styles.page}>
    <PageHeader title={title} />
    <ErrorState title="学习记录暂时无法读取" hint={message} action={<button type="button" className={styles.action} onClick={onRetry}>重新读取</button>} />
    <Link className={styles.home} to="/">返回首页</Link>
  </div>
}

export function WordStudyRecovery() {
  useWordStudy()
  const auth = useAuth(), toast = useToast()
  const [owner, setOwner] = useState<ReturnType<typeof captureQbankSession> | null>(null)
  const summary = getLegacyWordStudySummary()
  if (!summary) return null
  const confirmed = owner && isQbankSessionCurrent(owner)
  return <>
    <section className={styles.recovery} aria-label="恢复旧学习记录">
      <div><strong>旧本机学习记录仍保留</strong><p>{summary.cards} 张记忆卡 · {summary.plans} 个自定义计划 · {summary.customWords} 个自定义词。确认属于你后，可恢复到当前账号。</p></div>
      <button type="button" className={styles.action} onClick={() => {
        if (auth.isSigned) setOwner(captureQbankSession())
        else void auth.ensureSignedIn('登录后确认并恢复旧学习记录')
      }}>{auth.isSigned ? '确认并恢复' : '登录后恢复'}</button>
    </section>
    {confirmed ? <ConfirmSheet title="确认旧学习记录属于你？" desc="这些记录可能来自此前使用这台设备的人。恢复到当前账号后保留原始备份；已有的新记录会保留，今日完成量从本版开始统计。" confirmText="属于我，恢复" onClose={() => setOwner(null)} onConfirm={() => {
      if (!owner || !isQbankSessionCurrent(owner)) return
      const result = restoreLegacyWordStudy()
      setOwner(null)
      if (result.ok) toast.ok('旧学习记录已恢复到当前账号')
      else toast.err(result.error || '恢复未完成，原始备份仍保留')
    }} /> : null}
  </>
}
