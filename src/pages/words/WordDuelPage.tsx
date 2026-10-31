import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useToast } from '../../context/ToastContext'
import { WORD_BANK_META, type WordBankId } from '../../data/words/banks'
import { distractors, randomDuelWords, reviewCard } from '../../services/words/srs'
import { speakWordAsync, unlockSpeech } from '../../services/words/speech'
import { grantWordPoints } from '../../services/words/rewards'
import { useAuth } from '../../lib/auth'
import { PageHeader } from '../../components/PageHeader'
import styles from './wordplay.module.css'
import { useDownloadedWordBanks } from '../../lib/useDownloadedWordBanks'
import { useWordStudy } from '../../lib/useWordStudy'

const PER_WORD_SEC = 10

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function WordDuelPage() {
  const wordBanks = useDownloadedWordBanks()
  const toast = useToast()
  const auth = useAuth()
  const wordStudy = useWordStudy()
  const uid = auth.user?.uid || ''
  const [params] = useSearchParams()
  const rawBank = params.get('bank') as WordBankId | null
  const bank: WordBankId = rawBank && rawBank in WORD_BANK_META ? rawBank : 'cet4'

  const [seed, setSeed] = useState(0)
  const [round, setRound] = useState(0)
  const [score, setScore] = useState(0)
  const [done, setDone] = useState(false)
  const [runScope, setRunScope] = useState(wordStudy.scope)
  const [leftSec, setLeftSec] = useState(PER_WORD_SEC)
  const deck = useMemo(() => wordBanks.ready ? randomDuelWords(bank, 8) : [], [bank, seed, wordBanks.ready, wordBanks.revision])
  const current = deck[round]
  const options = useMemo(() => {
    if (!current) return []
    return shuffle([current.meaning, ...distractors(current.id, bank, 3)])
  }, [current, bank, round])
  const answering = useRef(false)
  const previousScope = useRef(wordStudy.scope)

  useEffect(() => {
    unlockSpeech()
  }, [])

  useEffect(() => {
    if (previousScope.current === wordStudy.scope) return
    previousScope.current = wordStudy.scope
    setRunScope(wordStudy.scope)
    setRound(0); setScore(0); setDone(false); setSeed((value) => value + 1)
  }, [wordStudy.scope])

  useEffect(() => {
    if (!current || done) return
    void speakWordAsync(current.word)
    setLeftSec(PER_WORD_SEC)
    answering.current = false
  }, [current?.id, done])

  useEffect(() => {
    if (done || !current) return
    const t = window.setInterval(() => {
      setLeftSec((s) => {
        if (s <= 1) {
          window.clearInterval(t)
          // 超时算错，进入下一题
          window.setTimeout(() => advance(false, true), 0)
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, done, seed, current?.id])

  function finish(nextScore: number) {
    if (runScope !== wordStudy.scope) return
    setScore(nextScore)
    setDone(true)
    if (uid && nextScore >= 5) {
      grantWordPoints(uid, 2)
      toast(`速对结束 ${nextScore}/${deck.length}，单词积分 +2`)
    } else toast(`速对结束 ${nextScore}/${deck.length}`)
  }

  function advance(ok: boolean, timeout = false) {
    if (answering.current || done || runScope !== wordStudy.scope) return
    answering.current = true
    if (current) reviewCard(current.id, ok ? 3 : 0)
    const nextScore = score + (ok ? 1 : 0)
    if (timeout) toast.err(`超时！${current?.meaning || ''}`)
    else if (ok) toast('正确！')
    else toast(`错了：${current?.meaning}`)
    if (round + 1 >= deck.length) {
      finish(nextScore)
      return
    }
    setScore(nextScore)
    setRound((r) => r + 1)
  }

  function pick(meaning: string) {
    if (!current || done) return
    advance(meaning === current.meaning)
  }

  return (
    <div className={styles.page}>
      <PageHeader title="单词速对" right={<Link className={styles.headerLink} to="/words">回词库</Link>} />
      <div className={styles.main}>
        {!wordBanks.ready && <p role="status">正在读取本机词库…</p>}
        <div className={styles.metaRow}>
          <span className={styles.metaPill}>{WORD_BANK_META[bank].name}</span>
          <span className={styles.metaPill}>每词 {PER_WORD_SEC}s</span>
        </div>

        {!done && current ? (
          <>
            <div className={styles.hud}>
              <span className={styles.hudPill}>第 {Math.min(round + 1, deck.length)}/{deck.length} 题</span>
              <span className={`${styles.hudPill} ${leftSec <= 3 ? styles.hudDanger : ''}`}>剩余 {leftSec}s</span>
              <span className={`${styles.hudPill} ${styles.hudScore}`}>得分 {score}</span>
            </div>
            <section className={styles.quizCard}>
              <b className={styles.word}>{current.word}</b>
              <span className={styles.phonetic}>{current.phonetic}</span>
              <div className={styles.timerTrack}>
                <i
                  className={`${styles.timerFill} ${leftSec <= 3 ? styles.timerLow : ''}`}
                  style={{ width: `${Math.max(0, (leftSec / PER_WORD_SEC) * 100)}%` }}
                />
              </div>
              <button type="button" className={styles.speakBtn} onClick={() => void speakWordAsync(current.word)}>
                🔊 再听一遍
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

        {done ? (
          <section className={styles.resultCard}>
            <div className={styles.resultEmoji} aria-hidden="true">⚡</div>
            <b className={styles.resultTitle}>本局成绩</b>
            <div className={styles.resultScore}>{score}<small>/{deck.length}</small></div>
            <p className={styles.resultText}>{score >= 5 ? '奖励已进背包' : '再练一轮冲击 5 分领奖'}</p>
            <div className={styles.resultActions}>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => {
                  setRound(0)
                  setScore(0)
                  setDone(false)
                  setSeed((n) => n + 1)
                }}
              >
                再来一局
              </button>
              <Link className={styles.ghostBtn} to="/words/endless">
                挑战无尽闯关
              </Link>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}
