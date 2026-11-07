import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { calendarMonthDays, calendarMonthKey, parseCalendarMonth } from '../lib/calendar-month'
import { captureQbankSession, getQbankRevision, subscribeQbank } from '../lib/qbank'
import { dayName, getDayStatus, listCourseDateExceptions, listNearbyRules, toDateKey } from '../lib/schedule-calendar'
import { describeScheduleSnapshotStatus, getScheduleRowsForDate, getScheduleTermStart, loadScheduleCache, scheduleStudentIdForSnapshot, SCHEDULE_CACHE_EVENT, teachingWeekForDate, validateScheduleSnapshot } from '../lib/schedule-cache'
import styles from './academic-calendar.module.css'

function CalendarContent() {
  const [selected, setSelected] = useState(() => new Date())
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [revision, setRevision] = useState(0)
  const dateButtons = useRef(new Map<string, HTMLButtonElement>())
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1)
    window.addEventListener(SCHEDULE_CACHE_EVENT, refresh)
    return () => window.removeEventListener(SCHEDULE_CACHE_EVENT, refresh)
  }, [])
  const dates = useMemo(() => calendarMonthDays(month), [month])
  const monthKey = calendarMonthKey(month)
  const selectedKey = toDateKey(selected)
  const todayKey = toDateKey(new Date())
  const snapshot = useMemo(() => loadScheduleCache(), [revision])
  const termStart = getScheduleTermStart()
  const owner = captureQbankSession().uid
  const studentId = scheduleStudentIdForSnapshot(snapshot, '', owner)
  const dayData = dates.map(date => {
    const validated = validateScheduleSnapshot(snapshot, studentId, date, termStart, owner)
    const courses = validated.status === 'ready' ? getScheduleRowsForDate(date, validated.rows, termStart) : []
    return { date, key: toDateKey(date), courses, status: getDayStatus(date), validated }
  })
  const current = dayData.find(day => day.key === selectedKey)!
  const week = teachingWeekForDate(selected, termStart)
  const beforeTerm = selectedKey < termStart
  const rules = listNearbyRules(new Date(month.getFullYear(), month.getMonth(), 1), 31)
    .filter(rule => rule.date.startsWith(monthKey) && !rule.disabled)
  const currentHint = rules.find(rule => rule.date === selectedKey && rule.source === 'gov')
  const courseChanges = listCourseDateExceptions(selectedKey)
  const snapshotHint = describeScheduleSnapshotStatus(current.validated.status)
  const courseCount = new Set(dayData.filter(day => calendarMonthKey(day.date) === monthKey).flatMap(day => day.courses.map(course => course.name))).size

  function selectDate(date: Date, focus = false) {
    if (date.getFullYear() < 2000 || date.getFullYear() > 2099) return
    setSelected(date)
    if (calendarMonthKey(date) !== monthKey) setMonth(new Date(date.getFullYear(), date.getMonth(), 1))
    if (focus) requestAnimationFrame(() => dateButtons.current.get(toDateKey(date))?.focus())
  }
  function moveMonth(offset: number) { selectDate(new Date(month.getFullYear(), month.getMonth() + offset, 1)) }

  return <div className={styles.page}>
    <PageHeader title="校历" right={<button className={styles.today} onClick={() => selectDate(new Date())}>今天</button>} />
    <section className={styles.intro}>
      <span className={styles.eyebrow}>我的校园日程</span>
      <h2>把这个月，安排清楚。</h2>
      <p>教学周、每日课程和已确认的调课，一起看。</p>
      <div className={styles.summary}><span>学期起点 <b>{termStart.replaceAll('-', '.')}</b></span><span>本月已记录 <b>{courseCount} 门课</b></span></div>
    </section>
    <section className={styles.calendar} aria-label="月历">
      <div className={styles.toolbar}>
        <button onClick={() => moveMonth(-1)} disabled={monthKey === '2000-01'} aria-label="上个月">‹</button>
        <label><span className={styles.srOnly}>选择月份</span><input type="month" min="2000-01" max="2099-12" value={monthKey} onChange={event => { const date = parseCalendarMonth(event.target.value); if (date) selectDate(date) }} /></label>
        <button onClick={() => moveMonth(1)} disabled={monthKey === '2099-12'} aria-label="下个月">›</button>
      </div>
      <div className={styles.weekdays} aria-hidden="true">{['一', '二', '三', '四', '五', '六', '日'].map(day => <span key={day}>{day}</span>)}</div>
      <div className={styles.days}>
        {dayData.map(({ date, key, courses, status }) => {
          const outside = calendarMonthKey(date) !== monthKey
          const label = status.off ? '停课' : status.kind === 'makeup' ? '调课' : courses.length ? `${courses.length}节课` : ''
          return <button key={key} ref={element => { if (element) dateButtons.current.set(key, element); else dateButtons.current.delete(key) }}
            className={`${styles.day} ${outside ? styles.outside : ''}`} aria-pressed={key === selectedKey} aria-current={key === todayKey ? 'date' : undefined}
            tabIndex={key === selectedKey ? 0 : -1} aria-label={`${key} ${dayName(status.calendarDay)}${label ? `，${label}` : ''}`}
            onClick={() => selectDate(date)} onKeyDown={event => { const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key]; if (delta) { event.preventDefault(); selectDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta), true) } }}>
            <span>{date.getDate()}</span><small>{label || (key === todayKey ? '今天' : '　')}</small>
          </button>
        })}
      </div>
      <p className={styles.legend}>带课程标记的日期来自已同步课表；停课与调课来自你确认的规则。</p>
    </section>
    <section className={styles.agenda} aria-live="polite" aria-label="所选日期安排">
      <div className={styles.agendaHeading}><h2>{selected.getMonth() + 1}月{selected.getDate()}日 <small>{dayName(current.status.calendarDay)}</small></h2><b>{beforeTerm ? '学期开始前' : `第 ${week} 教学周`}</b></div>
      {current.status.kind !== 'normal' && <p className={styles.notice}>{current.status.label}</p>}
      {currentHint && <p className={styles.notice}>{currentHint.label} · 国家日期提示，课程仍以学校通知和你确认的规则为准。</p>}
      {snapshotHint ? <div className={styles.empty}><b>{snapshotHint.title}</b><p>{snapshotHint.detail}</p><Link to="/schedule">查看课表与同步 ›</Link></div>
        : current.courses.length ? <ul className={styles.courses}>{current.courses.map((course, index) => <li key={`${course.name}:${index}`}><span className={styles.period}>第 {course.sections.join('、')} 节</span><div><b>{course.name}</b><p>{[course.room, course.teacher].filter(Boolean).join(' · ') || '教室与教师未填写'}</p></div></li>)}</ul>
          : <div className={styles.empty}><b>{current.status.off ? '已按个人规则停课' : '这天没有已记录课程'}</b><p>考试、临时活动与未同步课程，请以学校通知为准。</p></div>}
      {courseChanges.length > 0 && <p className={styles.note}>这天已保存 {courseChanges.length} 项单次课程调整；{current.validated.status === 'ready' ? '课程列表已应用这些调整。' : '核对并同步课表后查看完整课程安排。'}</p>}
      <div className={styles.actions}><Link to="/schedule?calendar=1">管理假期与调课</Link><Link to="/study?tab=exams">查看考试安排 ›</Link></div>
    </section>
    <details className={styles.sources}><summary>校历来源与保存说明</summary><p>教学周按课表页设置的学期开始日期计算，默认日期需按学校当学期校历核对。个人调课按账号保存在当前设备，暂不跨设备同步。国家节假日不会自动停课。</p><a href="https://xxzx.jou.edu.cn/info/1001/2851.htm" target="_blank" rel="noopener noreferrer">学校信息化中心校历入口 ↗</a><p>该入口为学校历史发布页，请核对图片中的学年；哦狐尚未导入经核验的当学年校历图片。</p></details>
  </div>
}

export function AcademicCalendarPage() {
  useSyncExternalStore(subscribeQbank, getQbankRevision)
  const session = captureQbankSession()
  return <CalendarContent key={`${session.uid}:${session.revision}`} />
}
