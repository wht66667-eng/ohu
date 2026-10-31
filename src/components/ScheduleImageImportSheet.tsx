import { useEffect, useMemo, useRef, useState } from 'react'
import imageCompression from 'browser-image-compression'
import { DialogLayer } from './ui/DialogLayer'
import { useAuth } from '../lib/auth'
import { requestAgnes } from '../lib/agnes-ai'
import { captureQbankSession, isQbankSessionCurrent } from '../lib/qbank'
import { getScheduleTermStart, savePhotoScheduleCache } from '../lib/schedule-cache'
import type { TtRow } from '../lib/timetable'
import styles from './ScheduleImageImportSheet.module.css'

type Parsed = { rows: TtRow[]; notes: string[]; termStart: string }
const datePattern = /^\d{4}-\d{2}-\d{2}$/

function parseResult(answer: string, fallbackTerm: string): Parsed {
  const source = answer.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let value: unknown
  try { value = JSON.parse(source) } catch { throw new Error('AI 返回格式无法读取，请换一张更清晰的课表图片后重试。') }
  if (!value || typeof value !== 'object' || !Array.isArray((value as { courses?: unknown }).courses)) throw new Error('没有识别出可核对的课程，请检查图片是否包含完整课表。')
  const rawRows = (value as { courses: unknown[] }).courses
  if (!rawRows.length || rawRows.length > 300) throw new Error(rawRows.length ? '识别项目过多，请按学期或图片分开导入。' : '没有识别到课程，请上传包含完整课表的清晰图片。')
  const rows = rawRows.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`第 ${index + 1} 项课程格式有误，不能保存。`)
    const row = item as Record<string, unknown>
    const week = Number(row.week), day = Number(row.day)
    const sections = Array.isArray(row.sections) ? row.sections.map(Number) : []
    if (!Number.isInteger(week) || week < 1 || week > 30 || !Number.isInteger(day) || day < 1 || day > 7
      || !sections.length || sections.length > 11 || sections.some(section => !Number.isInteger(section) || section < 1 || section > 11)
      || typeof row.name !== 'string' || !row.name.trim() || row.name.trim().length > 80
      || (row.teacher !== undefined && typeof row.teacher !== 'string') || (row.room !== undefined && typeof row.room !== 'string')) {
      throw new Error(`第 ${index + 1} 项课程信息不完整或超出范围，请重新识别。`)
    }
    return { week, day, sections: [...new Set(sections)].sort((a, b) => a - b), name: row.name.trim(), teacher: String(row.teacher || '').slice(0, 80), room: String(row.room || '').slice(0, 100) }
  })
  const candidateTerm = (value as { termStart?: unknown }).termStart
  const termStart = typeof candidateTerm === 'string' && datePattern.test(candidateTerm) ? candidateTerm : fallbackTerm
  const notes = Array.isArray((value as { notes?: unknown }).notes)
    ? (value as { notes: unknown[] }).notes.filter((note): note is string => typeof note === 'string').slice(0, 12)
    : []
  return { rows, notes, termStart }
}

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败，请重新选择。'))
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('读取图片失败，请重新选择。'))
    reader.readAsDataURL(file)
  })
}

