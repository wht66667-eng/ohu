import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useToast } from '../../context/ToastContext'
import { PageHeader } from '../../components/PageHeader'
import {
  WORD_BANK_META,
  type WordBankId,
  type WordDifficulty,
  wordOfId,
  addCustomWord,
  removeCustomWord,
  loadCustomWords,
  parseBulkWords,
  addBulkCustomWords,
} from '../../data/words/banks'
import { reviewCard, reviewStateForBanks } from '../../services/words/srs'
import {
  createPlan,
  deletePlan,
  getActivePlan,
  getActivePlanId,
  listPlans,
  planLabel,
  setActivePlanId,
  type StudyPlan,
} from '../../services/words/plans'
import { canSpeak, speakWordAsync, unlockSpeech } from '../../services/words/speech'
import { foxWordTip } from '../../lib/fox-ai'
import { grantWordPoints } from '../../services/words/rewards'
import { useAuth } from '../../lib/auth'
import { foxAssetUrl } from '../../lib/fox-art'
import { isFoxFreeVariant, useUiVariant } from '../../lib/ui-variant'
import styles from './words.module.css'
import { useDownloadedWordBanks } from '../../lib/useDownloadedWordBanks'
import { DownloadedWordPacks } from './DownloadedWordPacks'
import { useWordStudy } from '../../lib/useWordStudy'
import { WordStudyReadError, WordStudyRecovery } from '../../components/WordStudyRecovery'

const ALL_BANKS = Object.keys(WORD_BANK_META) as WordBankId[]

/** /words 单词记忆：今日任务优先，学习卡居中，计划与词库收纳其后 */
export function WordsPage() {
  const { scope } = useWordStudy()
  return <WordsPageContent key={scope} />
}

