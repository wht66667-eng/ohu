import { useMemo, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { openExternalUrl } from '../lib/campus-links'
import { captureQbankSession, getQbankRevision, subscribeQbank } from '../lib/qbank'
import { listPhysicalTestResults, parsePhysicalTestText, savePhysicalTestResult, type PhysicalTestEvent, type PhysicalTestRecord } from '../lib/physical-test-results'
import styles from './sports-results.module.css'

const SPORTS_COLLEGE = 'https://pe.jou.edu.cn/'
const PHYSICAL_TEST_CENTER = 'tel:85895570'

function currentSchoolYear(date = new Date()) {
  const start = date.getMonth() >= 7 ? date.getFullYear() : date.getFullYear() - 1
  return `${start}-${start + 1}`
}

function localToday() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function parseEventLines(value: string): PhysicalTestEvent[] {
  return value.split(/[\r\n]+/).map(line => {
    const match = line.trim().match(/^([^：:,，]{2,20})[：:,，]\s*(.{1,48})$/)
    if (!match || /姓名|学号|身份证|手机号|班级|学院|网址/i.test(match[1])) return null
    const result = match[2].trim()
    if (/\d{10,}/.test(`${match[1]}${result}`)) return null
    const scoreMatch = result.match(/(?:得分|分数|评分)\s*[:：]?\s*(\d{1,3}(?:\.\d+)?)/)
    return { name: match[1].trim(), result, ...(scoreMatch ? { score: Number(scoreMatch[1]) } : {}) }
  }).filter((row): row is PhysicalTestEvent => row !== null).slice(0, 12)
}

function ResultsChart({ rows }: { rows: PhysicalTestRecord[] }) {
  if (rows.length < 2) return <p className={styles.chartHint}>再记录一次不同日期的成绩，就能看到趋势变化。</p>
  const ordered = [...rows].sort((a, b) => a.testedAt.localeCompare(b.testedAt))
  const width = 320, height = 124, padX = 18, padY = 16
  const points = ordered.map((row, index) => ({
    row,
    x: padX + (ordered.length === 1 ? 0 : index * (width - padX * 2) / (ordered.length - 1)),
    y: height - padY - row.totalScore / 100 * (height - padY * 2),
  }))
  return <div className={styles.chartWrap}>
    <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`体测成绩趋势：${ordered.map(row => `${row.testedAt} ${row.totalScore}分`).join('，')}`}>
      {[0, 50, 100].map(score => {
        const y = height - padY - score / 100 * (height - padY * 2)
        return <g key={score}><line x1={padX} x2={width - padX} y1={y} y2={y} className={styles.gridLine} /><text x="0" y={y + 4} className={styles.axisLabel}>{score}</text></g>
      })}
      <polyline points={points.map(point => `${point.x},${point.y}`).join(' ')} className={styles.chartLine} />
      {points.map(point => <g key={point.row.id}><circle cx={point.x} cy={point.y} r="5" className={styles.chartPoint} /><title>{point.row.testedAt}：{point.row.totalScore} 分</title></g>)}
    </svg>
    <div className={styles.chartLabels}><span>{ordered[0].testedAt.slice(0, 7)}</span><span>{ordered[ordered.length - 1].testedAt.slice(0, 7)}</span></div>
  </div>
}

