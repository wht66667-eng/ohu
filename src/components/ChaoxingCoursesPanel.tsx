import { useState } from 'react'
import { Link } from 'react-router-dom'
import { parseChaoxingCourses, type ChaoxingCourse } from '../lib/chaoxing-parse'
import { clearChaoxingCourses, readChaoxingCourses, saveChaoxingCourses } from '../lib/chaoxing-store'
import { captureQbankSession } from '../lib/qbank'
import { useQbankRevision } from '../lib/useQbankRevision'
import s from './chaoxing-sync-panel.module.css'

function stampText(stamp: number): string {
  if (!stamp) return '时间未知'
  const date = new Date(stamp)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '时间未知'
}

/**
 * 学习通课程清单：课程页文字 → 本机缓存。
 *
 * 与 `ChaoxingSyncPanel` 的云端只读同步是两条独立通道：云端同步不覆盖这里，
 * 这里也不代表学习通登录态——只保存课程名与页面上的详情文字。
 */
export function ChaoxingCoursesPanel() {
  useQbankRevision()
  const session = captureQbankSession()
  return <CoursesPanel key={`${session.uid}:${session.revision}`} />
}

function CoursesPanel() {
  const [snapshot, setSnapshot] = useState(() => readChaoxingCourses())
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<ChaoxingCourse[] | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'ended'>('all')
  const courses = snapshot?.courses ?? []
  const activeCount = courses.filter((course) => !course.detail.includes('已结束')).length
  const endedCount = courses.length - activeCount
  const teacherCount = new Set(courses.map((course) => course.detail.split(' · ')[0]).filter(Boolean)).size
  const filtered = courses.filter((course) => {
    if (status === 'active' && course.detail.includes('已结束')) return false
    if (status === 'ended' && !course.detail.includes('已结束')) return false
    const keyword = query.trim().toLowerCase()
    return !keyword || `${course.title} ${course.detail}`.toLowerCase().includes(keyword)
  })

  function analyze() {
    setError(''); setMessage(''); setPending(null)
    if (!draft.trim()) { setError('先把学习通「课程」页的文字粘贴进来。'); return }
    const courses = parseChaoxingCourses(draft)
    if (!courses.length) { setError('没有识别到课程。请确认复制的是课程列表页，而不是某一门课的详情页。'); return }
    setPending(courses)
    setMessage(`已识别 ${courses.length} 门课程，核对后保存。`)
  }

  function save() {
    if (!pending) return
    setError(''); setMessage('')
    try {
      const saved = saveChaoxingCourses(pending)
      setSnapshot(saved)
      setPending(null); setDraft('')
      setMessage(`已缓存 ${saved.courses.length} 门课程；下次打开可直接查看。`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '保存失败，请重试。')
    }
  }

  function clear() {
    if (!confirmClear) { setConfirmClear(true); setMessage('再点一次「确认清除」会删除本机课程缓存。'); return }
    const ok = clearChaoxingCourses()
    setConfirmClear(false)
    if (!ok) { setError('清除失败，请稍后重试。'); return }
    setSnapshot(null); setPending(null)
    setMessage('本机课程缓存已清除；上方云端同步记录不受影响。')
  }

  return <section className={s.panel}>
    <h3>我的学习通课程</h3>
    <p>课程只保存在本机。</p>
    {snapshot?.courses.length ? <div className={s.records}>
      <div className={s.recordHead}>
        <b>本学期 {courses.length} 门 · 进行中 {activeCount}</b>
        <button type="button" onClick={clear}>{confirmClear ? '确认清除' : '清除课程缓存'}</button>
      </div>
      <small>更新于 {stampText(snapshot.syncedAt)} · 来源：统一认证 SSO / 页面文字</small>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索课程或老师" aria-label="搜索课程" style={{ flex: '1 1 140px', minHeight: 34, borderRadius: 10, border: '1px solid rgba(0,0,0,.12)', padding: '0 10px' }} />
        {([['all', '全部'], ['active', '进行中'], ['ended', '已结束']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setStatus(value)} aria-pressed={status === value} style={{ minHeight: 34, borderRadius: 10, padding: '0 12px', opacity: status === value ? 1 : 0.55 }}>{label}</button>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, margin: '8px 0' }}>
        <div style={{ padding: 8, borderRadius: 12, background: 'rgba(31,143,95,.08)' }}><b style={{ fontSize: 20 }}>{courses.length}</b><small style={{ display: 'block' }}>去重课程</small></div>
        <div style={{ padding: 8, borderRadius: 12, background: 'rgba(31,143,95,.08)' }}><b style={{ fontSize: 20 }}>{activeCount}</b><small style={{ display: 'block' }}>进行中</small></div>
        <div style={{ padding: 8, borderRadius: 12, background: 'rgba(31,143,95,.08)' }}><b style={{ fontSize: 20 }}>{teacherCount}</b><small style={{ display: 'block' }}>教师</small></div>
      </div>
      <small>已结束 {endedCount} 门 · 同课不同班按 classid 保留</small>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, margin: '6px 0' }}>
        <thead><tr style={{ textAlign: 'left', opacity: 0.65 }}><th style={{ padding: '4px 2px' }}>课程</th><th>教师</th><th>班级ID</th><th>状态</th></tr></thead>
        <tbody>{filtered.map((course) => {
          const ended = course.detail.includes('已结束')
          const teacher = course.detail.split(' · ')[0] || '—'
          return <tr key={`${course.classId ?? course.title}|${course.title}`} style={{ borderTop: '1px solid rgba(0,0,0,.06)' }}>
            <td style={{ padding: '6px 2px' }}>{course.title}</td>
            <td>{teacher}</td>
            <td>{course.classId || '—'}</td>
            <td>{ended ? '已结束' : '进行中'}</td>
          </tr>
        })}</tbody>
      </table>
      {!filtered.length ? <p role="status">没有匹配的课程，换个关键词或筛选。</p> : null}
      <Link to="/study/oneclick" className={s.recordHead} style={{ marginTop: 8 }}>用统一认证更新课程 ›</Link>
    </div> : <p>还没有课程。</p>}
    <label>粘贴课程页文字
      <textarea value={draft} onChange={(event) => { setDraft(event.target.value); setError(''); setMessage('') }} rows={5} maxLength={20000} placeholder={'高等数学A(1)\n张老师 · 已学 32/64 课时\n\n大学英语(3)\n李老师 · 进行中'} />
    </label>
    <div className={s.recordHead}>
      <button type="button" onClick={analyze} disabled={!draft.trim()}>识别课程</button>
      <button type="button" onClick={save} disabled={!pending}>保存课程清单</button>
    </div>
    {pending ? <div className={s.preview}>
      <b>识别结果 · {pending.length} 门</b>
      {pending.slice(0, 12).map((course) => <span key={course.title}>{course.title}</span>)}
      {pending.length > 12 ? <span>…另有 {pending.length - 12} 门</span> : null}
    </div> : null}
    {message ? <p role="status">{message}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <small>识别只在本机进行；不保存账号、密码、cookie 或页面原文。课程清单与教务课表分别保存，上课时间仍以教务课表为准。</small>
  </section>
}
