import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { requestAgnes, type AgnesFeature } from '../lib/agnes-ai'
import { NoticeTodoSheet } from './NoticeTodoSheet'
import styles from './AgnesStudyTools.module.css'

type ToolGroup = 'understand' | 'plan'
const TOOLS: { id: AgnesFeature; group: ToolGroup; title: string; detail: string; placeholder: string; resultNote: string; example: string }[] = [
  { id: 'chat', group: 'understand', title: '校园问答', detail: '问学习与校园生活', placeholder: '写下你想问的问题…', example: '怎样把一周复习拆成每天 30 分钟的小任务？', resultNote: '不会读取哦狐实时校园数据；校规、考试安排和开放时间请以学校官方通知为准。' },
  { id: 'study-plan', group: 'plan', title: '学习计划', detail: '按目标和时间安排', placeholder: '目标、完成日期、每天可用时间…', example: '目标：一周复习完高数第 3 章；每天 60 分钟；周日复盘。', resultNote: '只依据这次输入生成；请核对日期、可用时间和任务量，再决定是否采用。' },
  { id: 'material-summary', group: 'understand', title: '资料摘要', detail: '快速整理复习内容', placeholder: '粘贴你想整理的课程资料…', example: '示例资料：导数表示函数在某点的瞬时变化率；函数在一点可导，则该点连续。', resultNote: '摘要仅根据本次提供的资料生成；请对照原文核对关键定义和结论。' },
  { id: 'material-points', group: 'understand', title: '提炼考点', detail: '梳理重点与易混点', placeholder: '粘贴课程资料或复习范围…', example: '示例资料：光合作用利用光能，将二氧化碳和水转化为有机物并释放氧气。', resultNote: '考点只依据本次提供的资料；资料未覆盖的课程范围不会自动补齐。' },
  { id: 'material-quiz', group: 'understand', title: '生成自测题', detail: '用资料检验掌握情况', placeholder: '粘贴作为出题依据的学习资料…', example: '示例资料：牛顿第一定律指出，物体在合力为零时保持静止或匀速直线运动。', resultNote: '题目和答案根据本次资料生成；请先自行作答，再对照原文检查答案。' },
  { id: 'assignment-breakdown', group: 'plan', title: '拆解作业', detail: '把任务变成可执行步骤', placeholder: '手动写下作业要求；截止时间请自己确认…', example: '作业：完成教材第 3 章习题 1–10，并整理错题。截止时间以老师通知为准。', resultNote: '不会替你推断截止时间；提交要求和完成标准请以老师原通知为准。' },
  { id: 'exam-plan', group: 'plan', title: '考前规划', detail: '安排复习节奏与休息', placeholder: '科目、考试日期、薄弱点、每天可用时间…', example: '科目：高数；考试日期：11 月 20 日；薄弱点：积分；每天可学习 45 分钟。', resultNote: '请先核对考试日期和每天可用时段；计划是建议，不会自动写入日程。' },
  { id: 'vocab-explain', group: 'understand', title: '词汇讲解', detail: '理解英语或专业术语', placeholder: '输入词语、术语和上下文…', example: '请讲解 resilience 在心理学语境中的意思、常见用法和易混词。', resultNote: '词义可能随学科语境变化；专业用法请结合课程资料确认。' },
]
const TOOL_GROUPS: { id: ToolGroup; title: string; detail: string }[] = [
  { id: 'understand', title: '理解与练习', detail: '提问、整理资料、检验掌握' },
  { id: 'plan', title: '计划与执行', detail: '安排复习，把任务拆成步骤' },
]
const INPUT_LIMIT = 10000

