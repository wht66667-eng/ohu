import { useEffect, useRef, useState, type ClipboardEvent } from 'react'
import { parseNotice, type NoticeCandidate } from '../lib/notice-parser'
import { createTodo } from '../lib/todo'
import { captureQbankSession, isQbankSessionCurrent } from '../lib/qbank'
import { saveNoticeBatch } from '../lib/notice-todo-batch'
import { openExternalUrl } from '../lib/campus-links'
import s from './NoticeTodoSheet.module.css'

export function safeTodoLink(note: string | null | undefined): string | null {
  if (typeof note !== 'string' || !note.startsWith('作业链接：')) return null
  const raw = note.slice(5).trim()
  try { const u = new URL(raw); return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password ? u.href : null } catch { return null }
}
type Row = { selected: boolean; title: string; date: string; time: string; link: string; alternatives: NoticeCandidate['dates']; links: string[]; warnings: string[]; dateNeedsReview: boolean; dateConfirmed: boolean; deadlineNeedsReview: boolean; noDeadlineConfirmed: boolean }
const NOTICE_LIMIT = 10000
const CHAOXING_URL = 'https://www.chaoxing.com/'
function parseTodoDraft(text: string): { rows: Row[]; warnings: string[] } {
  const result = parseNotice(text)
  return {
    warnings: result.warnings,
    rows: result.candidates.map(item => {
      const dateNeedsReview = item.warnings.some(warning => /未写年份|发现多个日期|星期未写明|已过，请检查年份或日期/.test(warning))
      const deadlineNeedsReview = item.warnings.some(warning => /未写具体时间|未写具体时刻/.test(warning))
      return { selected: false, title: item.title, date: item.dates[0]?.date || '', time: item.dates[0]?.time || '', link: item.links[0] || '', alternatives: item.dates, links: item.links, warnings: item.warnings, dateNeedsReview, dateConfirmed: !dateNeedsReview, deadlineNeedsReview, noDeadlineConfirmed: false }
    }),
  }
}

