import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { captureQbankSession, isQbankSessionCurrent } from '../../lib/qbank'
import { importCoachTasksLocally, reconcileCoachLocalImports } from '../../lib/todo'
import { listImportRecords, type ImportOutcome, type TodoImportRecord } from '../../lib/todo-import'
import {
  COACH_ERRORS,
  MAX_TASK_MINUTES,
  MIN_TASK_MINUTES,
  parseContractText,
  validateContract,
  type CoachErrorKind,
  type CoachIssue,
  type CoachTask,
  type TaskContract,
} from '../../services/coach/contract'
import { planView, relationsView, reviewView, todayView } from '../../services/coach/views'
import { addDays, buildSampleContract } from '../../services/coach/sample'
import { generateContract } from '../../services/coach/ai'
import s from './CoachPreview.module.css'

type InnerView = 'today' | 'plan' | 'relations' | 'review'
type LoadError = { kind: Exclude<CoachErrorKind, 'validation'>; message: string; issues: CoachIssue[] }

const VIEWS: [InnerView, string][] = [['today', '今日'], ['plan', '计划'], ['relations', '关系'], ['review', '复盘']]

function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function minutesLabel(n: number): string {
  return n >= 60 ? `${Math.floor(n / 60)} 小时${n % 60 ? ` ${n % 60} 分` : ''}` : `${n} 分钟`
}

export function CoachPreview() {
  useAuth()
  const session = captureQbankSession()
  return <CoachPreviewSession key={`${session.uid}:${session.revision}`} />
}

