import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { loadAcademicMeta } from '../lib/academic-cache'
import { listPhysicalTestResults } from '../lib/physical-test-results'
import { readPocketUni } from '../lib/pocketuni-store'
import { CourseGradesPage } from './study/CourseGradesPage'
import { PublicElectivePage } from './study/PublicElectivePage'
import { PocketUniPage } from './study/PocketUniPage'
import { SportsResultsPage } from './SportsResultsPage'

const TABS = [
  ['courses', '课程成绩'],
  ['elective', '公选进度'],
  ['tice', '体测成绩'],
  ['pu', 'PU 成绩'],
] as const

type TabKey = (typeof TABS)[number][0]

function timeText(value: string | number | null | undefined): string {
  if (!value) return '还没有同步记录'
  const time = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(time)) return '还没有同步记录'
  return `更新于 ${new Date(time).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
}

/**
 * 成绩中心：课程成绩 / 公选进度 / 体测 / PU 四个子页共用一个入口与状态条。
 * 旧的 /grades/courses、/grades/public、/sports/results、/study/pu 会重定向到这里，
 * 侧边栏、首页和外部深链不需要改。
 */
export function GradesHubPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: TabKey = TABS.some(([key]) => key === raw) ? (raw as TabKey) : 'courses'
  const updatedText = useMemo(() => {
    if (tab === 'courses') return timeText(loadAcademicMeta('grades')?.savedAt)
    if (tab === 'elective') return timeText(loadAcademicMeta('grades')?.savedAt)
    if (tab === 'tice') return timeText(listPhysicalTestResults()[0]?.updatedAt)
    return timeText(readPocketUni()?.syncedAt)
  }, [tab])

  return <div style={{ minHeight: '100vh', background: 'var(--bg,#f6f7f4)' }}>
    <PageHeader title="成绩" />
    <div style={{ padding: '0 14px' }}>
      <div role="tablist" aria-label="成绩分类" style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '4px 0 10px' }}>
        {TABS.map(([key, label]) => <button
          key={key}
          type="button"
          role="tab"
          aria-selected={tab === key}
          onClick={() => setParams({ tab: key }, { replace: true })}
          style={{
            flex: 'none', padding: '9px 15px', borderRadius: 12, border: 0, cursor: 'pointer', fontSize: 13,
            background: tab === key ? 'var(--card,#fff)' : 'transparent',
            color: 'var(--text,#222)', fontWeight: tab === key ? 700 : 450,
            boxShadow: tab === key ? '0 2px 10px rgba(0,0,0,.06)' : 'none',
          }}
        >{label}</button>)}
      </div>
      <p role="status" style={{ margin: '0 0 10px', fontSize: 11.5, color: 'var(--text-3,#777)' }}>
        {updatedText} · 同步失败时保留旧数据，不会写成 0
      </p>
    </div>
    <div style={{ padding: '0 14px 90px', display: 'grid', gap: 12 }}>
      {tab === 'courses' ? <CourseGradesPage embedded /> : null}
      {tab === 'elective' ? <PublicElectivePage embedded /> : null}
      {tab === 'tice' ? <SportsResultsPage embedded /> : null}
      {tab === 'pu' ? <PocketUniPage embedded /> : null}
    </div>
  </div>
}
