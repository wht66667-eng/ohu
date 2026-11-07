import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { getNextClass, getScheduleRowsForDate } from '../lib/schedule-cache'
import { loadLocalIdentity } from '../lib/local-identity'
import { useSchool } from '../store/school'
import styles from './SimpleHomePage.module.css'


function daysUntil(dateTime: string): number | null {
  const time = Date.parse(dateTime.replace(' ', 'T'))
  if (!Number.isFinite(time)) return null
  return Math.ceil((time - Date.now()) / 86_400_000)
}

export function SimpleHomePage() {
  const rows = useSchool((state) => state.schedule)
  const exams = useSchool((state) => state.exams)
  const todos = useSchool((state) => state.todos)

  const next = useMemo(() => getNextClass(rows), [rows])
  const nearest = useMemo(() => {
    const list: Array<{ key: string; label: string; name: string; room: string; teacher: string; sections: number[] }> = []
    for (let index = 0; index <= 7 && list.length < 4; index += 1) {
      const date = new Date()
      date.setDate(date.getDate() + index)
      const label = index === 0 ? '今天' : index === 1 ? '明天' : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()]
      const items = getScheduleRowsForDate(date, rows).slice().sort((a, b) => a.sections[0] - b.sections[0])
      for (const row of items) {
        if (list.length >= 4) break
        list.push({ key: `${date.toDateString()}-${row.name}-${row.sections[0]}`, label, name: row.name, room: row.room, teacher: row.teacher, sections: row.sections })
      }
    }
    return list
  }, [rows])
  const upcoming = useMemo(() => {
    for (let index = 1; index <= 7; index += 1) {
      const date = new Date()
      date.setDate(date.getDate() + index)
      const items = getScheduleRowsForDate(date, rows)
      if (items.length) {
        const label = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()]
        const row = items[0]
        return { name: row.name, room: row.room, teacher: row.teacher, timeLabel: `${label} ${row.sections[0]}-${row.sections[row.sections.length - 1]}节` }
      }
    }
    return null
  }, [rows])
  const hero = next.name ? next : upcoming
  const identity = loadLocalIdentity()
  const date = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date())
  const upcomingExams = exams
    .filter((exam) => Date.parse(exam.datetime.replace(' ', 'T')) > Date.now())
    .sort((a, b) => Date.parse(a.datetime.replace(' ', 'T')) - Date.parse(b.datetime.replace(' ', 'T')))
    .slice(0, 2)

  return <div className={styles.page} data-fox-home="true">
    <header className={styles.header}>
      <img className={styles.avatar} src="/brand/ohu-original/fox-avatar.webp" alt="" width={48} height={48} />
      <div className={styles.greeting}>
        <small>{date}</small>
        <h1>{identity ? `${identity.studentId.slice(-4)} 同学` : '同学'}，你好</h1>
      </div>
      <div className={styles.actions}>
        <button type="button" aria-label="打开菜单" onClick={() => window.dispatchEvent(new Event('ohu-open-menu'))}>☰</button>
        <Link to="/settings" aria-label="设置">⚙</Link>
      </div>
    </header>

    <section className={styles.hero} aria-labelledby="ohu-home-next-class">
      <div className={styles.heroCopy}>
        <span className={styles.eyebrow}>{next.status === 'now' ? '正在上课' : '下节课'} <span aria-hidden="true">✦</span></span>
        <h2 id="ohu-home-next-class">{hero?.name || (rows.length ? '本周没有课' : '课表还未同步')}</h2>
        <p>
          {hero?.timeLabel || upcoming?.timeLabel || (rows.length ? '本周末没有安排' : '去课表同步')}
          {(hero?.room ?? upcoming?.room) ? ` · ${hero?.room ?? upcoming?.room}` : ''}
        </p>
        <Link className={styles.heroLink} to="/schedule">打开课表去同步</Link>
      </div>
      <div className={styles.heroArt}>
        <img src="/brand/ohu-original/fox-grades-transparent.png" alt="" width={104} height={90} />
        <span aria-hidden="true">✦</span>
      </div>
    </section>

    <section className={styles.card} aria-labelledby="ohu-home-nearest">
      <div className={styles.cardHead}>
        <span className={styles.cardIcon} aria-hidden="true">课</span>
        <b id="ohu-home-nearest">最近课程</b>
        <Link to="/schedule">全部</Link>
      </div>
      {nearest.length ? <ul className={styles.rowList}>
        {nearest.map((item) => <li className={styles.infoRow} key={item.key}>
          <span className={styles.sectionBadge}>{item.label}<br />{item.sections[0]}-{item.sections[item.sections.length - 1]}节</span>
          <span className={styles.rowMain}><b>{item.name}</b><small>{item.teacher || '教师待定'}</small></span>
          <span className={styles.dueText}>{item.room}</span>
        </li>)}
      </ul> : <p className={styles.emptyText}>{rows.length ? '本周没有课' : '去课表同步后显示最近课程'}</p>}
    </section>

    <Link className={styles.card} to="/grades" aria-label="进入学业中心" style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className={styles.cardHead}>
        <span className={styles.cardIcon} aria-hidden="true">绩</span>
        <b>学业中心</b>
        <span aria-hidden="true" style={{ opacity: 0.35 }}>›</span>
      </div>
      <p className={styles.emptyText}>成绩 · 考试 · 公选 · 体测 · PU · 学习通</p>
    </Link>

    <section className={styles.card} aria-labelledby="ohu-home-exams">
      <div className={styles.cardHead}>
        <span className={styles.cardIcon} aria-hidden="true">考</span>
        <b id="ohu-home-exams">考试通知</b>
        <Link to="/study?tab=exams">全部</Link>
      </div>
      {upcomingExams.length ? <ul className={styles.rowList}>
        {upcomingExams.map((exam) => {
          const days = daysUntil(exam.datetime)
          return <li className={styles.infoRow} key={`${exam.code}-${exam.datetime}`}>
            <span className={`${styles.dateBadge}${days !== null && days <= 3 ? ` ${styles.urgent}` : ''}`}>
              <b>{exam.datetime.slice(5, 10)}</b>
              <small>{exam.datetime.slice(11, 16)}</small>
            </span>
            <span className={styles.rowMain}>
              <b>{exam.name}</b>
              <small>{exam.room || '考场待定'}</small>
            </span>
            <em className={`${styles.countdown}${days !== null && days <= 3 ? ` ${styles.urgent}` : ''}`}>
              {days === null ? '' : days <= 0 ? '今天' : `${days} 天后`}
            </em>
          </li>
        })}
      </ul> : <p className={styles.emptyText}>暂无近期考试</p>}
    </section>

    <section className={styles.card} aria-labelledby="ohu-home-todo">
      <div className={styles.cardHead}>
        <span className={styles.cardIcon} aria-hidden="true">✓</span>
        <b id="ohu-home-todo">待办</b>
        <Link to="/todo">全部</Link>
      </div>
      {todos.length ? <ul className={styles.rowList}>
        {todos.slice(0, 3).map((todo) => <li className={styles.infoRow} key={todo.id}>
          <span className={styles.sectionBadge}>待办</span>
          <span className={styles.rowMain}><b>{todo.title}</b><small>{todo.note || '未设置备注'}</small></span>
          <span className={styles.dueText}>{todo.due_at ? todo.due_at.slice(5, 16).replace('T', ' ') : '无截止'}</span>
        </li>)}
      </ul> : <p className={styles.emptyText}>暂无待办，今天可以轻松一点。</p>}
    </section>

  </div>
}
