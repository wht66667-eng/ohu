import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../context/ToastContext'
import { PageHeader } from '../../components/PageHeader'
import { ConfirmSheet } from '../../components/ConfirmSheet'
import {
  listQuestionsLocal,
  listPapersLocal,
  removePaperLocal,
  deletePaperCloud,
  cloudEnabled,
  pullCloud,
  type PaperRow,
} from '../../lib/qbank'
import { getWordBank } from '../../data/words/banks'
import { getActivePlan } from '../../services/words/plans'
import { srsStatsForBanks } from '../../services/words/srs'
import styles from './english.module.css'
import { EmptyState, LoadingState } from '../../components/ui/StateViews'
import { useQbankRevision } from '../../lib/useQbankRevision'
import { QbankRecovery } from './QbankRecovery'
import { useDownloadedWordBanks } from '../../lib/useDownloadedWordBanks'
import { useWordStudy } from '../../lib/useWordStudy'
import { WordStudyReadError } from '../../components/WordStudyRecovery'

function bestOf(p: PaperRow): { score: number; total: number } | null {
  if (!p.attempts.length) return null
  let best = p.attempts[0]
  for (const a of p.attempts) if (a.score > best.score) best = a
  return { score: best.score, total: best.totalCount }
}

/** /english 英语学习聚合页（1.2.34 · 去 AI 化） */
export function EnglishHubPage() {
  const { scope } = useWordStudy()
  return <EnglishHubContent key={scope} />
}

