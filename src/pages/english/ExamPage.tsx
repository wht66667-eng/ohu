import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../context/ToastContext'
import { PageHeader } from '../../components/PageHeader'
import { paperByIdLocal, questionByIdLocal, type QRow } from '../../lib/qbank'
import { useQbankRevision } from '../../lib/useQbankRevision'
import { submitPaperAttempt, type PerQuestion } from '../../services/qbank/attempts'
import styles from './english.module.css'
import { ErrorState } from '../../components/ui/StateViews'

const JUDGE_OPTS = [
  { key: 'true', text: '对' },
  { key: 'false', text: '错' },
]

/** /english/exam/:paperId 答卷判分（1.2.34） */
export function ExamPage() {
  const auth = useAuth()
  const { paperId } = useParams()
  return <ExamContent key={`${auth.isSigned ? auth.user?.uid || 'signed' : 'guest'}:${paperId || ''}`} />
}

function ExamContent() {
  const { paperId } = useParams()
  const nav = useNavigate()
  const auth = useAuth()
  const toast = useToast()
  const qbankRevision = useQbankRevision()

  const paper = useMemo(() => paperId ? paperByIdLocal(paperId) : null, [paperId, qbankRevision])
  const questions = useMemo<QRow[]>(
    () => (paper ? paper.qids.map((id) => questionByIdLocal(id)).filter((q): q is QRow => !!q) : []),
    [paperId, paper],
  )

  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<{ score: number; correctCount: number; totalCount: number; perQuestion: Record<string, PerQuestion> } | null>(null)
  useEffect(() => {
    setAnswers({})
    setResult(null)
  }, [auth.isSigned, auth.user?.uid, paperId])

  if (!paper) {
    return (
      <div className={styles.page}>
        <PageHeader title="试卷" />
        <div className={styles.main}>
          <ErrorState
            title="试卷不存在"
            hint=""
            action={<button type="button" onClick={() => nav('/english')}>回英语学习</button>}
          />
        </div>
      </div>
    )
  }

  const answered = questions.filter((q) => answers[q.id] != null).length

  function pick(q: QRow, key: string) {
    if (result) return
    setAnswers((a) => ({ ...a, [q.id]: key }))
  }

  function submit() {
    if (result) return
    if (!paper) return
    if (answered < questions.length) {
      toast.warn(`还有 ${questions.length - answered} 题没答`)
      return
    }
    let r
    try { r = submitPaperAttempt(paper.id, answers) }
    catch (error) { toast.err(error instanceof Error ? error.message : '答卷未能保存，请重试'); return }
    if (!r.ok) { toast.err(r.error || '提交失败'); return }
    setResult(r)
    if (r.correctCount === r.totalCount) toast.ok(`满分 ${r.score} 分`)
    else toast(`得分 ${r.score}`)
  }

  function retry() {
    setAnswers({})
    setResult(null)
    window.scrollTo({ top: 0 })
  }

  return (
    <div className={styles.page}>
      <PageHeader title={paper.title} />
      <div className={styles.main}>
        {result ? (
          <div className={styles.scoreHero}>
            <div className={styles.scoreNum}>
              {result.correctCount} / {result.totalCount}
            </div>
            <p className={styles.muted}>得分 {result.score}</p>
            <div className={styles.scoreActions}>
              <button type="button" className={styles.btnMain} onClick={retry}>
                重做
              </button>
              <button type="button" className={styles.btnGhost} onClick={() => nav('/english')}>
                回英语学习
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.notice}>
            共 {questions.length} 题 · 已答 {answered}
          </div>
        )}

        <ul className={styles.qList} style={{ marginTop: 12 }}>
          {questions.map((q, i) => {
            const opts = q.qtype === 'judge' ? JUDGE_OPTS : q.options
            const chosen = answers[q.id]
            const per = result?.perQuestion[q.id]
            return (
              <li key={q.id} className={styles.card}>
                <div className={styles.qStem}>
                  {i + 1}. {q.stem}
                </div>
                <div className={styles.opts}>
                  {opts.map((o) => {
                    const isAnswer = result && o.key === q.answer
                    const isChosen = chosen === o.key
                    let cls = styles.opt
                    if (result) {
                      if (isAnswer) cls += ' ' + styles.optRight
                      else if (isChosen) cls += ' ' + styles.optWrong
                    } else if (isChosen) {
                      cls += ' ' + styles.optOn
                    }
                    let markCls = styles.mark
                    if (result) {
                      if (isAnswer) markCls += ' ' + styles.markRight
                      else if (isChosen) markCls += ' ' + styles.markWrong
                    } else if (isChosen) {
                      markCls += ' ' + styles.markOn
                    }
                    return (
                      <button key={o.key} type="button" className={cls} onClick={() => pick(q, o.key)}>
                        <span className={markCls}>{o.key === 'true' || o.key === 'false' ? (o.key === 'true' ? '对' : '错') : o.key}</span>
                        <span>{o.text}</span>
                      </button>
                    )
                  })}
                </div>
                {result && per ? (
                  <p className={`${styles.explain} ${per.correct ? styles.explainRight : styles.explainWrong}`}>
                    {per.correct ? '✓ 答对' : '✗ 答错'}
                    {q.explanation ? ` · ${q.explanation}` : ''}
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>

        {!result ? (
          <div className={styles.bar}>
            <span className={styles.barText}>
              {answered}/{questions.length}
            </span>
            <button type="button" className={styles.btnMain} disabled={answered < questions.length} onClick={submit}>
              交卷
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