function WordsPageContent() {
  const wordBanks = useDownloadedWordBanks()
  const foxfree = isFoxFreeVariant(useUiVariant())
  const [params] = useSearchParams()
  const toast = useToast()
  const auth = useAuth()
  const wordStudy = useWordStudy()
  const uid = auth.user?.uid || ''
  const [planId, setPlanId] = useState(getActivePlanId)
  const [tick, setTick] = useState(0)
  const [showPlanForm, setShowPlanForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newGoal, setNewGoal] = useState(15)
  const [newBanks, setNewBanks] = useState<WordBankId[]>(['cet4'])

  // —— 自定义添加单词 ——
  const [showAddWord, setShowAddWord] = useState(false)
  const [wordInput, setWordInput] = useState('')
  const [phoneticInput, setPhoneticInput] = useState('')
  const [meaningInput, setMeaningInput] = useState('')
  const [diffInput, setDiffInput] = useState<WordDifficulty>(2)
  const [customList, setCustomList] = useState(() => loadCustomWords())
  // —— 批量导入 ——
  const [showBulk, setShowBulk] = useState(false)
  const [bulkText, setBulkText] = useState('')

  const plan = useMemo(() => getActivePlan(), [planId, tick])
  const reviewState = useMemo(() => reviewStateForBanks(plan.bankIds, wordBanks.ready ? plan.dailyGoal : 0), [plan, tick, wordBanks.ready, wordBanks.revision])
  const due = reviewState.cards
  const stats = reviewState.stats
  const current = due[0] ? wordOfId(due[0].wordId) : null
  const [revealed, setRevealed] = useState(false)
  const [foxTip, setFoxTip] = useState('')
  const [foxBusy, setFoxBusy] = useState(false)
  const [speakBusy, setSpeakBusy] = useState(false)
  const foxRequest = useRef<AbortController | null>(null)
  const plans = useMemo(() => listPlans(), [tick, planId])
  const masteredPct = stats.total > 0 ? Math.min(100, Math.round((stats.learned / stats.total) * 100)) : 0

  useEffect(() => {
    unlockSpeech()
  }, [])

  useEffect(() => {
    const refresh = () => setTick(n => n + 1)
    const visible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', refresh)
    window.addEventListener('pageshow', refresh)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pageshow', refresh)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [])

  useEffect(() => {
    setPlanId(getActivePlanId())
    setCustomList(loadCustomWords())
    setTick((n) => n + 1)
  }, [wordStudy.scope, wordStudy.revision])

  useEffect(() => {
    if (!wordBanks.ready || stats.nextDueAt === null) return
    const delay = Math.min(2_147_000_000, Math.max(50, stats.nextDueAt - Date.now() + 20))
    const timer = window.setTimeout(() => setTick(n => n + 1), delay)
    return () => window.clearTimeout(timer)
  }, [wordBanks.ready, stats.nextDueAt, tick])

  useEffect(() => {
    foxRequest.current?.abort(); foxRequest.current = null
    setFoxTip('')
    setFoxBusy(false)
    setRevealed(false)
    return () => { foxRequest.current?.abort(); foxRequest.current = null }
  }, [current?.id])

  if (wordStudy.error) return <WordStudyReadError title="单词记忆" message={wordStudy.error} onRetry={wordStudy.retry} />

  function selectPlan(p: StudyPlan) {
    setActivePlanId(p.id)
    setPlanId(p.id)
    setRevealed(false)
    setTick((n) => n + 1)
  }

  function grade(g: 0 | 1 | 2 | 3) {
    if (!due[0]) return
    try { reviewCard(due[0].wordId, g) }
    catch { toast.err('学习记录保存失败，请检查设备剩余空间后重试'); return }
    setRevealed(false)
    setTick((n) => n + 1)
    if (g >= 2 && uid && Math.random() < 0.35) {
      grantWordPoints(uid, 1)
      toast('记得！单词积分 +1')
    }
  }

  async function speakCurrent() {
    if (!current || speakBusy) return
    setSpeakBusy(true)
    unlockSpeech()
    const ok = await speakWordAsync(current.word)
    setSpeakBusy(false)
    if (!ok) toast.err('朗读失败，请检查网络后重试')
  }

  async function askFoxTip() {
    if (!current || foxBusy) return
    const controller = new AbortController(); foxRequest.current = controller
    const timeout = setTimeout(() => controller.abort(), 45_000)
    setFoxBusy(true)
    try {
      const tip = await foxWordTip(current.word, current.meaning, uid, controller.signal)
      if (foxRequest.current === controller && !controller.signal.aborted) setFoxTip(tip)
      else if (foxRequest.current === controller) toast.err('助记请求超时，请重试')
    } catch { if (foxRequest.current === controller) toast.err('阿狐暂时没想出来，请重试') }
    finally { clearTimeout(timeout); if (foxRequest.current === controller) { foxRequest.current = null; setFoxBusy(false) } }
  }

  function toggleBank(b: WordBankId) {
    setNewBanks((prev) => (prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]))
  }

  function saveCustomPlan() {
    if (!newBanks.length) {
      toast.warn('请至少选一个词库')
      return
    }
    const p = createPlan({ name: newName || '我的计划', bankIds: newBanks, dailyGoal: newGoal })
    setPlanId(p.id)
    setShowPlanForm(false)
    setNewName('')
    setTick((n) => n + 1)
    toast.ok(`已创建计划：${p.name}`)
  }

  function removeCurrentPlan() {
    deletePlan(plan.id)
    setPlanId(getActivePlanId())
    setTick((n) => n + 1)
    toast.ok('已删除自定义计划')
  }

  // —— 自定义添加单词 ——
  function submitCustomWord() {
    const w = wordInput.trim()
    const m = meaningInput.trim()
    if (!w || !m) {
      toast.warn('单词和释义不能为空')
      return
    }
    const before = customList.length
    addCustomWord(w, phoneticInput, m, diffInput)
    const next = loadCustomWords()
    setCustomList(next)
    if (next.length === before) {
      toast.warn('该单词已存在')
    } else {
      toast.ok(`已添加：${w}`)
    }
    setWordInput('')
    setPhoneticInput('')
    setMeaningInput('')
    setTick((n) => n + 1)
  }

  function deleteCustomWord(id: string) {
    removeCustomWord(id)
    setCustomList(loadCustomWords())
    setTick((n) => n + 1)
  }

  function submitBulkImport() {
    const items = parseBulkWords(bulkText)
    if (!items.length) {
      toast.warn('未识别到有效单词，请检查格式')
      return
    }
    const added = addBulkCustomWords(items)
    setCustomList(loadCustomWords())
    setBulkText('')
    setTick((n) => n + 1)
    toast.ok(`成功导入 ${added} 个单词（共识别 ${items.length} 条，重复已跳过）`)
  }

  return (
    <div className={styles.page}>
      <PageHeader title="单词记忆" right={<Link className={styles.headerLink} to="/english">学习中心</Link>} />
      <div className={styles.main}>
        <WordStudyRecovery />
        <section className={styles.todayCard} aria-label="今日学习">
          <span className={styles.todayKicker}>今天的学习 · 遗忘曲线安排</span>
          <h2>{plan.name}</h2>
          <div className={styles.statGrid}>
            <div><b>{stats.due}</b><span>待复习</span></div>
            <div><b>{stats.learned}</b><span>已学</span></div>
            <div><b>{plan.dailyGoal}</b><span>日目标</span></div>
          </div>
          <div className={styles.progress} aria-hidden="true"><i style={{ width: `${masteredPct}%` }} /></div>
          <p className={styles.progressLabel}>词库共 {stats.total} 词 · 已掌握 {masteredPct}%</p>
        </section>
        {wordBanks.error && <p className={styles.formHint} role="status">{wordBanks.error} <button type="button" className={styles.linkBtn} onClick={wordBanks.retry}>重试</button></p>}

        {!wordBanks.ready ? <section className={styles.studyCard} role="status">正在读取本机词库…</section> : current ? (
          <section className={styles.studyCard} aria-label="当前单词">
            <div>
              <b className={styles.word}>{current.word}</b>
              <span className={styles.phonetic}>{current.phonetic}</span>
            </div>
            <div className={styles.wordActions}>
              <button type="button" className={styles.chipBtn} onClick={() => void speakCurrent()} disabled={!canSpeak() || speakBusy}>
                {speakBusy ? '朗读中…' : '🔊 朗读'}
              </button>
              <button type="button" className={styles.chipBtn} onClick={() => void askFoxTip()} disabled={foxBusy}>
                {foxfree ? null : <img src={foxAssetUrl(foxBusy ? 'loading' : 'reading')} width={20} height={20} alt="" />}
                {foxBusy ? '阿狐想着呢…' : '阿狐助记'}
              </button>
            </div>
            {foxTip ? <p className={styles.foxTip}>{foxTip}</p> : null}
            {revealed ? (
              <div><p className={styles.meaning}>{current.meaning}</p>{current.example && <p className={styles.wordExample} lang="en">{current.example}</p>}</div>
            ) : (
              <button type="button" className={styles.primaryBtn} onClick={() => setRevealed(true)}>显示释义</button>
            )}
            {revealed ? (
              <div className={styles.gradeGrid}>
                <button type="button" className={`${styles.gradeBtn} ${styles.gradeForget}`} onClick={() => grade(0)}>忘了</button>
                <button type="button" className={styles.gradeBtn} onClick={() => grade(1)}>犹豫</button>
                <button type="button" className={`${styles.gradeBtn} ${styles.gradeKnow}`} onClick={() => grade(2)}>记得</button>
                <button type="button" className={`${styles.gradeBtn} ${styles.gradeBest}`} onClick={() => grade(3)}>很熟</button>
              </div>
            ) : null}
          </section>
        ) : (
          <section className={styles.doneCard} aria-label="复习安排">
            {foxfree ? null : <img src={foxAssetUrl('reading')} width={88} height={88} alt="" aria-hidden="true" />}
            <b>{stats.total === 0 ? '当前计划还没有单词' : '这些单词还未到下次复习时间'}</b>
            <p>{stats.total === 0 ? '可以选择其他背诵计划，或在下方添加、下载词库。' : stats.nextDueAt !== null ? `${stats.waiting} 个单词等待复习，下一次安排在 ${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(stats.nextDueAt)}。到期后会自动显示学习卡。` : '正在等待下一次复习安排，可以重新检查队列。'}</p>
            <div className={styles.doneLinks}>
              <button type="button" className={styles.primaryBtn} onClick={() => setTick(n => n + 1)}>重新检查复习队列</button>
            </div>
          </section>
        )}

        <div className={styles.gameRow}>
          <Link className={styles.gameCard} to={`/words/duel?bank=${plan.bankIds[0] || 'cet4'}`}><b>⚡ 限时速对</b><span>60 秒快速热身</span></Link>
          <Link className={styles.gameCard} to="/words/endless"><b>🎯 无尽闯关</b><span>积分与排行</span></Link>
        </div>

        <div className={styles.sectionHead}>
          <h2>背诵计划</h2>
          <div className={styles.headActions}>
            {!plan.system ? (
              <button type="button" className={`${styles.linkBtn} ${styles.linkDanger}`} onClick={removeCurrentPlan}>删除计划</button>
            ) : null}
            <button type="button" className={styles.linkBtn} onClick={() => setShowPlanForm((v) => !v)}>
              {showPlanForm ? '收起' : '自定义'}
            </button>
          </div>
        </div>
        <div className={styles.chips}>
          {plans.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`${styles.chip} ${planId === p.id ? styles.chipOn : ''}`}
              onClick={() => selectPlan(p)}
              title={planLabel(p)}
            >
              {p.system ? '' : '★'}
              {p.name}
            </button>
          ))}
        </div>
        {showPlanForm ? (
          <div className={styles.formCard}>
            <input
              className={styles.input}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="计划名称，如：期末突击"
            />
            <div className={styles.chips}>
              {ALL_BANKS.map((b) => (
                <button
                  key={b}
                  type="button"
                  className={`${styles.chip} ${newBanks.includes(b) ? styles.chipOn : ''}`}
                  onClick={() => toggleBank(b)}
                >
                  {WORD_BANK_META[b].name}
                </button>
              ))}
            </div>
            <label>
              每日目标
              <input
                className={styles.inputNum}
                type="number"
                min={5}
                max={50}
                value={newGoal}
                onChange={(e) => setNewGoal(Number(e.target.value) || 15)}
              />
              词
            </label>
            <button type="button" className={`${styles.primaryBtn} ${styles.formSave}`} onClick={saveCustomPlan}>保存我的计划</button>
          </div>
        ) : null}

        <DownloadedWordPacks initiallyOpen={params.get('downloads') === '1'} onInstalled={bank => {
          const matching = listPlans().find(p => p.system && p.bankIds.length === 1 && p.bankIds[0] === bank)
          if (matching) selectPlan(matching)
        }} />

        <div className={styles.sectionHead}>
          <h2>我的单词<small>{customList.length} 词 · 仅保存在本机</small></h2>
          <div className={styles.headActions}>
            <button type="button" className={styles.linkBtn} onClick={() => { setShowBulk((v) => !v); setShowAddWord(false) }}>
              {showBulk ? '收起' : '批量导入'}
            </button>
            <button type="button" className={styles.linkBtn} onClick={() => { setShowAddWord((v) => !v); setShowBulk(false) }}>
              {showAddWord ? '收起' : '+ 添加单词'}
            </button>
          </div>
        </div>
        {showBulk ? (
          <div className={styles.formCard}>
            <textarea
              className={styles.textarea}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={'粘贴单词列表，每行一条，支持格式：\nword /音标/ 释义\nword 释义\nword, 释义'}
            />
            <button type="button" className={`${styles.primaryBtn} ${styles.formSave}`} onClick={submitBulkImport}>一键导入</button>
            <p className={styles.formHint}>示例：abandon /əˈbændən/ v.放弃；或：abandon v.放弃</p>
          </div>
        ) : null}
        {showAddWord ? (
          <div className={styles.formCard}>
            <input className={styles.input} value={wordInput} onChange={(e) => setWordInput(e.target.value)} placeholder="单词，如：abandon" />
            <input className={styles.input} value={phoneticInput} onChange={(e) => setPhoneticInput(e.target.value)} placeholder="音标（可选），如：/əˈbændən/" />
            <input className={styles.input} value={meaningInput} onChange={(e) => setMeaningInput(e.target.value)} placeholder="释义，如：v. 放弃；抛弃" />
            <label>
              难度
              <select
                className={styles.inputNum}
                value={diffInput}
                onChange={(e) => setDiffInput(Number(e.target.value) as WordDifficulty)}
              >
                <option value={1}>1 易</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
                <option value={5}>5 难</option>
              </select>
            </label>
            <button type="button" className={`${styles.primaryBtn} ${styles.formSave}`} onClick={submitCustomWord}>添加到我的单词</button>
            <p className={styles.formHint}>添加后在「自定义」计划里选「我的单词」即可背诵。仅保存在本机，不会上传。</p>
          </div>
        ) : null}
        {customList.length > 0 ? (
          <div className={styles.chips}>
            {customList.map((cw) => (
              <span key={cw.id} className={`${styles.chip} ${styles.wordChip}`} title={cw.meaning}>
                <span>{cw.word}</span>
                <button type="button" aria-label={`删除 ${cw.word}`} onClick={() => deleteCustomWord(cw.id)}>✕</button>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
