import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { getWordBank } from '../../data/words/banks'
import { captureQbankSession, isQbankSessionCurrent, listQuestionsLocal, type QRow } from '../../lib/qbank'
import { dueCardsForActivePlan, reviewCard } from '../../services/words/srs'
import { getWordStudyError, getWordStudyRevision, subscribeWordStudy } from '../../services/words/study-storage'
import { prepareQuickQuizQuestion } from '../quick-quiz'
import styles from './PlayfulReadings.module.css'

type ToggleProps = { enabled: boolean; onToggle: () => void }
const buttonText = (enabled: boolean) => enabled ? '使用中 · 点击停用' : '未使用 · 点击启用'

function randomize<T,>(rows: T[]): T[] {
  const result = [...rows]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function ReviewCards({ enabled, onToggle }: ToggleProps) {
  const [revision, setRevision] = useState(0)
  const [saveError, setSaveError] = useState('')
  const [revealedId, setRevealedId] = useState('')
  const studyRevision = useSyncExternalStore(subscribeWordStudy, getWordStudyRevision, () => 0)
  const state = useMemo(() => {
    void revision
    try {
      const session = captureQbankSession()
      const cards = dueCardsForActivePlan(1)
      const storageError = getWordStudyError()
      if (storageError) throw new Error(storageError)
      const word = cards[0] ? getWordBank().find(item => item.id === cards[0].wordId) : undefined
      return { card: cards[0], word, session, error: '' }
    } catch (error) { return { card: undefined, word: undefined, session: captureQbankSession(), error: error instanceof Error ? error.message : '读取复习卡失败' } }
  }, [revision, studyRevision])
  function grade(value: 0 | 1 | 2 | 3) {
    if (!enabled || !state.card || revealedId !== state.card.wordId) return
    if (!isQbankSessionCurrent(state.session)) { setSaveError('账号已切换，请重新打开记忆卡'); return }
    try { reviewCard(state.card.wordId, value); setRevealedId(''); setSaveError(''); setRevision(current => current + 1) }
    catch (error) { setSaveError(error instanceof Error ? error.message : '保存复习结果失败') }
  }
  return <div className={styles.controls}>
    <button type="button" className={enabled ? styles.secondary : styles.primary} onClick={onToggle} aria-label={enabled ? '停用今日记忆卡' : '启用今日记忆卡'} aria-pressed={enabled}>{buttonText(enabled)}</button>
    {enabled ? <div className={styles.tool}>
      {state.error ? <p className={styles.disclaimer} role="alert">{state.error}</p> : state.word ? <>
        {saveError ? <p className={styles.disclaimer} role="alert">{saveError}</p> : null}
        <div className={styles.result}><b>{state.word.word}{state.word.phonetic ? `  ${state.word.phonetic}` : ''}</b>{revealedId === state.word.id ? <><span>{state.word.meaning}</span>{state.word.example ? <span>{state.word.example}</span> : null}</> : <button type="button" className={styles.secondary} onClick={() => setRevealedId(state.word!.id)}>想好了吗？查看释义</button>}</div>
        <span className={styles.disclaimer}>按当前单词计划复习 · 记忆进度按账号保存在本机</span>
        {revealedId === state.word.id ? <div className={styles.grades}>
          <button type="button" onClick={() => grade(0)}>忘了</button><button type="button" onClick={() => grade(1)}>模糊</button><button type="button" onClick={() => grade(2)}>记得</button><button type="button" onClick={() => grade(3)}>很熟</button>
        </div> : null}
      </> : <><p className={styles.disclaimer}>当前计划没有到期单词，或还没有可复习的词库。</p><Link className={styles.draw} to="/words">管理单词计划</Link></>}
    </div> : null}
  </div>
}

export function QuickQuiz({ enabled, onToggle }: ToggleProps) {
  const session = useRef(captureQbankSession())
  const [items, setItems] = useState<QRow[]>([])
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState('')
  const [score, setScore] = useState(0)
  const [finished, setFinished] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  useEffect(() => {
    if (!enabled) { setItems([]); setIndex(0); setPicked(''); setScore(0); setFinished(false); setError(''); setSubmitted(false) }
  }, [enabled])
  function start() {
    if (!isQbankSessionCurrent(session.current)) { setError('账号已切换，请重新打开快测'); return }
    try {
      const bank = listQuestionsLocal().map(prepareQuickQuizQuestion).filter((question): question is QRow => question !== null)
      if (!bank.length) { setError('本机题库还没有可练习的题目。'); return }
      setItems(randomize(bank).slice(0, 5)); setIndex(0); setPicked(''); setScore(0); setFinished(false); setError(''); setSubmitted(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取本机题库失败') }
  }
  function next() {
    if (!submitted || !items[index] || !isQbankSessionCurrent(session.current)) return
    if (index + 1 >= items.length) setFinished(true)
    else { setIndex(index + 1); setPicked(''); setSubmitted(false) }
  }
  function check() {
    if (!picked || submitted || !items[index] || !isQbankSessionCurrent(session.current)) return
    setScore(current => current + (picked === items[index].answer ? 1 : 0))
    setSubmitted(true)
  }
  return <div className={styles.controls}>
    <button type="button" className={enabled ? styles.secondary : styles.primary} onClick={onToggle} aria-label={enabled ? '停用题库五题快测' : '启用题库五题快测'} aria-pressed={enabled}>{buttonText(enabled)}</button>
    {enabled ? <div className={styles.tool}>
      {!items.length || finished ? <>
        {finished ? <div className={styles.result} aria-live="polite"><b>完成快测 · {score}/{items.length}</b><span>这次练习只在当前页面临时计算，不会额外创建试卷或保存答案。</span></div> : <p className={styles.disclaimer}>从本机题库随机抽取最多 5 题，答题内容不会上传。</p>}
        {error ? <p className={styles.disclaimer} role="status">{error}</p> : null}
        <button type="button" className={styles.draw} onClick={start}>开始 5 题快测</button>
        <Link className={styles.disclaimer} to="/english/bank">整理题库并保存正式练习记录 ›</Link>
      </> : <>
        <div className={styles.result}><b>第 {index + 1}/{items.length} 题</b><span>{items[index].stem}</span></div>
        <div className={styles.quizOptions} role="group" aria-label="选择答案">{items[index].options.map(option => <button type="button" key={option.key} disabled={submitted} aria-pressed={picked === option.key} onClick={() => setPicked(option.key)}>{items[index].qtype === 'judge' ? option.text : `${option.key}. ${option.text}`}</button>)}</div>
        {submitted ? <><div className={styles.result} role="status"><b>{picked === items[index].answer ? '答对了' : '再记住这个知识点'}</b><span>正确答案：{items[index].options.find(option => option.key === items[index].answer)?.text}</span>{items[index].explanation ? <span>{items[index].explanation}</span> : null}</div><button type="button" className={styles.draw} onClick={next}>{index + 1 === items.length ? '完成快测' : '下一题'}</button></> : <button type="button" className={styles.draw} disabled={!picked} onClick={check}>确认答案</button>}
      </>}
    </div> : null}
  </div>
}
