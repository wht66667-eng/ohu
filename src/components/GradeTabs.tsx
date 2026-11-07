import { Link } from 'react-router-dom'

const TABS = [
  ['/grades/courses', '课程成绩'],
  ['/grades/public', '公选进度'],
  ['/sports/results', '体测成绩'],
  ['/study/pu', 'PU 成绩'],
] as const

export function GradeTabs({ active }: { active: string }) {
  return <nav aria-label="成绩分类" style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '4px 0 10px' }}>
    {TABS.map(([to, label]) => <Link
      key={to}
      to={to}
      aria-current={to === active ? 'page' : undefined}
      style={{
        flex: 'none', padding: '8px 14px', borderRadius: 12, textDecoration: 'none', fontSize: 13,
        background: to === active ? '#fff' : 'transparent',
        color: 'var(--text,#222)', fontWeight: to === active ? 600 : 400,
        boxShadow: to === active ? '0 2px 10px rgba(0,0,0,.06)' : 'none',
      }}
    >{label}</Link>)}
  </nav>
}
