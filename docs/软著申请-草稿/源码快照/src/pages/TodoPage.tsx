/**
 * 我的待办 /todo
 *
 * 把作业、工作任务放进清单：支持备注与到期时间。
 * - 顶部分段切换：今日（含逾期）/ 未完成 / 已完成，带数量角标
 * - 新建 / 编辑底部弹层；左圆形勾选完成 / 取消完成
 * - 左滑删除、⌘/Ctrl+N 新建、未完成/今日拖拽排序
 * - 临期待办由首页打开应用时的提醒弹窗 + 站内通知（kind=todo_due）负责
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import { PageHeader } from '../components/PageHeader'
import { TodoEmpty } from '../components/Illustrations/TodoEmpty'
import { FoxInline } from '../components/fox/FoxInline'
import { FoxPaw } from '../components/fox/FoxMarks'
import { StudyFoxCompanion } from '../components/fox/StudyFoxCompanion'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { NoticeTodoSheet, safeTodoLink } from '../components/NoticeTodoSheet'
import { useAuth } from '../lib/auth'
import { usePollingRows } from '../lib/hooks'
import { useToast } from '../context/ToastContext'
import { createTodo, deleteTodo, fetchTodos, updateTodo, type TodoRow } from '../lib/todo'
import {
  CAP_MAX,
  CAP_MIN,
  DEFAULT_LOAD,
  LOAD_LEVELS,
  computeLoad,
  getLoadCap,
  loadHint,
  loadLabel,
  normLoad,
  pullLoadCap,
  pushLoadCap,
  setLoadCap,
  wouldExceed,
  type LoadValue,
} from '../lib/todo-energy'
import {
  convertIdeaToTodo,
  createGrowthIdea,
  deleteGrowthIdea,
  fetchGrowthIdeas,
  updateGrowthIdea,
  type GrowthIdea,
} from '../lib/growth-pool'
import { barPct, buildBoard } from '../lib/todo-insights'
import { fmtDuration } from '../lib/focus-stats'
import {
  getTodoLeadMinutes,
  isTodoRemindEnabled,
  rescheduleTodoReminders,
  setTodoLeadMinutes,
  setTodoRemindEnabled,
  syncTodoRemindCache,
} from '../lib/todo-remind'
import { loadTodoOrderLocal, pullTodoOrder, pushTodoOrder } from '../lib/todo-order'
import { captureQbankSession, isQbankSessionCurrent } from '../lib/qbank'
import { useQbankRevision } from '../lib/useQbankRevision'
import { useUiVariant } from '../lib/ui-variant'
import { useUiMotion } from '../lib/motion-pref'
import { ErrorState } from '../components/ui/StateViews'
import me from './me.module.css'
import s from './todo.module.css'

type TabKey = 'today' | 'open' | 'done' | 'pool'

interface Draft {
  id: number
  title: string
  note: string
  due: string
  load: LoadValue
}

const SWIPE_THRESHOLD = 60

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function dayKeyOf(d: Date) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function todayKey() {
  return dayKeyOf(new Date())
}

function applyOrder(rows: TodoRow[], order: number[]): TodoRow[] {
  if (!order.length) return rows
  const rank = new Map(order.map((id, i) => [id, i]))
  return [...rows].sort((a, b) => {
    const ha = rank.has(a.id)
    const hb = rank.has(b.id)
    if (ha && hb) return rank.get(a.id)! - rank.get(b.id)!
    if (ha) return -1
    if (hb) return 1
    // 未进自定义排序的项：保持调用方已排好的 byDue 相对顺序（稳定排序）
    return 0
  })
}

/** ISO → datetime-local 的本地值（YYYY-MM-DDTHH:mm） */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 到期时间 → 展示文案 */
function dueText(iso: string | null): { text: string; cls: string } {
  if (!iso) return { text: '', cls: '' }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { text: '', cls: '' }
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const now = new Date()
  if (dayKeyOf(d) === dayKeyOf(now)) return { text: `今天 ${hm}`, cls: s.dueToday }
  if (d.getTime() < now.getTime()) return { text: `已逾期 ${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`, cls: s.dueOverdue }
  return { text: `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`, cls: s.dueFuture }
}

export function TodoPage() {
  useQbankRevision()
  const session = captureQbankSession()
  return <TodoAccountPage key={`${session.uid}:${session.revision}`} />
}

