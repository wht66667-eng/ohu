import { useMemo, useRef, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../context/ToastContext'
import { PageHeader } from '../../components/PageHeader'
import { ConfirmSheet } from '../../components/ConfirmSheet'
import { generateQuestionsFromText, type GenType, type TransDir } from '../../services/qbank/generate'
import type { ParsedQuestion } from '../../services/qbank/parse'
import { createQuestionsFromImport } from '../../services/qbank/import'
import { createPaper } from '../../services/qbank/papers'
import { importVocabularyFile } from '../../services/qbank/doc'
import { PaidFileGenerator } from './PaidFileGenerator'
import { QBANK_ERRORS } from '../../services/qbank/errors'
import {
  listQuestionsLocal,
  removeQuestionLocal,
  deleteQuestionCloud,
  captureQbankSession,
  isQbankSessionCurrent,
  pullCloud,
} from '../../lib/qbank'
import styles from './english.module.css'
import { EmptyState } from '../../components/ui/StateViews'
import { useQbankRevision } from '../../lib/useQbankRevision'
import { QbankRecovery } from './QbankRecovery'

const COUNTS = [3, 5, 8, 10] as const
const TYPES: { id: GenType; label: string }[] = [
  { id: 'mix', label: '混合' },
  { id: 'single', label: '单选' },
  { id: 'judge', label: '判断' },
  { id: 'trans', label: '互译' },
]
const DIRS: { id: TransDir; label: string }[] = [
  { id: 'both', label: '双向' },
  { id: 'zh2en', label: '中→英' },
  { id: 'en2zh', label: '英→中' },
]

type DraftItem = ParsedQuestion & { _key: number }

/** /english/bank 出题 / 题库（1.2.34） */
export function BankPage() {
  const auth = useAuth()
  return <BankContent key={auth.isSigned ? auth.user?.uid || 'signed' : 'guest'} />
}

function BankContent() {
  const auth = useAuth()
  const toast = useToast()
  const nav = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  const [text, setText] = useState('')
  const [subject, setSubject] = useState('英语')
  const [count, setCount] = useState<number>(5)
  const [gtype, setGtype] = useState<GenType>('mix')
  const [tdir, setTdir] = useState<TransDir>('both')
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<DraftItem[] | null>(null)

  const [tick, setTick] = useState(0)
  const qbankRevision = useQbankRevision()
  const [filter, setFilter] = useState('全部')
  const [q, setQ] = useState('')
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [paperName, setPaperName] = useState('')
  const [delQ, setDelQ] = useState<string | null>(null)

  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  useEffect(() => {
    let alive = true
    setDraft(null)
    setText('')
    setPicked([])
    setPicking(false)
    setDelQ(null)
    setFilter('全部')
    setQ('')
    setPaperName('')
    setBusy(false)
    void pullCloud().then((ok) => { if (alive && ok) setTick((n) => n + 1) })
    return () => { alive = false }
  }, [uid])
  const questions = useMemo(() => listQuestionsLocal(), [tick, qbankRevision])
  const subjects = useMemo(() => {
    const set = new Set(questions.map((x) => x.subject))
    return ['全部', ...[...set]]
  }, [questions])
  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return questions.filter((x) => {
      if (filter !== '全部' && x.subject !== filter) return false
      if (!kw) return true
      return x.stem.toLowerCase().includes(kw) || x.tags.some((t) => t.toLowerCase().includes(kw))
    })
  }, [questions, filter, q])

  async function onGenerate() {
    if (busy) return
    const session = captureQbankSession()
    setBusy(true)
    setDraft(null)
    try {
    const res = await generateQuestionsFromText(text, { count, type: gtype, dir: tdir })
    if (!isQbankSessionCurrent(session)) return
    setBusy(false)
    if (!res.ok) {
      toast.err(res.error || QBANK_ERRORS.modelFail)
      return
    }
    setDraft(res.questions.map((x, i) => ({ ...x, _key: i })))
    } catch { if (isQbankSessionCurrent(session)) toast.err('出题失败，请稍后重试') }
    finally { if (isQbankSessionCurrent(session)) setBusy(false) }
  }

  function editStem(key: number, stem: string) {
    setDraft((d) => (d ? d.map((x) => (x._key === key ? { ...x, stem } : x)) : d))
  }

  function dropDraft(key: number) {
    setDraft((d) => (d ? d.filter((x) => x._key !== key) : d))
  }

  async function saveDraft() {
    if (!draft?.length || busy) return
    const session = captureQbankSession()
    setBusy(true)
    try {
    const res = await createQuestionsFromImport(
      draft.map((x) => ({
        subject: subject.trim() || '未分类',
        sourceType: 'ai',
        qtype: x.qtype,
        stem: x.stem,
        options: x.options,
        answer: x.answer,
        explanation: x.explanation,
        difficulty: x.difficulty,
        tags: x.tags,
        contentHash: x.contentHash,
      })),
      'ai',
    )
    if (!isQbankSessionCurrent(session)) return
    if (res.created === 0) {
      toast.err(QBANK_ERRORS.allDuplicate)
      return
    }
    setDraft(null)
    setText('')
    setTick((n) => n + 1)
    toast.ok(`入库 ${res.created} 题${res.dup ? ` · 重复 ${res.dup}` : ''}`)
    } catch (error) { if (isQbankSessionCurrent(session)) toast.err(error instanceof Error ? error.message : '题目未能保存，请重试') }
    finally { if (isQbankSessionCurrent(session)) setBusy(false) }
  }

  async function onImportFile(file: File) {
    if (busy) return
    const session = captureQbankSession()
    setBusy(true)
    try {
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    if (ext === 'json') {
      const txt = await file.text().catch(() => '')
      if (!isQbankSessionCurrent(session)) return
      const r = await importVocabularyFile(txt)
      if (!isQbankSessionCurrent(session)) return
      setBusy(false)
      if (!r.ok) toast.err(r.error || '导入失败')
      else {
        setTick((n) => n + 1)
        toast.ok(`导入 ${r.created} 道真题词汇题`)
      }
      return
    }
    setBusy(false)
    toast.err('词汇导入请选择 JSON；资料文件请使用下方「文件自动出题」')
    } catch (error) { if (isQbankSessionCurrent(session)) toast.err(error instanceof Error ? error.message : '导入失败，请稍后重试') }
    finally { if (isQbankSessionCurrent(session)) setBusy(false) }
  }

  function togglePick(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  }

  function makePaper() {
    if (picked.length < 2) {
      toast.warn('组卷至少选 2 题')
      return
    }
    try {
    const p = createPaper({ title: paperName.trim() || `${subject.trim() || '英语'}自测卷`, questionIds: picked })
    setPicking(false)
    setPicked([])
    setPaperName('')
    setTick((n) => n + 1)
    toast.ok(`已组卷 · ${p.qids.length} 题`)
    nav(`/english/exam/${p.id}`)
    } catch (error) { toast.err(error instanceof Error ? error.message : '试卷未能保存，请重试') }
  }

  return (
    <div className={styles.page}>
      <PageHeader title="出题 / 题库" />
      <div className={styles.main}>
        <QbankRecovery />
        {/* —— AI 出题 —— */}
        <div className={styles.card}>
          <h3 className={styles.cardTitle}>资料出题</h3>
          <textarea
            className={styles.textarea}
            placeholder="粘贴要背的资料…（课文、笔记、范文）"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={6000}
          />
          <div className={styles.field}>
            <label>分类</label>
            <input className={styles.input} placeholder="如：英语 / 高数" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={20} />
          </div>
          <div className={styles.chips} style={{ marginBottom: 8 }}>
            {COUNTS.map((c) => (
              <button key={c} type="button" className={`${styles.chip} ${count === c ? styles.chipOn : ''}`} onClick={() => setCount(c)}>
                {c} 题
              </button>
            ))}
          </div>
          <div className={styles.chips}>
            {TYPES.map((t) => (
              <button key={t.id} type="button" className={`${styles.chip} ${gtype === t.id ? styles.chipOn : ''}`} onClick={() => setGtype(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          {gtype === 'trans' ? (
            <div className={styles.chips} style={{ marginTop: 8 }}>
              {DIRS.map((d) => (
                <button key={d.id} type="button" className={`${styles.chip} ${tdir === d.id ? styles.chipOn : ''}`} onClick={() => setTdir(d.id)}>
                  {d.label}
                </button>
              ))}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button type="button" className={styles.btnMain} disabled={busy} onClick={() => void onGenerate()}>
              {busy ? '出题中…' : '开始出题'}
            </button>
            <button type="button" className={styles.btnGhost} onClick={() => fileRef.current?.click()}>
              导入词汇 JSON（免费）
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onImportFile(f)
                e.target.value = ''
              }}
            />
            {draft ? (
              <button type="button" className={styles.btnGhost} onClick={() => void saveDraft()}>
                入库 {draft.length} 题
              </button>
            ) : null}
          </div>
          <details className={styles.help}>
            <summary className={styles.helpSummary}>❓ 怎么用？</summary>
            <div className={styles.helpBody}>
              粘贴资料出题及词汇 JSON 导入免费。PDF、Word、TXT 文件使用下方「文件自动出题」，成功后加入同一个题库。
              <br />
              资料只进本人题库，不出 APK。
            </div>
          </details>

          {draft ? (
            <ul className={styles.qList} style={{ marginTop: 12 }}>
              {draft.map((x) => (
                <li key={x._key} className={styles.qRow}>
                  <div className={styles.qBody}>
                    <textarea
                      className={styles.textarea}
                      style={{ minHeight: 52 }}
                      value={x.stem}
                      onChange={(e) => editStem(x._key, e.target.value)}
                    />
                    <div className={styles.qMeta}>
                      <span className={styles.tag}>{x.qtype === 'judge' ? '判断' : '单选'}</span>
                      <span className={styles.tag}>
                        答案：{x.qtype === 'judge' ? (x.answer === 'true' ? '对' : '错') : x.options.find((o) => o.key === x.answer)?.text || x.answer}
                      </span>
                    </div>
                  </div>
                  <button type="button" className={styles.del} aria-label="移除该题" onClick={() => dropDraft(x._key)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <PaidFileGenerator subject={subject} type={gtype} dir={tdir} onSaved={() => setTick(n => n + 1)} />

        {/* —— 题库 —— */}
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>
            题库 {questions.length} 题{filter !== '全部' ? ` · ${filter}` : ''}
          </h2>
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => {
              setPicking((v) => !v)
              setPicked([])
            }}
          >
            {picking ? '退出组卷' : '组卷'}
          </button>
        </div>

        <div className={styles.searchRow}>
          <input className={styles.input} placeholder="搜索题干 / 标签" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className={styles.chips}>
          {subjects.map((s) => (
            <button key={s} type="button" className={`${styles.chip} ${filter === s ? styles.chipOn : ''}`} onClick={() => setFilter(s)}>
              {s}
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <EmptyState
            title={questions.length ? '没有匹配的题' : '题库是空的'}
            hint={questions.length ? '换个关键词试试' : '粘贴资料或导入词汇 JSON，开始免费练习'}
            action={questions.length ? undefined : <button type="button" onClick={() => fileRef.current?.click()}>导入词汇 JSON</button>}
          />
        ) : (
          <ul className={styles.qList}>
            {shown.map((x) => (
              <li key={x.id} className={styles.qRow}>
                {picking ? (
                  <label className={styles.qPick}><input type="checkbox" className={styles.qRowCheck} checked={picked.includes(x.id)} onChange={() => togglePick(x.id)} aria-label="选择该题" /></label>
                ) : null}
                <div className={styles.qBody}>
                  <div className={styles.qStem}>{x.stem}</div>
                  <div className={styles.qMeta}>
                    <span className={styles.tag}>{x.qtype === 'judge' ? '判断' : '单选'}</span>
                    <span className={styles.tag}>{x.subject}</span>
                    {x.sourceType === 'cet4_2025_12' ? <span className={`${styles.tag} ${styles.tagFox}`}>四级真题</span> : null}
                    {x.sourceType === 'ai' ? <span className={styles.tag}>AI</span> : null}
                    {x.sourceType === 'doc' ? <span className={styles.tag}>文档</span> : null}
                  </div>
                </div>
                {!picking ? (
                  <button type="button" className={styles.del} aria-label="删除该题" onClick={() => setDelQ(x.id)}>
                    ×
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {picking ? (
          <div className={styles.bar}>
            <span className={styles.barText}>已选 {picked.length} 题</span>
            <input className={styles.input} style={{ flex: 2 }} placeholder="卷名" value={paperName} onChange={(e) => setPaperName(e.target.value)} maxLength={24} />
            <button type="button" className={styles.btnMain} onClick={makePaper}>
              生成试卷
            </button>
          </div>
        ) : null}
      </div>

      {delQ ? (
        <ConfirmSheet
          title="删除这道题？"
          desc="已组好的试卷会自动移除这道题。"
          danger
          confirmText="删除"
          onConfirm={() => {
            const id = delQ
            setDelQ(null)
            try {
              removeQuestionLocal(id)
              void deleteQuestionCloud(id)
              setTick((n) => n + 1)
              toast.ok('已删除')
            } catch (error) { toast.err(error instanceof Error ? error.message : '未能删除，请重试') }
          }}
          onClose={() => setDelQ(null)}
        />
      ) : null}
    </div>
  )
}
