/**
 * 匿名社区 · 目标墙 /study/goals
 *
 * 量力的原意：看见别人的目标和努力，打破信息茧房。落到咱这儿就是一面目标墙——
 * - 默认匿名：服务端只给一个 4 位代号，不落昵称头像
 * - 实名要本人点头：开关打开才把昵称/头像上传，关掉立刻变回匿名
 * - 鼓励（点赞）与举报走既有能力；撤下是软删除，举报仍可追溯
 */
import { useCallback, useEffect, useState } from 'react'
import { PageHeader } from '../../components/PageHeader'
import { ConfirmSheet } from '../../components/ConfirmSheet'
import { ErrorState } from '../../components/ui/StateViews'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../context/ToastContext'
import { submitReport } from '../../lib/reports'
import {
  GOAL_TEXT_MAX,
  authorLabel,
  cheerEnergyGoal,
  createEnergyGoal,
  fetchEnergyGoals,
  hideEnergyGoal,
  setEnergyGoalReveal,
  type EnergyGoal,
} from '../../lib/energy-goals'
import { DEFAULT_LOAD, LOAD_LEVELS, loadLabel, normLoad, type LoadValue } from '../../lib/todo-energy'
import me from '../me.module.css'
import s from './energy-goals.module.css'

export function EnergyGoalsPage() {
  const auth = useAuth()
  const toast = useToast()
  const signed = !!auth.isSigned
  const uid = auth.user?.uid || ''

  const [rows, setRows] = useState<EnergyGoal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [load, setLoad] = useState<LoadValue>(DEFAULT_LOAD)
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [askHide, setAskHide] = useState<EnergyGoal | null>(null)
  const [reportOf, setReportOf] = useState<EnergyGoal | null>(null)

  const reload = useCallback(async () => {
    if (!signed || !uid) {
      setRows([])
      setLoading(false)
      return
    }
    const res = await fetchEnergyGoals(40)
    setLoading(false)
    if (res.error) {
      setError(res.error)
      return
    }
    setError('')
    setRows(res.rows)
  }, [signed, uid])

  useEffect(() => {
    void reload()
  }, [reload])

  async function publish() {
    const body = text.trim()
    if (body.length < 2) {
      toast('目标至少写 2 个字')
      return
    }
    setBusy(true)
    const res = await createEnergyGoal({
      text: body,
      load,
      reveal,
      name: auth.user?.nickname || '',
      avatar: auth.user?.avatarUrl || '',
    })
    setBusy(false)
    if (res.error) {
      toast.err(res.error)
      return
    }
    setText('')
    setReveal(false)
    toast.ok('已贴到目标墙')
    await reload()
  }

  async function onCheer(g: EnergyGoal) {
    // 先本地翻转，点完立刻有反馈；服务端结果以 reload 为准
    setRows((prev) =>
      prev.map((r) => (r.id === g.id ? { ...r, cheered: !r.cheered, cheers: Math.max(0, r.cheers + (r.cheered ? -1 : 1)) } : r)),
    )
    const res = await cheerEnergyGoal(g.id)
    if (res.error) {
      toast.err(res.error)
      await reload()
      return
    }
    await reload()
  }

  async function onToggleReveal(g: EnergyGoal) {
    const next = !g.reveal
    const res = await setEnergyGoalReveal(g.id, next, auth.user?.nickname || '', auth.user?.avatarUrl || '')
    if (res.error) {
      toast.err(res.error)
      return
    }
    toast(next ? '已公开昵称头像' : '已恢复匿名')
    await reload()
  }

  async function doHide() {
    if (!askHide) return
    const g = askHide
    setAskHide(null)
    const res = await hideEnergyGoal(g.id)
    if (res.error) {
      toast.err(res.error)
      return
    }
    toast.ok('已撤下')
    await reload()
  }

  async function doReport() {
    if (!reportOf) return
    const g = reportOf
    setReportOf(null)
    const res = await submitReport({
      reporterUid: uid,
      targetType: 'energy_goal',
      targetId: String(g.id),
      reason: '目标墙内容不合适',
    })
    if (res.error) {
      toast.err(res.error)
      return
    }
    toast.ok('已举报，我们会尽快处理')
  }

  const mine = rows.filter((r) => r.mine)
  const others = rows.filter((r) => !r.mine)

  return (
    <div className={me.page}>
      <PageHeader title="目标墙" />
      <div className={s.wrap}>
        {!signed ? (
          <div className={s.notice}>
            <b>登录后加入目标墙</b>
            <p>看看别人正在努力什么，也把你的目标贴上来</p>
          </div>
        ) : (
          <>
            <div className={s.notice}>
              <b>默认匿名</b>
              <p>
                不点「公开昵称头像」，别人只看到一个代号；你的 uid 从不离开服务端。
                发布即表示同意公开展示目标内容。
              </p>
            </div>

            <div className={s.publishCard}>
              <textarea
                className={s.input}
                placeholder={`最近想做成的一件事（最多 ${GOAL_TEXT_MAX} 字）`}
                maxLength={GOAL_TEXT_MAX}
                rows={2}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div className={s.chips}>
                {LOAD_LEVELS.map((lv) => (
                  <button
                    key={lv.value}
                    type="button"
                    className={load === lv.value ? `${s.chip} ${s.chipOn}` : s.chip}
                    onClick={() => setLoad(lv.value)}
                  >
                    {lv.label}
                  </button>
                ))}
              </div>
              <label className={s.revealRow}>
                <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
                <span>公开我的昵称头像</span>
              </label>
              <div className={s.publishRow}>
                <span className={s.count}>
                  {text.length}/{GOAL_TEXT_MAX}
                </span>
                <button type="button" className={s.mainBtn} disabled={busy} onClick={() => void publish()}>
                  {busy ? '发布中…' : '贴上去'}
                </button>
              </div>
            </div>

            {error ? (
              <ErrorState
                compact
                title="目标墙加载失败"
                hint={error}
                action={
                  <button type="button" onClick={() => void reload()}>
                    重试
                  </button>
                }
              />
            ) : null}

            {loading ? (
              <p className={s.hint}>加载中…</p>
            ) : rows.length === 0 ? (
              <div className={s.notice}>
                <b>墙上还空着</b>
                <p>写下你最近想做成的一件事，让别人也看见有人在努力</p>
              </div>
            ) : (
              <>
                {mine.length > 0 ? (
                  <section className={s.section}>
                    <h2 className={s.sectionTitle}>我贴的</h2>
                    <ul className={s.list}>
                      {mine.map((g) => (
                        <GoalCard
                          key={g.id}
                          g={g}
                          onCheer={() => void onCheer(g)}
                          onToggleReveal={() => void onToggleReveal(g)}
                          onHide={() => setAskHide(g)}
                          onReport={undefined}
                        />
                      ))}
                    </ul>
                  </section>
                ) : null}
                <section className={s.section}>
                  <h2 className={s.sectionTitle}>大家在努力什么</h2>
                  <ul className={s.list}>
                    {others.map((g) => (
                      <GoalCard
                        key={g.id}
                        g={g}
                        onCheer={() => void onCheer(g)}
                        onReport={() => setReportOf(g)}
                      />
                    ))}
                  </ul>
                </section>
              </>
            )}
          </>
        )}
      </div>

      {askHide ? (
        <ConfirmSheet
          title="撤下这条目标？"
          desc={`「${askHide.text}」会从目标墙移除`}
          confirmText="撤下"
          danger
          onClose={() => setAskHide(null)}
          onConfirm={() => void doHide()}
        />
      ) : null}

      {reportOf ? (
        <ConfirmSheet
          title="举报这条目标？"
          desc={`「${reportOf.text}」会被送进审核队列`}
          confirmText="举报"
          danger
          onClose={() => setReportOf(null)}
          onConfirm={() => void doReport()}
        />
      ) : null}
    </div>
  )
}

