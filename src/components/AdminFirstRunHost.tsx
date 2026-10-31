import { useEffect, useState } from 'react'
import { DialogLayer } from './ui/DialogLayer'
import { bootSettled, whenBootSettled } from '../lib/boot'
import { hasAcceptedLegal, markLegalAccepted, markPermsFinished } from '../lib/first-run'
import { adminNotificationPermission } from '../lib/admin-notifications'
import { SHELL_ONBOARDING } from '../data/shell-onboarding'
import styles from './FirstRunHost.module.css'

/** Management consent never initializes student schedules, exact alarms, or the keep-alive service. */
export function AdminFirstRunHost({ onDone }: { onDone: () => void }) {
  const [ready, setReady] = useState(() => bootSettled())
  const [legal, setLegal] = useState(() => hasAcceptedLegal('admin'))
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { let alive = true; void whenBootSettled().then(() => { if (alive) setReady(true) }); return () => { alive = false } }, [])
  if (!ready) return null
  const meta = SHELL_ONBOARDING.admin
  async function finish(request: boolean) {
    if (busy) return
    setBusy(true); setError('')
    try {
      if (request) await adminNotificationPermission(true)
      markPermsFinished('admin'); onDone()
    } catch { setError('暂时无法读取通知权限，可以稍后到管理设置中开启。') }
    finally { setBusy(false) }
  }
  return <DialogLayer title="管理端首次使用" onClose={() => {}} allowClose={false} className={styles.guideSurface}><div className={styles.card}>
    <div className={styles.head}><span className={styles.eyebrow}>哦狐 · 校园运营</span><h1>{legal ? '管理工作通知' : meta.title}</h1><p>{legal ? '新举报会在管理端运行期间同步提醒' : '请阅读管理端使用说明'}</p></div>
    <div className={styles.body}>{legal ? <><p>允许通知后，可接收学生举报与内容治理提醒。铃声、震动、横幅和锁屏显示可在手机系统的“哦狐管理工作通知”渠道调整。</p><p>当前使用在线轮询，关闭应用后不能保证新举报送达。</p></> : <><h2 className={styles.sectionTitle}>{meta.disclaimerTitle}</h2><ol className={styles.list}>{meta.disclaimer.map((line) => <li key={line}>{line}</li>)}</ol><h2 className={styles.sectionTitle}>{meta.manualTitle}</h2><ul className={styles.list}>{meta.manual.map((line) => <li key={line}>{line}</li>)}</ul><label className={styles.check}><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />我已阅读并同意以上说明</label></>}{error ? <p role="alert">{error}</p> : null}</div>
    <div className={styles.foot}>{legal ? <><button type="button" className={styles.main} disabled={busy} onClick={() => void finish(true)}>{busy ? '正在设置…' : '允许管理通知'}</button><button type="button" className={styles.ghost} disabled={busy} onClick={() => void finish(false)}>稍后设置</button></> : <button type="button" className={styles.main} disabled={!agreed} onClick={() => { markLegalAccepted('admin'); setLegal(true) }}>同意并继续</button>}</div>
  </div></DialogLayer>
}
