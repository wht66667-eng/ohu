import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { EmptyState } from '../../components/ui/StateViews'
import { copyText } from '../../lib/campus-account'
import { getQbankRevision, captureQbankSession, isQbankSessionCurrent, subscribeQbank } from '../../lib/qbank'
import { useAuth } from '../../lib/auth'
import { createFeedback } from '../../lib/feedback'
import { DialogLayer } from '../../components/ui/DialogLayer'
import { findScheduleSchool, readScheduleGuideSchool, saveScheduleGuideSchool, SCHEDULE_SCHOOLS, type ScheduleSchool } from '../../lib/schedule-schools'
import styles from './SchoolScheduleGuide.module.css'
import scheduleStyles from './ScheduleHome.module.css'

export function ScheduleSchoolPicker({ schoolId, onChange }: { schoolId: string; onChange: (id: string) => void }) {
  return <div className={styles.picker}>
    <label htmlFor="schedule-school">查询学校</label>
    <select id="schedule-school" value={schoolId} onChange={event => onChange(event.target.value)}>
      {SCHEDULE_SCHOOLS.map(school => <option value={school.id} key={school.id}>{school.name}</option>)}
    </select>
  </div>
}

export function SchoolScheduleGuide({ school, onChange, error = '' }: { school: ScheduleSchool; onChange: (id: string) => void; error?: string }) {
  const auth = useAuth()
  const [copyResult, setCopyResult] = useState('')
  const [copying, setCopying] = useState(false)
  const [queryIndex, setQueryIndex] = useState(0)
  const [requestOpen, setRequestOpen] = useState(false)
  const [requestBusy, setRequestBusy] = useState(false)
  const [requestName, setRequestName] = useState(school.id === 'jou' ? '江苏海洋大学' : school.name)
  const [requestUrl, setRequestUrl] = useState(school.links[0]?.href || '')
  const [requestVendor, setRequestVendor] = useState('正方教务')
  const [requestModules, setRequestModules] = useState<string[]>(['课表'])
  const [requestError, setRequestError] = useState('')
  const [requestDone, setRequestDone] = useState('')
  const requestLock = useRef(false)
  useEffect(() => { setCopyResult(''); setQueryIndex(0) }, [school.id])
  const option = school.queryOptions?.[queryIndex]
  const entry = school.links[option?.linkIndex ?? 0]
  async function copyGuide() {
    if (copying) return
    setCopying(true)
    try {
      const content = [school.name, school.summary, school.access, ...school.steps.map((step, i) => `${i + 1}. ${step}`), ...school.links.map(link => `${link.label}：${link.href}`), school.help].join('\n')
      setCopyResult(await copyText(content) ? '查询步骤和官方地址已复制' : '未能复制，请长按下方地址手动复制')
    } catch { setCopyResult('未能复制，请长按下方地址手动复制') } finally { setCopying(false) }
  }
  async function submitAdapterRequest() {
    if (requestLock.current) return
    const name = requestName.trim(), portal = requestUrl.trim()
    if (!name || name.length > 50) { setRequestError('请填写学校全称（最多 50 字）。'); return }
    if (!requestModules.length) { setRequestError('请至少选择一项需要哦狐评估接入的校园服务。'); return }
    let parsedUrl: URL
    try { parsedUrl = new URL(portal) } catch { setRequestError('请填写有效的学校教务网址。'); return }
    if (!['https:', 'http:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password || parsedUrl.hostname === 'localhost' || /^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(parsedUrl.hostname)) {
      setRequestError('请填写公开可访问的 HTTP 或 HTTPS 学校网址，不要填写账号、密码或内网地址。'); return
    }
    requestLock.current = true; setRequestBusy(true); setRequestError('')
    try {
      if (!(await auth.ensureSignedIn('提交学校教务接入申请需要先登录哦狐'))) return
      const result = await createFeedback({
        category: 'suggest',
        title: `教务接入申请：${name}`.slice(0, 40),
        content: `学校：${name}\n教务系统类型：${requestVendor}\n需要评估：${requestModules.join('、')}\n学校公开入口网址：${parsedUrl.href}\n\n此申请只提供公开入口信息，不含账号密码。请哦狐科技核验该校系统后评估适配。`.slice(0, 500),
        creator_name: auth.profile?.username || auth.user?.nickname || '同学',
      })
      if (result.error) throw new Error(result.error)
      setRequestDone('已提交给哦狐科技。学校系统会先核验入口与适配条件，接入进度可在“联系管理员”查看。')
      setRequestOpen(false)
    } catch (failure) { setRequestError((failure as Error).message || '提交失败，请稍后重试。') }
    finally { requestLock.current = false; setRequestBusy(false) }
  }
  return <div className={styles.page}>
    <PageHeader title="课表" />
    <ScheduleSchoolPicker schoolId={school.id} onChange={onChange} />
    <section className={styles.nationalCard}>
      <span className={styles.nationalBadge}>全国高校逐步适配</span>
      <h2>让哦狐支持你的学校</h2>
      <p>江苏海洋大学教务同步已接入，并作为默认学校。其他学校可提交公开教务网址；即使同为正方，也要逐校核验登录、验证码和课表结构。</p>
      <button type="button" className={styles.queryAction} onClick={() => { setRequestName(school.id === 'jou' ? '' : school.name); setRequestUrl(school.links[0]?.href || ''); setRequestError(''); setRequestDone(''); setRequestOpen(true) }}>提交学校教务网址</button>
      {requestDone ? <p className={styles.feedback} role="status">{requestDone}</p> : null}
      <small>只提交学校公开网址，不要发送账号、密码、验证码或个人课表截图。</small>
    </section>
    {error ? <p className={styles.feedback} role="alert">{error}</p> : null}
    {school.mode === 'integrated' ? <div className={`${scheduleStyles.loginCard} ${styles.queryCard}`}>
      <EmptyState title="哦狐已支持本校教务同步" hint="返回课表页，可绑定教务账号并在哦狐内同步课程、成绩与考试安排。" />
      <Link className={styles.queryAction} to="/schedule">返回哦狐课表</Link>
    </div> : <div className={`${scheduleStyles.loginCard} ${styles.queryCard}`}>
      <EmptyState title="哦狐暂未接入本校自动同步" hint={school.syncUnavailableReason ?? '目前只能查看学校官方查询入口。'} />
      <p className={styles.queryNote}>请在学校官方平台查询。哦狐不会在此收集教务账号或密码，网页课表也不会自动同步到哦狐。</p>
    </div>}
    {school.mode === 'official' ? <details className={styles.guide} open>
      <summary>学校官方入口与查询步骤</summary>
      <div className={styles.guideBody}>
        {school.queryOptions ? <div className={styles.queryOptions} role="group" aria-label="查询网络">
          {school.queryOptions.map((item, index) => <button type="button" key={item.label} aria-pressed={queryIndex === index} onClick={() => setQueryIndex(index)}>{item.label}</button>)}
        </div> : null}
        {entry ? <a className={styles.queryAction} href={entry.href} target="_blank" rel="noopener noreferrer">打开学校查询入口 ↗</a> : null}
        <p className={styles.queryHint}>{option?.hint ?? school.queryHint}</p>
        <p className={styles.access}>{school.access}</p>
        <h2>怎样查看课表</h2>
        <ol className={styles.steps}>{school.steps.map(step => <li key={step}>{step}</li>)}</ol>
        <div className={styles.links}>{school.links.map(link => <a className={styles.link} href={link.href} target="_blank" rel="noopener noreferrer" key={link.href}>
          <span><strong>{link.label}</strong><small>{new URL(link.href).hostname}</small></span><span aria-hidden="true">↗</span>
        </a>)}</div>
        <button type="button" className={styles.copy} onClick={() => void copyGuide()} disabled={copying}>{copying ? '正在复制…' : '复制查询步骤与地址'}</button>
        <p className={styles.feedback} role="status">{copyResult}</p>
        <div className={styles.help}><h2>打不开或找不到课表？</h2><p>{school.help}</p></div>
        <p className={styles.note}>网页查询结果不会自动保存为哦狐课表或生成上课提醒。</p>
        <details className={styles.sources}><summary>入口来源与核对日期</summary><p>2026-10-20 核对公开入口；尚未验证本校账号登录及个人课表同步。</p>{school.sourceUrls.map(url => <a href={url} key={url}>{new URL(url).hostname} ↗</a>)}</details>
      </div>
    </details> : null}
    {requestOpen ? <DialogLayer title="提交学校教务网址" onClose={() => { if (!requestBusy) setRequestOpen(false) }}>
      <div className={styles.requestForm}>
        <p>把学校公开入口交给哦狐科技评估。为保护账号安全，这里不收集教务账号、密码、验证码或个人课表。</p>
        <label>学校全称<input value={requestName} maxLength={50} onChange={event => setRequestName(event.target.value)} placeholder="例如：某某大学" /></label>
        <label>教务系统类型<select value={requestVendor} onChange={event => setRequestVendor(event.target.value)}><option>正方教务</option><option>强智教务</option><option>树维教务</option><option>青果教务</option><option>其他 / 不确定</option></select></label>
        <fieldset className={styles.moduleChoices}><legend>希望哦狐评估接入</legend>{['课表同步', '成绩查询', '考试安排', '体测成绩'].map(module => <label key={module}><input type="checkbox" checked={requestModules.includes(module)} onChange={event => setRequestModules(current => event.target.checked ? [...current, module] : current.filter(item => item !== module))} />{module}</label>)}</fieldset>
        <label>学校公开教务网址<input type="url" value={requestUrl} maxLength={300} onChange={event => setRequestUrl(event.target.value)} placeholder="https://…" /></label>
        {requestError ? <p className={styles.feedback} role="alert">{requestError}</p> : null}
        <button type="button" className={styles.queryAction} disabled={requestBusy} onClick={() => void submitAdapterRequest()}>{requestBusy ? '正在提交…' : '提交给哦狐科技'}</button>
      </div>
    </DialogLayer> : null}
  </div>
}

export function SchoolScheduleGuidePage() {
  useSyncExternalStore(subscribeQbank, getQbankRevision, getQbankRevision)
  const session = captureQbankSession()
  const [selection, setSelection] = useState(() => ({ uid: session.uid, id: readScheduleGuideSchool(session.uid) }))
  const [saveError, setSaveError] = useState<{ uid: string; revision: number; message: string } | null>(null)
  const schoolId = selection.uid === session.uid ? selection.id : readScheduleGuideSchool(session.uid)
  const school = findScheduleSchool(schoolId) ?? SCHEDULE_SCHOOLS[0]!
  function selectSchool(id: string) {
    if (!isQbankSessionCurrent(session)) return
    if (!saveScheduleGuideSchool(id, session.uid)) {
      setSaveError({ uid: session.uid, revision: session.revision, message: '暂时无法保存学校选择，请检查本机存储空间后重试。' })
      return
    }
    setSelection({ uid: session.uid, id })
    setSaveError(null)
  }
  return <SchoolScheduleGuide key={`${session.uid}:${session.revision}`} school={school} onChange={selectSchool} error={saveError?.uid === session.uid && saveError.revision === session.revision ? saveError.message : ''} />
}
