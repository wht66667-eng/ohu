import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { GradeTabs } from '../../components/GradeTabs'
import { openExternalUrl } from '../../lib/campus-links'
import { CAMPUS_BRIDGE_AVAILABLE } from '../../lib/campus-bridge'
import { waitForBackgroundSync } from '../../lib/background-sync'
import { captureQbankSession } from '../../lib/qbank'
import { useQbankRevision } from '../../lib/useQbankRevision'
import {
  PU_BUCKET_LABEL,
  PU_CLASS_LABEL,
  parsePocketUniPayload,

  puCreditOf,
  puDisplayTotal,
  puIsEmpty,
  puRowsWithCredit,
  type PuSummary,
} from '../../lib/pocketuni-parse'
import {
  PU_HOME_URL,
  clearPocketUni,
  readPocketUni,
  savePocketUni,
} from '../../lib/pocketuni-store'
import { clearPocketUniAuth, closeCampusWebView, runPocketUniSync } from '../../lib/one-click'
import { clearPuCredentials, readPuCredentials, savePuCredentials } from '../../lib/pocketuni-credentials'
import { readQuality } from '../../lib/quality-store'
import { CollapsibleCard } from '../../components/CollapsibleCard'
import styles from './pocketuni.module.css'

const PU_STAGE_TEXT: Record<string, string> = {
  'pu-login': '口袋校园登录',
  pu: 'PU 学分',
}

function creditText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return String(Number(value.toFixed(2)))
}

function stampText(stamp: number): string {
  if (!stamp) return '时间未知'
  const date = new Date(stamp)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '时间未知'
}

export function PocketUniPage({ embedded = false }: { embedded?: boolean } = {}) {
  useQbankRevision()
  const session = captureQbankSession()
  return <PocketUniContent key={`${session.uid}:${session.revision}`} embedded={embedded} />
}