function GoalCard({
  g,
  onCheer,
  onToggleReveal,
  onHide,
  onReport,
}: {
  g: EnergyGoal
  onCheer: () => void
  onToggleReveal?: () => void
  onHide?: () => void
  onReport?: () => void
}) {
  return (
    <li className={s.card}>
      <div className={s.cardTop}>
        <span className={s.loadTag}>
          {loadLabel(normLoad(g.load))} · {g.load} 点
        </span>
        <span className={g.reveal ? `${s.author} ${s.authorOn}` : s.author}>
          {g.reveal && g.avatar ? <img src={g.avatar} alt="" className={s.avatar} /> : null}
          {authorLabel(g)}
        </span>
      </div>
      <p className={s.text}>{g.text}</p>
      <div className={s.cardFoot}>
        <button
          type="button"
          className={g.cheered ? `${s.cheer} ${s.cheerOn}` : s.cheer}
          onClick={onCheer}
          aria-pressed={g.cheered}
        >
          鼓励 {g.cheers > 0 ? g.cheers : ''}
        </button>
        {onToggleReveal ? (
          <button type="button" className={s.miniBtn} onClick={onToggleReveal}>
            {g.reveal ? '恢复匿名' : '公开昵称'}
          </button>
        ) : null}
        {onHide ? (
          <button type="button" className={s.miniBtn} onClick={onHide}>
            撤下
          </button>
        ) : null}
        {onReport ? (
          <button type="button" className={s.miniBtn} onClick={onReport}>
            举报
          </button>
        ) : null}
      </div>
    </li>
  )
}