function CoachPreviewSession() {
  const auth = useAuth()
  const [session] = useState(captureQbankSession)
  const uid = useId()
  const [todayKey] = useState(localToday)
  const [draft, setDraft] = useState<TaskContract | null>(() => buildSampleContract(todayKey))
  const [source, setSource] = useState<'sample' | 'paste' | 'ai'>('sample')
  const [loadError, setLoadError] = useState<LoadError | null>(null)
  const [view, setView] = useState<InnerView>('today')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const seqRef = useRef(0)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const [pendingRecords, setPendingRecords] = useState<TodoImportRecord[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [importError, setImportError] = useState('')
  useEffect(() => () => { abortRef.current?.abort() }, [])

  const validation = useMemo(() => (draft ? validateContract(draft) : null), [draft])
  const validationIssues = validation && !validation.ok ? validation.issues : []
  const toWrite = useMemo(() => (draft ? draft.tasks.filter(t => !t.done) : []), [draft])
  const today = useMemo(() => (draft ? todayView(draft, todayKey) : null), [draft, todayKey])
  const plan = useMemo(() => (draft ? planView(draft) : null), [draft])
  const relations = useMemo(() => (draft ? relationsView(draft) : null), [draft])
  const review = useMemo(() => (draft ? reviewView(draft) : null), [draft])

  function loadSample() {
    abortRef.current?.abort()
    seqRef.current++
    setBusy(false)
    setConfirmOpen(false)
    setDraft(buildSampleContract(todayKey))
    setSource('sample')
    setLoadError(null)
    setEditingId(null)
    setPasteOpen(false)
  }

  function applyPaste() {
    const result = parseContractText(pasteText)
    if (result.ok || result.kind === 'validation') {
      setDraft(result.contract)
      setSource('paste')
      setLoadError(null)
      setEditingId(null)
      setPasteOpen(false)
    } else {
      setLoadError({ kind: result.kind, message: result.message, issues: result.issues })
    }
  }

  async function runGenerate() {
    if (busy) return
    if (!auth.isSigned) {
      setLoadError({ kind: 'auth', message: COACH_ERRORS.auth.detail, issues: [{ code: 'AUTH_REQUIRED', message: '生成草稿需要登录哦狐账号' }] })
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    const seq = ++seqRef.current
    setBusy(true)
    setLoadError(null)
    const result = await generateContract(goal, todayKey, addDays(todayKey, 6), controller.signal)
    if (seq !== seqRef.current || !isQbankSessionCurrent(session)) return
    setBusy(false)
    if (result.ok) {
      setDraft(result.contract)
      setSource('ai')
      setEditingId(null)
      setLoadError(null)
    } else if (result.kind === 'validation') {
      // 结构合法但排期有问题：载入草稿并展示校验异常，供用户直接修改。
      if (result.contract) setDraft(result.contract)
      setSource('ai')
      setEditingId(null)
      setLoadError(null)
    } else {
      setLoadError({ kind: result.kind, message: result.message, issues: result.issues })
    }
  }

  function updateTask(id: string, patch: Partial<CoachTask>) {
    setDraft(d => (d ? { ...d, tasks: d.tasks.map(t => (t.id === id ? { ...t, ...patch } : t)) } : d))
  }

  function toggleDep(task: CoachTask, depId: string, on: boolean) {
    updateTask(task.id, { dependsOn: on ? [...task.dependsOn, depId] : task.dependsOn.filter(x => x !== depId) })
  }

  function addTask() {
    const id = `t${Date.now().toString(36)}`
    setDraft(d => {
      if (!d) return d
      const task: CoachTask = { id, title: '新任务', date: todayKey, minutes: 30, dependsOn: [], category: '学习', done: false, note: '' }
      return { ...d, tasks: [...d.tasks, task] }
    })
    setEditingId(id)
  }

  function removeTask(id: string) {
    setDraft(d => (d ? { ...d, tasks: d.tasks.filter(t => t.id !== id).map(t => ({ ...t, dependsOn: t.dependsOn.filter(x => x !== id) })) } : d))
    setEditingId(null)
  }

  function refreshPending() {
    setPendingRecords(listImportRecords(session.uid || 'guest').filter(r => r.status === 'pending'))
  }

  function openConfirm() {
    setOutcome(null)
    setImportError('')
    setSelected([])
    try {
      refreshPending()
      setConfirmOpen(true)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '无法读取本机导入凭证')
    }
  }

  async function confirmWrite() {
    if (importing || !draft || validationIssues.length || !isQbankSessionCurrent(session)) return
    const chosen = toWrite.filter(task => selected.includes(task.id))
    if (!chosen.length) return
    setImporting(true)
    setImportError('')
    try {
      const result = await importCoachTasksLocally(draft, chosen, session)
      if (!isQbankSessionCurrent(session)) return
      setOutcome(result)
      setConfirmOpen(false)
      refreshPending()
    } catch (error) {
      if (isQbankSessionCurrent(session)) setImportError(error instanceof Error ? error.message : '请核对本机记录后再操作')
    } finally {
      setImporting(false)
    }
  }

  async function checkPending() {
    if (importing) return
    setImporting(true)
    try {
      await reconcileCoachLocalImports(session)
      if (!isQbankSessionCurrent(session)) return
      refreshPending()
      setImportError('')
      setOutcome(null)
    } catch (error) {
      if (isQbankSessionCurrent(session)) setImportError(error instanceof Error ? error.message : '本机核对失败，请保留数据')
    } finally {
      setImporting(false)
    }
  }

  const errorCard = loadError ? (
    <div className={s.error} role="alert">
      <h3>{COACH_ERRORS[loadError.kind].title}</h3>
      <p>{loadError.message || COACH_ERRORS[loadError.kind].detail}</p>
      {loadError.issues.length ? <ul className={s.issues}>{loadError.issues.map((it, i) => <li key={`${it.code}-${i}`}>{it.message}</li>)}</ul> : null}
      <p className={s.recovery}>{COACH_ERRORS[loadError.kind].recovery}</p>
      <div className={s.errorActions}>
        {loadError.kind === 'auth' ? <button type="button" className={s.btnMain} onClick={() => auth.openLogin('生成教练草稿前，请先登录哦狐账号')}>重新登录</button> : null}
        {loadError.kind === 'network' || loadError.kind === 'timeout' ? <button type="button" className={s.btnMain} disabled={busy} onClick={() => void runGenerate()}>重试生成</button> : null}
        {loadError.kind === 'parse' ? <button type="button" className={s.btnMain} onClick={() => { setPasteOpen(true); setLoadError(null) }}>改用粘贴 JSON</button> : null}
        <button type="button" className={s.btnGhost} onClick={loadSample}>加载示例契约</button>
      </div>
    </div>
  ) : null

  function renderTask(task: CoachTask, extra?: { ready?: boolean; blockedBy?: string[] }) {
    const editing = editingId === task.id
    return (
      <li key={task.id} className={`${s.task} ${task.done ? s.taskDone : ''}`}>
        <div className={s.taskHead}>
          <label className={s.doneLab}>
            <input type="checkbox" checked={task.done} onChange={e => updateTask(task.id, { done: e.target.checked })} aria-label={`标记「${task.title}」完成`} />
            <span className={s.doneBox} aria-hidden="true">{task.done ? '✓' : ''}</span>
          </label>
          <div className={s.taskTitle}>
            <b>{task.title || '（未命名）'}</b>
            <span className={s.taskMeta}>{task.category} · {minutesLabel(task.minutes)} · {task.date}{extra && !extra.ready && extra.blockedBy?.length ? ` · 待前置：${extra.blockedBy.join('、')}` : ''}</span>
          </div>
          <button type="button" className={s.editBtn} aria-expanded={editing} onClick={() => setEditingId(editing ? null : task.id)}>{editing ? '收起' : '编辑'}</button>
        </div>
        {editing ? (
          <div className={s.editForm}>
            <label className={s.field}><span>标题</span><input className={s.input} value={task.title} onChange={e => updateTask(task.id, { title: e.target.value })} aria-label="任务标题" /></label>
            <div className={s.fieldRow}>
              <label className={s.field}><span>日期</span><input type="date" className={s.input} value={task.date} onChange={e => updateTask(task.id, { date: e.target.value })} aria-label="任务日期" /></label>
              <label className={s.field}><span>时长（分钟）</span><input type="number" inputMode="numeric" className={s.input} value={Number.isFinite(task.minutes) ? task.minutes : ''} onChange={e => updateTask(task.id, { minutes: e.target.value === '' ? 0 : Math.trunc(Number(e.target.value)) })} aria-label={`任务时长，${MIN_TASK_MINUTES} 到 ${MAX_TASK_MINUTES} 分钟`} /></label>
            </div>
            <label className={s.field}><span>分类</span><input className={s.input} value={task.category} onChange={e => updateTask(task.id, { category: e.target.value })} aria-label="任务分类" /></label>
            <div className={s.field}>
              <span>前置任务（依赖）</span>
              <div className={s.depGrid}>
                {draft?.tasks.filter(o => o.id !== task.id).map(o => (
                  <label key={o.id} className={s.depChip}>
                    <input type="checkbox" checked={task.dependsOn.includes(o.id)} onChange={e => toggleDep(task, o.id, e.target.checked)} />
                    <span>{o.title || o.id}</span>
                  </label>
                ))}
                {draft && draft.tasks.length <= 1 ? <span className={s.depEmpty}>暂无其他任务可依赖</span> : null}
              </div>
            </div>
            <div className={s.editActions}>
              <button type="button" className={s.btnGhost} onClick={() => setEditingId(null)}>完成编辑</button>
              <button type="button" className={s.btnDanger} onClick={() => removeTask(task.id)}>删除任务</button>
            </div>
          </div>
        ) : null}
      </li>
    )
  }

  return (
    <section className={s.wrap} aria-label="教练任务契约预览">
      <fieldset className={`${s.controls} ${s.wrap}`} disabled={importing}>
      <div className={s.notice} role="note">
        <b>预览编辑不落库 · 确认才写入</b>
        <span>编辑只留在当前页面。逐项勾选并确认后才保存到当前账号的本机待办，不上传、不云同步。日期与时长作为备注保存，不设置午夜提醒；前置依赖仅在预览中生效。清理浏览器数据会丢失本机记录和去重凭证。</span>
      </div>

      <div className={s.toolbar}>
        <button type="button" className={s.btnGhost} onClick={loadSample}>加载示例</button>
        <button type="button" className={s.btnGhost} aria-expanded={pasteOpen} onClick={() => setPasteOpen(o => !o)}>粘贴 JSON</button>
        <button type="button" className={s.btnGhost} onClick={addTask} disabled={!draft}>新增任务</button>
        <button type="button" className={s.btnMain} onClick={openConfirm} disabled={!draft || importing || validationIssues.length > 0 || toWrite.length === 0}>保存到本机待办</button>
        <span className={s.sourceTag}>{source === 'sample' ? '示例契约' : source === 'paste' ? '粘贴契约' : 'AI 草稿'}{draft ? ` · ${draft.tasks.length} 项` : ''}</span>
      </div>

      <div className={s.aiRow}>
        <input className={s.input} value={goal} onChange={e => setGoal(e.target.value)} placeholder="学习目标（可选），如：本周高数复习 + 四级冲刺" aria-label="教练学习目标" disabled={busy} />
        <button type="button" className={s.btnMain} onClick={() => void runGenerate()} disabled={busy} aria-busy={busy}>{busy ? '生成中…' : 'AI 生成草稿'}</button>
      </div>
      <p className={s.aiHint}>AI 生成需登录并联网，仅产出草稿；离线可用「加载示例 / 粘贴 JSON」。生成结果同样经过本地校验。</p>

      {pasteOpen ? (
        <div className={s.pastePanel}>
          <label className={s.field} htmlFor={`${uid}-paste`}><span>粘贴 TaskContract 1.1.0 JSON</span></label>
          <textarea id={`${uid}-paste`} className={s.textarea} value={pasteText} onChange={e => setPasteText(e.target.value)} rows={6} placeholder='{"schema":"ohu.task-contract","version":"1.1.0",...}' aria-label="契约 JSON 输入" />
          <div className={s.editActions}>
            <button type="button" className={s.btnMain} onClick={applyPaste} disabled={!pasteText.trim()}>校验并预览</button>
            <button type="button" className={s.btnGhost} onClick={() => { setPasteText(''); setPasteOpen(false) }}>取消</button>
          </div>
        </div>
      ) : null}

      {errorCard}
      {importError ? <p className={s.empty} role="alert">{importError}</p> : null}
      {confirmOpen ? (
        <div className={s.pastePanel} role="region" aria-label="确认保存本机待办">
          <h3 className={s.dayHead}>逐项选择本机保存</h3>
          <p className={s.viewSummary}>当前归属：{session.uid ? '已登录账号' : '访客'}。默认不选；已完成任务不导入。仅保存本机，不生成云端任务。</p>
          <ul className={s.taskList}>
            {toWrite.map(task => <li className={s.task} key={task.id}>
              <label className={s.selection}>
                <input type="checkbox" checked={selected.includes(task.id)}
                  onChange={e => setSelected(ids => e.target.checked ? [...ids, task.id] : ids.filter(id => id !== task.id))} />
                <span>{task.title}<small>{task.date} · {minutesLabel(task.minutes)}</small></span>
              </label>
            </li>)}
          </ul>
          <div className={s.editActions}>
            <button className={s.btnMain} type="button" disabled={!selected.length || !!validationIssues.length || busy}
              onClick={() => void confirmWrite()}>确认保存 {toWrite.filter(task => selected.includes(task.id)).length} 项</button>
            <button className={s.btnGhost} type="button" onClick={() => setConfirmOpen(false)}>取消保存</button>
          </div>
        </div>
      ) : null}
      {outcome ? <div className={s.pastePanel} role="status" aria-live="polite">
        <h3 className={s.dayHead}>本机保存结果</h3>
        <p className={s.viewSummary}>已写入 {outcome.created} · 已存在 {outcome.duplicate} · 待核对 {outcome.pending} · 未写入 {outcome.failed + outcome.skipped}</p>
        <ul className={s.issues}>{outcome.results.map((result, index) => <li key={`${result.key}-${index}`}>
          {result.title} — {({ created: '已写入本机', duplicate: '已存在，未重复创建', pending: '待核对，未自动重写', failed: '未写入，可重新确认', skipped: '已停止，未继续写入' })[result.status]}
          {result.todoId != null ? `（编号 ${result.todoId}）` : ''}{result.error ? `：${result.error}` : ''}
        </li>)}</ul>
      </div> : null}
      <button className={s.btnGhost} type="button" onClick={() => {
        try { refreshPending(); setImportError('') } catch (error) { setImportError(error instanceof Error ? error.message : '凭证读取失败') }
      }}>查看待处理记录</button>
      {pendingRecords.length ? <div className={s.pastePanel} aria-label="待处理本机记录">
        <h3 className={s.dayHead}>待处理记录 {pendingRecords.length} 项</h3>
        <ul className={s.issues}>{pendingRecords.map(record => <li key={record.key}>{record.title} · {record.date} · {record.error || '写入结果尚未确认'}</li>)}</ul>
        <p className={s.viewSummary}>按稳定导入键读取本机待办核对，不按标题猜测，不手填编号。核对失败时保留凭证，避免重复保存。</p>
        <button className={s.btnGhost} type="button" onClick={() => void checkPending()}>核对本机写入结果</button>
      </div> : null}

      {draft ? (
        <>
          {validationIssues.length ? (
            <div className={s.validation} role="alert">
              <h3>{COACH_ERRORS.validation.title}</h3>
              <p>{COACH_ERRORS.validation.detail}</p>
              <ul className={s.issues}>{validationIssues.map((it, i) => <li key={`${it.code}-${i}`}>{it.message}</li>)}</ul>
              <p className={s.recovery}>{COACH_ERRORS.validation.recovery}</p>
            </div>
          ) : null}

          <div className={s.viewTabs} role="group" aria-label="教练视图">
            {VIEWS.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={view === id} className={view === id ? `${s.viewTab} ${s.viewTabOn}` : s.viewTab} onClick={() => setView(id)}>{label}</button>
            ))}
          </div>

          {view === 'today' && today ? (
            <div className={s.viewBody}>
              <p className={s.viewSummary}>{todayKey} · {today.tasks.length} 项 · {minutesLabel(today.totalMinutes)} · 可开始 {today.readyCount} · 受阻 {today.blockedCount} · 已完成 {today.doneCount}</p>
              {today.tasks.length ? <ul className={s.taskList}>{today.tasks.map(t => renderTask(t.task, { ready: t.ready, blockedBy: t.blockedBy }))}</ul> : <p className={s.empty}>今天没有排期任务。可在「计划」查看其他日期，或新增任务。</p>}
            </div>
          ) : null}

          {view === 'plan' && plan ? (
            <div className={s.viewBody}>
              <p className={s.viewSummary}>{draft.horizon.start} ~ {draft.horizon.end} · 共 {plan.taskCount} 项 · {minutesLabel(plan.totalMinutes)}</p>
              {plan.days.length ? plan.days.map(day => (
                <div key={day.date} className={s.dayGroup}>
                  <h4 className={s.dayHead}>{day.date}{day.date === todayKey ? ' · 今天' : ''} <span>{day.tasks.length} 项 · {minutesLabel(day.totalMinutes)}</span></h4>
                  <ul className={s.taskList}>{day.tasks.map(t => renderTask(t))}</ul>
                </div>
              )) : <p className={s.empty}>暂无任务。点击「新增任务」开始排期。</p>}
            </div>
          ) : null}

          {view === 'relations' && relations ? (
            <div className={s.viewBody}>
              <p className={s.viewSummary}>{relations.edgeCount} 条依赖{relations.hasCycle ? ' · 存在成环（见上方校验）' : ' · 无环'}</p>
              {relations.order.length ? <p className={s.order}>建议执行顺序：{relations.order.map(id => draft.tasks.find(t => t.id === id)?.title || id).join(' → ')}</p> : null}
              <ul className={s.relList}>
                {relations.nodes.map(node => (
                  <li key={node.task.id} className={s.relNode}>
                    <b>{node.task.title || node.task.id}</b>
                    <span className={s.relMeta}>前置：{node.prerequisites.length ? node.prerequisites.map(p => p.title || p.id).join('、') : '无'} · 后续：{node.dependents.length ? node.dependents.map(p => p.title || p.id).join('、') : '无'}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {view === 'review' && review ? (
            <div className={s.viewBody}>
              <p className={s.viewSummary}>完成 {review.done}/{review.total} · {Math.round(review.rate * 100)}% · 已投入 {minutesLabel(review.minutesDone)} / {minutesLabel(review.minutesTotal)}</p>
              <div className={s.rateBar} aria-hidden="true"><span style={{ width: `${Math.round(review.rate * 100)}%` }} /></div>
              <ul className={s.catList}>
                {review.byCategory.map(c => (
                  <li key={c.category}><span>{c.category}</span><b>{c.done}/{c.total}</b></li>
                ))}
              </ul>
              {review.unfinished.length ? <>
                <h4 className={s.dayHead}>未完成</h4>
                <ul className={s.taskList}>{review.unfinished.map(t => renderTask(t))}</ul>
              </> : <p className={s.empty}>全部任务已完成，复盘清零。</p>}
            </div>
          ) : null}
        </>
      ) : !loadError ? (
        <p className={s.empty}>还没有契约。点击「加载示例」离线预览，或粘贴 / 生成你自己的 TaskContract。</p>
      ) : null}
      </fieldset>
      {importing ? <p className={s.viewSummary} role="status">正在处理本机记录，请稍候…</p> : null}
    </section>
  )
}