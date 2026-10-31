import { useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { PageHeader } from '../../components/PageHeader'
import { ConfirmSheet } from '../../components/ConfirmSheet'
import { FoxInline } from '../../components/fox/FoxInline'
import { FoxPaw } from '../../components/fox/FoxMarks'
import { FocusDialog } from '../../components/focus/FocusInteractions'
import { FocusIcon } from '../../components/focus/FocusIcon'
import { useAuth } from '../../lib/auth'
import { useUiVariant } from '../../lib/ui-variant'
import { useUiMotion } from '../../lib/motion-pref'
import { fadeUp } from '../../lib/animations'
import ui from '../../components/focus/focus-interactions.module.css'
import styles from './goals.module.css'

type Goal = { id: string; title: string; note: string; date: string; done: boolean; encouraged: boolean; createdAt: string }
type Draft = Pick<Goal, 'title' | 'note' | 'date'> & { id?: string }
const PREFIX = 'study.goals.local.v1:'
function readGoals(scope: string): Goal[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PREFIX + scope) || '[]')
    if (!Array.isArray(value)) return []
    return value.filter((goal): goal is Goal => !!goal && typeof goal.id === 'string' && typeof goal.title === 'string' && typeof goal.note === 'string' && typeof goal.date === 'string' && typeof goal.done === 'boolean' && typeof goal.encouraged === 'boolean' && typeof goal.createdAt === 'string').slice(0, 100)
  } catch { return [] }
}

/** Personal goals are explicitly local; no social counts or cloud writes. */
export function StudyGoalsPage() {
  const auth = useAuth()
  const scope = auth.isSigned && auth.user?.uid ? auth.user.uid : 'guest'
  return <GoalsForAccount key={scope} scope={scope} />
}

