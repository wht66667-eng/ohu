import { useMemo, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { GradeTabs } from '../components/GradeTabs'
import { openExternalUrl } from '../lib/campus-links'
import { captureQbankSession, getQbankRevision, subscribeQbank } from '../lib/qbank'
import {
  importTiceSummary,
  listPhysicalTestResults,
  parsePhysicalTestText,
  savePhysicalTestResult,
  type PhysicalTestEvent,
  type PhysicalTestRecord,
} from '../lib/physical-test-results'
import { parseTicePaste, ticeEventViews, type TiceSummary } from '../lib/tice-parse'
import styles from './sports-results.module.css'


function currentSchoolYear(date = new Date()) {
  const start = date.getMonth() >= 7 ? date.getFullYear() : date.getFullYear() - 1
  return `${start}-${start + 1}`
}

function localToday() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function parseEventLines(value: string): PhysicalTestEvent[] {
  return value.split(/[\r\n]+/).map((line): PhysicalTestEvent | null => {
    const match = line.trim().match(/^([^：:,，]{2,20})[：:,，]\s*(.{1,48})$/)
    if (!match || /姓名|学号|身份证|手机号|班级|学院|网址/i.test(match[1])) return null
    const result = match[2].trim()
    if (/\d{10,}/.test(`${match[1]}${result}`)) return null
    const scoreMatch = result.match(/(?:得分|分数|评分)\s*[:：]?\s*(\d{1,3}(?:\.\d+)?)/)
    return { name: match[1].trim(), result, ...(scoreMatch ? { score: Number(scoreMatch[1]) } : {}) }
  }).filter((row): row is PhysicalTestEvent => row !== null).slice(0, 12)
}

function scoreText(value: number | null): string {
  return value === null ? '—' : String(Number(value.toFixed(2)))
}

function ResultsChart({ rows }: { rows: PhysicalTestRecord[] }) {
  const ordered = rows.filter((row) => row.totalScore !== null)
    .sort((a, b) => (a.testedAt || a.academicYear).localeCompare(b.testedAt || b.academicYear))
  if (ordered.length < 2) return <p className={styles.chartHint}>再记录一次不同日期的成绩，就能看到趋势变化。</p>
  const width = 320, height = 124, padX = 18, padY = 16
  const points = ordered.map((row, index) => ({
    row,
    x: padX + index * (width - padX * 2) / (ordered.length - 1),
    y: height - padY - (row.totalScore ?? 0) / 120 * (height - padY * 2),
  }))
  return <div className={styles.chartWrap}>
    <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`体测成绩趋势：${ordered.map(row => `${row.testedAt || row.academicYear} ${scoreText(row.totalScore)}分`).join('，')}`}>
      {[0, 60, 120].map(score => {
        const y = height - padY - score / 120 * (height - padY * 2)
        return <g key={score}><line x1={padX} x2={width - padX} y1={y} y2={y} className={styles.gridLine} /><text x="0" y={y + 4} className={styles.axisLabel}>{score}</text></g>
      })}
      <polyline points={points.map(point => `${point.x},${point.y}`).join(' ')} className={styles.chartLine} />
      {points.map(point => <g key={point.row.id}><circle cx={point.x} cy={point.y} r="5" className={styles.chartPoint} /><title>{point.row.testedAt || point.row.academicYear}：{scoreText(point.row.totalScore)} 分</title></g>)}
    </svg>
    <div className={styles.chartLabels}><span>{ordered[0].testedAt.slice(0, 7) || ordered[0].academicYear}</span><span>{ordered[ordered.length - 1].testedAt.slice(0, 7) || ordered[ordered.length - 1].academicYear}</span></div>
  </div>
}

function TicePreview({ summary }: { summary: TiceSummary }) {
  const current = summary.current
  return <div className={styles.ticePreview}>
    <b>识别结果 · {summary.history.length} 个学年{current?.items.length ? ` · 本次 ${current.items.length} 项明细` : ''}</b>
    {summary.history.length ? <ul>
      {summary.history.map(year => <li key={year.year}>
        <span>{year.year}</span>
        <span>{year.total === null ? '未公布' : `${scoreText(year.total)} 分`}</span>
        <span>{year.grade || '等级未公布'}</span>
      </li>)}
    </ul> : <p>没有识别到历年表。若只粘贴了「本次」页，会缺少学年与总分，请连同历年成绩页一起粘贴。</p>}
    {current?.items.length ? <p>本次已计分 {current.doneCount}/{current.totalCount} 项；`---` 的项目按「未计分」保存，不当成 0 分。</p> : null}
  </div>
}

