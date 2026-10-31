import { useEffect, useRef, useState, type FormEvent } from 'react'
import { getExamReminderPreferences, saveExamReminderPreferences, type ExamReminderPreferences } from '../lib/exam-reminder-prefs'
import { rescheduleExamReminders } from '../lib/exam-utils'
import { captureQbankSession, isQbankSessionCurrent } from '../lib/qbank'
import { useQbankRevision } from '../lib/useQbankRevision'
import styles from './ExamReminderSettings.module.css'

/** A late save result stays with the account revision that started the operation. */
export function ExamReminderSettings() {
  const revision = useQbankRevision()
  const session = captureQbankSession()
  return <ExamReminderContent key={`${session.uid}:${revision}`} />
}

function ExamReminderContent() {
  const [draft, setDraft] = useState(getExamReminderPreferences)
  const [eveningTime, setEveningTime] = useState(() => getExamReminderPreferences().eveningTime)
  const [leadHours, setLeadHours] = useState(() => String(getExamReminderPreferences().leadHours))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({ time: '', hours: '' })
  const alive = useRef(true)
  const running = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  function toggle(key: 'enabled' | 'eveningEnabled' | 'leadEnabled' | 'startEnabled') {
    if (running.current) return
    setDraft((previous) => ({ ...previous, [key]: !previous[key] }))
    setMessage(''); setError(''); setFieldErrors({ time: '', hours: '' })
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (running.current) return
    const hours = Number(leadHours)
    const validTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(eveningTime)
    const validHours = !!leadHours.trim() && Number.isFinite(hours) && hours >= 0.25 && hours <= 24 && Math.abs(hours * 60 - Math.round(hours * 60)) <= 1e-7
    const nextErrors = {
      time: draft.enabled && draft.eveningEnabled && !validTime ? '请选择有效时间，例如 20:00。' : '',
      hours: draft.enabled && draft.leadEnabled && !validHours ? '请输入 0.25～24 小时，且对应整数分钟，例如 0.5 小时。' : '',
    }
    setFieldErrors(nextErrors)
    if (nextErrors.time || nextErrors.hours) { setMessage(''); setError(''); return }
    const owner = captureQbankSession()
    running.current = true
    setBusy(true); setMessage(''); setError('')
    let saved = false
    try {
      const previous = getExamReminderPreferences()
      // An inactive node keeps its last valid time, so an unfinished field cannot block turning reminders off.
      const next: ExamReminderPreferences = { ...draft, eveningTime: validTime ? eveningTime : previous.eveningTime, leadHours: validHours ? Math.round(hours * 60) / 60 : previous.leadHours }
      saveExamReminderPreferences(next)
      saved = true
      setDraft(next); setEveningTime(next.eveningTime); setLeadHours(String(next.leadHours))
      const result = await rescheduleExamReminders()
      if (!alive.current || !isQbankSessionCurrent(owner)) return
      if (/失败|未能|未授予|未允许|无法|渠道已关闭|清理未完成/.test(result.message)) {
        setError(`设置已保存，但考试提醒未能更新：${result.message}`)
      } else setMessage(`设置已保存。${result.message || '考试提醒计划已更新。'}`)
    } catch (cause) {
      if (alive.current && isQbankSessionCurrent(owner)) setError(`${saved ? '设置已保存，但考试提醒未能更新：' : '设置未保存：'}${(cause as Error).message || '请重试。'}`)
    } finally {
      running.current = false
      if (alive.current && isQbankSessionCurrent(owner)) setBusy(false)
    }
  }

  return <section className={styles.panel} aria-labelledby="exam-reminder-title" aria-busy={busy}>
    <h3 id="exam-reminder-title">考试提醒</h3>
    <p className={styles.intro}>三个时点可独立选择。调整后，点击下方保存一起生效。</p>
    <form onSubmit={save} noValidate>
      <button type="button" role="switch" aria-label="考试提醒" aria-checked={draft.enabled} className={styles.row} disabled={busy} onClick={() => toggle('enabled')}>
        <span><strong>考试提醒</strong><small>{draft.enabled ? '按下方选定的时点提醒，保存后生效' : '保存后停止考试通知与 App 内考试提醒'}</small></span><span className={styles.state}>{draft.enabled ? '开' : '关'}</span>
      </button>
      <fieldset className={styles.nodes} disabled={busy || !draft.enabled}>
        <legend className={styles.visuallyHidden}>考试提醒时点</legend>
        <button type="button" role="switch" aria-label="考试前一天晚间提醒" aria-checked={draft.eveningEnabled} className={styles.row} onClick={() => toggle('eveningEnabled')}>
          <span><strong>前一天晚间</strong><small>提前准备准考证、文具与出行安排</small></span><span className={styles.state}>{draft.eveningEnabled ? '开' : '关'}</span>
        </button>
        <div className={styles.field}>
          <label htmlFor="exam-reminder-evening">前一天提醒时间</label>
          <input id="exam-reminder-evening" type="time" value={eveningTime} disabled={!draft.eveningEnabled} aria-invalid={!!fieldErrors.time} aria-describedby="exam-reminder-evening-hint" onChange={(event) => { setEveningTime(event.target.value); setFieldErrors((previous) => ({ ...previous, time: '' })); setMessage(''); setError('') }} />
          <p id="exam-reminder-evening-hint" className={fieldErrors.time ? styles.error : styles.hint} role={fieldErrors.time ? 'alert' : undefined}>{fieldErrors.time || '在考试日期的前一个晚上提醒，例如 20:00。'}</p>
        </div>
        <button type="button" role="switch" aria-label="考前提前提醒" aria-checked={draft.leadEnabled} className={styles.row} onClick={() => toggle('leadEnabled')}>
          <span><strong>考前提前</strong><small>留出到达考场与核对座位的时间</small></span><span className={styles.state}>{draft.leadEnabled ? '开' : '关'}</span>
        </button>
        <div className={styles.field}>
          <label htmlFor="exam-reminder-hours">考前提前时间</label>
          <div className={styles.hoursInput}><input id="exam-reminder-hours" type="number" inputMode="decimal" min={0.25} max={24} step="any" value={leadHours} disabled={!draft.leadEnabled} aria-invalid={!!fieldErrors.hours} aria-describedby="exam-reminder-hours-hint" onChange={(event) => { setLeadHours(event.target.value); setFieldErrors((previous) => ({ ...previous, hours: '' })); setMessage(''); setError('') }} /><span>小时</span></div>
          <p id="exam-reminder-hours-hint" className={fieldErrors.hours ? styles.error : styles.hint} role={fieldErrors.hours ? 'alert' : undefined}>{fieldErrors.hours || '支持 0.25～24 小时，需对应整数分钟。0.5 小时＝30 分钟。'}</p>
          <div className={styles.presets} aria-label="常用考试提前时间">{[0.25, 0.5, 1, 2, 3, 6].map((value) => <button key={value} type="button" aria-pressed={leadHours === String(value)} disabled={!draft.leadEnabled} onClick={() => { setLeadHours(String(value)); setFieldErrors((previous) => ({ ...previous, hours: '' })); setMessage(''); setError('') }}>{value} 小时</button>)}</div>
        </div>
        <button type="button" role="switch" aria-label="开考时提醒" aria-checked={draft.startEnabled} className={styles.row} onClick={() => toggle('startEnabled')}>
          <span><strong>开考时</strong><small>考试开始时再提醒一次</small></span><span className={styles.state}>{draft.startEnabled ? '开' : '关'}</span>
        </button>
      </fieldset>
      {draft.enabled && !draft.eveningEnabled && !draft.leadEnabled && !draft.startEnabled ? <p className={styles.hint} role="status">三个时点均已关闭，保存后不会安排考试提醒。</p> : null}
      <button type="submit" className={styles.save} disabled={busy}>{busy ? '正在更新考试提醒…' : '保存考试提醒'}</button>
    </form>
    <p className={styles.hint}>仅为已同步且有明确考试时间的安排提醒。关闭的时点保留上次有效时间；声音与通知显示以系统设置为准。</p>
    {busy ? <p className={styles.hint} role="status">正在保存设置并更新考试提醒计划…</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : message ? <p className={styles.feedback} role="status">{message}</p> : null}
  </section>
}