function GoalsForAccount({ scope }: { scope: string }) {
  const variant = useUiVariant()
  const cute = variant === 'cute'
  const reduce = useUiMotion()
  const id = useId()
  const [goals, setGoals] = useState(() => readGoals(scope))
  const [tab, setTab] = useState<'open' | 'done'>('open')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [askDelete, setAskDelete] = useState<Goal | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const visible = useMemo(() => goals.filter((goal) => goal.done === (tab === 'done')), [goals, tab])
  const doneCount = goals.filter((goal) => goal.done).length

  function persist(next: Goal[], message: string) {
    try {
      localStorage.setItem(PREFIX + scope, JSON.stringify(next))
      setGoals(next)
      setError('')
      setNotice(message)
      return true
    } catch { setError('本机保存失败，请检查存储空间后重试。'); return false }
  }
  function save() {
    if (!draft) return
    if (!draft.title.trim()) { setError('先给目标起一个名字吧'); return }
    if (draft.date && !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) { setError('请选择有效日期'); return }
    if (!draft.id && goals.length >= 100) { setError('最多保留 100 个目标，可先整理已完成记录。'); return }
    const fields = { title: draft.title.trim().slice(0, 60), note: draft.note.trim().slice(0, 160), date: draft.date }
    const next = draft.id ? goals.map((goal) => goal.id === draft.id ? { ...goal, ...fields } : goal) : [{ ...fields, id: crypto.randomUUID(), done: false, encouraged: false, createdAt: new Date().toISOString() }, ...goals]
    if (persist(next, draft.id ? '目标已更新' : cute ? '小目标种下啦～' : '目标已添加')) setDraft(null)
  }
  function toggleDone(goal: Goal) {
    persist(goals.map((item) => item.id === goal.id ? { ...item, done: !item.done } : item), goal.done ? '目标已重新打开' : cute ? '又向前走了一步，真棒～' : '目标已完成')
  }
  function encourage(goal: Goal) {
    persist(goals.map((item) => item.id === goal.id ? { ...item, encouraged: !item.encouraged } : item), goal.encouraged ? '已收起鼓励' : cute ? '给努力的自己一枚小爪印～' : '已给自己鼓励')
  }

  return <div className={styles.page}>
    <PageHeader title="目标墙" right={<button type="button" className={ui.primaryButton} onClick={() => { setError(''); setDraft({ title: '', note: '', date: '' }) }}><FocusIcon name="plus" size={18} />新目标</button>} />
    <div className={styles.content}>
      <section className={styles.intro}>
        <div><span className={styles.eyebrow}>一点一滴，积攒成长</span><h2>{cute ? '把小目标，慢慢变成现实～' : '专注于下一步'}</h2><p>目标保存在本机，按当前账号分别记录。</p></div>
        {cute ? <span className={styles.introLeaf} aria-hidden="true"><svg viewBox="0 0 64 64"><path d="M9 51C4 20 22 8 55 10C55 40 37 61 9 51Z" fill="var(--leaf)" /><path d="M13 49L46 19M24 39L23 24M35 28L48 30" fill="none" stroke="var(--green)" strokeWidth="3" strokeLinecap="round" /></svg></span> : null}
      </section>
      <div className={styles.summary}><div><span>进行中</span><strong>{goals.length - doneCount}</strong></div><div><span>已达成</span><strong>{doneCount}</strong></div><Link to="/study/focus"><FocusIcon name="timer" size={20} />去专注</Link></div>
      <div className={styles.tabs} role="group" aria-label="目标状态">{(['open', 'done'] as const).map((key) => <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>{key === 'open' ? '正在成长' : '已完成'}</button>)}</div>
      <p className={styles.notice} role="status">{notice}</p>
      {error && !draft ? <p className={styles.error} role="alert">{error}</p> : null}
      <AnimatePresence initial={false} mode="wait"><motion.div key={tab} className={styles.wall} {...fadeUp(reduce)}>
        {visible.length ? visible.map((goal) => <article key={goal.id} className={`${styles.goal} ${goal.done ? styles.goalDone : ''}`}>
          <div className={styles.goalTop}><span className={styles.goalLabel}>{goal.done ? '已达成' : '个人目标'}</span><button type="button" className={ui.iconButton} aria-label={`编辑目标：${goal.title}`} onClick={() => { setError(''); setDraft({ id: goal.id, title: goal.title, note: goal.note, date: goal.date }) }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5L19 9M5 19L9 18L20 7L17 4L6 15Z" /></svg></button></div>
          <h3>{goal.title}</h3>{goal.note ? <p>{goal.note}</p> : null}
          {goal.date ? <span className={styles.date}>计划日期 <time dateTime={goal.date}>{goal.date.replaceAll('-', '.')}</time></span> : <span className={styles.date}>按自己的节奏来</span>}
          <div className={styles.goalActions}><motion.button type="button" className={styles.encourage} aria-pressed={goal.encouraged} aria-label={`${goal.encouraged ? '收起' : '给自己'}鼓励：${goal.title}`} onClick={() => encourage(goal)} whileTap={reduce ? undefined : { scale: cute ? .96 : .98 }} transition={{ duration: cute ? .35 : .24, ease: cute ? [.34, 1.56, .64, 1] : [.22, 1, .36, 1] }}>{cute ? <FoxPaw size={18} /> : <FocusIcon name="check" size={18} />}{goal.encouraged ? '已鼓励自己' : '给自己鼓励'}</motion.button><button type="button" className={styles.complete} aria-label={`${goal.done ? '重新打开' : '完成'}目标：${goal.title}`} onClick={() => toggleDone(goal)}><FocusIcon name={goal.done ? 'plus' : 'check'} size={18} />{goal.done ? '重新打开' : '标为完成'}</button><button type="button" className={ui.iconButton} aria-label={`删除目标：${goal.title}`} onClick={() => setAskDelete(goal)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7H20M10 3H14M6 7L7 21H17L18 7M10 11V17M14 11V17" /></svg></button></div>
        </article>) : <div className={styles.empty}><FoxInline variant="empty" size={cute ? 88 : 40} text={cute ? tab === 'done' ? '长大的小目标，会留在这里～' : '种下一片小目标吧～' : tab === 'done' ? '暂无完成记录' : '还没有目标'} sub="从一件今天能做的小事开始" action={tab === 'open' ? { label: '添加目标', onClick: () => { setError(''); setDraft({ title: '', note: '', date: '' }) } } : undefined} /></div>}
      </motion.div></AnimatePresence>
      <p className={styles.storageNote}>“鼓励”是给自己的标记，不是公开点赞。此处目标暂不跨设备同步。</p>
    </div>
    <AnimatePresence>{draft ? <FocusDialog title={draft.id ? '编辑目标' : '添加目标'} onClose={() => { setDraft(null); setError('') }}>
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); save() }}>
        <label className={ui.field} htmlFor={`${id}-title`}><span className={ui.fieldLabel}>目标名称</span><input id={`${id}-title`} autoFocus maxLength={60} value={draft.title} placeholder="例如：读完这本书" aria-invalid={!!error && !draft.title.trim()} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label className={ui.field} htmlFor={`${id}-note`}><span className={ui.fieldLabel}>下一小步（选填）</span><textarea id={`${id}-note`} maxLength={160} rows={3} value={draft.note} placeholder="写下一个具体、能做到的行动" onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
        <label className={ui.field} htmlFor={`${id}-date`}><span className={ui.fieldLabel}>计划日期（选填）</span><input id={`${id}-date`} type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <div className={ui.dialogFooter}><button type="button" className={ui.secondaryButton} onClick={() => { setDraft(null); setError('') }}>取消</button><button type="submit" className={ui.primaryButton}>保存目标</button></div>
      </form>
    </FocusDialog> : null}</AnimatePresence>
    {askDelete ? <ConfirmSheet title="删除这个目标？" desc={askDelete.title} danger confirmText="删除" onClose={() => setAskDelete(null)} onConfirm={() => { if (persist(goals.filter((goal) => goal.id !== askDelete.id), '目标已删除')) setAskDelete(null) }} /> : null}
  </div>
}
