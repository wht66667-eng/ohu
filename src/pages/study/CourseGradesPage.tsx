import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { GradeTabs } from '../../components/GradeTabs'
import { loadGradesCache, type GradeRowRemote } from '../../lib/academic-cache'
import { useQbankRevision } from '../../lib/useQbankRevision'

const num = (value: string) => {
  const parsed = Number(String(value).replace(/[^\d.]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

export function CourseGradesPage({ embedded = false }: { embedded?: boolean } = {}) {
  useQbankRevision()
  const rows = loadGradesCache()
  const [query, setQuery] = useState('')
  const [term, setTerm] = useState('')

  const terms = useMemo(() => Array.from(new Set(rows.map((row) => `${row.year} ${row.term}`.trim()).filter(Boolean))), [rows])
  const filtered = rows.filter((row) => {
    if (term && `${row.year} ${row.term}`.trim() !== term) return false
    const keyword = query.trim().toLowerCase()
    return !keyword || `${row.name} ${row.code} ${row.nature}`.toLowerCase().includes(keyword)
  })
  const numeric = rows.map((row) => num(row.score)).filter((value): value is number => value !== null)
  const average = numeric.length ? numeric.reduce((sum, value) => sum + value, 0) / numeric.length : null
  const credits = rows.reduce((sum, row) => sum + (num(row.credit) ?? 0), 0)

  const content = <main style={{ padding: embedded ? 0 : '10px 14px 90px', display: 'grid', gap: 12 }}>
      {embedded ? null : <GradeTabs active="courses" />}
      <section style={{ borderRadius: 18, padding: 16, background: 'var(--card,#fff)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 style={{ margin: 0, fontSize: 22 }}>课程成绩</h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 10 }}>
          {[['平均分', average === null ? '—' : average.toFixed(1)], ['总学分', credits ? credits.toFixed(1) : '—'], ['课程数', String(rows.length)]].map(([label, value]) => (
            <div key={label} style={{ padding: 10, borderRadius: 14, background: 'rgba(31,143,95,.06)' }}>
              <b style={{ fontSize: 22 }}>{value}</b><small style={{ display: 'block', opacity: 0.7 }}>{label}</small>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索课程 / 代码 / 性质" aria-label="搜索课程成绩" style={{ flex: '1 1 150px', minHeight: 34, borderRadius: 10, border: '1px solid rgba(0,0,0,.12)', padding: '0 10px' }} />
          <select value={term} onChange={(event) => setTerm(event.target.value)} aria-label="选择学期" style={{ minHeight: 34, borderRadius: 10, border: '1px solid rgba(0,0,0,.12)', padding: '0 8px' }}>
            <option value="">全部学期</option>
            {terms.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
      </section>

      {rows.length ? <section style={{ borderRadius: 16, padding: 14, background: 'var(--card,#fff)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ textAlign: 'left', opacity: 0.65 }}><th style={{ padding: '4px 2px' }}>课程</th><th>性质</th><th>学分</th><th>成绩</th><th>绩点</th></tr></thead>
          <tbody>{filtered.map((row: GradeRowRemote) => <tr key={`${row.code}-${row.year}-${row.term}`} style={{ borderTop: '1px solid rgba(0,0,0,.06)' }}>
            <td style={{ padding: '6px 2px' }}>{row.name}<small style={{ display: 'block', opacity: 0.55 }}>{row.year} {row.term} · {row.code}</small></td>
            <td>{row.nature || '—'}</td>
            <td>{row.credit || '—'}</td>
            <td><b>{row.score || '—'}</b></td>
            <td>{row.gpa || '—'}</td>
          </tr>)}</tbody>
        </table>
        {!filtered.length ? <p role="status" style={{ fontSize: 12.5 }}>没有匹配的课程。</p> : null}
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12 }}>查看结构化 JSON 样例（{Math.min(filtered.length, 3)} 条）</summary>
          <pre style={{ overflowX: 'auto', fontSize: 11, background: 'rgba(0,0,0,.04)', padding: 8, borderRadius: 8 }}>{JSON.stringify(filtered.slice(0, 3), null, 2)}</pre>
        </details>
      </section> : <section style={{ borderRadius: 16, padding: 18, background: 'var(--card,#fff)', textAlign: 'center' }}>
        <b>还没有课程成绩</b>
        <p style={{ fontSize: 12.5, opacity: 0.7 }}>去「一键获取」同步课表、成绩、考试。</p>
        <Link to="/study/oneclick" style={{ display: 'inline-block', padding: '10px 18px', borderRadius: 12, background: 'var(--green,#1f8f5f)', color: '#fff', textDecoration: 'none' }}>去一键获取</Link>
      </section>}
    </main>

  if (embedded) return content
  return <div style={{ minHeight: '100vh', background: 'var(--bg,#f6f7f4)' }}>
    <PageHeader title="成绩" />
    {content}
  </div>
}
