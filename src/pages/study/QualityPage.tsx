import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/PageHeader'
import { useQbankRevision } from '../../lib/useQbankRevision'
import { readQuality } from '../../lib/quality-store'

function credit(value: number): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(2))) : '—'
}

function stamp(value: number): string {
  if (!value) return '时间未知'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '时间未知'
}

export function QualityPage() {
  useQbankRevision()
  const summary = readQuality()

  return <div style={{ minHeight: '100vh', background: 'var(--bg,#f6f7f4)' }}>
    <PageHeader title="校园档案 · 素质拓展" />
    <div style={{ padding: '0 14px' }}><Link to="/grades" style={{ fontSize: 13, color: 'var(--green-text,#1f8f5f)', textDecoration: 'none' }}>‹ 返回成绩中心</Link></div>
    <main style={{ padding: '12px 14px 90px', display: 'grid', gap: 12 }}>
      {summary ? <>
        <section style={{ borderRadius: 18, padding: '18px 16px', background: 'var(--green,#1f8f5f)', color: '#fff' }}>
          <small style={{ opacity: 0.8 }}>实践系统 · 素质拓展</small>
          <h2 style={{ margin: '6px 0 2px', fontSize: 34 }}>{credit(summary.totalCredit)} <span style={{ fontSize: 14, fontWeight: 400 }}>学分</span></h2>
          <p style={{ margin: 0, fontSize: 12.5, opacity: 0.9 }}>
            类型2 {credit(summary.type2)} · 类型3 {credit(summary.type3)} · 排名 {summary.rank || '—'} · 前 {summary.percent || '—'}%
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 11.5, opacity: 0.75 }}>更新于 {stamp(summary.syncedAt)} · 与 PU 分开计算，不相加</p>
        </section>

        <section style={{ borderRadius: 16, padding: 14, background: 'var(--card,#fff)' }}>
          <b style={{ fontSize: 15 }}>学期明细</b>
          {summary.semesters.length ? <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'grid', gap: 8 }}>
            {summary.semesters.map((semester) => <li key={semester.id} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line,rgba(0,0,0,.06))', paddingBottom: 6 }}>
              <span>{semester.id || '学期'}</span>
              <b>{credit(semester.total)} 学分</b>
            </li>)}
          </ul> : <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--text-2)' }}>没有学期明细，只读到汇总。</p>}
        </section>

        <section style={{ borderRadius: 16, padding: 14, background: 'var(--card,#fff)' }}>
          <b style={{ fontSize: 15 }}>构成明细</b>
          {summary.details.length ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {summary.details.map((item) => <span key={item.name} style={{ padding: '6px 10px', borderRadius: 999, background: 'var(--green-soft,#e8f5ee)', fontSize: 12 }}>
              {item.name} {credit(item.credit)}
            </span>)}
          </div> : <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--text-2)' }}>没有分类明细。</p>}
        </section>

        <Link to="/study/oneclick" style={{ textAlign: 'center', padding: 12, borderRadius: 12, background: 'var(--card,#fff)', color: 'var(--green,#1f8f5f)', textDecoration: 'none', fontSize: 13 }}>
          更新校园档案 · 素质拓展 ›
        </Link>
      </> : <section style={{ borderRadius: 16, padding: 18, background: 'var(--card,#fff)', textAlign: 'center' }}>
        <b style={{ fontSize: 16 }}>还没有校园档案数据</b>
        <p style={{ margin: '8px 0 14px', fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6 }}>
          在「一键获取」读取实践系统 7058；需要统一认证密码。校园档案与 PU 官方分开保存、不相加。
        </p>
        <Link to="/study/oneclick" style={{ display: 'inline-block', padding: '10px 18px', borderRadius: 12, background: 'var(--green,#1f8f5f)', color: '#fff', textDecoration: 'none', fontSize: 14 }}>
          去一键获取
        </Link>
      </section>}
    </main>
  </div>
}