function TodoAccountPage() {
  const nav = useNavigate()
  const auth = useAuth()
  const toast = useToast()
  const uiVariant = useUiVariant()
  const cute = uiVariant === 'cute'
  const minimal = uiVariant === 'minimal'
  const reduce = useUiMotion()
  const signed = !!auth.isSigned
  const [tab, setTab] = useState<TabKey>('today')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [noticeOpen, setNoticeOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [order, setOrder] = useState<number[]>(() => loadTodoOrderLocal())
  const [openSwipe, setOpenSwipe] = useState<number | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const dragFrom = useRef<number | null>(null)
  /** 拖拽进行中禁止左滑，避免与排序抢手势 */
  const draggingRef = useRef(false)
  /** 每日负荷上限（点） */
  const [cap, setCapState] = useState<number>(() => getLoadCap())
  const [ideas, setIdeas] = useState<GrowthIdea[]>([])
  const [ideaDraft, setIdeaDraft] = useState<{ title: string; note: string; load: LoadValue } | null>(null)
  const [askDropIdea, setAskDropIdea] = useState<GrowthIdea | null>(null)
  /** 看板的专注数据来自本地台账，回页面 / 专注结束都要重算 */
  const [boardTick, setBoardTick] = useState(0)
  /** 勾掉一件时给小狐狸一个庆祝瞬间（仅软萌几何） */
  const [celebrate, setCelebrate] = useState(false)
  useEffect(() => {
    if (!celebrate) return
    const timeout = window.setTimeout(() => setCelebrate(false), 2600)
    return () => window.clearTimeout(timeout)
  }, [celebrate])
  const uid = auth.user?.uid || ''

  const { rows, error, loading, reload } = usePollingRows<TodoRow>(
    async () => {
      const session = captureQbankSession()
      if (!signed || !uid || session.uid !== uid) return { rows: [], error: null }
      const result = await fetchTodos()
      if (!isQbankSessionCurrent(session)) return { rows: [], error: null }
      if (!result.error && !syncTodoRemindCache(result.rows, session)) return { ...result, error: '待办提醒镜像保存失败，请检查本机存储后重试' }
      return result
    },
    [signed, uid],
  )

  useEffect(() => {
    if (!signed || !uid) return
    let alive = true
    void pullTodoOrder(uid).then((ids) => {
      if (alive && ids.length) setOrder(ids)
    })
    void pullLoadCap(uid).then((c) => {
      if (alive) setCapState(c)
    })
    return () => {
      alive = false
    }
  }, [signed, uid])

  /* —— 成长池：想法列表 —— */
  const reloadIdeas = useCallback(async () => {
    const session = captureQbankSession()
    if (!signed || !uid || session.uid !== uid) {
      setIdeas([])
      return
    }
    const res = await fetchGrowthIdeas()
    if (!isQbankSessionCurrent(session)) return
    if (res.error) {
      toast.err(res.error)
      return
    }
    setIdeas(res.rows)
  }, [signed, uid, toast])

  useEffect(() => {
    void reloadIdeas()
  }, [reloadIdeas])

  // 从专注页返回时本地专注台账已变，回前台重算看板
  useEffect(() => {
    const bump = () => setBoardTick((n) => n + 1)
    window.addEventListener('focus', bump)
    return () => window.removeEventListener('focus', bump)
  }, [])

  /* —— 待办闹钟：与上课提醒同一套系统闹钟，独立开关与提前量 —— */
  const [remindOn, setRemindOn] = useState(() => isTodoRemindEnabled())
  const [leadMin, setLeadMin] = useState(() => getTodoLeadMinutes())

  // The successful fetch above owns the mirror; never mirror stale rows from a prior UID.
  useEffect(() => {
    if (!signed || loading || error || captureQbankSession().uid !== uid) return
    void rescheduleTodoReminders().catch(() => toast.warn('待办提醒更新失败，请检查通知权限后重试'))
  }, [rows, remindOn, leadMin, signed, uid, loading, error, toast])

  function onToggleRemind(on: boolean) {
    setRemindOn(on)
    setTodoRemindEnabled(on)
    void rescheduleTodoReminders().then((r) => {
      if (r.message) toast(r.message)
    }).catch(() => toast.warn('待办提醒更新失败，请重试'))
  }

  function onChangeLead(m: number) {
    setLeadMin(m)
    setTodoLeadMinutes(m)
    if (remindOn) void rescheduleTodoReminders().catch(() => toast.warn('待办提醒更新失败，请重试'))
  }

  const groups = useMemo(() => {
    const open = rows.filter((r) => !r.done)
    const done = rows.filter((r) => r.done)
    const tk = todayKey()
    const today = open.filter((r) => r.due_at && dayKeyOf(new Date(r.due_at)) === tk)
    const overdue = open.filter((r) => r.due_at && new Date(r.due_at).getTime() < Date.now())
    const byDue = (a: TodoRow, b: TodoRow) => {
      const ta = a.due_at ? new Date(a.due_at).getTime() : Number.POSITIVE_INFINITY
      const tb = b.due_at ? new Date(b.due_at).getTime() : Number.POSITIVE_INFINITY
      if (ta !== tb) return ta - tb
      return String(b.created_at || '').localeCompare(String(a.created_at || ''))
    }
    const todayIds = new Set(today.map((r) => r.id))
    const overdueOnly = overdue.filter((r) => !todayIds.has(r.id))
    const todayList = applyOrder([...today, ...overdueOnly].sort(byDue), order)
    const openList = applyOrder([...open].sort(byDue), order)
    return {
      today: todayList,
      open: openList,
      done: [...done].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))),
      todayCount: today.length + overdueOnly.length,
      openCount: open.length,
      doneCount: done.length,
    }
  }, [rows, order])

  /** 今日负荷：未完成且（今天到期 / 已逾期 / 没设到期）的负荷之和 */
  const load = useMemo(() => computeLoad(rows, cap), [rows, cap])
  const board = useMemo(() => buildBoard(rows, 7), [rows, boardTick])
  const poolOpen = useMemo(
    () => ideas.filter((i) => i.status === 'parked').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
    [ideas],
  )
  const poolDone = useMemo(
    () => ideas.filter((i) => i.status !== 'parked').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
    [ideas],
  )

  const list = tab === 'today' ? groups.today : tab === 'open' ? groups.open : groups.done
  const canDrag = tab === 'today' || tab === 'open'

  function onChangeCap(next: number) {
    const c = setLoadCap(next)
    setCapState(c)
    void pushLoadCap(uid, c)
  }

  function openNew() {
    setDraft({ id: 0, title: '', note: '', due: '', load: DEFAULT_LOAD })
  }

  function openEdit(row: TodoRow) {
    setDraft({ id: row.id, title: row.title, note: row.note, due: isoToLocalInput(row.due_at), load: normLoad(row.load) })
  }

  /* —— 成长池：记想法 / 转待办 / 放回池里 —— */

  function openIdeaNew(preset = '') {
    setIdeaDraft({ title: preset, note: '', load: DEFAULT_LOAD })
  }

  async function saveIdea() {
    if (!ideaDraft) return
    const title = ideaDraft.title.trim()
    if (!title) {
      toast('先写一下想做的事')
      return
    }
    setBusy(true)
    const res = await createGrowthIdea({ title, note: ideaDraft.note.trim(), load: ideaDraft.load })
    setBusy(false)
    if (res.error) {
      toast.err(res.error)
      return
    }
    setIdeaDraft(null)
    toast.ok('已放进成长池')
    await reloadIdeas()
  }

  async function parkTodoBack(row: TodoRow) {
    // 把待办退回成长池：想法先落地，再删待办，避免两头都空
    const res = await createGrowthIdea({ title: row.title, note: row.note || '', load: row.load })
    if (res.error) {
      toast.err(res.error)
      return
    }
    const del = await deleteTodo(row.id)
    if (del.error) {
      toast.err(del.error)
      await reloadIdeas()
      return
    }
    persistOrder(order.filter((id) => id !== row.id))
    toast.ok('已放回成长池')
    await reloadIdeas()
    reload()
  }

  async function convertIdea(idea: GrowthIdea) {
    setBusy(true)
    const r = await convertIdeaToTodo(idea)
    setBusy(false)
    if (r.error) {
      toast.err(r.error)
      return
    }
    toast.ok('已转成待办')
    await reloadIdeas()
    const latest = await fetchTodos()
    if (!latest.error) syncOrderAfterMutation(latest.rows)
    reload()
  }

  async function dropIdea(idea: GrowthIdea) {
    const res = await deleteGrowthIdea(idea.id)
    if (res.error) {
      toast.err(res.error)
      return
    }
    setIdeas((prev) => prev.filter((i) => i.id !== idea.id))
    toast.ok('已移出成长池')
  }

  async function reopenIdea(idea: GrowthIdea) {
    const res = await updateGrowthIdea(idea.id, { status: 'parked', todo_id: null })
    if (res.error) {
      toast.err(res.error)
      return
    }
    await reloadIdeas()
  }

  function persistOrder(ids: number[]) {
    setOrder(ids)
    void pushTodoOrder(uid, ids)
  }

  function syncOrderAfterMutation(nextRows?: TodoRow[]) {
    const ids = (nextRows ?? rows).filter((r) => !r.done).map((r) => r.id)
    const merged = [...order.filter((id) => ids.includes(id)), ...ids.filter((id) => !order.includes(id))]
    persistOrder(merged)
  }

  async function saveDraft() {
    if (!draft) return
    const title = draft.title.trim()
    if (!title) {
      toast('先写一下待办内容吧')
      return
    }
    setBusy(true)
    const dueIso = draft.due ? new Date(draft.due).toISOString() : ''
    const res = draft.id
      ? await updateTodo(draft.id, { title, note: draft.note.trim(), due_at: dueIso, load: draft.load })
      : await createTodo({ title, note: draft.note.trim(), due_at: dueIso, load: draft.load })
    setBusy(false)
    if (res.error) {
      toast.err(res.error)
      return
    }
    setDraft(null)
    // 超限只提醒、不拦人：负荷系统的意义是让你看见，不是替你做决定
    if (load.over) toast.warn('今天已经排超了，记得留点余量')
    toast(draft.id ? '已保存' : '已加入待办')
    const latest = await fetchTodos()
    if (!latest.error) syncOrderAfterMutation(latest.rows)
    else syncOrderAfterMutation()
    reload()
  }

  async function toggle(row: TodoRow) {
    const nextDone = !row.done
    const res = await updateTodo(row.id, { done: nextDone })
    if (res.error) {
      toast.err(res.error)
      return
    }
    syncOrderAfterMutation()
    reload()
    if (nextDone && cute) setCelebrate(true)
  }

  /* 删除待办不可逆：先确认再删，避免左滑误触丢数据 */
  const [askDel, setAskDel] = useState<TodoRow | null>(null)

  async function remove(row: TodoRow) {
    const res = await deleteTodo(row.id)
    if (res.error) {
      toast.err(res.error)
      return
    }
    persistOrder(order.filter((id) => id !== row.id))
    setOpenSwipe(null)
    toast.ok('已删除')
    reload()
  }

  /* C3：⌘N / Ctrl+N */
  useEffect(() => {
    if (!signed) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if ((e.metaKey || e.ctrlKey) && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault()
        openNew()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [signed])

  function onItemPointerDown(e: ReactPointerEvent, row: TodoRow) {
    if (draggingRef.current || dragId != null) return
    if ((e.target as HTMLElement).closest('[data-drag-handle]')) return
    if (openSwipe != null && openSwipe !== row.id) setOpenSwipe(null)
    const startX = e.clientX
    const startY = e.clientY
    let moved = false
    let swiping = false
    const el = e.currentTarget as HTMLElement
    const onMove = (ev: PointerEvent) => {
      if (draggingRef.current) {
        el.style.transform = ''
        return
      }
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!moved && Math.abs(dx) + Math.abs(dy) < 6) return
      moved = true
      if (!swiping) {
        if (Math.abs(dy) > Math.abs(dx)) return
        swiping = true
      }
      const tx = Math.min(0, Math.max(-88, dx))
      el.style.transform = `translateX(${tx}px)`
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (draggingRef.current) {
        el.style.transform = ''
        return
      }
      const dx = ev.clientX - startX
      if (swiping && dx <= -SWIPE_THRESHOLD) {
        el.style.transform = 'translateX(-88px)'
        setOpenSwipe(row.id)
      } else {
        el.style.transform = ''
        if (openSwipe === row.id) setOpenSwipe(null)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function onDragHandlePointerDown(e: ReactPointerEvent, row: TodoRow, index: number) {
    if (!canDrag) return
    e.stopPropagation()
    e.preventDefault()
    setOpenSwipe(null)
    const startY = e.clientY
    let armed = false
    const timer = window.setTimeout(() => {
      armed = true
      draggingRef.current = true
      dragFrom.current = index
      setDragId(row.id)
    }, 300)
    const onMove = (ev: PointerEvent) => {
      if (!armed) {
        if (Math.abs(ev.clientY - startY) > 8) {
          window.clearTimeout(timer)
        }
        return
      }
      const under = document.elementsFromPoint(ev.clientX, ev.clientY).find((n) => n instanceof HTMLElement && n.dataset.todoId)
      if (under && under instanceof HTMLElement) {
        const toId = Number(under.dataset.todoId)
        const fromId = dragFrom.current
        if (fromId == null || Number.isNaN(toId)) return
        const ids = list.map((r) => r.id)
        const fromIdx = ids.indexOf(row.id)
        const toIdx = ids.indexOf(toId)
        if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return
        const next = [...ids]
        const [moved] = next.splice(fromIdx, 1)
        next.splice(toIdx, 0, moved)
        const rest = order.filter((id) => !next.includes(id))
        persistOrder([...next, ...rest])
        dragFrom.current = toIdx
      }
    }
    const onUp = () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      draggingRef.current = false
      setDragId(null)
      dragFrom.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div className={`${me.page} ${s.page}`} onClick={() => setOpenSwipe(null)}>
      <PageHeader
        title="我的待办"
        right={
          signed ? (
            <span className={s.addWrap}>
              <button type="button" className={s.addBtn} onClick={openNew}>
                + 新建
              </button>
            </span>
          ) : undefined
        }
      />

      <div className={s.wrap}>
        {signed ? <button type="button" className={s.noticeEntry} onClick={() => setNoticeOpen(true)}><strong>粘贴通知生成待办</strong><span>在本机识别，核对后保存 ›</span></button> : null}
        {!signed ? (
          <div className={s.emptyCard}>
            {cute || minimal ? (
              <FoxInline variant="empty" size={cute ? 88 : 40} text={cute ? '陪你把小事一件件做好' : '整理你的待办'} />
            ) : (
              <TodoEmpty variant="signin" size={120} className={s.emptyEmoji} />
            )}
            <b>登录后使用待办</b>
            <p>把作业、工作任务放进来，到期前会提醒你</p>
          </div>
        ) : (
          <>
            <div className={s.todoHero}>
              <div className={s.todoHeroCopy}>
                <small>OHU · 我的待办</small>
                <h2>先做好今天的小事</h2>
                <p>{groups.todayCount ? `今天与逾期共 ${groups.todayCount} 项待处理，按自己的节奏来。` : '今天没有到期任务，给自己留一点好心情。'}</p>
              </div>
              <img src="/brand/ohu-original/fox-todo-transparent.png" alt="" width="112" height="112" />
            </div>

            <div className={s.seg}>
              {(
                [
                  ['today', '今日待办', groups.todayCount],
                  ['open', '全部未完成', groups.openCount],
                  ['done', '已完成', groups.doneCount],
                  ['pool', '成长池', poolOpen.length],
                ] as Array<[TabKey, string, number]>
              ).map(([k, label, n]) => (
                <button
                  key={k}
                  type="button"
                  className={tab === k ? `${s.segBtn} ${s.segOn}` : s.segBtn}
                  onClick={() => setTab(k)}
                >
                  {label}
                  {n > 0 && (k === 'today' || k === 'open' || k === 'pool') ? <i className={s.badge}>{n}</i> : null}
                </button>
              ))}
            </div>

            {/* —— 今日负荷条：先估力气，再决定要不要加 —— */}
            <div className={s.loadCard}>
              <div className={s.loadHead}>
                <span className={s.loadTitle}>今日负荷</span>
                <span className={s.loadCap}>
                  上限
                  <select value={cap} onChange={(e) => onChangeCap(Number(e.target.value))} aria-label="每日负荷上限">
                    {Array.from({ length: (CAP_MAX - CAP_MIN) / 2 + 1 }, (_, i) => CAP_MIN + i * 2).map((n) => (
                      <option key={n} value={n}>
                        {n} 点
                      </option>
                    ))}
                  </select>
                </span>
              </div>
              {cute ? (
                <div
                  className={s.tailMeter}
                  role="progressbar"
                  aria-label="今日负荷"
                  aria-valuemin={0}
                  aria-valuemax={load.cap}
                  aria-valuenow={Math.min(load.cap, load.used)}
                  aria-valuetext={`今日已排 ${load.used} 点，上限 ${load.cap} 点`}
                >
                  <motion.svg
                    viewBox="0 0 300 40"
                    aria-hidden="true"
                    animate={reduce || load.over ? { rotate: 0 } : { rotate: [-1, 1, -1] }}
                    transition={{ duration: 2.4, repeat: reduce ? 0 : Infinity, ease: 'easeInOut' }}
                  >
                    <path d="M13 26Q70 9 149 22T286 13" fill="none" stroke="var(--mint-2)" strokeWidth="20" strokeLinecap="round" />
                    <motion.path
                      d="M13 26Q70 9 149 22T286 13"
                      fill="none"
                      stroke="var(--fox-orange, #ff9a3d)"
                      strokeWidth={load.over ? 24 : 20}
                      strokeLinecap="round"
                      initial={false}
                      animate={{ pathLength: Math.min(1, load.ratio) }}
                      transition={{ duration: reduce ? 0 : 0.35 }}
                    />
                    <path
                      d={load.over ? 'M244 18L251 8L258 13L267 3L270 11L289 5L281 22L270 19L266 29L258 22L248 29Z' : 'M254 20Q269 18 286 7L290 16Q276 27 259 28Z'}
                      fill="var(--fox-belly, #fff0dc)"
                      stroke="var(--fox-orange, #ff9a3d)"
                      strokeWidth="1"
                    />
                  </motion.svg>
                </div>
              ) : (
                <div className={s.loadTrack}>
                  <i
                    className={load.over ? s.loadFillOver : load.warn ? s.loadFillWarn : s.loadFillOk}
                    style={{ width: `${Math.min(100, Math.round(load.ratio * 100))}%` }}
                  />
                </div>
              )}
              <p className={load.over ? `${s.loadHint} ${s.loadHintOver}` : load.warn ? `${s.loadHint} ${s.loadHintWarn}` : s.loadHint}>
                {loadHint(load)}
              </p>
              {cute || minimal ? (
                <>
                  <div className={s.growthHead}>
                    <b>完成脚印</b>
                    <span>
                      {groups.doneCount} / {rows.length} 项
                    </span>
                  </div>
                  <div className={s.footsteps} aria-label={`已完成 ${groups.doneCount} 项，共 ${rows.length} 项`}>
                    {[1, 2, 3, 4, 5].map((step) => (
                      <span
                        key={step}
                        className={rows.length > 0 && groups.doneCount / rows.length >= step / 5 ? s.footstepDone : s.footstep}
                      >
                        <FoxPaw />
                      </span>
                    ))}
                  </div>
                </>
              ) : null}
            </div>

            {cute && celebrate ? (
              <motion.div
                className={s.completion}
                role="status"
                initial={{ opacity: 0, y: reduce ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <StudyFoxCompanion complete size={64} />
                <span>
                  <b>又完成一件，真棒～</b>
                  <small>给今天留下一枚小脚印</small>
                </span>
              </motion.div>
            ) : null}

            {/* —— 待办闹钟：开关 + 提前量 —— */}
            <div className={s.remindBar}>
              <label className={s.remindSwitch}>
                <input
                  type="checkbox"
                  checked={remindOn}
                  onChange={(e) => onToggleRemind(e.target.checked)}
                />
                <span>到期闹钟提醒</span>
              </label>
              <span className={s.remindLead}>
                提前
                <select
                  value={leadMin}
                  disabled={!remindOn}
                  onChange={(e) => onChangeLead(Number(e.target.value))}
                  aria-label="提前提醒分钟数"
                >
                  {[5, 10, 15, 30, 60, 120].map((m) => (
                    <option key={m} value={m}>
                      {m} 分钟
                    </option>
                  ))}
                </select>
              </span>
            </div>
            <p className={s.remindNote}>
              {remindOn
                ? '关掉 App 也会准点震动提醒，打开时额外弹窗'
                : '开启后，待办到期前会震动并弹窗提醒'}
            </p>

            {error ? (
              <ErrorState
                compact
                title="待办同步失败"
                hint={error}
                action={
                  <button type="button" onClick={reload}>
                    重试
                  </button>
                }
              />
            ) : null}

            {loading && !rows.length ? (
              cute || minimal ? <FoxInline variant="loading" text="正在整理待办…" /> : <p className={s.hint}>加载中…</p>
            ) : tab === 'pool' ? (
              <div className={s.poolWrap}>
                <p className={s.poolTip}>
                  想学点什么、想练点什么，先记在这儿。等负荷条空出来了，再把它变成真待办——想法不会丢，也不会烂在收藏夹里。
                </p>
                {poolOpen.length === 0 ? (
                  <div className={s.emptyCard}>
                    <TodoEmpty variant="idle" size={120} className={s.emptyEmoji} />
                    <b>成长池是空的</b>
                    <p>想到什么就先扔进来，不用马上决定什么时候做</p>
                  </div>
                ) : (
                  <ul className={s.list}>
                    {poolOpen.map((idea) => (
                      <li key={idea.id} className={s.itemWrap}>
                        <div className={s.item}>
                          <button type="button" className={s.body} onClick={() => openIdeaNew(idea.title)}>
                            <span className={s.title}>{idea.title}</span>
                            {idea.note ? <span className={s.note}>{idea.note}</span> : null}
                            <span className={s.dueRow}>
                              <span className={s.loadTag}>
                                {loadLabel(idea.load)} · {idea.load} 点
                              </span>
                            </span>
                          </button>
                          <button
                            type="button"
                            className={s.iconBtn}
                            title="转成待办"
                            aria-label="转成待办"
                            onClick={() => void convertIdea(idea)}
                          >
                            →
                          </button>
                          <button
                            type="button"
                            className={s.iconBtn}
                            title="专注这件"
                            aria-label="专注这件"
                            onClick={() => nav(`/study/focus?plan=${encodeURIComponent(idea.title)}`)}
                          >
                            🎯
                          </button>
                          <button
                            type="button"
                            className={s.iconBtn}
                            title="移出成长池"
                            aria-label="移出成长池"
                            onClick={() => setAskDropIdea(idea)}
                          >
                            🗑
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {poolDone.length > 0 ? (
                  <div className={s.poolDoneWrap}>
                    <p className={s.poolDoneTitle}>已经长成待办 / 已放弃</p>
                    <ul className={s.poolDoneList}>
                      {poolDone.map((idea) => (
                        <li key={idea.id}>
                          <span className={idea.status === 'converted' ? s.poolChipOk : s.poolChipOff}>
                            {idea.status === 'converted' ? '已转待办' : '已放弃'}
                          </span>
                          <span className={s.poolDoneText}>{idea.title}</span>
                          <button type="button" className={s.poolReopen} onClick={() => void reopenIdea(idea)}>
                            放回池里
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : !error && list.length === 0 ? (
              <div className={s.emptyCard}>
                <img className={s.emptyFox} src="/brand/ohu-original/fox-todo-transparent.png" alt="" width="98" height="98" loading="lazy" />
                <b>{tab === 'done' ? '还没有完成记录' : tab === 'today' ? '今天和逾期任务都完成啦' : '这里空空的'}</b>
                <p>{tab === 'done' ? '完成的待办会留在这里' : tab === 'today' ? '可以切到“全部未完成”查看之后的计划' : '点右上角「+ 新建」，把作业和工作任务加进来'}</p>
              </div>
            ) : (
              <ul className={s.list}>
                {list.map((row, index) => {
                  const due = dueText(row.due_at)
                  const revealed = openSwipe === row.id
                  return (
                    <li
                      key={row.id}
                      className={`${s.itemWrap} ${dragId === row.id ? s.itemDragging : ''}`}
                      data-todo-id={row.id}
                    >
                      <button
                        type="button"
                        className={s.swipeDel}
                        onClick={(e) => {
                          e.stopPropagation()
                          setAskDel(row)
                        }}
                        aria-label="删除"
                      >
                        🗑
                      </button>
                      <div
                        className={s.item}
                        style={revealed ? { transform: 'translateX(-88px)' } : undefined}
                        onPointerDown={(e) => onItemPointerDown(e, row)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          className={row.done ? `${s.check} ${s.checkOn}` : s.check}
                          onClick={() => void toggle(row)}
                          aria-label={row.done ? '标记未完成' : '标记完成'}
                        >
                          {row.done ? '✓' : ''}
                        </button>
                        <button type="button" className={s.body} onClick={() => openEdit(row)}>
                          <span className={row.done ? s.titleDone : s.title}>{row.title}</span>
                          {row.note && !safeTodoLink(row.note) ? <span className={s.note}>{row.note}</span> : null}
                          <span className={s.dueRow}>
                            <span className={s.loadTag}>
                              {loadLabel(row.load)} · {row.load} 点
                            </span>
                            {due.text ? <span className={due.cls}>{due.text}</span> : null}
                            {!row.done && remindOn && row.due_at ? (
                              <i className={s.bell} title="已设闹钟" aria-label="已设闹钟">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                  <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
                                  <path d="M13.7 21a2 2 0 0 1-3.4 0" />
                                </svg>
                              </i>
                            ) : null}
                          </span>
                        </button>
                        {!row.done ? (
                          <button
                            type="button"
                            className={s.del}
                            aria-label="专注这条"
                            title="专注这条"
                            onClick={() => nav(`/study/focus?plan=${encodeURIComponent(row.title)}`)}
                          >
                            🎯
                          </button>
                        ) : null}
                        {safeTodoLink(row.note) ? <a className={s.noticeLink} href={safeTodoLink(row.note) || undefined} target="_blank" rel="noopener noreferrer" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>打开作业 ↗</a> : null}
                        {canDrag ? (
                          <button
                            type="button"
                            className={s.dragHandle}
                            data-drag-handle
                            aria-label="拖拽排序"
                            onPointerDown={(e) => onDragHandlePointerDown(e, row, index)}
                          >
                            ⋮⋮
                          </button>
                        ) : (
                          <button type="button" className={s.del} onClick={() => setAskDel(row)} aria-label="删除">
                            🗑
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}

            <button
              type="button"
              className={s.fab}
              onClick={() => (tab === 'pool' ? openIdeaNew() : openNew())}
              aria-label={tab === 'pool' ? '记一个想法' : '新建待办'}
            >
              +
            </button>

            {/* —— 数据看板：专注趋势 + 完成趋势 —— */}
            <div className={s.boardCard}>
              <div className={s.boardHead}>
                <span className={s.boardTitle}>这一周</span>
                <button type="button" className={s.boardLink} onClick={() => nav('/study/goals')}>
                  看看大家在努力什么 →
                </button>
              </div>
              <div className={s.boardStats}>
                <div>
                  <span>今日专注</span>
                  <strong>{board.focusToday > 0 ? fmtDuration(board.focusToday) : '0 分钟'}</strong>
                </div>
                <div>
                  <span>本周专注</span>
                  <strong>{fmtDuration(board.focusWeek)}</strong>
                </div>
                <div>
                  <span>连续专注</span>
                  <strong>
                    {board.streak}
                    <small>天</small>
                  </strong>
                </div>
                <div>
                  <span>本周完成</span>
                  <strong>
                    {board.doneWeek}
                    <small>件</small>
                  </strong>
                </div>
              </div>
              <div className={s.boardBars}>
                {board.focus.map((d, i) => {
                  const done = board.done[i]
                  return (
                    <div key={d.key} className={s.barCol}>
                      <div className={s.barStack}>
                        <i className={s.barFocus} style={{ height: `${barPct(d.minutes, board.focusBest)}%` }} />
                        <i className={s.barDone} style={{ height: `${barPct(done?.done || 0, board.doneBest)}%` }} />
                      </div>
                      <span className={d.isToday ? `${s.barDay} ${s.barDayOn}` : s.barDay}>{d.weekday}</span>
                    </div>
                  )
                })}
              </div>
              <p className={s.boardLegend}>
                <i className={s.barFocus} /> 专注时长
                <i className={s.barDone} /> 完成件数
              </p>
            </div>
          </>
        )}
      </div>

      {noticeOpen ? <NoticeTodoSheet uid={uid} onClose={() => setNoticeOpen(false)} onSaved={reload} /> : null}
      {draft ? (
        <>
          <div className={s.mask} onClick={() => setDraft(null)} />
          <div className={s.sheet}>
            <div className={s.sheetHead}>
              <h3>{draft.id ? '编辑待办' : '新建待办'}</h3>
              <button type="button" className={s.close} onClick={() => setDraft(null)} aria-label="关闭">
                ✕
              </button>
            </div>
            <label className={s.field}>
              <span>内容</span>
              <input
                className={s.input}
                placeholder="如：高数作业 P56 / 社团招新海报"
                maxLength={60}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label className={s.field}>
              <span>备注（选填）</span>
              <textarea
                className={s.area}
                placeholder="补充说明，比如交到哪、找谁"
                maxLength={200}
                rows={3}
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              />
            </label>
            <div className={s.field}>
              <span>精力负荷（做这件事要花多少力气）</span>
              <div className={s.loadChips}>
                {LOAD_LEVELS.map((lv) => (
                  <button
                    key={lv.value}
                    type="button"
                    className={draft.load === lv.value ? `${s.loadChip} ${s.loadChipOn}` : s.loadChip}
                    onClick={() => setDraft({ ...draft, load: lv.value })}
                  >
                    <b>{lv.label}</b>
                    <i>{lv.value} 点</i>
                  </button>
                ))}
              </div>
              <p className={s.loadChipDesc}>
                {LOAD_LEVELS.find((lv) => lv.value === draft.load)?.desc || ''}
                {wouldExceed(rows, draft.load, cap) ? ' · 加上这条今天就超上限了' : ''}
              </p>
            </div>
            <label className={s.field}>
              <span>到期时间（选填，到期前会提醒）</span>
              <input
                className={s.input}
                type="datetime-local"
                value={draft.due}
                onChange={(e) => setDraft({ ...draft, due: e.target.value })}
              />
            </label>
            <div className={s.btnRow}>
              {draft.id ? (
                <button
                  type="button"
                  className={s.ghostBtn}
                  onClick={() => {
                    const row = rows.find((r) => r.id === draft.id)
                    if (row) void parkTodoBack(row)
                    setDraft(null)
                  }}
                >
                  放回成长池
                </button>
              ) : null}
              {draft.id ? (
                <button
                  type="button"
                  className={s.ghostBtn}
                  onClick={() => {
                    const row = rows.find((r) => r.id === draft.id)
                    if (row) setAskDel(row)
                    setDraft(null)
                  }}
                >
                  删除
                </button>
              ) : null}
              <button type="button" className={s.mainBtn} disabled={busy} onClick={() => void saveDraft()}>
                {busy ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </>
      ) : null}

      {askDel ? (
        <ConfirmSheet
          title="删除这条待办？"
          desc={`「${askDel.title}」删除后不可恢复`}
          confirmText="删除"
          danger
          onClose={() => setAskDel(null)}
          onConfirm={async () => {
            const row = askDel
            setAskDel(null)
            await remove(row)
          }}
        />
      ) : null}

      {ideaDraft ? (
        <>
          <div className={s.mask} onClick={() => setIdeaDraft(null)} />
          <div className={s.sheet}>
            <div className={s.sheetHead}>
              <h3>记进成长池</h3>
              <button type="button" className={s.close} onClick={() => setIdeaDraft(null)} aria-label="关闭">
                ✕
              </button>
            </div>
            <label className={s.field}>
              <span>想做的事</span>
              <input
                className={s.input}
                placeholder="如：学点心理学 / 把英语口语练起来"
                maxLength={60}
                value={ideaDraft.title}
                onChange={(e) => setIdeaDraft({ ...ideaDraft, title: e.target.value })}
              />
            </label>
            <label className={s.field}>
              <span>备注（选填）</span>
              <textarea
                className={s.area}
                placeholder="为什么想做、从哪儿开始"
                maxLength={200}
                rows={3}
                value={ideaDraft.note}
                onChange={(e) => setIdeaDraft({ ...ideaDraft, note: e.target.value })}
              />
            </label>
            <div className={s.field}>
              <span>大概要多少力气</span>
              <div className={s.loadChips}>
                {LOAD_LEVELS.map((lv) => (
                  <button
                    key={lv.value}
                    type="button"
                    className={ideaDraft.load === lv.value ? `${s.loadChip} ${s.loadChipOn}` : s.loadChip}
                    onClick={() => setIdeaDraft({ ...ideaDraft, load: lv.value })}
                  >
                    <b>{lv.label}</b>
                    <i>{lv.value} 点</i>
                  </button>
                ))}
              </div>
              <p className={s.loadChipDesc}>先估个大概，真转待办的时候还能再改</p>
            </div>
            <div className={s.btnRow}>
              <button type="button" className={s.mainBtn} disabled={busy} onClick={() => void saveIdea()}>
                {busy ? '保存中…' : '放进池里'}
              </button>
            </div>
          </div>
        </>
      ) : null}

      {askDropIdea ? (
        <ConfirmSheet
          title="移出成长池？"
          desc={`「${askDropIdea.title}」会从池里删掉，之后想做要重新记`}
          confirmText="移出"
          danger
          onClose={() => setAskDropIdea(null)}
          onConfirm={async () => {
            const idea = askDropIdea
            setAskDropIdea(null)
            await dropIdea(idea)
          }}
        />
      ) : null}
    </div>
  )
}
