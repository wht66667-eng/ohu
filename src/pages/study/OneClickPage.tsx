import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { CAMPUS_BRIDGE_AVAILABLE } from '../../lib/campus-bridge'
import {
  OneClickError,
  runChaoxingSsoSync,
  runPocketUniSync,
  runQualitySync,
  runPublicElectiveSync,
  runSchoolSync,
  runTiceSync,
  closeCampusWebView,
  type SchoolSyncResult,
  type SourceStatus,
} from '../../lib/one-click'
import { ensureLocalIdentity, loadLocalIdentity } from '../../lib/local-identity'
import { refreshAllReminders } from '../../lib/notify-setup'
import {
  clearOneClickSecrets,
  readOneClickCredentials,
  saveOneClickCredentials,
  type OneClickCredentials,
} from '../../lib/oneclick-credentials'
import styles from './one-click.module.css'

type Busy = 'school' | 'tice' | 'pu' | 'chaoxing' | 'quality' | null

const STAGE_TEXT: Record<string, string> = {
  vpn: '校园网登录',
  cas: '统一认证',
  zf: '正方教务',
  grades: '成绩',
  timetable: '课表',
  exams: '考试',
  'tice-login': '体测登录',
  tice: '体测成绩',
  'pu-login': '口袋校园登录',
  pu: 'PU 学分',
  'chaoxing-login': '学习通登录',
  chaoxing: '学习通课程',
  quality: '校园档案',
}

function statusText(status: SourceStatus): string {
  if (status.ok) return status.count === undefined ? '成功' : `成功 · ${status.count} 条`
  return status.message || '失败'
}