function SportsResultsAccountPage() {
  const [rows, setRows] = useState(() => listPhysicalTestResults())
  const [schoolYear, setSchoolYear] = useState(currentSchoolYear())
  const [testedAt, setTestedAt] = useState(localToday())
  const [totalScore, setTotalScore] = useState('')
  const [eventText, setEventText] = useState('')
  const [sourceText, setSourceText] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const best = useMemo(() => rows.reduce<PhysicalTestRecord | null>((current, row) => !current || row.totalScore > current.totalScore ? row : current, null), [rows])
  const latest = rows[0]

  const parseCopiedResult = () => {
    setError('')
    if (!sourceText.trim()) { setError('先粘贴成绩页面中的文字，或手动填写下方总分和项目。'); return }
    const parsed = parsePhysicalTestText(sourceText)
    if (parsed.totalScore !== null) setTotalScore(String(parsed.totalScore))
    if (parsed.events.length) setEventText(parsed.events.map(event => `${event.name}：${event.result}`).join('\n'))
    setSourceText('')
    setMessage(parsed.totalScore === null && !parsed.events.length
      ? '没有识别出成绩字段。原文已从输入框清除，请手动录入总分和项目；确认前不会保存任何内容。'
      : `已在本机识别${parsed.totalScore === null ? '' : '总分'}${parsed.events.length ? `和 ${parsed.events.length} 项明细` : ''}。请核对后保存；查询原文不会保存。`)
  }

  const save = () => {
    setError(''); setMessage('')
    const score = Number(totalScore)
    if (!/^\d{4}-\d{4}$/.test(schoolYear) || Number(schoolYear.slice(5)) !== Number(schoolYear.slice(0, 4)) + 1) { setError('学年请填写连续的格式，例如 2026-2027。'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(testedAt) || !Number.isFinite(new Date(`${testedAt}T12:00:00`).getTime())) { setError('请选择有效的体测日期。'); return }
    if (!totalScore.trim() || !Number.isFinite(score) || score < 0 || score > 100) { setError('总分需填写 0 到 100 之间的数字。'); return }
    const expected = captureQbankSession()
    try {
      savePhysicalTestResult({ academicYear: schoolYear, testedAt, totalScore: score, events: parseEventLines(eventText) }, expected)
      setRows(listPhysicalTestResults())
      setTotalScore(''); setEventText('')
      setMessage('成绩已保存在本机当前账号中。查询原文没有保存。')
    } catch (failure) { setError((failure as Error).message || '体测成绩保存失败，请重试。') }
  }

  return <div className={styles.page}>
    <PageHeader title="体测成绩" />
    <div className={styles.content}>
      <section className={styles.card}>
        <span className={styles.kicker}>江苏海洋大学 · 成绩由你确认后保存</span>
        <h2>把体测记录带回哦狐</h2>
        <p>打开学校官方查询入口，查看成绩后复制结果页文字，回到这里粘贴。哦狐只在本机识别，你确认后保存总分和项目明细；不会保存原文，也不会索取学校密码。</p>
        <button type="button" className={styles.primary} onClick={() => openExternalUrl(SPORTS_COLLEGE)}>打开体育学院官方入口 ↗</button>
        <a className={styles.secondary} href={PHYSICAL_TEST_CENTER}>联系体测中心 · 85895570</a>
        <div className={styles.quickLinks}><Link to="/study">学业中心：课表与成绩 ›</Link><Link to="/schedule">打开我的课表 ›</Link></div>
        <small>官方系统没有向哦狐开放可验证的个人成绩接口，所以跳转后仍需你复制并确认成绩。以后只有获得学校正式授权接口，才能自动同步。</small>
      </section>

      <section className={`${styles.card} ${styles.recordCard}`}>
        <div className={styles.sectionTitle}><div><span className={styles.kicker}>本机 · 当前账号隔离</span><h2>录入一次，持续查看</h2></div><span className={styles.count}>{rows.length} 条</span></div>
        <label className={styles.field}>粘贴成绩页文字（仅用于本次识别）<textarea value={sourceText} onChange={event => { setSourceText(event.target.value); setError(''); setMessage('') }} rows={4} placeholder="可以长按粘贴学校成绩页面中的文字；保存时不会保留这段原文。" /></label>
        <button type="button" className={styles.outlineButton} onClick={parseCopiedResult}>本机识别并填入</button>
        <div className={styles.formGrid}>
          <label className={styles.field}>学年<input value={schoolYear} onChange={event => setSchoolYear(event.target.value)} placeholder="2026-2027" inputMode="numeric" /></label>
          <label className={styles.field}>测试日期<input type="date" value={testedAt} onChange={event => setTestedAt(event.target.value)} /></label>
          <label className={styles.field}>体测总分<input type="number" min="0" max="100" step="0.01" value={totalScore} onChange={event => setTotalScore(event.target.value)} placeholder="0–100" inputMode="decimal" /></label>
        </div>
        <label className={styles.field}>项目明细（每行“项目：成绩”，可选填）<textarea value={eventText} onChange={event => setEventText(event.target.value)} rows={4} maxLength={1200} placeholder={'50米跑：8.5 秒\n立定跳远：2.1 米'} /></label>
        <p className={styles.formHint}>只会保存学年、日期、总分和最多 12 项明细，不会保存姓名、学号或粘贴原文。</p>
        {message ? <p className={styles.success} role="status">{message}</p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <button type="button" className={styles.primary} onClick={save}>确认保存成绩</button>
      </section>

      <section className={styles.card}>
        <div className={styles.sectionTitle}><div><span className={styles.kicker}>成绩趋势</span><h2>我的体测记录</h2></div></div>
        {rows.length ? <>
          <div className={styles.stats}>
            <div><small>最好成绩</small><strong>{best?.totalScore ?? '—'}<i>分</i></strong><span>{best?.academicYear ?? '等待记录'}</span></div>
            <div><small>最近一次</small><strong>{latest?.totalScore ?? '—'}<i>分</i></strong><span>{latest?.testedAt ?? '等待记录'}</span></div>
          </div>
          <ResultsChart rows={rows} />
          <div className={styles.history}>{rows.map(row => <article className={styles.resultRow} key={row.id}>
            <div className={styles.resultHead}><span><b>{row.academicYear}</b><small>{row.testedAt}</small></span><strong>{row.totalScore}<i>分</i></strong></div>
            {row.events.length ? <div className={styles.eventList}>{row.events.map(event => <span key={`${row.id}-${event.name}`}>{event.name} · {event.result}{event.score === undefined ? '' : ` · ${event.score}分`}</span>)}</div> : <small className={styles.noEvents}>未录入单项明细</small>}
          </article>)}</div>
        </> : <div className={styles.empty}><strong>还没有体测记录</strong><span>从学校官方入口查询后，粘贴成绩并确认保存，之后就能看最好成绩与变化趋势。</span></div>}
      </section>
      <Link className={styles.back} to="/sports">返回运动中心</Link>
    </div>
  </div>
}

export function SportsResultsPage() {
  const scope = useSyncExternalStore(
    subscribeQbank,
    () => `${getQbankRevision()}:${captureQbankSession().uid}`,
    () => 'server:guest',
  )
  return <SportsResultsAccountPage key={scope} />
}
