import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { captureQbankSession, isQbankSessionCurrent } from '../../lib/qbank'
import { ConfirmSheet } from '../../components/ConfirmSheet'
import { createQuestionsFromImport } from '../../services/qbank/import'
import type { GenType, TransDir } from '../../services/qbank/generate'
import {
  generatePaidFile, loadFileGenerationConfig, loadFileGenerationCredits, prepareFileGeneration,
  FileGenerationError, readPendingFileGeneration, rememberFileGeneration, forgetFileGeneration, recoverFileGeneration,
  type FileGenerationConfig, type FileGenerationRequest, type FileQuestion, type PendingFileGeneration,
} from '../../services/qbank/paid-file'
import styles from './english.module.css'

const labels: Record<GenType, string> = { mix: '单选与判断', single: '单选', judge: '判断', trans: '中英互译选择题' }

export function PaidFileGenerator({ subject, type, dir, onSaved }: { subject: string; type: GenType; dir: TransDir; onSaved: (count: number) => void }) {
  const auth = useAuth()
  const picker = useRef<HTMLInputElement>(null)
  const controller = useRef<AbortController | null>(null)
  const active = useRef(true)
  const [config, setConfig] = useState<FileGenerationConfig | null>(null)
  const [credits, setCredits] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [input, setInput] = useState<FileGenerationRequest | null>(null)
  const [questions, setQuestions] = useState<FileQuestion[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [saved, setSaved] = useState('')
  const [pending, setPending] = useState<PendingFileGeneration | null>(null)
  const [needsOriginalFile, setNeedsOriginalFile] = useState(false)
  const uid = auth.isSigned ? auth.user?.uid || '' : ''

  const terminal = (reason: unknown) => reason instanceof FileGenerationError && ['JOB_FAILED', 'JOB_EXPIRED', 'GENERATION_FAILED', 'INVALID_MODEL_RESULT', 'PARSE_FAILED', 'NO_TEXT', 'BAD_REQUEST', 'UNSUPPORTED_FORMAT', 'FILE_TOO_LARGE', 'TEXT_TOO_LONG', 'PENDING_STORAGE'].includes(reason.code)

  useEffect(() => {
    active.current = true
    const ctrl = new AbortController()
    setLoading(true)
    setConfig(null)
    setCredits(null)
    setError('')
    void (async () => {
      if (uid) {
        const previous = readPendingFileGeneration(uid)
        if (previous) {
          setPending(previous)
          setInput({ ...previous, base64: '' })
          try {
            const result = await recoverFileGeneration(previous, ctrl.signal)
            if (!ctrl.signal.aborted && result.status === 'succeeded') { setQuestions(result.questions); setInput({ ...previous, subject: result.subject, base64: '' }) }
          } catch (reason) {
            if (!ctrl.signal.aborted) {
              if (reason instanceof FileGenerationError && reason.code === 'JOB_NOT_FOUND') setNeedsOriginalFile(true)
              if (terminal(reason)) { forgetFileGeneration(uid); setPending(null); setInput(null) }
              setError(reason instanceof Error ? reason.message : '任务待确认，请重新查询')
            }
          }
        }
      }
      const next = await loadFileGenerationConfig(ctrl.signal)
      if (ctrl.signal.aborted) return
      setConfig(next)
      if (auth.isSigned && next.enabled) {
        const available = await loadFileGenerationCredits(ctrl.signal)
        if (!ctrl.signal.aborted) setCredits(available)
      }
    })().catch(reason => { if (!ctrl.signal.aborted) setError(reason instanceof Error ? reason.message : '服务暂时无法连接') })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false) })
    return () => { active.current = false; ctrl.abort(); controller.current?.abort() }
  }, [uid, refresh])

  async function start() {
    if (busy || !config || !file || !config.enabled || (!credits && !input)) return
    const session = captureQbankSession()
    setBusy(true)
    setError('')
    setSaved('')
    const ctrl = new AbortController()
    controller.current = ctrl
    try {
      const prepared = input?.base64 ? input : {
        ...await prepareFileGeneration(file, config, { subject: input?.subject || subject, type: input?.type || type, dir: input?.dir || dir }),
        ...(input ? { requestId: input.requestId } : {}),
      }
      if (!active.current || !isQbankSessionCurrent(session)) return
      rememberFileGeneration(uid, prepared, config.questionsPerJob)
      setPending({ ...prepared, questionsPerJob: config.questionsPerJob })
      setInput(prepared)
      const result = await generatePaidFile(prepared, config.questionsPerJob, ctrl.signal)
      if (!active.current || !isQbankSessionCurrent(session)) return
      setQuestions(result.questions)
      setConfirm(false)
      setCredits(await loadFileGenerationCredits(ctrl.signal).catch(() => null))
    } catch (reason) {
      if (active.current && isQbankSessionCurrent(session)) {
        if (reason instanceof FileGenerationError && reason.code === 'JOB_NOT_FOUND') setNeedsOriginalFile(true)
        if (terminal(reason)) { forgetFileGeneration(uid); setPending(null); setInput(null) }
        setError(reason instanceof Error ? reason.message : '结果尚未确认，请重试同一任务'); setConfirm(false)
      }
    } finally {
      if (active.current && isQbankSessionCurrent(session)) setBusy(false)
    }
  }

  async function queryPending() {
    if (!pending || busy) return
    const session = captureQbankSession()
    setBusy(true)
    setError('')
    const ctrl = new AbortController()
    controller.current = ctrl
    try {
      const result = await recoverFileGeneration(pending, ctrl.signal)
      if (!active.current || !isQbankSessionCurrent(session)) return
      if (result.status === 'succeeded') { setQuestions(result.questions); setInput({ ...pending, subject: result.subject, base64: '' }) }
      else setError('本次任务仍在生成，请稍后查询；不会新增扣费。')
    } catch (reason) {
      if (active.current && isQbankSessionCurrent(session)) {
        if (reason instanceof FileGenerationError && reason.code === 'JOB_NOT_FOUND') setNeedsOriginalFile(true)
        if (terminal(reason)) { forgetFileGeneration(uid); setPending(null); setInput(null) }
        setError(reason instanceof Error ? reason.message : '结果暂时无法读取，请重试查询')
      }
    } finally { if (active.current && isQbankSessionCurrent(session)) setBusy(false) }
  }

  async function save() {
    if (!questions || !input || busy) return
    const session = captureQbankSession()
    setBusy(true)
    setError('')
    try {
      const result = await createQuestionsFromImport(questions.map(q => ({ ...q, subject: input.subject, sourceType: 'doc' })), 'doc')
      if (!active.current || !isQbankSessionCurrent(session)) return
      setSaved(`已加入原题库 ${result.created} 题${result.dup ? `，${result.dup} 题已存在` : ''}。练习和组卷继续免费。`)
      setQuestions(null)
      forgetFileGeneration(uid)
      setPending(null)
      setNeedsOriginalFile(false)
      setInput(null)
      setFile(null)
      onSaved(result.created)
    } catch (reason) {
      if (active.current && isQbankSessionCurrent(session)) setError(reason instanceof Error ? reason.message : '本机保存失败，题目仍在此处，重试保存不扣次数')
    } finally { if (active.current && isQbankSessionCurrent(session)) setBusy(false) }
  }

  const ready = !loading && !!config?.enabled && auth.isSigned && (!!input || (credits !== null && credits > 0))
  return <section className={styles.card} aria-labelledby="paid-file-title">
    <div className={styles.paidHeading}><h3 id="paid-file-title" className={styles.cardTitle}>文件自动出题</h3><span className={styles.tagFox}>按次付费</span></div>
    <p className={styles.paidHint}>选择自己的课件或笔记，生成后加入原题库。背单词、阿狐助记和普通练习免费。</p>
    {loading ? <p role="status" className={styles.paidHint}>正在读取出题服务…</p> : config ? <>
      <p className={styles.paidPrice}>{config.priceCent > 0 ? `¥${(config.priceCent / 100).toFixed(2)} / 次 · 每次 ${config.questionsPerJob} 题` : '价格与购买方式尚未配置'}{config.enabled && credits !== null ? ` · 剩余 ${credits} 次` : ''}</p>
      {!config.enabled ? <p className={styles.paidHint}>购买开放后即可使用，当前不会扣费。</p> : !auth.isSigned ? <button type="button" className={styles.btnGhost} onClick={() => auth.openLogin('登录后查看文件出题次数')}>登录查看次数</button> : credits === 0 ? <p className={styles.paidHint}>{config.canPurchase ? '暂无出题次数，请先购买。' : '暂无出题次数，购买暂未开放。当前不会扣费。'}</p> : null}
    </> : null}
    {error ? <div role="alert"><p className={styles.paidError}>{error}</p>{!input && !questions ? <button type="button" className={styles.btnGhost} disabled={busy} onClick={() => setRefresh(n => n + 1)}>重新连接</button> : null}</div> : null}
    <div className={styles.paidActions}>
      <button type="button" className={styles.btnGhost} disabled={!ready || busy || !!questions || (!!input && !needsOriginalFile)} onClick={() => picker.current?.click()}>{needsOriginalFile ? '重新选择原文件' : file ? '重新选文件' : '选择文件'}</button>
      <input ref={picker} type="file" accept=".txt,.docx,.pdf" hidden onChange={e => {
        const chosen = e.target.files?.[0]
        if (chosen && config) {
          if (!chosen.size || chosen.size > config.maxBytes) setError('文件需在 2 MB 以内，请先精简资料')
          else if (needsOriginalFile && pending && chosen.name !== pending.fileName) setError(`请重新选择原文件：${pending.fileName}`)
          else {
            setFile(chosen)
            if (!needsOriginalFile) { setInput(null); setPending(null) }
            setNeedsOriginalFile(false); setQuestions(null); setError(''); setSaved('')
          }
        }
        e.target.value = ''
      }} />
      {file && !questions ? <button type="button" className={styles.btnMain} disabled={!ready || busy} onClick={() => setConfirm(true)}>{busy ? '正在生成…' : input ? '重试本次任务' : '确认出题'}</button> : null}
      {pending && !questions ? <button type="button" className={styles.btnGhost} disabled={busy} onClick={() => void queryPending()}>查询本次任务</button> : null}
      {questions ? <button type="button" className={styles.btnMain} disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : `加入原题库 ${questions.length} 题`}</button> : null}
    </div>
    {pending && !file ? <p className={styles.paidHint}>待确认任务：{pending.fileName}。查询结果不会再次消耗次数。</p> : null}
    {file ? <p className={styles.paidHint}>{file.name} · {(file.size / 1024).toFixed(0)} KB · {labels[input?.type || type]}{input ? ' · 重试沿用本次任务，不重复扣次数' : ''}</p> : null}
    <p className={styles.paidHint}>支持 TXT、DOCX、文字版 PDF，最多 2 MB / 12,000 字。扫描件请先转成文字。解析或生成失败返还次数；网络中断后重试同一任务。</p>
    {saved ? <p role="status" className={styles.paidHint}>{saved}</p> : null}
    {questions ? <details className={styles.help}><summary className={styles.helpSummary}>预览 {questions.length} 题</summary><ol className={styles.paidPreview}>{questions.map(q => <li key={q.contentHash}>{q.stem}<p>{q.explanation}</p></li>)}</ol></details> : null}
    {confirm && config ? <ConfirmSheet title={input ? '继续本次文件出题？' : '确认使用 1 次出题？'} desc={`${file?.name}，${config.questionsPerJob} 题。${input ? '使用原任务编号重试，已成功的任务直接返回结果。' : '仅生成成功消耗 1 次。资料将发送到出题服务和 AI 模型处理。'}`} confirmText={input ? '重试本次任务' : '使用 1 次并生成'} busy={busy} onConfirm={() => void start()} onClose={() => setConfirm(false)} /> : null}
  </section>
}
