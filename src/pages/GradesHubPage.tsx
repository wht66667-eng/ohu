import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { loadLocalIdentity } from '../lib/local-identity'
import { summarizePublicElectives } from '../lib/public-elective'
import { useSchool } from '../store/school'
import styles from './SimpleHomePage.module.css'

const MODULES = [
  ['成绩', '成绩总览与学期筛选', '/grades/courses'],
  ['考试', '考试时间、考场与提醒', '/study?tab=exams'],
  ['公选课进度', 'H / R / Z / G 四类学分', '/grades/public'],
  ['体测成绩', '总分与单项明细', '/sports/results'],
  ['PU 成绩', '口袋校园学分', '/study/pu'],
  ['学习通', '本学期课程与待办', '/study/chaoxing'],
] as const

export function GradesHubPage() {
  const grades = useSchool((state) => state.grades)
  const exams = useSchool((state) => state.exams)
  const pu = useSchool((state) => state.pu)
  const tice = useSchool((state) => state.tice)
  const publicElective = useSchool((state) => state.publicElective)
  const electiveSummary = useMemo(() => summarizePublicElectives(grades, publicElective), [grades, publicElective])
  const identity = loadLocalIdentity()

  const stats = useMemo(() => {
    const scored = grades.filter((row) => Number.isFinite(Number.parseFloat(row.score)))
    const average = scored.length ? scored.reduce((sum, row) => sum + Number.parseFloat(row.score), 0) / scored.length : null
    const credits = grades.reduce((sum, row) => sum + (Number.parseFloat(row.credit) || 0), 0)
    return { average, credits, count: grades.length }
  }, [grades])

  const upcomingExams = exams
    .filter((exam) => Date.parse(exam.datetime.replace(' ', 'T')) > Date.now())
    .sort((a, b) => Date.parse(a.datetime.replace(' ', 'T')) - Date.parse(b.datetime.replace(' ', 'T')))
    .slice(0, 2)

  return <div className={styles.page} data-fox-home="true">
    <header className={styles.header}>
      <img className={styles.avatar} src="/brand/ohu-original/fox-avatar.webp" alt="" width={44} height={44} />
      <div className={styles.greeting}>
        <small>学业中心</small>
        <h1>成绩与通知</h1>
      </div>
      <div className={styles.actions}>
        <Link to="/" aria-label="返回首页">‹</Link>
      </div>
    </header>

    <section className={styles.card} aria-labelledby="hub-grades">
      <div className={styles.cardHead}>
        <span className={styles.cardIcon} aria-hidden="true">绩</span>
        <b id="hub-grades">成绩</b>
        <Link to="/grades/courses">全部</Link>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        {[['平均分', stats.average === null ? '—' : stats.average.toFixed(1)], ['总学分', stats.credits.toFixed(1)], ['课程数', String(stats.count)]].map(([label, value]) => (
          <div key={label} style={{ padding: '10px 8px', borderRadius: 12, background: 'var(--home-leaf,var(--green-soft))' }}>
            <b style={{ fontSize: 20 }}>{value}</b>
            <small style={{ display: 'block', opacity: 0.65 }}>{label}</small>
          </div>
        ))}
      </div>
    </section>

    <section className={styles.card} aria-labelledby="hub-notice">
      <div className={styles.cardHead}>
        <span className={styles.cardIcon} aria-hidden="true">考</span>
        <b id="hub-notice">考试通知</b>
        <Link to="/study?tab=exams">全部</Link>
      </div>
      {upcomingExams.length ? <ul className={styles.rowList}>
        {upcomingExams.map((exam) => <li className={styles.infoRow} key={`${exam.code}-${exam.datetime}`}>
          <span className={styles.dateBadge}><b>{exam.datetime.slice(5, 10)}</b><small>{exam.datetime.slice(11, 16)}</small></span>
          <span className={styles.rowMain}><b>{exam.name}</b><small>{exam.room || '考场待定'}</small></span>
        </li>)}
      </ul> : <p className={styles.emptyText}>暂无近期考试</p>}
    </section>

    <section className={styles.card} aria-labelledby="hub-modules">
      <div className={styles.cardHead}>
        <span className={styles.cardIcon} aria-hidden="true">全</span>
        <b id="hub-modules">全部功能</b>
      </div>
      <div style={{ display: 'grid', gap: 2 }}>
        {MODULES.map(([label, desc, to]) => {
          const value = label === '公选课进度' ? `${electiveSummary.total.toFixed(1)} / 8.0`
            : label === 'PU 成绩' && pu ? `${pu.totalCredit ?? '—'} 学分`
              : label === '体测成绩' && tice.length ? `${tice[0].totalScore ?? '—'} 分`
                : label === '成绩' ? `${stats.count} 门`
                  : label === '考试' ? `${upcomingExams.length} 场`
                    : ''
          return <Link key={to} to={to} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 4px', color: 'inherit', textDecoration: 'none', borderTop: '1px solid var(--line)' }}>
            <span className={styles.rowMain}><b>{label}</b><small>{desc}</small></span>
            {value ? <span className={styles.countdown}>{value}</span> : null}
            <span aria-hidden="true" style={{ opacity: 0.35 }}>›</span>
          </Link>
        })}
      </div>
    </section>

    <section className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.cardIcon} aria-hidden="true">我</span>
        <b>{identity ? `学号 ${identity.studentId}` : '游客浏览'}</b>
      </div>
      <p className={styles.emptyText}>数据来自学校系统，同步一次后保存在本机。</p>
      <Link className={styles.heroLink} to="/study/oneclick">去一键获取更新数据</Link>
    </section>
  </div>
}