export function NoticeTodoSheet({ uid, onClose, onSaved, initialText = '', source = 'notice' }: {
  uid: string
  onClose: () => void
  onSaved: () => void
  initialText?: string
  source?: 'notice' | 'ai' | 'chaoxing'
}) {
  const isAiDraft = source === 'ai'
  const isChaoxingImport = source === 'chaoxing'
  const [text, setText] = useState(initialText)
  const [initialParse] = useState(() => isAiDraft && initialText.trim() ? parseTodoDraft(initialText) : null)
  const [rows, setRows] = useState<Row[] | null>(initialParse?.rows ?? null)
  const [warnings, setWarnings] = useState<string[]>(initialParse?.warnings ?? [])
  const [pasteHint, setPasteHint] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const lock = useRef(false)
  const dialog = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.querySelector<HTMLElement>('textarea')?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !lock.current) { event.preventDefault(); closeRef.current(); return }
      if (event.key !== 'Tab' || !dialog.current) return
      const focusable = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')].filter(node => node.getClientRects().length)
      if (!focusable.length) return
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus() }
  }, [])
  function parse() {
    const result = parseTodoDraft(text)
    setWarnings(result.warnings)
    setRows(result.rows)
    setError('')
  }
  function onNoticePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = event.clipboardData.getData('text/plain')
    if (!pasted) return
    const field = event.currentTarget
    const start = field.selectionStart ?? field.value.length
    const end = field.selectionEnd ?? field.value.length
    const nextLength = field.value.length - (end - start) + pasted.length
    if (nextLength <= NOTICE_LIMIT) return
    event.preventDefault()
    setPasteHint(`这次粘贴会超过 ${NOTICE_LIMIT} 字上限，整段内容未粘贴；请分段复制，避免通知被截断后误识别。`)
  }
  async function pasteNotice() {
    setPasteHint('')
    try {
      if (!navigator.clipboard?.readText) throw new Error('unsupported')
      const value = await navigator.clipboard.readText()
      if (!value.trim()) { setPasteHint('剪贴板没有文字；也可以点输入框后长按粘贴。'); return }
      if (value.length > NOTICE_LIMIT) {
        setPasteHint(`剪贴板内容超过 ${NOTICE_LIMIT} 字，未粘贴，避免截断后误识别；请先复制需要的部分。`)
        return
      }
      setText(value)
      setRows(null)
      setWarnings([])
      setError('')
      setUncertain(false)
      setPasteHint('通知已粘贴，请确认内容后点“识别并预览”。')
    } catch {
      setPasteHint('当前环境无法读取剪贴板；点输入框后长按并选择“粘贴”。')
    }
  }
  function change(index: number, patch: Partial<Row>) { setRows(prev => prev?.map((r, i) => i === index ? { ...r, ...patch } : r) || null) }
  async function save() {
    if (lock.current || !rows || uncertain) return
    const selected = rows.map((row, index) => ({ row, index })).filter(item => item.row.selected)
    if (!selected.length) { setError('请选择至少一项待办。'); return }
    for (const { row } of selected) {
      if (!row.title.trim()) { setError('请填写选中待办的标题。'); return }
      if (row.date && row.dateNeedsReview && !row.dateConfirmed) { setError('请先核对有歧义的截止日期，并勾选确认。'); return }
      if (row.deadlineNeedsReview && !row.date && !row.time && !row.noDeadlineConfirmed) { setError('通知里有截止时间表达；请填写完整日期和时间，或明确确认此待办不设置截止日期与提醒。'); return }
      if (row.date && !row.time || !row.date && row.time) { setError('请确认完整的截止日期和时间，或将两项都留空。'); return }
      if (row.date && !Number.isFinite(new Date(`${row.date}T${row.time}:00+08:00`).getTime())) { setError('截止时间无效，请重新选择。'); return }
      const normalizedLink = row.link ? safeTodoLink(`作业链接：${row.link}`) : null
      if (row.link && (!normalizedLink || normalizedLink.length > 195)) { setError('请填写有效的 HTTP 或 HTTPS 作业链接（规范化后最多 195 字符）。'); return }
    }
    const session = captureQbankSession()
    if (!uid || uid !== session.uid) { setError('账号状态已变化，请重新打开。'); return }
    lock.current = true; setBusy(true); setError('')
    const result = await saveNoticeBatch(selected.map(({ row, index }) => ({ index, title: row.title, date: row.date, time: row.time, link: row.link })), () => isQbankSessionCurrent(session), createTodo, index => change(index, { selected: false }))
    if (result.changed) {
      lock.current = false
      setBusy(false)
      return
    }
    if (result.error) { setUncertain(true); setError(`已保存 ${result.saved} 项。后续保存未确认：${result.error}。请关闭后检查待办列表，再决定是否重新添加。`) }
    lock.current = false; setBusy(false); onSaved()
    if (!result.error && result.saved === selected.length) onClose()
  }
  return <div className={s.backdrop}>
    <section ref={dialog} className={s.sheet} role="dialog" aria-modal="true" aria-labelledby="notice-title">
      <header><h2 id="notice-title">{isAiDraft ? '把 AI 建议整理成待办' : isChaoxingImport ? '导入学习通作业与提醒' : '粘贴通知生成待办'}</h2><button type="button" onClick={onClose} disabled={busy} aria-label="关闭">×</button></header>
      <p>{isAiDraft
        ? 'AI 结果只在本机预填并识别，不会再次发送给 AI。候选默认未勾选，请逐项核对并选择；确认后只保存标题、截止时间和作业链接。时间按北京时间填写。'
        : isChaoxingImport
          ? '先在学习通复制老师通知，再粘贴到下面。识别只在本机完成；你可以逐项修改标题、截止日期和作业链接，勾选后保存到哦狐待办。提醒沿用待办现有设置；原文不会保存。哦狐不会索取或保存学习通密码。'
          : '识别在本机完成；候选默认未勾选，请逐项核对并选择。确认后只保存标题、截止时间和作业链接，不保存通知原文。时间按北京时间填写。'}</p>
      {isChaoxingImport ? <button type="button" className={s.secondary} onClick={() => openExternalUrl(CHAOXING_URL)}>打开学习通 ↗</button> : null}
      <div className={s.noticeInput}>
        <div className={s.noticeHeader}><label htmlFor="notice-todo-text">{isAiDraft ? 'AI 建议（可编辑）' : isChaoxingImport ? '学习通老师通知' : '老师通知'}</label><button type="button" className={s.pasteButton} onClick={() => void pasteNotice()} disabled={busy || uncertain}>从剪贴板粘贴</button></div>
        <textarea id="notice-todo-text" value={text} onPaste={onNoticePaste} onChange={e => {
          if (e.target.value.length > NOTICE_LIMIT) {
            setPasteHint(`内容超过 ${NOTICE_LIMIT} 字上限，未接收本次输入；请分段处理，避免通知被截断后误识别。`)
            return
          }
          setText(e.target.value); setRows(null); setWarnings([]); setError(''); setUncertain(false); setPasteHint('')
        }} placeholder={isAiDraft ? '检查 AI 建议，也可以补充或删除内容' : isChaoxingImport ? '粘贴学习通中的作业、考试或课程提醒通知' : '粘贴通知内容'} rows={5} disabled={busy || uncertain} />
        <small className={s.inputMeta} aria-live="polite">{text.length}/{NOTICE_LIMIT}{pasteHint ? ` · ${pasteHint}` : ''}</small>
      </div>
      {text.length > NOTICE_LIMIT ? <p className={s.warning} role="status">AI 建议超过本机待办识别上限。请先删减到 {NOTICE_LIMIT} 字以内，再重新识别；当前内容不会自动截断或保存。</p> : null}
      <button type="button" className={s.secondary} onClick={parse} disabled={busy || uncertain || text.length > NOTICE_LIMIT}>{isAiDraft && initialParse ? '重新识别' : '识别并预览'}</button>
      {warnings.map((warning, i) => <p className={s.warning} key={i}>{warning}</p>)}
      {rows?.map((row, i) => <fieldset key={i} disabled={busy || uncertain}>
        <legend><label><input type="checkbox" checked={row.selected} onChange={e => change(i, { selected: e.target.checked })} /> 待办 {i + 1}</label></legend>
        <label>标题<input maxLength={60} value={row.title} onChange={e => change(i, { title: e.target.value })} /></label>
        {row.alternatives.length > 1 ? <label>选择识别到的日期<select value={row.alternatives.findIndex(d => d.date === row.date && d.time === row.time)} onChange={e => { const d = row.alternatives[Number(e.target.value)]; if (d) change(i, { date: d.date, time: d.time, dateConfirmed: true, noDeadlineConfirmed: false }) }}><option value={-1}>手动填写</option>{row.alternatives.map((d, j) => <option value={j} key={j}>{d.label} · {d.date} {d.time || '时间待确认'}</option>)}</select></label> : null}
        <div className={s.times}><label>截止日期<input type="date" value={row.date} onChange={e => change(i, { date: e.target.value, dateConfirmed: true, noDeadlineConfirmed: false })} /></label><label>截止时间<input type="time" value={row.time} onChange={e => change(i, { time: e.target.value, noDeadlineConfirmed: false })} /></label></div>
        {row.date && row.dateNeedsReview ? <label className={s.dateConfirm}><input type="checkbox" checked={row.dateConfirmed} onChange={e => change(i, { dateConfirmed: e.target.checked })} />我已核对这个截止日期</label> : null}
        {row.deadlineNeedsReview ? <label className={s.dateConfirm}><input type="checkbox" checked={row.noDeadlineConfirmed} onChange={e => change(i, e.target.checked ? { date: '', time: '', noDeadlineConfirmed: true } : { noDeadlineConfirmed: false })} />我确认此待办不设置截止日期和提醒</label> : null}
        {row.date && !row.time ? <p className={s.warning}>通知没有明确时间，请确认后填写；也可以清空日期，不设置截止时间。</p> : null}
        {row.links.length > 1 ? <label>选择识别到的链接<select value={row.links.indexOf(row.link)} onChange={e => { const link = row.links[Number(e.target.value)]; if (link) change(i, { link }) }}><option value={-1}>手动填写</option>{row.links.map((link, j) => <option value={j} key={link}>{link}</option>)}</select></label> : null}
        <label>作业链接（选填）<input type="url" value={row.link} onChange={e => change(i, { link: e.target.value })} placeholder="https://" /></label>
        {row.warnings.map((warning, j) => <p className={s.warning} key={j}>{warning}</p>)}
      </fieldset>)}
      {rows?.length && !rows.some(row => row.selected) ? <p role="status" className={s.warning}>请勾选至少一项要保存的待办。</p> : null}
      {error ? <p role="alert" className={s.warning}>{error}</p> : null}
      {rows?.length ? <button type="button" className={s.primary} onClick={() => void save()} disabled={busy || uncertain || !rows.some(row => row.selected)}>{busy ? '正在保存…' : '保存选中的待办'}</button> : null}
    </section>
  </div>
}