export function AgnesStudyTools({ uid, onRequireLogin }: { uid: string; onRequireLogin: () => void }) {
  const [selected, setSelected] = useState<AgnesFeature>('study-plan')
  const [drafts, setDrafts] = useState<Partial<Record<AgnesFeature, string>>>({})
  const [answer, setAnswer] = useState('')
  const [answerInput, setAnswerInput] = useState('')
  const [error, setError] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const [pasteStatus, setPasteStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [privacyConfirmed, setPrivacyConfirmed] = useState(false)
  const [todoDraftOpen, setTodoDraftOpen] = useState(false)
  const request = useRef<AbortController | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)
  const tool = TOOLS.find(item => item.id === selected)!
  const input = drafts[selected] || ''
  const answerMatchesInput = !!answer && answerInput === input.trim()

  useEffect(() => () => request.current?.abort(), [])

  if (!uid) return <section className={styles.section} aria-labelledby="agnes-tools-login-title">
    <div className={styles.loginGate}>
      <span aria-hidden="true">OHU AI</span>
      <h2 id="agnes-tools-login-title">登录后使用 AI 学习工具</h2>
      <p>登录后可使用校园问答、资料整理和学习计划。提交内容前仍会显示发送说明，并由你逐次确认。</p>
      <button type="button" onClick={onRequireLogin}>手机号登录</button>
    </div>
  </section>

  async function generate(event: FormEvent) {
    event.preventDefault()
    if (busy || !input.trim()) return
    if (!uid) { onRequireLogin(); return }
    if (!privacyConfirmed) { setError('请先确认已了解 AI 输入的发送范围。'); return }
    const submittedInput = input.trim()
    const controller = new AbortController()
    request.current?.abort()
    request.current = controller
    setBusy(true); setError(''); setAnswer(''); setAnswerInput(''); setCopyStatus('')
    try {
      const result = await requestAgnes(selected, submittedInput, controller.signal)
      if (!controller.signal.aborted) { setAnswer(result); setAnswerInput(submittedInput) }
    }
    catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'AI 暂时无法回应，请稍后重试。')
    }
    finally {
      if (request.current === controller) { request.current = null; setBusy(false) }
    }
  }

  async function pasteInput() {
    setPasteStatus('')
    try {
      if (!navigator.clipboard?.readText) throw new Error('unsupported')
      const text = await navigator.clipboard.readText()
      if (!text.trim()) { setPasteStatus('剪贴板没有文字；也可以点输入框后长按粘贴。'); return }
      if (text.length > INPUT_LIMIT) {
        setPasteStatus(`内容超过 ${INPUT_LIMIT} 字，未粘贴以免遗漏；请分段复制后分别处理。`)
        return
      }
      setDrafts(current => ({ ...current, [selected]: text }))
      setPrivacyConfirmed(false)
      setError('')
      setPasteStatus('已粘贴，可以先检查内容再生成。')
    } catch {
      setPasteStatus('当前环境无法直接读取剪贴板；请点输入框后长按并选择“粘贴”。')
    }
  }

  function useExample() {
    if (busy) return
    setDrafts(current => ({ ...current, [selected]: tool.example }))
    setPrivacyConfirmed(false)
    setAnswer('')
    setAnswerInput('')
    setError('')
    setCopyStatus('')
    setPasteStatus('示例已填入，可编辑后再生成。')
  }

  return <section className={styles.section} aria-labelledby="agnes-tools-title">
    <div className={styles.heading}><div><span>OHU AI · 学习工具箱</span><h2 id="agnes-tools-title">把学习问题拆成下一步</h2></div><span className={styles.badge}>8 项工具</span></div>
    <div className={styles.toolGroups}>
      {TOOL_GROUPS.map(group => <section className={styles.toolGroup} key={group.id} aria-labelledby={`agnes-group-${group.id}`}>
        <div className={styles.groupHeading}><h3 id={`agnes-group-${group.id}`}>{group.title}</h3><span>{group.detail}</span></div>
        <div className={styles.grid} role="group" aria-label={`${group.title}工具`}>
          {TOOLS.filter(item => item.group === group.id).map(item => <button key={item.id} type="button" disabled={busy} aria-pressed={selected === item.id} className={styles.tool} onClick={() => { setSelected(item.id); setAnswer(''); setAnswerInput(''); setError(''); setCopyStatus(''); setPasteStatus(''); setPrivacyConfirmed(false) }}>
            <strong>{item.title}</strong><span>{item.detail}</span>
          </button>)}
        </div>
      </section>)}
    </div>
    <form ref={formRef} className={styles.form} onSubmit={event => void generate(event)} aria-busy={busy}>
      <div className={styles.inputHead}><label htmlFor="agnes-input">{tool.title}</label><div className={styles.inputActions}><button type="button" className={styles.exampleButton} disabled={busy} onClick={useExample}>填入示例</button>{input || answer ? <button type="button" className={styles.clearButton} disabled={busy} onClick={() => { setDrafts(current => ({ ...current, [selected]: '' })); setAnswer(''); setAnswerInput(''); setError(''); setCopyStatus(''); setPasteStatus(''); setPrivacyConfirmed(false) }}>清空</button> : null}<button type="button" className={styles.paste} disabled={busy} onClick={() => void pasteInput()}>从剪贴板粘贴</button></div></div>
      <textarea id="agnes-input" value={input} disabled={busy} onChange={event => {
        if (event.target.value.length > INPUT_LIMIT) { setPasteStatus(`内容最多 ${INPUT_LIMIT} 字，请删减后再生成。`); return }
        setDrafts(current => ({ ...current, [selected]: event.target.value })); setPrivacyConfirmed(false); setError(''); setPasteStatus('')
      }} placeholder={tool.placeholder} rows={4} />
      {pasteStatus ? <small className={styles.pasteHint} role="status">{pasteStatus}</small> : null}
      <p className={styles.dataDisclosure}>提交后，当前输入会发送给哦狐 AI 服务及 Agnes AI 模型服务商用于本次处理。哦狐不会持久保存输入原文；模型服务商的数据处理与保留以其政策为准。请先移除密码、学号、联系方式等不必要的个人信息。</p>
      <label className={styles.consent}><input type="checkbox" checked={privacyConfirmed} disabled={busy} onChange={event => { setPrivacyConfirmed(event.target.checked); setError('') }} /><span>我已阅读发送说明，并确认发送当前输入。</span></label>
      <div className={styles.formFoot}><small>{input.length}/{INPUT_LIMIT} · 仅在确认后发送</small><div className={styles.formButtons}>{busy ? <button type="button" className={styles.cancelGenerate} onClick={() => {
        const active = request.current
        request.current = null
        active?.abort()
        setBusy(false)
        setError('已停止本机等待，输入内容仍保留；若请求已送达服务端，模型处理无法撤回。')
      }}>取消生成</button> : null}<button type="submit" disabled={busy || !input.trim() || !privacyConfirmed}>{busy ? '正在整理…' : '生成建议'}</button></div></div>
    </form>
    {busy ? <p className={styles.busyStatus} role="status" aria-live="polite"><span aria-hidden="true" />正在生成「{tool.title}」建议；当前内容不会自动保存，完成后请先核对。</p> : null}
    {error ? <div className={styles.error} role="alert"><span>{error}</span>{!busy && input.trim() && privacyConfirmed && !answerMatchesInput ? <button type="button" onClick={() => formRef.current?.requestSubmit()}>重试</button> : null}</div> : null}
    {answer && !answerMatchesInput ? <p className={styles.staleAnswer} role="status">输入内容已修改，当前结果对应修改前的版本。请重新生成后再使用。</p> : null}
    {answerMatchesInput ? <article className={styles.answer}><div className={styles.answerHead}><strong>生成结果</strong><button type="button" onClick={async () => {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('unsupported')
        await navigator.clipboard.writeText(answer)
        setCopyStatus('已复制到剪贴板。')
      } catch { setCopyStatus('无法访问剪贴板；可长按结果文字选择复制。') }
    }}>复制</button></div><p>{answer}</p>{copyStatus ? <small role="status">{copyStatus}</small> : null}<small>AI 内容是文字建议，不会自动保存；请核对日期和安排。</small><small className={styles.groundingNote} role="note">{tool.resultNote}</small>
      {selected === 'study-plan' || selected === 'assignment-breakdown' ? <div className={styles.followUp}>
        <span>把建议转成待办前，可在本机提取候选、编辑并逐项确认。</span>
        <div className={styles.followUpActions}>
          {uid ? <button type="button" onClick={() => setTodoDraftOpen(true)}>整理成待办</button> : null}
          <Link to="/todo">打开待办页 ›</Link>
        </div>
      </div> : null}
    </article> : null}
    {todoDraftOpen && answerMatchesInput && uid ? <NoticeTodoSheet uid={uid} source="ai" initialText={answer} onClose={() => setTodoDraftOpen(false)} onSaved={() => undefined} /> : null}
    <p className={styles.privacy}>使用需要哦狐账号登录。各工具的输入只在当前页面分别暂存，不会互相串用；工具不会自动读取或提交你的课表、待办和教务资料。</p>
  </section>
}
