import { useState } from 'react'
import { ConfirmSheet } from '../../components/ConfirmSheet'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../context/ToastContext'
import { useQbankRevision } from '../../lib/useQbankRevision'
import { captureQbankSession, getLegacyQbankSummary, isQbankSessionCurrent, restoreLegacyQbank } from '../../lib/qbank'
import styles from './english.module.css'

export function QbankRecovery() {
  useQbankRevision()
  const auth = useAuth()
  const toast = useToast()
  const [session, setSession] = useState<ReturnType<typeof captureQbankSession> | null>(null)
  const old = getLegacyQbankSummary()
  if (!old) return null
  const identity = auth.isSigned ? '当前账号' : '当前访客记录'
  const confirming = session && isQbankSessionCurrent(session)
  return <>
    <div className={styles.recoveryCard}>
      <div><strong>旧版题库仍保留在本机</strong><p>{old.questions} 题 · {old.papers} 份试卷。确认属于你后，可恢复到{identity}。</p></div>
      <button type="button" className={styles.syncRetry} onClick={() => setSession(captureQbankSession())}>恢复旧题库</button>
    </div>
    {confirming ? <ConfirmSheet
      title="确认旧题库属于你？"
      desc={`旧缓存可能来自此前使用这台设备的账号。恢复后放入${identity}，仅保存到本机；原始备份继续保留。`}
      confirmText="确认并恢复"
      onClose={() => setSession(null)}
      onConfirm={() => {
        if (!session || !isQbankSessionCurrent(session)) return
        const result = restoreLegacyQbank()
        setSession(null)
        if (result.ok) toast.ok('旧题库已恢复到本机')
        else toast.err(result.error || '恢复失败，旧题库仍保留')
      }}
    /> : null}
  </>
}
