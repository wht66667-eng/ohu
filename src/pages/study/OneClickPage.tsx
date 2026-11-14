import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { CAMPUS_BRIDGE_AVAILABLE } from '../../lib/campus-bridge'
import {
  OneClickError,
  runChaoxingSsoSync,
  runQualitySync,
  runPublicElectiveSync,
  runSchoolSync,
  verifyCampusIdentity,
  type OneClickStage,
  type SchoolSyncResult,
  type SourceStatus,
} from '../../lib/one-click'
import { pauseBackgroundSync, resumeBackgroundSync, type GateCredentials } from '../../lib/background-sync'
import { rememberCampusSession } from '../../lib/campus-session'
import { ensureLocalIdentity, loadLocalIdentity } from '../../lib/local-identity'
import { refreshAllReminders } from '../../lib/notify-setup'
import {
  clearOneClickSecrets,
  readOneClickCredentials,
  saveOneClickCredentials,
  type OneClickCredentials,
} from '../../lib/oneclick-credentials'
import { loadAcademicMeta } from '../../lib/academic-cache'
import { loadScheduleCache } from '../../lib/schedule-cache'
import { readChaoxingCourses } from '../../lib/chaoxing-store'
import { readQuality } from '../../lib/quality-store'
import { readPublicElectives } from '../../lib/public-elective'
import { listPhysicalTestResults } from '../../lib/physical-test-results'
import { readPocketUni } from '../../lib/pocketuni-store'
import styles from './one-click.module.css'

type Busy = 'school' | 'chaoxing' | 'quality' | null

const STAGE_TEXT: Record<string, string> = {
  vpn: '校园网登录',
  cas: '统一认证',
  zf: '正方教务',
  grades: '成绩',
  timetable: '课表',
  exams: '考试',
  'chaoxing-login': '学习通登录',
  chaoxing: '学习通课程',
  quality: '校园档案',
}

function statusText(status: SourceStatus): string {
  if (status.ok) return status.count === undefined ? '成功' : `成功 · ${status.count} 条`
  return status.message || '失败'
}

/**
 * 阶段上报 → stage 文案。同一阶段首次上报时开始计时，
 * 之后每条消息带上「（已 Ns）」，让用户看到当前阶段已耗时。
 */
function makeStageReporter(setStage: (text: string) => void) {
  let stageKey: OneClickStage | '' = ''
  let stageStarted = 0
  return (next: OneClickStage, message: string) => {
    const now = Date.now()
    if (next !== stageKey) { stageKey = next; stageStarted = now }
    const elapsed = Math.max(0, Math.round((now - stageStarted) / 1000))
    const timed = /…\s*$/.test(message) ? message.replace(/…\s*$/, `（已 ${elapsed}s）…`) : `${message}（已 ${elapsed}s）`
    setStage(`${STAGE_TEXT[next] ?? next} · ${timed}`)
  }
}

