import { Link } from 'react-router-dom'

export const GRADE_TABS = [
  ['courses', '课程成绩'],
  ['elective', '公选进度'],
  ['tice', '体测成绩'],
  ['pu', 'PU 成绩'],
] as const

export type GradeTabKey = (typeof GRADE_TABS)[number][0]

/** 成绩中心内部的子页导航；旧链接仍会被重定向到同一位置。 */
export function GradeTabs({ active }: { active: GradeTabKey }) {
  return <nav aria-label="成绩分类" style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '4px 0 10px' }}>
    {GRADE_TABS.map(([key, label]) => <Link
      key={key}
      to={`/grades?tab=${key}`}
      aria-current={key === active ? 'page' : undefined}
      style={{
        flex: 'none', padding: '8px 14px', borderRadius: 12, textDecoration: 'none', fontSize: 13,
        background: key === active ? '#fff' : 'transparent',
        color: 'var(--text,#222)', fontWeight: key === active ? 600 : 400,
        boxShadow: key === active ? '0 2px 10px rgba(0,0,0,.06)' : 'none',
      }}
    >{label}</Link>)}
  </nav>
}