export function OneClickPage() {
  const [creds, setCreds] = useState<OneClickCredentials>(() => readOneClickCredentials())
  const [initials, setInitials] = useState('')
  const [busy, setBusy] = useState<Busy>(null)
  const [stage, setStage] = useState('')
  const [school, setSchool] = useState<SchoolSyncResult | null>(null)
  const [tice, setTice] = useState<SourceStatus | null>(null)
  const [pu, setPu] = useState<SourceStatus | null>(null)
  const [chaoxing, setChaoxing] = useState<SourceStatus | null>(null)
  const [quality, setQuality] = useState<SourceStatus | null>(null)
  const [puAccount, setPuAccount] = useState('')
  const [puPassword, setPuPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

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
    if (!saveOneClickCredentials(creds)) setNotice('密码未能写入本机加密存储，本次仍可继续使用；下次需要重新输入。')
  }

  const schoolTask = () => run('school', async () => {
    if (!ensureInputs()) return
    persist()
    const result = await runSchoolSync({
      studentId: creds.stuid,
      vpnPassword: creds.vpnPassword,
      casPassword: creds.casPassword,
      report: (next, message) => setStage(`${STAGE_TEXT[next] ?? next} · ${message}`),
    })
    setSchool(result)
    setStage('')
    setNotice(`教务读取完成：成绩 ${statusText(result.grades)}，课表 ${statusText(result.timetable)}，考试 ${statusText(result.exams)}。`)
    if (result.grades.ok || result.timetable.ok || result.exams.ok) {
      void refreshAllReminders().catch(() => undefined)
    }
  })

  const ticeTask = () => run('tice', async () => {
    if (!ensureInputs(false)) return
    if (!creds.ticePassword) { setError('体测系统是独立账号，请填写体测密码（首次可试「姓名首字母大写_学号」）。'); return }
    persist()
    const result = await runTiceSync({
      studentId: creds.stuid,
      vpnPassword: creds.vpnPassword,
      ticePassword: creds.ticePassword,
      report: (next, message) => setStage(`${STAGE_TEXT[next] ?? next} · ${message}`),
    })
    setTice(result)
    setStage('')
    setNotice('体测成绩已写入本机；可在「体测成绩」页查看历年与本次明细。')
  })

  const puTask = () => run('pu', async () => {    if (!ensureIdentity()) return
    const result = await runPocketUniSync({ report: (next, message) => setStage(`${STAGE_TEXT[next] ?? next} · ${message}`) })
    setPu(result)
    setStage('')
    setNotice('PU 学分已保存；若总分为 4.85、分类明细正常，说明读取成功。')
  })

  const comboTask = () => run('tice', async () => {
    if (!ensureInputs()) return
    if (!creds.ticePassword) { setError('请填写体测密码（首次可试 姓名首字母_学号）。'); return }
    if (!puAccount.trim() || !puPassword) { setError('请填写口袋校园（PU）账号和密码。'); return }
    persist()
    let ticeResult: SourceStatus
    try {
      ticeResult = await runTiceSync({
        studentId: creds.stuid,
        vpnPassword: creds.vpnPassword,
        ticePassword: creds.ticePassword,
        report: (_next, message) => setStage(`体测 · ${message}`),
      })
    } catch (error) {
      ticeResult = { ok: false, message: error instanceof Error ? error.message : '体测读取失败' }
    }
    setTice(ticeResult)
    setStage('体测完成，准备读取 PU…')
    let puResult: SourceStatus
    try {
      puResult = await runPocketUniSync({
        account: puAccount.trim(),
        password: puPassword,
        report: (_next, message) => setStage(`PU · ${message}`),
      })
    } catch (error) {
      puResult = { ok: false, message: error instanceof Error ? error.message : 'PU 读取失败' }
    }
    setPu(puResult)
    setStage('')
    setNotice(`体测：${statusText(ticeResult)}；PU：${statusText(puResult)}`)
  })

  const puOnlyTask = () => run('pu', async () => {
    const result = await runPocketUniSync({
      account: puAccount.trim() || undefined,
      password: puPassword || undefined,
      report: (_next, message) => setStage(`PU · ${message}`),
    })
    setPu(result)
    setStage('')
    setNotice(`PU：${statusText(result)}`)
  })

  const chaoxingTask = () => run('chaoxing', async () => {
    if (!ensureInputs()) return
    const result = await runChaoxingSsoSync({
      studentId: creds.stuid,
      vpnPassword: creds.vpnPassword,
      casPassword: creds.casPassword,
      report: (next, message) => setStage(`${STAGE_TEXT[next] ?? next} · ${message}`),
    })
    setChaoxing(result)
    setStage('')
    setNotice(`学习通课程已缓存（${result.count ?? 0} 门，统一认证 SSO）。`)
  })

  const qualityTask = () => run('quality', async () => {
    if (!ensureInputs()) return
    const result = await runQualitySync({
      studentId: creds.stuid,
      vpnPassword: creds.vpnPassword,
      casPassword: creds.casPassword,
      report: (next, message) => setStage(`${STAGE_TEXT[next] ?? next} · ${message}`),
    })
    setQuality(result)
    setStage('')
    setNotice(result.ok ? `校园档案：${result.message || '已保存'}` : '素质拓展读取失败，请检查实践系统是否可访问。')
  })

  const publicElectiveTask = () => run('quality', async () => {
    if (!ensureInputs()) return
    const result = await runPublicElectiveSync({
      studentId: creds.stuid,
      vpnPassword: creds.vpnPassword,
      casPassword: creds.casPassword,
      report: (next, message) => setStage(`${STAGE_TEXT[next] ?? next} · ${message}`),
    })
    setStage('')
    setNotice(`公选选课：${result.count ?? 0} 门`)
  })

  const allTask = () => run('school', async () => {
    if (!ensureInputs()) return
    const summary: string[] = []
    const report = (next: Parameters<NonNullable<Parameters<typeof runSchoolSync>[0]['report']>>[0], message: string) => setStage(`${STAGE_TEXT[next] ?? next} · ${message}`)

    const schoolResult = await runSchoolSync({ studentId: creds.stuid, vpnPassword: creds.vpnPassword, casPassword: creds.casPassword, report })
    setSchool(schoolResult)
    summary.push(`校园 ${schoolResult.grades.count ?? 0}/${schoolResult.timetable.count ?? 0}/${schoolResult.exams.count ?? 0}`)

    try {
      const quality = await runQualitySync({ studentId: creds.stuid, vpnPassword: creds.vpnPassword, casPassword: creds.casPassword, report })
      setQuality(quality)
      summary.push(`档案 ${quality.count ?? 0} 条`)
    } catch { summary.push('档案失败') }

    try {
      const chaoxing = await runChaoxingSsoSync({ studentId: creds.stuid, vpnPassword: creds.vpnPassword, casPassword: creds.casPassword, report })
      setChaoxing(chaoxing)
      summary.push(`学习通 ${chaoxing.count ?? 0} 门`)
    } catch { summary.push('学习通失败') }

    if (creds.ticePassword.trim()) {
      try {
        const ticeResult = await runTiceSync({ studentId: creds.stuid, vpnPassword: creds.vpnPassword, ticePassword: creds.ticePassword, report })
        setTice(ticeResult)
        summary.push(`体测 ${ticeResult.count ?? 0} 条`)
      } catch { summary.push('体测失败') }
    } else {
      summary.push('体测需密码')
    }

    if (puAccount.trim() && puPassword) {
      try {
        const puResult = await runPocketUniSync({ account: puAccount.trim(), password: puPassword, report })
        setPu(puResult)
        summary.push(`PU ${puResult.count ?? 0} 条`)
      } catch { summary.push('PU 失败') }
    } else {
      summary.push('PU 需授权')
    }

    setStage('')
    setNotice(summary.join(' · '))
  })


  function fillTiceByInitials() {
    const value = initials.trim().toUpperCase().replace(/[^A-Z]/g, '')
    if (!value) { setError('先填写姓名首字母，例如 AAA。'); return }
    if (!creds.stuid.trim()) { setError('请先填写学号。'); return }
    update('ticePassword', `${value}_${creds.stuid.trim()}`)
    setError('')
  }

  const savedIdentity = loadLocalIdentity()

  return <div className={styles.page}>
    <PageHeader title="一键获取" />
    <div className={styles.content}>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>设备内登录 · 不经过云端</span>
        <h2>一次输入，<br />把校园数据带回来</h2>
        <p>学号 + 校园网密码 + 统一认证密码，直接读取课表、成绩、考试；学号就是本机身份，不需要手机号注册。体测、PU、学习通是各自独立的账号，登录一次后也能一键更新。</p>
        <div className={styles.badges}>
          <span>无需手机号</span><span>密码不写日志</span><span>默认不保存</span><span>只取本人数据</span>
        </div>
      </section>

      {!CAMPUS_BRIDGE_AVAILABLE ? <p className={styles.warn} role="status">
        设备侧取数桥只在 Android App 内可用。当前是网页或 iOS 版本，请安装 Android 包后使用；也可以继续用「粘贴导入」。
      </p> : null}

      {savedIdentity ? <p className={styles.identity} role="status">本机身份：学号 {savedIdentity.studentId}（数据只保存在这台设备）</p> : null}

      {(school || tice || pu || quality || chaoxing) ? <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '2px 0 8px' }}>
        {([
          ['成绩', school?.grades],
          ['课表', school?.timetable],
          ['考试', school?.exams],
          ['体测', tice],
          ['PU', pu],
          ['素质拓展', quality],
          ['学习通', chaoxing],
        ] as Array<[string, SourceStatus | undefined]>).filter(([, status]) => !!status).map(([label, status]) => (
          <span
            key={label}
            className={status!.ok ? styles.resultOk : styles.resultBad}
            style={{ flex: 'none', minWidth: 92 }}
          >
            <b>{label}</b>
            <span>{status!.ok ? (status!.count === undefined ? '成功' : `${status!.count} 条`) : '未完成'}</span>
          </span>
        ))}
      </div> : null}

      <section className={styles.card}>
        <div className={styles.cardHead}><div><span className={styles.kicker}>第 1 步</span><h3>学号与密码</h3></div></div>
        <label className={styles.field}>学号<input value={creds.stuid} inputMode="numeric" autoComplete="username" onChange={(event) => update('stuid', event.target.value)} placeholder="2023120448" /></label>
        <small style={{ display: 'block', margin: '-6px 0 10px', fontSize: 11, opacity: 0.6 }}>10 位数字，例如 2023120448</small>
        <label className={styles.field}>VPN / 校园网密码<input type="password" value={creds.vpnPassword} autoComplete="current-password" onChange={(event) => update('vpnPassword', event.target.value)} placeholder="8–20 位，区分大小写" /></label>
        <small style={{ display: 'block', margin: '-6px 0 10px', fontSize: 11, opacity: 0.6 }}>2023 级默认身份证后 8 位；2024 级起为身份证后 8 位 + @Jou</small>
        <label className={styles.field}>统一认证密码<input type="password" value={creds.casPassword} autoComplete="current-password" onChange={(event) => update('casPassword', event.target.value)} placeholder="8–20 位，含字母/数字/符号" /></label>
        <small style={{ display: 'block', margin: '-6px 0 10px', fontSize: 11, opacity: 0.6 }}>初始密码为 Jou@ + 身份证后 8 位；区分大小写</small>
        <label className={styles.field}>体测密码（选填）
          <input type="password" value={creds.ticePassword} autoComplete="off" onChange={(event) => update('ticePassword', event.target.value)} placeholder="不填则跳过体测" />
        </label>
        <small style={{ display: 'block', margin: '-6px 0 10px', fontSize: 11, opacity: 0.6 }}>初始为姓名首字母大写 + _ + 学号，例如 WHT_2023120448</small>
        <div className={styles.inlineRow}>
          <input value={initials} onChange={(event) => setInitials(event.target.value)} placeholder="如 AAA" aria-label="姓名首字母" />
          <button type="button" className={styles.mini} onClick={fillTiceByInitials}>填入 首字母_学号</button>
        </div>
        <label className={styles.check}>
          <input type="checkbox" checked={creds.remember} onChange={(event) => update('remember', event.target.checked)} />
          在本机加密记住密码（默认关闭；关闭时每次同步都要重新输入）
        </label>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={!CAMPUS_BRIDGE_AVAILABLE || busy !== null} onClick={() => void allTask()}>
            {busy === 'school' ? '正在同步全部…' : '一键登录并同步全部'}
          </button>
          <button type="button" className={styles.outline} disabled={!CAMPUS_BRIDGE_AVAILABLE || busy !== null} onClick={() => void schoolTask()}>
            只获取课表 · 成绩 · 考试
          </button>
        </div>
        {stage ? <p className={styles.stage} role="status">{stage}</p> : null}
        {school ? <div className={styles.results}>
          <div className={school.grades.ok ? styles.resultOk : styles.resultBad}><b>成绩</b><span>{statusText(school.grades)}</span></div>
          <div className={school.timetable.ok ? styles.resultOk : styles.resultBad}><b>课表</b><span>{statusText(school.timetable)}</span></div>
          <div className={school.exams.ok ? styles.resultOk : styles.resultBad}><b>考试</b><span>{statusText(school.exams)}</span></div>
        </div> : null}
        {school?.name ? <p className={styles.muted}>正方姓名校验：{school.name}</p> : null}
      </section>

      <section className={styles.card}>
        <div className={styles.cardHead}><div><span className={styles.kicker}>体测 + PU</span><h3>一次输入，两个一起读</h3></div></div>
        <p className={styles.muted}>体测和口袋校园是两套独立账号。体测密码用上方「体测密码（选填）」；填一次后点下面按钮，会在后台自动登录并读取。</p>
        <label className={styles.field}>PU 账号<input value={puAccount} onChange={(event) => setPuAccount(event.target.value)} placeholder="口袋校园手机号 / 学号" autoComplete="username" /></label>
        <label className={styles.field}>PU 密码<input type="password" value={puPassword} onChange={(event) => setPuPassword(event.target.value)} placeholder="口袋校园密码" autoComplete="current-password" /></label>
        <div className={styles.actions}>
          <button type="button" className={styles.primary} disabled={!CAMPUS_BRIDGE_AVAILABLE || busy !== null} onClick={() => void comboTask()}>
            {busy === 'tice' ? '正在读取…' : '一键读取体测 + PU'}
          </button>
          <button type="button" className={styles.outline} disabled={!CAMPUS_BRIDGE_AVAILABLE || busy !== null} onClick={() => void puOnlyTask()}>
            {busy === 'pu' ? 'PU 读取中…' : '只更新 PU'}
          </button>
          {busy === 'tice' ? (
            <button type="button" className={styles.outline} onClick={() => { setStage('已取消'); void closeCampusWebView().catch(() => undefined) }}>
              取消读取
            </button>
          ) : null}
        </div>
        <p className={styles.muted}>体测一般 10–30 秒；PU 需要等页面渲染和登录，约 20–60 秒。超过 2 分钟还没结果，可点「取消读取」。</p>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHead}><div><span className={styles.kicker}>第 2 步</span><h3>需要单独授权的数据</h3></div></div>
        <p className={styles.muted}>下面三项各自是独立账号：第一次需要你在弹出的页面里登录，之后才能一键更新。可见页面右上角有「完成」按钮，可随时取消。</p>
        <div className={styles.sourceList}>
          <div className={styles.sourceRow}>
            <div><b>体测成绩</b><small>用上方「体测密码（选填）」自动登录 tice</small></div>
            <button type="button" className={styles.outline} disabled={!CAMPUS_BRIDGE_AVAILABLE || busy !== null} onClick={() => void ticeTask()}>{busy === 'tice' ? '读取中…' : '读取体测'}</button>
          </div>
          {tice ? <p className={tice.ok ? styles.okText : styles.badText}>体测：{statusText(tice)}</p> : null}
          <div className={styles.sourceRow}>
            <div><b>PU 二课</b><small>口袋校园登录一次，读成绩明细文字</small></div>
            <button type="button" className={styles.outline} disabled={!CAMPUS_BRIDGE_AVAILABLE || busy !== null} onClick={() => void puTask()}>{busy === 'pu' ? '等待登录…' : '授权并读取'}</button>
          </div>
          {pu ? <p className={pu.ok ? styles.okText : styles.badText}>PU：{statusText(pu)}</p> : null}
          <div className={styles.sourceRow}>
            <div><b>学习通</b><small>超星账号登录一次，缓存课程列表</small></div>
            <button type="button" className={styles.outline} disabled={!CAMPUS_BRIDGE_AVAILABLE || busy !== null} onClick={() => void chaoxingTask()}>{busy === 'chaoxing' ? '等待登录…' : '授权并读取'}</button>
          </div>
          {chaoxing ? <p className={chaoxing.ok ? styles.okText : styles.badText}>学习通：{statusText(chaoxing)}</p> : null}
          <div className={styles.sourceRow}>
            <div><b>公选选课（正方）</b><small>xsxkqk 选课情况，按课程代码匹配成绩</small></div>
            <button type="button" className={styles.outline} disabled={!CAMPUS_BRIDGE_AVAILABLE || busy !== null} onClick={() => void publicElectiveTask()}>{busy === 'quality' ? '读取中…' : '读取公选选课'}</button>
          </div>
          <div className={styles.sourceRow}>
            <div><b>校园档案（实验）</b><small>进实践系统后请求 quality 接口，失败会带回捕获的 URL</small></div>
            <button type="button" className={styles.outline} disabled={!CAMPUS_BRIDGE_AVAILABLE || busy !== null} onClick={() => void qualityTask()}>{busy === 'quality' ? '尝试中…' : '尝试读取'}</button>
          </div>
          {quality ? <p className={quality.ok ? styles.okText : styles.badText}>素质拓展：{quality.ok ? (quality.message || statusText(quality)) : statusText(quality)}</p> : null}
        </div>
      </section>

      {notice ? <p className={styles.okText} role="status">{notice}</p> : null}
      {error ? <p className={styles.badText} role="alert">{error}</p> : null}

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
          <div>
            <dt>体测密码</dt>
            <dd>首次可尝试「姓名首字母大写_学号」，例如 AAA_2023111111；若改过密码，请用新密码。</dd>
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

      <section className={styles.noteCard}>
        <b>安全与边界</b>
        <p>· 密码只在设备内、仅用于本次登录；不发给哦狐服务器，不写日志，错误提示也不会回显密码。</p>
        <p>· 默认不保存密码；勾选后使用本机随机密钥加密保存，可随时在下方清除。</p>
        <p>· 学号即本机身份，数据只在这台设备上；换设备需要重新同步。</p>
        <p>· 学校系统与第三方平台改版会导致取数失败；失败时不会写入假数据，旧数据保留。</p>
        <button type="button" className={styles.ghost} onClick={() => {
          const ok = clearOneClickSecrets()
          setNotice(ok ? '已清除本机保存的密码（学号保留）。' : '清除失败，请稍后重试。')
          setCreds((current) => ({ ...current, vpnPassword: '', casPassword: '', ticePassword: '', remember: false }))
        }}>清除本机保存的密码</button>
      </section>
    </div>
  </div>
}
