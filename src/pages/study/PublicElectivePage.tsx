import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { GradeTabs } from '../../components/GradeTabs'
import { loadGradesCache } from '../../lib/academic-cache'
import { readPublicElectives } from '../../lib/public-elective'
import { useQbankRevision } from '../../lib/useQbankRevision'

const PASS = /^(合格|优秀|良好|中等|及格|通过)/
const passed = (score: string) => {
  const numeric = Number(String(score).replace(/[^\d.]/g, ''))
  if (Number.isFinite(numeric) && numeric > 0) return numeric >= 60
  return PASS.test(String(score).trim())
}

export function PublicElectivePage({ embedded = false }: { embedded?: boolean } = {}) {
  useQbankRevision()
  const grades = loadGradesCache()
  const offerings = readPublicElectives()
  const [query, setQuery] = useState('')

  const courses = useMemo(() => {
    const categoryOf = (code: string) => ({ H: '海洋知识类', R: '人文素养类', Z: '自然科学类', G: '公共艺术类' } as Record<string, string>)[String(code).toUpperCase().slice(0, 1)] ?? '其他公选'
    /* 每条成绩最多匹配一门目录课程，避免同名课程把同一条成绩重复计入学分。 */
    const consumed = new Set<number>()
    const catalog = offerings.map((item) => {
      const index = grades.findIndex((row, rowIndex) => !consumed.has(rowIndex) && (row.code === item.code || row.name === item.name))
      const grade = index >= 0 ? grades[index] : undefined
      if (index >= 0) consumed.add(index)
      return { code: item.code, name: item.name, teacher: item.teacher, credit: item.credit, category: item.category || categoryOf(item.code), score: grade?.score ?? '未修', ok: grade ? passed(grade.score) : false }
    })
    const used = new Set(catalog.map((item) => item.code))
    /* 与「已修公选课」口径一致（H/R/Z/G）；同代码重修只保留一条，及格的优先。 */
    const deduped = new Set<string>()
    const fromGrades = grades
      .filter((row, rowIndex) => !consumed.has(rowIndex) && !used.has(row.code))
      .filter((row) => row.nature.includes('公选') || /^[HRZG]/i.test(String(row.code)))
      .sort((a, b) => Number(passed(b.score)) - Number(passed(a.score)))
      .filter((row) => {
        const key = row.code || row.name
        if (deduped.has(key)) return false
        deduped.add(key)
        return true
      })
      .map((row) => ({ code: row.code, name: row.name, teacher: '', credit: Number(row.credit) || 0, category: categoryOf(row.code), score: row.score, ok: passed(row.score) }))
    return [...catalog, ...fromGrades]
  }, [grades, offerings])

  const categories = useMemo(() => {
    const map = new Map<string, { credits: number; courses: typeof courses }>([
      ['海洋知识类', { credits: 0, courses: [] }],
      ['人文素养类', { credits: 0, courses: [] }],
      ['自然科学类', { credits: 0, courses: [] }],
      ['公共艺术类', { credits: 0, courses: [] }],
    ])
    for (const course of courses) {
      const item = map.get(course.category) ?? { credits: 0, courses: [] }
      item.courses.push(course)
      if (course.ok) item.credits += course.credit
      map.set(course.category, item)
    }
    return Array.from(map, ([name, value]) => ({ name, credits: Math.min(2, value.credits), courses: value.courses }))
  }, [courses])

  const total = categories.reduce((sum, item) => sum + item.credits, 0)
  const taken = useMemo(() => grades
    .filter((row) => row.nature.includes('公选') || /^[HRZG]/i.test(String(row.code)))
    .map((row) => ({ code: row.code, name: row.name, credit: Number(row.credit) || 0, score: row.score, category: ({ H: '海洋知识类', R: '人文素养类', Z: '自然科学类', G: '公共艺术类' } as Record<string, string>)[String(row.code).toUpperCase().slice(0, 1)] ?? '其他' })), [grades])
  const filtered = courses.filter((course) => !query.trim() || `${course.name} ${course.code} ${course.teacher}`.toLowerCase().includes(query.trim().toLowerCase()))

  const content = <main style={{ padding: embedded ? 0 : '10px 14px 90px', display: 'grid', gap: 12 }}>
      {embedded ? null : <GradeTabs active="elective" />}
      <section style={{ borderRadius: 18, padding: 16, background: 'var(--card,#fff)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div><h2 style={{ margin: 0, fontSize: 22 }}>公选课毕业进度</h2></div>
          <div style={{ textAlign: 'right' }}><b style={{ fontSize: 26 }}>{total.toFixed(1)}<small style={{ fontSize: 12 }}>/8.0</small></b><small style={{ display: 'block', fontSize: 11 }}>已获得</small></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 10 }}>
          {[['已通过', total.toFixed(1)], ['可选课程', String(courses.length)], ['已匹配成绩', String(courses.filter((course) => course.score !== '未修').length)]].map(([label, value]) => (
            <div key={label} style={{ padding: 10, borderRadius: 14, background: 'rgba(31,143,95,.06)' }}><b style={{ fontSize: 22 }}>{value}</b><small style={{ display: 'block', opacity: 0.7 }}>{label}</small></div>
          ))}
        </div>
      </section>

      {taken.length ? <section style={{ padding: 14, borderRadius: 16, background: 'var(--card,#fff)' }}>
        <b>已修公选课（按课程代码分类）</b>
        <small style={{ display: 'block', opacity: 0.65, marginTop: 2 }}>H 海洋知识 · R 人文素养 · Z 自然科学 · G 公共艺术</small>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
          <thead><tr style={{ textAlign: 'left', opacity: 0.65 }}><th>课程</th><th>类别</th><th>学分</th><th>成绩</th></tr></thead>
          <tbody>{taken.map((row) => <tr key={`${row.code}-${row.name}`} style={{ borderTop: '1px solid rgba(0,0,0,.06)' }}>
            <td style={{ padding: '6px 2px' }}>{row.name}<small style={{ display: 'block', opacity: 0.55 }}>{row.code}</small></td>
            <td>{row.category}</td><td>{row.credit || '—'}</td><td>{row.score}</td>
          </tr>)}</tbody>
        </table>
      </section> : <section style={{ padding: 14, borderRadius: 16, background: 'var(--card,#fff)' }}>
        <b>已修公选课（按课程代码分类）</b>
        <p style={{ margin: '6px 0 0', fontSize: 12.5, opacity: 0.7 }}>本机成绩缓存为空，先同步成绩后再按 H/R/Z/G 分类。</p>
      </section>}

      {categories.length ? <section style={{ display: 'grid', gap: 10 }}>
        {categories.map((item) => <div key={item.name} style={{ padding: 14, borderRadius: 16, background: 'var(--card,#fff)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>{item.name}</b><span>{item.credits.toFixed(1)} / 2.0 学分</span></div>
          <div style={{ height: 6, borderRadius: 3, background: 'rgba(0,0,0,.08)', margin: '8px 0' }}><div style={{ width: `${Math.min(100, (item.credits / 2) * 100)}%`, height: '100%', borderRadius: 3, background: 'var(--green,#1f8f5f)' }} /></div>
          <small style={{ opacity: 0.7 }}>{item.credits >= 2 ? '已达标' : `还差 ${(2 - item.credits).toFixed(1)} 学分`}</small>
        </div>)}
      </section> : <section style={{ padding: 18, borderRadius: 16, background: 'var(--card,#fff)', textAlign: 'center' }}>
        <b>还没有公选课目录</b>
        <p style={{ fontSize: 12.5, opacity: 0.7 }}>先在一键获取里跑「公选选课（正方 xsxkqk）」，或同步成绩后从成绩匹配。</p>
        <Link to="/study/oneclick" style={{ display: 'inline-block', padding: '10px 18px', borderRadius: 12, background: 'var(--green,#1f8f5f)', color: '#fff', textDecoration: 'none' }}>去一键获取</Link>
      </section>}

      {filtered.length ? <section style={{ padding: 14, borderRadius: 16, background: 'var(--card,#fff)' }}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索课程 / 代码 / 教师" aria-label="搜索公选课" style={{ width: '100%', minHeight: 34, borderRadius: 10, border: '1px solid rgba(0,0,0,.12)', padding: '0 10px', marginBottom: 8 }} />
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ textAlign: 'left', opacity: 0.65 }}><th>课程</th><th>教师</th><th>学分</th><th>成绩</th></tr></thead>
          <tbody>{filtered.map((course) => <tr key={`${course.code}-${course.name}`} style={{ borderTop: '1px solid rgba(0,0,0,.06)' }}>
            <td style={{ padding: '6px 2px' }}>{course.name}<small style={{ display: 'block', opacity: 0.55 }}>{course.code}</small></td>
            <td>{course.teacher || '—'}</td><td>{course.credit || '—'}</td><td>{course.score}</td>
          </tr>)}</tbody>
        </table>
        <details style={{ marginTop: 8 }}><summary style={{ cursor: 'pointer', fontSize: 12 }}>查看结构化 JSON 样例</summary><pre style={{ overflowX: 'auto', fontSize: 11, background: 'rgba(0,0,0,.04)', padding: 8, borderRadius: 8 }}>{JSON.stringify(filtered.slice(0, 3), null, 2)}</pre></details>
      </section> : null}
    </main>

  if (embedded) return content
  return <div style={{ minHeight: '100vh', background: 'var(--bg,#f6f7f4)' }}>
    <PageHeader title="成绩" />
    {content}
  </div>
}