function SportsResultsAccountPage() {
  const [rows, setRows] = useState(() => listPhysicalTestResults())
  const [schoolYear, setSchoolYear] = useState(currentSchoolYear())
  const [testedAt, setTestedAt] = useState(localToday())
  const [totalScore, setTotalScore] = useState('')
  const [eventText, setEventText] = useState('')
  const [sourceText, setSourceText] = useState('')
  const [recordView, setRecordView] = useState<'current' | 'history' | 'standard'>('current')
  const [ticeText, setTiceText] = useState('')
  const [ticePreview, setTicePreview] = useState<TiceSummary | null>(null)
  const [message, setMessage] = useState('')
  const [ticeMessage, setTiceMessage] = useState('')
  const [error, setError] = useState('')
  const [ticeError, setTiceError] = useState('')
  const best = useMemo(() => rows.reduce<PhysicalTestRecord | null>((current, row) => {
    if (row.totalScore === null) return current
    return !current || current.totalScore === null || row.totalScore > current.totalScore ? row : current
  }, null), [rows])
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

  const analyzeTice = () => {
    setTiceError(''); setTiceMessage(''); setTicePreview(null)
    if (!ticeText.trim()) { setTiceError('先把体测「历年成绩」或「本次成绩」页面整页复制，再粘贴到这里。'); return }
    const parsed = parseTicePaste(ticeText)
    if (!parsed.history.length && !parsed.current) {
      setTiceError('没有识别到体测学年或项目。请确认复制的是体测系统的成绩表格，而不是通知页面。')
      return
    }
    setTicePreview(parsed)
    setTiceMessage(`已识别 ${parsed.history.length} 个学年${parsed.current?.items.length ? `、本次 ${parsed.current.items.length} 项明细` : ''}；核对后保存。`)
  }

  const saveTice = () => {
    if (!ticePreview) return
    setTiceError(''); setTiceMessage('')
    try {
      importTiceSummary(ticePreview)
      setRows(listPhysicalTestResults())
      setTicePreview(null); setTiceText('')
      setTiceMessage('体测成绩已保存到本机当前账号；`---` 项目记为未计分，未公布的总分保持「—」。')
    } catch (failure) {
      setTiceError(failure instanceof Error ? failure.message : '保存失败，请重试。')
    }
  }

  const save = () => {
    setError(''); setMessage('')
    const score = Number(totalScore)
    if (!/^\d{4}-\d{4}$/.test(schoolYear) || Number(schoolYear.slice(5)) !== Number(schoolYear.slice(0, 4)) + 1) { setError('学年请填写连续的格式，例如 2026-2027。'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(testedAt) || !Number.isFinite(new Date(`${testedAt}T12:00:00`).getTime())) { setError('请选择有效的体测日期。'); return }
    if (!totalScore.trim() || !Number.isFinite(score) || score < 0 || score > 120) { setError('总分需填写 0 到 120 之间的数字（含加分）。'); return }
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
    <div style={{ padding: '0 16px' }}><GradeTabs active="/sports/results" /></div>
    <div className={styles.content}>
      <section style={{ padding: '22px 20px', borderRadius: 24, background: 'var(--green-soft)', color: 'var(--green-text)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <small style={{ opacity: 0.8 }}>最近一次体测</small>
          <small style={{ opacity: 0.8 }}>{latest?.academicYear || '尚无记录'}</small>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, margin: '6px 0 2px' }}>
          <b style={{ fontSize: 68, lineHeight: 1 }}>{latest ? scoreText(latest.totalScore) : '—'}</b>
          <span style={{ fontSize: 16, opacity: 0.85 }}>分</span>
          {latest?.grade ? <em style={{ marginLeft: 8, padding: '3px 8px', borderRadius: 999, background: 'rgba(255,255,255,.2)', fontSize: 12, fontStyle: 'normal' }}>{latest.grade}</em> : null}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, opacity: 0.9 }}>
          <span>最好 {best ? `${scoreText(best.totalScore)} 分 · ${best.academicYear}` : '—'}</span>
          <Link to="/study/oneclick" style={{ color: 'inherit', textDecoration: 'underline' }}>更新成绩</Link>
        </div>
      </section>

      <section className={`${styles.card} ${styles.recordCard}`}>
        <label className={styles.field}>粘贴成绩页文字<textarea value={ticeText} onChange={event => { setTiceText(event.target.value); setTiceError(''); setTiceMessage('') }} rows={4} maxLength={60000} placeholder="粘贴体测成绩页文字" /></label>
        <div className={styles.buttonRow}>
          <button type="button" className={styles.outlineButton} onClick={analyzeTice} disabled={!ticeText.trim()}>识别</button>
          <button type="button" className={styles.primary} onClick={saveTice} disabled={!ticePreview}>保存</button>
        </div>
        {ticePreview ? <TicePreview summary={ticePreview} /> : null}
        {ticeMessage ? <p className={styles.success} role="status">{ticeMessage}</p> : null}
        {ticeError ? <p className={styles.error} role="alert">{ticeError}</p> : null}
      </section>

      <section className={`${styles.card} ${styles.recordCard}`}>
        <label className={styles.field}>粘贴成绩页文字<textarea value={sourceText} onChange={event => { setSourceText(event.target.value); setError(''); setMessage('') }} rows={3} placeholder="粘贴成绩页文字" /></label>
        <button type="button" className={styles.outlineButton} onClick={parseCopiedResult}>本机识别并填入</button>
        <div className={styles.formGrid}>
          <label className={styles.field}>学年<input value={schoolYear} onChange={event => setSchoolYear(event.target.value)} placeholder="2026-2027" inputMode="numeric" /></label>
          <label className={styles.field}>测试日期<input type="date" value={testedAt} onChange={event => setTestedAt(event.target.value)} /></label>
          <label className={styles.field}>体测总分（含加分）<input type="number" min="0" max="120" step="0.01" value={totalScore} onChange={event => setTotalScore(event.target.value)} placeholder="0–120" inputMode="decimal" /></label>
        </div>
        <label className={styles.field}>项目明细（每行“项目：成绩”，可选填）<textarea value={eventText} onChange={event => setEventText(event.target.value)} rows={4} maxLength={1200} placeholder={'50米跑：8.5 秒\n立定跳远：2.1 米'} /></label>
        {message ? <p className={styles.success} role="status">{message}</p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <button type="button" className={styles.primary} onClick={save}>确认保存成绩</button>
      </section>

      <section className={styles.card}>
        <div style={{ display: 'flex', gap: 8, margin: '0 0 12px', flexWrap: 'wrap' }}>
          {([['current', '本次'], ['history', '历年'], ['standard', '标准']] as const).map(([key, label]) => (
            <button key={key} type="button" className={recordView === key ? styles.primary : styles.outlineButton} onClick={() => setRecordView(key)}>
              {label}
            </button>
          ))}
        </div>
        {recordView === 'standard' ? <div className={styles.empty}>
          <strong>学校评分标准暂未接入</strong>
          <span>体测系统 exerPFB 还没同步；先参考国家《学生体质健康标准（2014年修订）》，不伪造校标。</span>
          <button type="button" className={styles.outlineButton} onClick={() => openExternalUrl('https://www.csh.moe.edu.cn/wtzx/zcwj/20141226/2c909e854a8490a4014a84fda9b4001d.html')}>查看国家体测标准 ↗</button>
        </div> : rows.length ? <>
          {recordView === 'history' ? <div className={styles.stats}>
            <div><small>最好成绩</small><strong>{best ? scoreText(best.totalScore) : '—'}<i>分</i></strong><span>{best?.academicYear ?? '等待记录'}</span></div>
            <div><small>最近一次</small><strong>{latest ? scoreText(latest.totalScore) : '—'}<i>分</i></strong><span>{latest?.testedAt || latest?.academicYear || '等待记录'}</span></div>
          </div> : null}
          {recordView === 'history' ? <ResultsChart rows={rows} /> : null}
          <div className={styles.history}>{(recordView === 'current' ? (latest ? [latest] : []) : rows).map(row => <article className={styles.resultRow} key={row.id}>
            <div className={styles.resultHead}>
              <span>
                <b>{row.academicYear}{row.grade ? <em className={styles.gradePill}>{row.grade}</em> : null}</b>
                <small>{row.testedAt || '学校未提供具体日期'}{row.source === 'jou-tice' ? ' · 学校系统同步' : row.source === 'tice-import' ? ' · 体测页面导入' : ''}{row.bonus ? ` · 加分 ${row.bonus}` : ''}</small>
              </span>
              <strong>{scoreText(row.totalScore)}<i>分</i></strong>
            </div>
            {row.events.length ? <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
              {ticeEventViews(row.events.map((item) => ({ name: item.name, raw: item.result, score: item.score ?? null, note: item.note ?? '' }))).map((event) => <div key={`${row.id}-${event.name}`} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'baseline', padding: '8px 10px', borderRadius: 10, background: 'rgba(0,0,0,.035)' }}>
                <div><b style={{ fontSize: 13 }}>{event.name}</b><small style={{ display: 'block', opacity: 0.6 }}>权重 {event.weight}%{event.note ? ` · ${event.note}` : ''}</small></div>
                <span style={{ fontSize: 13 }}>{event.raw || '—'}</span>
                <em style={{ fontStyle: 'normal', fontSize: 12, opacity: 0.75 }}>{event.score === null ? '未计分' : `${event.score} 分`}</em>
              </div>)}
            </div> : <small className={styles.noEvents}>未录入单项明细</small>}
          </article>)}</div>
        </> : <div className={styles.empty}><strong>还没有体测记录</strong><span>用一键登录自动同步（填写体测密码），或从学校官方入口查询后粘贴成绩页文字识别保存，之后就能看最好成绩与变化趋势。</span><Link to="/study/oneclick" style={{ justifySelf: 'center', display: 'inline-block', padding: '10px 18px', borderRadius: 12, background: 'var(--green,#1f8f5f)', color: '#fff', textDecoration: 'none', fontWeight: 600 }}>去一键获取</Link></div>}
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
