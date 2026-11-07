import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import { captureQbankSession } from '../lib/qbank'
import { useQbankRevision } from '../lib/useQbankRevision'
import { clearLearningSnapshot, learningSyncAvailable, readLearningSnapshot, syncLearning, type LearningHomework } from '../lib/learning-sync'
import { runChaoxingCookieSync } from '../lib/one-click'
import { readChaoxingCourses } from '../lib/chaoxing-store'
import { filterCurrentSemester } from '../lib/chaoxing-parse'
import { NoticeTodoSheet } from './NoticeTodoSheet'
import s from './chaoxing-sync-panel.module.css'

function Panel() {
  const auth = useAuth()
  const [snapshot, setSnapshot] = useState(readLearningSnapshot)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [course, setCourse] = useState('')
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const [draft, setDraft] = useState('')
  const [cookieText, setCookieText] = useState('')
  const [cookieBusy, setCookieBusy] = useState(false)
  const [cookieMessage, setCookieMessage] = useState('')
  const [cookieOpen, setCookieOpen] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void learningSyncAvailable(controller.signal).then(setAvailable).catch(() => { if (!controller.signal.aborted) setAvailable(false) })
    return () => { controller.abort(); request.current?.abort() }
  }, [])
  async function sync(event: React.FormEvent) {
    event.preventDefault()
    if (busy || !consent || !available) return
    const controller = new AbortController(); request.current = controller
    setBusy(true); setMessage('')
    try {
      const currentTitles = new Set(filterCurrentSemester(readChaoxingCourses()?.courses ?? []).map((item) => item.title))
      const currentKeys = (snapshot?.courses || []).filter((item) => currentTitles.has(item.name)).map((item) => item.key)
      const result = await syncLearning(username, password, course, controller.signal, currentKeys)
      if (!controller.signal.aborted) { setSnapshot(result); setMessage(`课程已保存；本次读取 ${result.coveredCourseKeys.length} 门课程的作业${result.remainingCourseKeys.length ? `，另有 ${result.remainingCourseKeys.length} 门未成功读取，旧记录已保留，可分课程重试` : ''}。`) }
    } catch (error) { if (!controller.signal.aborted) { setMessage(error instanceof Error ? error.message : '同步未完成，原记录已保留。'); setCookieOpen(true) } }
    finally { if (!controller.signal.aborted) { setPassword(''); setConsent(false); setBusy(false) } }
  }
  async function importCookie() {
    if (cookieBusy) return
    if (!cookieText.trim()) { setCookieMessage('先把浏览器里的 Cookie 粘贴进来。'); return }
    setCookieBusy(true)
    setCookieMessage('')
    try {
      const result = await runChaoxingCookieSync({ cookie: cookieText })
      setCookieMessage(result.ok ? `已读取 ${result.count ?? 0} 门课程` : (result.message || '读取失败'))
    } catch (error) {
      setCookieMessage(error instanceof Error ? error.message : '读取失败')
    } finally {
      setCookieBusy(false)
    }
  }
  function todo(item: LearningHomework) {    const name = snapshot?.courses.find(c => c.key === item.courseKey)?.name || '学习通'
    setDraft(`${name}：${item.title}${item.dueAt ? `\n截止时间：${item.dueAt.slice(0, 10)} ${item.dueAt.slice(11, 16)}` : item.deadlineText ? `\n截止时间（请核对年份）：${item.deadlineText}` : '\n截止时间未提供，请核对'}`)
  }
  return <section className={s.panel}>
    <h3>同步我的课程与作业</h3>
    <p>用你本人的学习通账号发起只读查询，成功后自动保存在本机当前哦狐账号。作业转提醒前仍需核对。</p>
    {available === null ? <p role="status">正在检查同步服务…</p> : available === false ? <p role="status">暂时无法连接同步服务，请稍后重试；也可以展开下方「用 Cookie 导入」读取课程。</p> : <p role="status">服务端只读代理已启用：可用学习通账号密码同步，或展开下方用 Cookie 导入。</p>}
    {!auth.isSigned ? <button type="button" onClick={() => auth.openLogin('登录后同步学习通课程与作业')}>登录哦狐</button> : available ? <form onSubmit={event => void sync(event)}>
      <label>学习通账号<input value={username} maxLength={80} autoComplete="off" onChange={e => setUsername(e.target.value)} required disabled={busy} /></label>
      <label>学习通密码<input type="password" value={password} maxLength={256} autoComplete="off" onChange={e => setPassword(e.target.value)} required disabled={busy} /></label>
      <label>同步范围<select value={course} onChange={e => setCourse(e.target.value)} disabled={busy}><option value="">全部课程（较多时分批）</option>{snapshot?.courses.map(c => <option value={c.key} key={c.key}>{c.name}</option>)}</select></label>
      <label className={s.consent}><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy} />我同意本次将学习通账号密码发送给哦狐查询代理，并由代理登录学习通读取我的课程、作业。密码和登录会话不落盘，请求结束即销毁。</label>
      <button type="submit" disabled={busy || !consent}>{busy ? '正在读取…' : '只读同步并保存'}</button>
    </form> : null}
    {message ? <p role="status">{message}</p> : null}
    <details open={cookieOpen} onToggle={(event) => setCookieOpen(event.currentTarget.open)} style={{ marginTop: 12 }}>
      <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-2)' }}>密码登录被风控？用 Cookie 导入</summary>
      <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>浏览器登录 chaoxing.com 后，F12 → Network → 任意请求 → 复制 Cookie（含 uid/_uid/fid/vc3），粘贴到这里。Cookie 只在本机使用。</p>
      <textarea value={cookieText} onChange={(event) => setCookieText(event.target.value)} rows={3} placeholder="uid=...; _uid=...; fid=...; vc3=..." style={{ width: '100%', fontSize: 12, borderRadius: 10, padding: 8 }} />
      <button type="button" disabled={cookieBusy} onClick={() => void importCookie()}>{cookieBusy ? '正在读取…' : '用 Cookie 读取课程'}</button>
      {cookieMessage ? <p role="status" style={{ fontSize: 12 }}>{cookieMessage}</p> : null}
    </details>
    {snapshot ? <div className={s.records}>
      <div className={s.recordHead}><b>已保存 {snapshot.courses.length} 门课程</b><button type="button" disabled={busy} onClick={() => { try { clearLearningSnapshot(); setSnapshot(null); setCourse('') } catch { setMessage('本机存储暂时无法访问，请稍后再试。') } }}>清除本机记录</button></div>
      <small>更新于 {new Date(snapshot.queriedAt).toLocaleString('zh-CN')} · 作业日期未知时不会自动设置提醒</small>
      <div className={s.courses}>{snapshot.courses.map(c => <span key={c.key}>{c.name}{c.teacher ? ` · ${c.teacher}` : ''}</span>)}</div>
      {snapshot.homework.length ? snapshot.homework.map(item => <article key={item.key}><b>{item.title}</b><small>{snapshot.courses.find(c => c.key === item.courseKey)?.name} · {item.status}</small><small>{item.dueAt ? `截止 ${item.dueAt.slice(0, 16).replace('T', ' ')}` : item.deadlineText ? `截止 ${item.deadlineText}（年份待核对）` : '截止时间待核对'}</small><button type="button" onClick={() => todo(item)}>核对并转待办</button></article>) : <p>当前没有已成功读取的作业记录；未成功读取的课程不会被当作“没有作业”。</p>}
    </div> : null}
    <small>此功能参考开源项目的只读协议，属于非官方适配；遇到验证码或登录验证时请先在学习通处理。</small>
    {draft && auth.user?.uid ? <NoticeTodoSheet uid={auth.user.uid} initialText={draft} source="chaoxing" onClose={() => setDraft('')} onSaved={() => { setDraft(''); setMessage('已按确认内容保存到待办。') }} /> : null}
  </section>
}
export function ChaoxingSyncPanel() {
  useQbankRevision()
  const session = captureQbankSession()
  return <Panel key={`${session.uid}:${session.revision}`} />
}