export function OneClickPage({ gate }: { gate?: { onPass: (credentials: GateCredentials) => void } } = {}) {
  const [creds, setCreds] = useState<OneClickCredentials>(() => readOneClickCredentials())
  // 简化界面：先选更新范围，点「下一步」才展开学号与密码（已记住账号时直接展开）。
  const [showCreds, setShowCreds] = useState(() => Boolean(readOneClickCredentials()?.stuid))
  const [showVpn, setShowVpn] = useState(false)
  const [showCas, setShowCas] = useState(false)
  const stuidInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [stage, setStage] = useState('')
  const [school, setSchool] = useState<SchoolSyncResult | null>(null)
  const [chaoxing, setChaoxing] = useState<SourceStatus | null>(null)
  const [quality, setQuality] = useState<SourceStatus | null>(null)
  useEffect(() => { pauseBackgroundSync(); return () => resumeBackgroundSync() }, [])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [noticeTone, setNoticeTone] = useState<'ok' | 'partial' | 'bad'>('ok')
  /** 「更新数据」扩展数据源勾选：默认全不勾，只跑教务三件（课表/成绩/考试）。 */
  const [extras, setExtras] = useState({ elective: false, quality: false, chaoxing: false })

  function update<K extends keyof OneClickCredentials>(key: K, value: OneClickCredentials[K]) {
    setCreds((current) => ({ ...current, [key]: value }))
  }

  /** 学号就是本机身份：不需要手机号注册；已有手机号账号时也不会被覆盖。 */
  function ensureIdentity(): boolean {
    const studentId = creds.stuid.trim()
    if (!studentId) {
      setError('请先填写学号。学号就是本机身份，不需要手机号注册。')
      return false
    }
    if (!ensureLocalIdentity(studentId)) {
      setError('学号格式不正确，请检查后重试。')
      return false
    }
    return true
  }

  function ensureInputs(needCas = true): boolean {
    if (!ensureIdentity()) return false
    if (!creds.vpnPassword) { setError('请填写校园网（VPN）密码。'); return false }
    if (needCas && !creds.casPassword) { setError('请填写统一认证密码。'); return false }
    return true
  }

  async function run(label: Busy, task: () => Promise<void>) {
    if (busy) return
    setBusy(label); setError(''); setNotice(''); setStage('')
    try {
      await task()
    } catch (failure) {
      const prefix = failure instanceof OneClickError ? `${STAGE_TEXT[failure.stage] ?? failure.stage}：` : ''
      setError(`${prefix}${failure instanceof Error ? failure.message : '操作失败，请重试。'}`)
    } finally {
      setBusy(null)
    }
  }

  function persist() {
    if (!creds.remember) return
    if (!saveOneClickCredentials(creds)) { setNoticeTone('partial'); setNotice('密码未能写入本机加密存储，本次仍可继续使用；下次需要重新输入。') }
  }

  const chaoxingTask = () => run('chaoxing', async () => {
    if (!ensureInputs()) return
    const result = await runChaoxingSsoSync({
      studentId: creds.stuid,
      vpnPassword: creds.vpnPassword,
      casPassword: creds.casPassword,
      report: makeStageReporter(setStage),
    })
    setChaoxing(result)
    setStage('')
    setNoticeTone(result.ok ? 'ok' : 'bad')
    setNotice(result.ok ? `学习通课程已缓存（${result.count ?? 0} 门，统一认证 SSO）。` : `学习通读取失败：${result.message || '请重试。'}`)
  })

  const qualityTask = () => run('quality', async () => {
    if (!ensureInputs()) return
    const result = await runQualitySync({
      studentId: creds.stuid,
      vpnPassword: creds.vpnPassword,
      casPassword: creds.casPassword,
      report: makeStageReporter(setStage),
    })
    setQuality(result)
    setStage('')
    setNoticeTone(result.ok ? 'ok' : 'bad')
    setNotice(result.ok ? `校园档案：${result.message || '已保存'}` : '素质拓展读取失败，请检查实践系统是否可访问。')
  })

  const publicElectiveTask = () => run('quality', async () => {
    if (!ensureInputs()) return
    const result = await runPublicElectiveSync({
      studentId: creds.stuid,
      vpnPassword: creds.vpnPassword,
      casPassword: creds.casPassword,
      report: makeStageReporter(setStage),
    })
    setStage('')
    setNoticeTone(result.ok ? 'ok' : 'bad')
    setNotice(result.ok ? `公选选课：${result.count ?? 0} 门` : `公选选课读取失败：${result.message || '请重试。'}`)
  })

  const gateTask = () => run('school', async () => {
    if (!ensureInputs()) return
    // 首次认证门槛只建立 WebVPN + CAS 会话；正方票据与取数留在「一键获取」阶段（登录面少等 40-90 秒）。
    await verifyCampusIdentity(creds.stuid.trim(), creds.vpnPassword, creds.casPassword, makeStageReporter(setStage), { zfTicket: false })
    rememberCampusSession({ studentId: creds.stuid.trim(), vpnPassword: creds.vpnPassword, casPassword: creds.casPassword })
    setStage('认证通过，正在进入…')
    gate?.onPass({
      studentId: creds.stuid.trim(),
      vpnPassword: creds.vpnPassword,
      casPassword: creds.casPassword,
    })
  })

  const allTask = () => run('school', async () => {
    if (!ensureInputs()) return
    persist()
    const summary: string[] = []
    let okCount = 0
    let failCount = 0
    const report = makeStageReporter(setStage)

    const schoolResult = await runSchoolSync({ studentId: creds.stuid, vpnPassword: creds.vpnPassword, casPassword: creds.casPassword, report })
    setSchool(schoolResult)
    rememberCampusSession({ studentId: creds.stuid.trim(), vpnPassword: creds.vpnPassword, casPassword: creds.casPassword })
    for (const [label, status] of [['成绩', schoolResult.grades], ['课表', schoolResult.timetable], ['考试', schoolResult.exams]] as Array<[string, SourceStatus]>) {
      if (status.ok) { okCount++; summary.push(`${label} ${status.count === undefined ? '成功' : `${status.count} 条`}`) }
      else { failCount++; summary.push(`${label}失败`) }
    }

    // 扩展段按勾选执行；默认全不勾时只跑教务三件。
    if (extras.elective) {
      try {
        const publicResult = await runPublicElectiveSync({ studentId: creds.stuid, vpnPassword: creds.vpnPassword, casPassword: creds.casPassword, report })
        if (publicResult.ok) { okCount++; summary.push(`公选 ${publicResult.count ?? 0} 门`) }
        else { failCount++; summary.push('公选失败') }
      } catch { failCount++; summary.push('公选失败') }
    }

    if (extras.quality) {
      try {
        const quality = await runQualitySync({ studentId: creds.stuid, vpnPassword: creds.vpnPassword, casPassword: creds.casPassword, report })
        setQuality(quality)
        if (quality.ok) { okCount++; summary.push(`档案 ${quality.count ?? 0} 条`) }
        else { failCount++; summary.push('档案失败') }
      } catch { failCount++; summary.push('档案失败') }
    }

    if (extras.chaoxing) {
      try {
        const chaoxing = await runChaoxingSsoSync({ studentId: creds.stuid, vpnPassword: creds.vpnPassword, casPassword: creds.casPassword, report })
        setChaoxing(chaoxing)
        if (chaoxing.ok) { okCount++; summary.push(`学习通 ${chaoxing.count ?? 0} 门`) }
        else { failCount++; summary.push('学习通失败') }
      } catch { failCount++; summary.push('学习通失败') }
    }

    setStage('')
    const tone = failCount === 0 ? 'ok' : okCount === 0 ? 'bad' : 'partial'
    setNoticeTone(tone)
    setNotice(`${tone === 'ok' ? '全部更新完成' : tone === 'bad' ? '更新失败' : '部分更新完成'}：${summary.join(' · ')}。体测和 PU 请到各自页面登录更新。`)
    if (okCount > 0) void refreshAllReminders().catch(() => undefined)
  })

  const savedIdentity = loadLocalIdentity()

  const overview = useMemo(() => {
    const stamp = (value: string | number | undefined | null): string => {
      if (value === undefined || value === null || value === 0 || value === '') return '未获取'
      const ms = typeof value === 'number' ? value : Date.parse(value)
      if (!Number.isFinite(ms)) return '未获取'
      return new Date(ms).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    }
    const electives = readPublicElectives()
    return [
      { label: '成绩', time: stamp(loadAcademicMeta('grades')?.savedAt), session: school?.grades },
      { label: '课表', time: stamp(loadScheduleCache().meta?.savedAt), session: school?.timetable },
      { label: '考试', time: stamp(loadAcademicMeta('exams')?.savedAt), session: school?.exams },
      { label: '公选选课', time: electives.length ? `本机 ${electives.length} 门 · 未记录时间` : '未获取', session: undefined },
      { label: '校园档案', time: stamp(readQuality()?.syncedAt), session: quality ?? undefined },
      { label: '学习通', time: stamp(readChaoxingCourses()?.syncedAt), session: chaoxing ?? undefined },
      { label: '体测', time: stamp(listPhysicalTestResults()[0]?.updatedAt), session: undefined },
      { label: 'PU 二课', time: stamp(readPocketUni()?.syncedAt), session: undefined },
    ] as Array<{ label: string; time: string; session?: SourceStatus }>
  }, [school, quality, chaoxing])

  return <div className={styles.page}>
    <PageHeader title={gate ? '首次认证' : '校园数据更新'} />
    <div className={styles.content}>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>设备内登录 · 不经过云端</span>
        <h2>一次输入，<br />把校园数据带回来</h2>
        <p>学号 + 两个密码，直接读取课表、成绩、考试；无需手机号，密码不写日志。体测、PU、学习通进入后单独更新。</p>
        <div className={styles.badges}>
          <span>无需手机号</span><span>密码不写日志</span><span>只取本人数据</span>
        </div>
      </section>

      {!CAMPUS_BRIDGE_AVAILABLE ? <p className={styles.warn} role="status">
        设备侧取数桥只在 Android App 内可用。当前是网页或 iOS 版本，请安装 Android 包后使用；也可以继续用「粘贴导入」。
      </p> : null}

      {savedIdentity ? <p className={styles.identity} role="status">本机身份：学号 {savedIdentity.studentId}（数据只保存在这台设备）</p> : null}

      <details className={styles.card}>
        <div className={styles.cardHead}><div><span className={styles.kicker}>分项状态</span><h3>本机数据概览</h3></div></div>
        <div className={styles.ovList}>
          {overview.map((row) => (
            <div key={row.label} className={styles.ovRow}>
              <b>{row.label}</b>
              <span className={styles.ovTime}>{row.time}</span>
              {row.session ? <span className={row.session.ok ? styles.ovOk : styles.ovBad}>{row.session.ok ? '本次成功' : '本次失败'}</span> : null}
            </div>
          ))}
        </div>
        <p className={styles.muted}>时间为本机快照保存时间；「未获取」表示当前账号在这台设备还没有缓存。体测与 PU 是独立账号，需到各自页面登录。</p>
      </details>

      <section className={styles.card}>
        <div className={styles.cardHead}><div><span className={styles.kicker}>主操作</span><h3>{gate ? '校园认证' : '更新支持的数据源'}</h3></div></div>
        {!gate ? <>
          <p className={styles.muted}>默认只更新教务三件（成绩 · 课表 · 考试）。勾选后「更新数据」会依次多读：</p>
          <label className={styles.check}>
            <input type="checkbox" checked={extras.elective} disabled={busy !== null} onChange={(event) => setExtras((current) => ({ ...current, elective: event.target.checked }))} />
            公选选课（正方「选课情况」）
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={extras.quality} disabled={busy !== null} onChange={(event) => setExtras((current) => ({ ...current, quality: event.target.checked }))} />
            校园档案（素质拓展学分）
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={extras.chaoxing} disabled={busy !== null} onChange={(event) => setExtras((current) => ({ ...current, chaoxing: event.target.checked }))} />
            学习通课程（统一认证 SSO，多花 1–2 分钟）
          </label>
        </> : null}
        <div className={styles.actions}>
          {!gate && !showCreds ? (
            <button type="button" className={styles.primary} onClick={() => { setShowCreds(true); requestAnimationFrame(() => stuidInput.current?.focus()) }}>
              下一步：填写学号密码 ›
            </button>
          ) : (
            <button type="button" className={styles.primary} disabled={!CAMPUS_BRIDGE_AVAILABLE || busy !== null} onClick={() => void (gate ? gateTask() : allTask())}>
              {busy === 'school' ? (gate ? '正在认证…' : '正在更新…') : gate ? '认证并进入' : '开始更新'}
            </button>
          )}
        </div>
        {stage ? <p className={styles.stage} role="status">{stage}</p> : null}
        {school ? <div className={styles.results}>
          <div className={school.grades.ok ? styles.resultOk : styles.resultBad}><b>成绩</b><span>{statusText(school.grades)}</span></div>
          <div className={school.timetable.ok ? styles.resultOk : styles.resultBad}><b>课表</b><span>{statusText(school.timetable)}</span></div>
          <div className={school.exams.ok ? styles.resultOk : styles.resultBad}><b>考试</b><span>{statusText(school.exams)}</span></div>
        </div> : null}
        {school?.name ? <p className={styles.muted}>正方姓名校验：{school.name}</p> : null}
      </section>

      {notice ? <p className={noticeTone === 'bad' ? styles.badText : noticeTone === 'partial' ? styles.partText : styles.okText} role={noticeTone === 'bad' ? 'alert' : 'status'}>{notice}</p> : null}
      {error ? <p className={styles.badText} role="alert">{error}</p> : null}

      {gate || showCreds ? (
      <section className={styles.card}>
        <div className={styles.cardHead}><div><span className={styles.kicker}>{gate ? '认证信息' : '第 2 步'}</span><h3>学号与密码</h3></div></div>
        <label className={styles.field}>学号<input ref={stuidInput} value={creds.stuid} inputMode="numeric" autoComplete="username" onChange={(event) => update('stuid', event.target.value)} placeholder="20231111" /></label>
        <small style={{ display: 'block', margin: '-6px 0 10px', fontSize: 11, opacity: 0.6 }}>例如 20231111</small>
        <label className={styles.field}>VPN / 校园网密码
          <span className={styles.pwWrap}>
            <input type={showVpn ? 'text' : 'password'} value={creds.vpnPassword} autoComplete="current-password" onChange={(event) => update('vpnPassword', event.target.value)} placeholder="8–20 位，区分大小写" />
            <button type="button" className={styles.pwEye} aria-label={showVpn ? '隐藏校园网密码' : '显示校园网密码'} onClick={() => setShowVpn((value) => !value)}>{showVpn ? '隐藏' : '显示'}</button>
          </span>
        </label>
        <small style={{ display: 'block', margin: '-6px 0 10px', fontSize: 11, opacity: 0.6 }}>2023 级默认身份证后 8 位；2024 级起为身份证后 8 位 + @Jou</small>
        <label className={styles.field}>统一认证密码
          <span className={styles.pwWrap}>
            <input type={showCas ? 'text' : 'password'} value={creds.casPassword} autoComplete="current-password" onChange={(event) => update('casPassword', event.target.value)} placeholder="8–20 位，含字母/数字/符号" />
            <button type="button" className={styles.pwEye} aria-label={showCas ? '隐藏统一认证密码' : '显示统一认证密码'} onClick={() => setShowCas((value) => !value)}>{showCas ? '隐藏' : '显示'}</button>
          </span>
        </label>
        <small style={{ display: 'block', margin: '-6px 0 10px', fontSize: 11, opacity: 0.6 }}>初始密码为 Jou@ + 身份证后 8 位；区分大小写</small>
        <label className={styles.check}>
          <input type="checkbox" checked={creds.remember} onChange={(event) => update('remember', event.target.checked)} />
          在本机加密记住密码（默认关闭；关闭时每次同步都要重新输入）
        </label>
      </section>
      ) : null}

      {gate ? <p className={styles.muted}>体测和 PU（口袋校园）是独立账号，入口门禁不再要求这两套密码。进入后到「体测成绩」页、「PU 成绩」页各自点「登录并更新」即可。</p> : null}

      {!gate ? <section className={styles.card}>
        <div className={styles.cardHead}><div><span className={styles.kicker}>第 2 步</span><h3>需要单独更新的数据</h3></div></div>
        <p className={styles.muted}>下面三项各自是独立账号：第一次需要你在弹出的页面里登录，之后才能一键更新。可见页面右上角有「完成」按钮，可随时取消。</p>
        <div className={styles.sourceList}>
          <div className={styles.sourceRow}>
            <div><b>学习通</b><small>超星账号登录一次，缓存课程列表</small></div>
            <button type="button" className={styles.outline} disabled={!CAMPUS_BRIDGE_AVAILABLE || busy !== null} onClick={() => void chaoxingTask()}>{busy === 'chaoxing' ? '等待登录…' : '授权并读取'}</button>
          </div>
          {chaoxing ? <p className={chaoxing.ok ? styles.okText : styles.badText}>学习通：{statusText(chaoxing)}</p> : null}
          <div className={styles.sourceRow}>
            <div><b>公选选课（正方）</b><small>xsxkqk 选课情况，按课程代码匹配成绩</small></div>
            <button type="button" className={styles.outline} disabled={!CAMPUS_BRIDGE_AVAILABLE || busy !== null} onClick={() => void publicElectiveTask()}>{busy === 'quality' ? '读取中…' : '读取公选选课'}</button>
          </div>
          <details className={styles.expDetails}>
            <summary>实验来源：校园档案（默认折叠）</summary>
            <div className={styles.sourceRow}>
              <div><b>校园档案</b><small>进实践系统后请求 quality 接口，失败会带回捕获的 URL</small></div>
              <button type="button" className={styles.outline} disabled={!CAMPUS_BRIDGE_AVAILABLE || busy !== null} onClick={() => void qualityTask()}>{busy === 'quality' ? '尝试中…' : '尝试读取'}</button>
            </div>
            {quality ? <p className={quality.ok ? styles.okText : styles.badText}>素质拓展：{quality.ok ? (quality.message || statusText(quality)) : statusText(quality)}</p> : null}
          </details>
          <div className={styles.sourceRow}>
            <div><b>体测成绩</b><small>体测是独立账号，在该页面单独登录</small></div>
            <Link className={styles.outline} to="/sports/results">去体测页</Link>
          </div>
          <div className={styles.sourceRow}>
            <div><b>PU 二课</b><small>口袋校园是独立账号，在该页面单独登录</small></div>
            <Link className={styles.outline} to="/study/pu">去 PU 页</Link>
          </div>
        </div>
      </section> : null}

      <details className={styles.card}>
        <summary style={{ cursor: 'pointer', listStyle: 'none' }}><span className={styles.kicker}>说明</span><h3 style={{ display: 'inline', marginLeft: 8 }}>学校初始密码规则</h3></summary>
        <dl className={styles.rules}>
          <div>
            <dt>WebVPN 密码</dt>
            <dd>用于登录 WebVPN 校外访问通道。2023 级初始密码为身份证后八位；2024 级及以后为身份证后八位@Jou。</dd>
          </div>
          <div>
            <dt>统一认证密码</dt>
            <dd>用于信息门户 / CAS 统一认证。初始密码为 Jou@身份证后八位。</dd>
          </div>
        </dl>
        <p className={styles.muted}>以上为学校初始密码规则；若曾修改，请使用修改后的密码。忘记密码可在对应系统自助找回或咨询学校网络中心。</p>
      </details>

      <section className={styles.links}>
        <Link to="/study?tab=grades">成绩 ›</Link>
        <Link to="/schedule">课表 ›</Link>
        <Link to="/sports/results">体测成绩 ›</Link>
        <Link to="/study/pu">PU 二课 ›</Link>
      </section>

      <details className={styles.noteCard}>
        <summary className={styles.noteSummary}>安全与边界 · 本机保存密码管理</summary>
        <p>· 密码只在设备内、仅用于本次登录；不发给哦狐服务器，不写日志，错误提示也不会回显密码。</p>
        <p>· 默认不保存密码；勾选后使用本机随机密钥加密保存，可随时在下方清除。</p>
        <p>· 学号即本机身份，数据只在这台设备上；换设备需要重新同步。</p>
        <p>· 学校系统与第三方平台改版会导致取数失败；失败时不会写入假数据，旧数据保留。</p>
        <button type="button" className={styles.ghost} onClick={() => {
          const ok = clearOneClickSecrets()
          setNoticeTone(ok ? 'ok' : 'bad')
          setNotice(ok ? '已清除本机保存的密码（学号保留）。' : '清除失败，请稍后重试。')
          setCreds((current) => ({ ...current, vpnPassword: '', casPassword: '', ticePassword: '', remember: false }))
        }}>清除本机保存的密码</button>
      </details>
    </div>
  </div>
}
