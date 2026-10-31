import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../lib/auth'
import type { WordEntry } from '../../data/words/banks'
import {
  endlessDistractors,
  endlessSecondsForIndex,
  endlessStageInfo,
  formatElapsed,
  getLegacyEndlessLeaderboardSummary,
  loadEndlessLeaderboard,
  pickEndlessWord,
  restoreLegacyEndlessLeaderboard,
  submitEndlessScore,
  type EndlessScore,
} from '../../services/words/endless'
import { speakWordAsync, unlockSpeech } from '../../services/words/speech'
import { grantWordPoints } from '../../services/words/rewards'
import { PageHeader } from '../../components/PageHeader'
import { EmptyState } from '../../components/ui/StateViews'
import styles from './wordplay.module.css'
import { useDownloadedWordBanks } from '../../lib/useDownloadedWordBanks'
import { useWordStudy } from '../../lib/useWordStudy'

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function WordEndlessPage() {
  const wordBanks = useDownloadedWordBanks()
  const toast = useToast()
  const auth = useAuth()
  const wordStudy = useWordStudy()
  const displayName = auth.user?.nickname || auth.user?.loginName || auth.user?.uid?.slice(0, 6) || '同学'

  const [playing, setPlaying] = useState(false)
  const [runScope, setRunScope] = useState(wordStudy.scope)
  const [index, setIndex] = useState(0)
  const [correct, setCorrect] = useState(0)
  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(0)
  const [leftSec, setLeftSec] = useState(10)
  const [limitSec, setLimitSec] = useState(10)
  const [current, setCurrent] = useState<WordEntry | null>(null)
  const [options, setOptions] = useState<string[]>([])
  const [over, setOver] = useState(false)
  const [lastElapsed, setLastElapsed] = useState(0)
  const [board, setBoard] = useState<EndlessScore[]>(() => loadEndlessLeaderboard())
  const [legacySummary, setLegacySummary] = useState(() => getLegacyEndlessLeaderboardSummary())
  const [legacyError, setLegacyError] = useState('')
  const [claimBusy, setClaimBusy] = useState(false)
  const startedAt = useRef(0)
  const recentIds = useRef<string[]>([])
  const busy = useRef(false)
  const correctRef = useRef(0)
  const bestStreakRef = useRef(0)
  const endedRef = useRef(true)
  const previousScope = useRef(wordStudy.scope)

  const stage = useMemo(() => endlessStageInfo(index), [index])

  useEffect(() => {
    unlockSpeech()
  }, [])

  useEffect(() => {
    if (previousScope.current === wordStudy.scope) return
    previousScope.current = wordStudy.scope
    setRunScope(wordStudy.scope)
    setPlaying(false); setOver(false); setCurrent(null)
    setIndex(0); setCorrect(0); setStreak(0); setBestStreak(0)
    endedRef.current = true
  }, [wordStudy.scope])

  useEffect(() => {
    setBoard(loadEndlessLeaderboard())
    setLegacySummary(getLegacyEndlessLeaderboardSummary())
    setLegacyError('')
  }, [wordStudy.scope, auth.user?.uid])

  function deal(nextIndex: number) {
    const w = pickEndlessWord(nextIndex, recentIds.current.slice(-12))
    recentIds.current = [...recentIds.current, w.id].slice(-40)
    const lim = endlessSecondsForIndex(nextIndex)
    setCurrent(w)
    setOptions(shuffle([w.meaning, ...endlessDistractors(w, 3)]))
    setLimitSec(lim)
    setLeftSec(lim)
    setIndex(nextIndex)
    busy.current = false
    void speakWordAsync(w.word)
  }

  function startRun() {
    setRunScope(wordStudy.scope)
    if (!wordBanks.ready) return
    recentIds.current = []
    endedRef.current = false
    correctRef.current = 0
    bestStreakRef.current = 0
    setCorrect(0)
    setStreak(0)
    setBestStreak(0)
    setOver(false)
    setPlaying(true)
    setLastElapsed(0)
    startedAt.current = Date.now()
    deal(0)
  }

  useEffect(() => {
    if (!playing || over || !current) return
    const t = window.setInterval(() => {
      setLeftSec((s) => {
        if (s <= 1) {
          window.clearInterval(t)
          window.setTimeout(() => endRun('timeout'), 0)
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, over, current?.id, index])

  function endRun(reason: 'wrong' | 'timeout') {
    if (endedRef.current || runScope !== wordStudy.scope) return
    endedRef.current = true
    setPlaying(false)
    setOver(true)
    const elapsed = Date.now() - startedAt.current
    setLastElapsed(elapsed)
    const finalCorrect = correctRef.current
    try {
      const list = submitEndlessScore({
        name: displayName,
        correct: finalCorrect,
        elapsedMs: elapsed,
        bestStreak: bestStreakRef.current,
      })
      setBoard(list)
    } catch (error) {
      setBoard(loadEndlessLeaderboard())
      toast(error instanceof Error ? error.message : '成绩未能保存在本机；原有排行榜仍保留。')
    }
    if (reason === 'timeout') toast(`时间到！答对 ${finalCorrect} 词`)
    else toast(`答错了！答对 ${finalCorrect} 词`)
    if (auth.user?.uid && finalCorrect >= 10) {
      grantWordPoints(auth.user.uid, Math.min(5, Math.floor(finalCorrect / 10)))
      toast.ok('无尽奖励：单词积分已入账')
    }
  }

  function pick(meaning: string) {
    if (!playing || over || !current || busy.current || endedRef.current) return
    busy.current = true
    if (meaning !== current.meaning) {
      endRun('wrong')
      return
    }
    const nextCorrect = correctRef.current + 1
    const nextStreak = streak + 1
    correctRef.current = nextCorrect
    bestStreakRef.current = Math.max(bestStreakRef.current, nextStreak)
    setCorrect(nextCorrect)
    setStreak(nextStreak)
    setBestStreak(bestStreakRef.current)
    deal(index + 1)
  }

  function claimLegacyBoard() {
    if (claimBusy) return
    setClaimBusy(true); setLegacyError('')
    const result = restoreLegacyEndlessLeaderboard()
    setClaimBusy(false)
    if (!result.ok || !result.rows) { setLegacyError(result.error || '旧排行榜导入失败；原记录仍保留。'); return }
    setBoard(result.rows)
    setLegacySummary(null)
    toast.ok(`已把旧排行榜归入当前账号，共 ${result.rows.length} 条成绩。`)
  }

  return (
    <div className={styles.page}>
      <PageHeader title="无尽闯关" right={<Link className={styles.headerLink} to="/words">回词库</Link>} />
      <div className={styles.main}>
        <div className={styles.metaRow}>
          <span className={styles.metaPill}>全库不限</span>
          <span className={styles.metaPill}>每 10 题加快 1s · 最低 1s</span>
        </div>

        {!playing && !over ? (
          <section className={styles.startCard}>
            <div className={styles.cardEmoji} aria-hidden="true">🎯</div>
            <b className={styles.startTitle}>无尽闯关</b>
            <p className={styles.startText}>规则：选正确释义；答错或超时结束。第 1–10 题 10 秒，11–20 题 9 秒……减到 1 秒后保持。难度随阶段上升。</p>
            <button type="button" className={styles.primaryBtn} onClick={startRun} disabled={!wordBanks.ready}>
              {wordBanks.ready ? '开始无尽' : '正在读取词库…'}
            </button>
          </section>
        ) : null}

        {playing && current ? (
          <>
            <div className={styles.hud}>
              <span className={`${styles.hudPill} ${styles.hudStage} ${styles.hudFox}`}>{stage.label}</span>
              <span className={`${styles.hudPill} ${styles.hudFox}`}>连对 {streak}</span>
              <span className={`${styles.hudPill} ${styles.hudScore}`}>累计 {correct}</span>
              <span className={`${styles.hudPill} ${leftSec <= 3 ? styles.hudDanger : ''}`}>剩余 {leftSec}s</span>
            </div>
            <section className={styles.quizCard}>
              <b className={styles.word}>{current.word}</b>
              <span className={styles.phonetic}>{current.phonetic}</span>
              <span className={styles.quizMeta}>难度 {current.difficulty}</span>
              <div className={styles.timerTrack}>
                <i
                  className={`${styles.timerFill} ${leftSec <= 3 ? styles.timerLow : ''}`}
                  style={{ width: `${Math.max(0, (leftSec / Math.max(1, limitSec)) * 100)}%` }}
                />
              </div>
              <button type="button" className={styles.speakBtn} onClick={() => void speakWordAsync(current.word)}>
                🔊 朗读
              </button>
            </section>
            <div className={styles.answerGrid}>
              {options.map((m, i) => (
                <button key={m} type="button" className={styles.answerBtn} onClick={() => pick(m)}>
                  <span className={styles.answerKey}>{'ABCD'[i]}</span>
                  <span>{m}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}

        {over ? (
          <section className={styles.resultCard}>
            <div className={styles.resultEmoji} aria-hidden="true">🎯</div>
            <b className={styles.resultTitle}>本局成绩</b>
            <p className={styles.resultText}>
              本局答对 <strong>{correct}</strong> 词 · 用时 {formatElapsed(lastElapsed)} · 最高连对 {bestStreak}
            </p>
            <div className={styles.resultActions}>
              <button type="button" className={styles.primaryBtn} onClick={startRun}>
                再闯一局
              </button>
            </div>
          </section>
        ) : null}

        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>排行榜</h2>
          <span className={styles.sectionHint}>答对多为先 · 同量时更快者靠前</span>
        </div>
        <p className={styles.boardPrivacyNote}>{auth.user?.uid ? '仅当前账号可见 · 只保存在此设备' : '访客排行榜独立保存 · 登录账号后会单独记录'}</p>
        {legacySummary ? <aside className={styles.legacyBoardNotice}>
          <p>发现本机旧排行榜 {legacySummary.count} 条，最高答对 {legacySummary.bestScore} 词。旧记录没有账号归属；确认后会只导入当前账号，其他账号将不能读取这份旧榜。</p>
          <button type="button" className={styles.legacyBoardButton} onClick={claimLegacyBoard} disabled={claimBusy}>{claimBusy ? '正在导入…' : '确认归入当前账号'}</button>
          {legacyError ? <small role="alert">{legacyError}</small> : null}
        </aside> : legacyError ? <p className={styles.legacyBoardError} role="alert">{legacyError}</p> : null}
        {board.length === 0 ? (
          <EmptyState compact title="还没有成绩" hint="来做第一名吧" />
        ) : (
          <div className={styles.boardList}>
            {board.slice(0, 15).map((row, i) => (
              <div key={row.id} className={styles.boardRow}>
                <span className={`${styles.rankBadge} ${i === 0 ? styles.rankTop : ''}`}>#{i + 1}</span>
                <div className={styles.boardBody}>
                  <div className={styles.boardName}>{row.name}</div>
                  <div className={styles.boardSub}>
                    答对 {row.correct} · {formatElapsed(row.elapsedMs)} · 连对 {row.bestStreak}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