function PocketUniContent({ embedded = false }: { embedded?: boolean } = {}) {
  const [summary, setSummary] = useState<PuSummary | null>(() => readPocketUni())
  const [draft, setDraft] = useState('')
  const [preview, setPreview] = useState<PuSummary | null>(null)
  const [channel, setChannel] = useState<'json' | 'text' | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [account, setAccount] = useState(() => readPuCredentials().account)
  const [password, setPassword] = useState(() => readPuCredentials().password)
  const [remember, setRemember] = useState(true)
  const [connected, setConnected] = useState(() => Boolean(readPuCredentials().password))
  const [syncing, setSyncing] = useState(false)
  const [stage, setStage] = useState('')
  const [syncNotice, setSyncNotice] = useState('')
  const [syncError, setSyncError] = useState('')
  const guest = !captureQbankSession().uid
  const quality = readQuality()

  const total = summary ? puDisplayTotal(summary) : null
  const rows = useMemo(() => (summary ? puRowsWithCredit(summary) : []), [summary])
  const classes = useMemo(() => (summary ? (['a', 'b', 'c', 'labor'] as const) : []), [summary])

  function analyze() {
    setError(''); setMessage('')
    if (!draft.trim()) { setError('先把口袋校园「成绩明细」页的文字粘贴进来，或粘贴 credit 接口的 JSON。'); return }
    try {
      const parsed = parsePocketUniPayload(draft)
      if (puIsEmpty(parsed.summary)) {
        setPreview(null); setChannel(null)
        setError('没有识别到学分。请确认复制的是「成绩明细」页（文字可选中），不是 canvas 渲染的「我的成绩单」。')
        return
      }
      setPreview(parsed.summary); setChannel(parsed.channel)
      setMessage(`已识别：总学分 ${creditText(puDisplayTotal(parsed.summary))}，${puRowsWithCredit(parsed.summary).length} 条有学分明细。核对无误后保存。`)
    } catch (failure) {
      setPreview(null); setChannel(null)
      setError(failure instanceof Error ? failure.message : '识别失败，请重试。')
    }
  }

  function save() {
    if (!preview) return
    setError(''); setMessage('')
    try {
      const saved = savePocketUni(preview)
      setSummary(saved)
      setPreview(null); setChannel(null); setDraft('')
      setMessage('PU 二课学分已保存到本机当前账号；下次打开可直接查看。')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '保存失败，请重试。')
    }
  }

  function clear() {
    if (!confirmClear) { setConfirmClear(true); setMessage('再点一次「确认清除」会删除本机 PU 缓存。'); return }
    const ok = clearPocketUni()
    setConfirmClear(false)
    if (!ok) { setError('清除失败，请稍后重试。'); return }
    setSummary(null); setPreview(null); setMessage('本机 PU 缓存已清除。')
  }

  function openLogin() {
    document.getElementById('pu-connect')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  async function syncPu() {
    if (syncing) return
    setSyncError(''); setSyncNotice(''); setStage('')
    if (!CAMPUS_BRIDGE_AVAILABLE) { setSyncError('PU 取数只在 Android App 内可用；可以先用下方「粘贴成绩明细」导入。'); return }
    if (!connected && (!account.trim() || !password)) {
      setSyncError('请先填写口袋校园账号和密码；也可以点「去页面手动登录」。')
      return
    }
    setSyncing(true)
    try {
      setStage('正在完成后台同步…')
      await waitForBackgroundSync()
      setStage('')
      const result = await runPocketUniSync({
        account: account.trim() || undefined,
        password: password || undefined,
        report: (next, text) => setStage(`${PU_STAGE_TEXT[next] ?? next} · ${text}`),
      })
      const saved = readPocketUni()
      setSummary(saved)
      if (remember && account.trim() && password) {
        savePuCredentials({ account, password, remember: true })
        setConnected(true)
      }
      if (result.ok) {
          setSyncNotice(`已更新 PU 学分${saved ? `：总学分 ${creditText(puDisplayTotal(saved))}` : ''}。`)
      } else {
        setSyncError(result.message || 'PU 更新失败，请重试。')
      }
    } catch (failure) {
      setSyncError(failure instanceof Error ? failure.message : 'PU 更新失败，请重试。')
    } finally {
      setSyncing(false)
      setStage('')
    }
  }

  function disconnect() {
    clearPuCredentials()
    setAccount('')
    setPassword('')
    setConnected(false)
    setSyncNotice('已断开口袋校园连接；下次更新需要重新登录。')
    void clearPocketUniAuth().catch(() => undefined)
  }

  const content = <div className={styles.content}>
      {embedded ? null : <GradeTabs active="pu" />}

      {quality ? <section style={{ marginBottom: 12, padding: 16, borderRadius: 18, background: 'var(--card,#fff)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div><h2 style={{ margin: 0, fontSize: 22 }}>校园档案学分</h2><small style={{ opacity: 0.65 }}>校园档案 · 最近获取 {new Date(quality.syncedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</small></div>
          <b style={{ fontSize: 26 }}>{quality.totalCredit}</b>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 10 }}>
          {[
            ['A 类', quality.type1, 4],
            ['B 类', quality.type2, 6],
            ['劳动教育', quality.type3, 2],
          ].map(([label, value, target]) => {
            const gap = Math.max(0, Number(target) - Number(value))
            return <div key={String(label)} style={{ padding: 10, borderRadius: 14, background: 'rgba(31,143,95,.06)' }}>
              <small style={{ display: 'block', opacity: 0.7 }}>{label}</small>
              <b style={{ fontSize: 24 }}>{Number(value).toFixed(2).replace(/\.00$/, '')}</b>
              <small style={{ display: 'block' }}>参考 {target} 学分</small>
              <em style={{ fontStyle: 'normal', fontSize: 11, opacity: 0.7 }}>{gap ? `差 ${gap.toFixed(2).replace(/\.00$/, '')}` : '已达标'}</em>
            </div>
          })}
        </div>
        <Link to="/study/quality" style={{ display: 'inline-block', marginTop: 8, color: 'var(--green-text)', fontSize: 13, fontWeight: 700, textDecoration: 'none' }}>查看校园档案 ›</Link>
      </section> : null}

      <section className={styles.hero}>
        <span className={styles.eyebrow}>PU 官方 · 口袋校园</span>
        <h2>官方成绩<br />按分类看学分</h2>
        <div className={styles.totalRow}>
          <strong>{creditText(total)}</strong><span>总学分</span>
        </div>
        <div className={styles.split}>
          <div><small>活动类</small><b>{creditText(summary?.activityCredit ?? null)}</b></div>
          <div><small>成果类</small><b>{creditText(summary?.applyCredit ?? null)}</b></div>
        </div>
        <button type="button" className={styles.primary} disabled={syncing || !CAMPUS_BRIDGE_AVAILABLE} onClick={() => void (connected ? syncPu() : openLogin())}>
          {syncing ? '正在读取…' : connected ? '更新 PU 学分' : '连接口袋校园'}
        </button>
        <button type="button" className={styles.outline} disabled={syncing} onClick={() => openExternalUrl(PU_HOME_URL)}>打开口袋校园 ↗</button>
        <small className={styles.heroNote}>
          更新于 {stampText(summary?.syncedAt || 0)} · PU 是口袋校园的独立账号体系，和校园档案 7058 不是同一口径，两边学分不混算。
        </small>
      </section>


      {guest ? <p className={styles.notice} role="status">当前未登录哦狐，PU 数据保存在本机访客区；登录后会按账号隔离。</p> : null}

      {summary ? <section className={styles.card}>
        <div className={styles.cardHead}>
          <div><span className={styles.kicker}>已保存</span><h3>PU 学分概览</h3></div>
          <span className={styles.sourcePill}>口袋校园</span>
        </div>
        <div className={styles.classChips}>
          {classes.length ? classes.map((item) => <span key={item} className={styles.classChip}>
            <b>{PU_CLASS_LABEL[item]}</b><em>{creditText(puCreditOf(summary, item))}</em>
          </span>) : <span className={styles.muted}>明细里没有分类信息，只读到总数。</span>}
        </div>
        {rows.length ? <ul className={styles.rows}>
          {rows.map((row, index) => <li key={`${row.name}-${index}`}>
            <div>
              <b>{row.category || row.name}</b>
              <span>{row.name !== (row.category || row.name) ? row.name : PU_BUCKET_LABEL[row.bucket]}</span>
            </div>
            <div className={styles.rowRight}>
              <em>{creditText(row.credit)}</em>
              <small>{PU_CLASS_LABEL[row.puClass]}{row.bucket === 'unknown' ? '' : ` · ${PU_BUCKET_LABEL[row.bucket]}`}</small>
            </div>
          </li>)}
        </ul> : <p className={styles.muted}>只读到了总学分，没有可展示的分类明细。可在下方重新粘贴「成绩明细」页文字补全。</p>}
        <div className={styles.footer}>
          <small>更新于 {stampText(summary.syncedAt)} · 来源 pocketuni</small>
          <button type="button" className={styles.ghost} onClick={clear}>{confirmClear ? '确认清除' : '清除本机缓存'}</button>
          <button type="button" className={styles.ghost} onClick={() => { clearPocketUni(); setSummary(null); setMessage('已解除 PU 授权，下次需要重新登录。'); void clearPocketUniAuth().catch(() => undefined) }}>解除 PU 授权</button>
        </div>
      </section> : <section className={styles.card}>
        <h3>还没有 PU 记录</h3>
        <button type="button" className={styles.primary} onClick={openLogin}>登录口袋校园并读取</button>
        <button type="button" className={styles.outline} onClick={() => openExternalUrl(PU_HOME_URL)}>打开口袋校园网页 ↗</button>
      </section>}

      <div id="pu-connect">
        <CollapsibleCard
          title="口袋校园 · 连接与更新"
          meta={connected ? '已保存 PU 账号，可直接更新' : '独立账号，连接一次后免输入'}
          status={syncing ? '正在更新' : connected ? '已连接' : '未连接'}
          tone={connected ? 'ok' : 'neutral'}
        >
          <p className={styles.muted}>{connected
            ? '已在本机加密保存 PU 账号。点「更新 PU 学分」直接读取官方学分，随时可以断开。'
            : '输入口袋校园账号密码后，App 会在后台自动登录并读取官方学分，不用跳到官网。也可以打开口袋校园页面手动登录一次。'}</p>
          <label className={styles.field}>PU 账号<input value={account} autoComplete="username" onChange={(event) => { setAccount(event.target.value); setSyncError(''); setSyncNotice('') }} placeholder="口袋校园手机号 / 学号" /></label>
          <label className={styles.field}>PU 密码<input type="password" value={password} autoComplete="current-password" onChange={(event) => { setPassword(event.target.value); setSyncError(''); setSyncNotice('') }} placeholder="口袋校园密码" /></label>
          <label className={styles.muted} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} style={{ width: 18, height: 18 }} />
            保持连接（本机加密保存，下次免输入）
          </label>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} disabled={syncing || !CAMPUS_BRIDGE_AVAILABLE} onClick={() => void syncPu()}>
              {syncing ? '正在读取…' : connected ? '更新 PU 学分' : '登录并读取学分'}
            </button>
            {connected && !syncing ? <button type="button" className={styles.outline} onClick={disconnect}>断开连接</button> : null}
            {!connected && !syncing ? <button type="button" className={styles.outline} onClick={() => { setStage('请在打开的页面登录口袋校园'); void runPocketUniSync({ report: (next, text) => setStage(`${PU_STAGE_TEXT[next] ?? next} · ${text}`) }).then(() => { const next = readPocketUni(); setSummary(next); setSyncNotice('已更新 PU 学分。') }).catch((failure) => setSyncError(failure instanceof Error ? failure.message : 'PU 更新失败，请重试。')).finally(() => setStage('')) }}>去页面手动登录</button> : null}
            {syncing ? <button type="button" className={styles.outline} onClick={() => { setStage('已取消'); void closeCampusWebView().catch(() => undefined) }}>取消</button> : null}
          </div>
          {stage ? <p className={styles.stageText} role="status">{stage}</p> : null}
          {syncNotice ? <p className={styles.success} role="status">{syncNotice}</p> : null}
          {syncError ? <p className={styles.error} role="alert">{syncError}</p> : null}
        </CollapsibleCard>
      </div>

      <CollapsibleCard title="粘贴成绩明细导入" meta="在口袋校园打开成绩明细，复制文字后回到这里">
        <label className={styles.field}>粘贴内容
          <textarea
            value={draft}
            onChange={(event) => { setDraft(event.target.value); setError(''); setMessage(''); setPreview(null) }}
            rows={6}
            maxLength={20000}
            placeholder={'活动类 4.25 + 成果类 0.60 = 总成绩 4.85\n【素质拓展B类】团员主题教育（0.85）\n【劳动教育】公益劳动（1.00）'}
          />
        </label>
        <div className={styles.actions}>
          <button type="button" className={styles.outline} onClick={analyze} disabled={!draft.trim()}>识别内容</button>
          <button type="button" className={styles.primary} onClick={save} disabled={!preview}>保存到本机</button>
        </div>
        {preview ? <div className={styles.preview}>
          <b>识别结果 · {channel === 'json' ? '接口 JSON' : '页面文字'}</b>
          <span>总学分 {creditText(puDisplayTotal(preview))} · 活动 {creditText(preview.activityCredit)} · 成果 {creditText(preview.applyCredit)} · 明细 {puRowsWithCredit(preview).length} 条</span>
          {(['a', 'b', 'c', 'labor'] as const).map((item) => <span key={item}>{PU_CLASS_LABEL[item]} {creditText(puCreditOf(preview, item))}</span>)}
        </div> : null}
        {message ? <p className={styles.success} role="status">{message}</p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <small className={styles.muted}>识别只在本机进行；不会把粘贴内容发送到服务器。保存时只保留学分数字与分类名。</small>
      </CollapsibleCard>

      <section className={styles.noteCard}>
        <b>口径说明</b>
        <p>· 没读到 ≠ 0：未读取到的总分会显示「—」，不会写成 0 学分。</p>
        <p>· 0 分分类只用于看「还差哪类」，不进合计与明细。</p>
        <p>· 学校尚未公布 A/B/C 类毕业要求，页面不写「还差 X 学分」，避免伪造达标线。</p>
        <Link className={styles.back} to="/study?tab=grades">返回成绩 ›</Link>
      </section>
    </div>

  if (embedded) return content
  return <div className={styles.page}>
    <PageHeader title="PU 成绩" />
    {content}
  </div>
}