function EnglishHubContent() {
  const wordBanks = useDownloadedWordBanks()
  const auth = useAuth()
  const wordStudy = useWordStudy()
  const toast = useToast()
  const nav = useNavigate()
  const [tick, setTick] = useState(0)
  const qbankRevision = useQbankRevision()
  const [syncState, setSyncState] = useState<'device' | 'loading' | 'synced' | 'unconfirmed'>('device')
  const [syncTry, setSyncTry] = useState(0)
  const syncRevision = useRef(0)
  const [delId, setDelId] = useState<string | null>(null)

  useEffect(() => {
    const revision = ++syncRevision.current
    let alive = true
    setDelId(null)
    if (!cloudEnabled()) {
      setSyncState('device')
      return () => { alive = false }
    }
    setSyncState('loading')
    void pullCloud().then((ok) => {
      if (!alive || syncRevision.current !== revision) return
      setSyncState(ok ? 'synced' : 'unconfirmed')
      if (ok) setTick((n) => n + 1)
    })
    return () => { alive = false }
  }, [auth.isSigned, auth.user?.uid, syncTry])

  const questions = useMemo(() => listQuestionsLocal(), [qbankRevision])
  const papers = useMemo(() => listPapersLocal(), [qbankRevision])
  const wordCount = useMemo(() => getWordBank().length, [wordBanks.revision, wordStudy.revision])
  const plan = useMemo(() => getActivePlan(), [tick, wordStudy.revision])
  const wordStats = useMemo(() => srsStatsForBanks(plan.bankIds), [plan, tick, wordBanks.revision])
  const suggested = Math.min(plan.dailyGoal, wordStats.due)

  if (wordStudy.error) return <WordStudyReadError title="英语学习" message={wordStudy.error} onRetry={wordStudy.retry} />

  return (
    <div className={styles.page}>
      <PageHeader title="英语学习" />
      <div className={styles.main}>
        <section className={styles.todayCard} aria-labelledby="english-today-title">
          <span className={styles.todayKicker}>今天的学习 · 本机单词计划</span>
          <h2 id="english-today-title" className={styles.todayTitle}>{plan.name}</h2>
          <p className={styles.todayDesc}>{suggested > 0 ? `建议先学 ${suggested} 词，按自己的节奏继续。` : '当前没有到期单词，可以练习试卷或调整计划。'}</p>
          <div className={styles.statGrid}>
            <div><b>{wordStats.due}</b><span>待学与复习</span></div>
            <div><b>{wordStats.learned}</b><span>已学习</span></div>
            <div><b>{plan.dailyGoal}</b><span>日目标</span></div>
          </div>
          <Link to="/words" className={styles.continueBtn}>{suggested > 0 ? '继续学习' : '查看学习计划'}<span aria-hidden="true">→</span></Link>
        </section>

        <div className={styles.syncCard} aria-live="polite" aria-busy={syncState === 'loading'}>
          {syncState === 'loading' ? (
            <LoadingState compact title="正在同步题库…" />
          ) : (
            <div className={styles.syncLine}>
              <span>题库 {questions.length} 题 · 试卷 {papers.length} 份<br />{syncState === 'device' ? '本机记录，可离线使用' : syncState === 'synced' ? '题库同步已完成' : '云端同步未确认，本机内容可用'}</span>
              {syncState === 'unconfirmed' ? <button type="button" className={styles.syncRetry} onClick={() => setSyncTry(n => n + 1)}>重试同步</button> : null}
            </div>
          )}
        </div>

        <QbankRecovery />
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>学习方式</h2>
        </div>
        <div className={styles.entryGrid}>
          <Link className={styles.entryCard} to="/words">
            <span className={styles.entryIcon}>📖</span>
            <b className={styles.entryTitle}>单词记忆</b>
            <span className={styles.entryDesc}>遗忘曲线</span>
          </Link>
          <Link className={styles.entryCard} to="/english/bank">
            <span className={styles.entryIcon}>📝</span>
            <b className={styles.entryTitle}>出题题库</b>
            <span className={styles.entryDesc}>资料出题 · 组卷</span>
          </Link>
          <Link className={styles.entryCard} to="/words/duel">
            <span className={styles.entryIcon}>⚡</span>
            <b className={styles.entryTitle}>限时速对</b>
            <span className={styles.entryDesc}>对战</span>
          </Link>
          <Link className={styles.entryCard} to="/words/endless">
            <span className={styles.entryIcon}>🎯</span>
            <b className={styles.entryTitle}>无尽闯关</b>
            <span className={styles.entryDesc}>排行</span>
          </Link>
        </div>

        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>试卷题库</h2>
          <button type="button" className={styles.linkBtn} onClick={() => nav('/english/bank')}>
            出题 / 题库 →
          </button>
        </div>

        {papers.length === 0 ? (
          <EmptyState
            title="还没有试卷"
            hint="粘一段资料就能出题"
            action={<Link to="/english/bank">去出题</Link>}
          />
        ) : (
          <ul className={styles.qList}>
            {papers.map((p) => {
              const best = bestOf(p)
              return (
                <li key={p.id} className={styles.qRow}>
                  <div className={styles.qBody}>
                    <div className={styles.qStem}>{p.title}</div>
                    <div className={styles.qMeta}>
                      <span className={styles.tag}>{p.qids.length} 题</span>
                      {best ? <span className={styles.tag}>最好 {best.score} 分</span> : null}
                      <span className={styles.tag}>{p.createdAt.slice(0, 10)}</span>
                    </div>
                  </div>
                  <button type="button" className={styles.btnGhost} onClick={() => nav(`/english/exam/${p.id}`)}>
                    {best ? '再测' : '开始'}
                  </button>
                  <button type="button" className={styles.del} aria-label="删除试卷" onClick={() => setDelId(p.id)}>
                    ×
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <div className={styles.card}>
          <div className={styles.cardHead}>
            <h3 className={styles.cardTitle}>单词词库</h3>
            <span className={styles.tag}>共 {wordCount} 词</span>
          </div>
          <details className={styles.help}>
            <summary className={styles.helpSummary}>❓ 怎么增加词库的单词量？</summary>
            <div className={styles.helpBody}>
              点上方「单词记忆」→ 找到「我的单词」区 → 点「+ 添加单词」。
              <br />
              支持单个添加，也支持「批量导入」：把单词列表（每行一条）粘贴进去，自动识别单词和释义。
              <br />
              添加后在「自定义计划」里勾选「我的单词」即可背诵，仅保存在本机。
            </div>
          </details>
        </div>
      </div>

      {delId ? (
        <ConfirmSheet
          title="删除这份试卷？"
          desc="题目保留在题库里，只删卷子。"
          danger
          confirmText="删除"
          onConfirm={() => {
            const id = delId
            setDelId(null)
            try {
              removePaperLocal(id)
              void deletePaperCloud(id)
              setTick((n) => n + 1)
              toast.ok('已删除')
            } catch (error) { toast.err(error instanceof Error ? error.message : '未能删除，请重试') }
          }}
          onClose={() => setDelId(null)}
        />
      ) : null}
    </div>
  )
}