export function ScheduleImageImportSheet({ defaultSchool, onClose, onSaved }: { defaultSchool: string; onClose: () => void; onSaved: (rows: TtRow[], termStart: string) => void }) {
  const auth = useAuth()
  const session = useMemo(() => captureQbankSession(), [])
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [consent, setConsent] = useState(false)
  const [school, setSchool] = useState(defaultSchool || '江苏海洋大学')
  const [termStart, setTermStart] = useState(() => getScheduleTermStart(session.uid))
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [error, setError] = useState('')
  const [notes, setNotes] = useState<string[]>([])
  const controller = useRef<AbortController | null>(null)
  const lock = useRef(false)

  useEffect(() => () => {
    controller.current?.abort()
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  function chooseFile(next: File | undefined) {
    if (!next) return
    setError(''); setParsed(null); setConsent(false)
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(next.type)) { setError('请选择 JPG、PNG 或 WebP 图片；HEIC 图片请先转换后再上传。'); return }
    if (next.size > 15 * 1024 * 1024) { setError('图片不能超过 15 MB，请先裁剪后再上传。'); return }
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setFile(next); setPreviewUrl(URL.createObjectURL(next))
  }

  async function recognize() {
    if (lock.current || !file || !consent) return
    lock.current = true; setBusy(true); setError('')
    const request = new AbortController(); controller.current = request
    try {
      if (!(await auth.ensureSignedIn('使用 AI 识别课表需要先登录哦狐'))) return
      const compressed = await imageCompression(file, { maxSizeMB: 0.95, maxWidthOrHeight: 1800, useWebWorker: true, fileType: 'image/jpeg' })
      const imageDataUrl = await fileToDataUrl(compressed)
      const answer = await requestAgnes('schedule-image', `学校：${school.trim() || '未填写'}\n当前学期开始日期：${termStart}\n只识别图中课程，不确定的内容列为核对提醒。`, request.signal, imageDataUrl)
      if (!isQbankSessionCurrent(session)) throw new Error('账号状态已变化，请重新打开导入页面。')
      const result = parseResult(answer, termStart)
      setParsed(result); setNotes(result.notes)
      setTermStart(result.termStart)
      if (!result.rows.length) setError('图片中没有足够确定的课程，请重新拍摄或补充课表信息。')
    } catch (failure) {
      setError((failure as Error)?.message || '识别失败，请检查网络后重试。')
    } finally { controller.current = null; lock.current = false; setBusy(false) }
  }

  function editRow(index: number, patch: Partial<TtRow>) {
    setParsed(previous => previous ? { ...previous, rows: previous.rows.map((row, i) => i === index ? { ...row, ...patch } : row) } : previous)
  }
  function removeRow(index: number) {
    setParsed(previous => previous ? { ...previous, rows: previous.rows.filter((_, i) => i !== index) } : previous)
  }
  function save() {
    if (!parsed?.rows.length || !datePattern.test(termStart)) { setError('请核对学期开始日期和至少一门课程。'); return }
    if (parsed.rows.some(row => !row.name.trim() || !Number.isInteger(Number(row.week)) || Number(row.week) < 1 || Number(row.week) > 30
      || !Number.isInteger(Number(row.day)) || Number(row.day) < 1 || Number(row.day) > 7 || !row.sections.length
      || row.sections.some(section => !Number.isInteger(Number(section)) || Number(section) < 1 || Number(section) > 11))) {
      setError('课程名、周次、星期或节次有误，请先修正。'); return
    }
    if (!isQbankSessionCurrent(session)) { setError('账号状态已变化，请重新打开导入页面。'); return }
    if (!savePhotoScheduleCache(parsed.rows, termStart, session)) { setError('保存失败，原有课表已保留。请检查本机存储空间后重试。'); return }
    onSaved(parsed.rows, termStart)
  }

  return <DialogLayer title="拍照导入课表" onClose={() => { controller.current?.abort(); onClose() }} full>
    <div className={styles.sheet}>
      <header className={styles.header}><div><span>哦狐课表工具</span><h2>拍照上传，AI 帮你整理</h2></div><button className={styles.close} type="button" onClick={onClose} aria-label="关闭">×</button></header>
      <p className={styles.intro}>默认按江苏海洋大学课表识别；其他学校也可上传图片。AI 只整理重复课程，成绩和体测仍通过学校官方入口查询。</p>
      <label className={styles.field}>学校名称<input value={school} maxLength={60} onChange={event => setSchool(event.target.value)} placeholder="江苏海洋大学" /></label>
      <label className={styles.field}>本学期开始日期<input type="date" value={termStart} onChange={event => setTermStart(event.target.value)} /></label>
      <label className={styles.upload}>选择课表照片<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={event => chooseFile(event.target.files?.[0])} /><span>{file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : '拍照或从相册选择 · 最大 15 MB'}</span></label>
      {previewUrl ? <img className={styles.previewImage} src={previewUrl} alt="待识别课表预览" /> : null}
      <div className={styles.disclosure}><strong>发送前请确认</strong><p>图片可能包含姓名、学号和课程信息。勾选并开始识别后，压缩图片会发送到哦狐 AI 服务及 Agnes AI 模型服务商处理；识别完成后不保存图片。服务商的数据处理与保留以其政策为准。</p></div>
      <label className={styles.consent}><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} /><span>我已检查图片内容，并同意将这张课表图片发送给 AI 识别</span></label>
      <button className={styles.primary} type="button" disabled={!file || !consent || busy} onClick={() => void recognize()}>{busy ? '正在识别课表…' : '同意发送并开始识别'}</button>
      {busy ? <p className={styles.progress} role="status">正在识别，不会自动修改或覆盖课表。</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {parsed ? <section className={styles.results}>
        <h3>识别结果 <small>{parsed.rows.length} 项 · 请逐项核对</small></h3>
        {notes.length ? <ul className={styles.notes}>{notes.map((note, i) => <li key={`${i}-${note}`}>{note}</li>)}</ul> : null}
        <div className={styles.courseList}>{parsed.rows.map((row, index) => <article className={styles.course} key={`${index}-${row.name}`}>
          <div className={styles.courseHead}><strong>课程 {index + 1}</strong><button type="button" onClick={() => removeRow(index)}>移除</button></div>
          <label>课程名<input value={row.name} maxLength={80} onChange={event => editRow(index, { name: event.target.value })} /></label>
          <div className={styles.courseGrid}>
            <label>周次<input type="number" min="1" max="30" value={row.week} onChange={event => editRow(index, { week: Number(event.target.value) })} /></label>
            <label>星期<input type="number" min="1" max="7" value={row.day} onChange={event => editRow(index, { day: Number(event.target.value) })} /></label>
            <label>节次<input value={row.sections.join(',')} onChange={event => editRow(index, { sections: event.target.value.split(/[,，、\s]+/).filter(Boolean).map(Number) })} /></label>
          </div>
          <label>教师<input value={row.teacher} maxLength={80} onChange={event => editRow(index, { teacher: event.target.value })} /></label>
          <label>教室<input value={row.room} maxLength={100} onChange={event => editRow(index, { room: event.target.value })} /></label>
        </article>)}</div>
        <p className={styles.backup}>确认后会将识别课表设为当前课表；现有教务课表会在本机暂存，可随时恢复。图片与识别原文不会保存。</p>
        <div className={styles.actions}><button className={styles.cancel} type="button" onClick={onClose}>暂不保存</button><button className={styles.primary} type="button" onClick={save}>核对完成，设为当前课表</button></div>
      </section> : null}
    </div>
  </DialogLayer>
}
