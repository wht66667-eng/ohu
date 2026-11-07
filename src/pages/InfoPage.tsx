import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { DialogLayer } from '../components/ui/DialogLayer'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateViews'
import { InfoPublishSheet, type InfoPublishMode } from '../components/InfoPublishSheet'
import pubStyles from '../components/PublishSheet.module.css'
import { Avatar, ProductArt } from '../components/Thumbs'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../lib/auth'
import { usePollingRows } from '../lib/hooks'
import {
  HELP_KIND_TEXT,
  HELP_STATUS_TEXT,
  LOST_KIND_TEXT,
  LOST_STATUS_TEXT,
  activitySeatText,
  fetchActivities,
  fetchHelpList,
  fetchHelpMine,
  fetchLostList,
  fetchNews,
  fmtBulletinTime,
  setHelpStatus,
  signupActivity,
  type Activity,
  type HelpItem,
  type LostItem,
  type News,
} from '../lib/bulletin'
import { queryRows } from '../lib/market'
import { deletePost } from '../lib/moderation'
import { INFO_FILTERS, INFO_KIND_FILTER, fetchInfoTarget, infoTargetKey, parseInfoTarget, type InfoTargetRecord } from '../lib/info-target'
import styles from './campus.module.css'
import infoStyles from './InfoPage.module.css'

const FILTERS = INFO_FILTERS
type Filter = (typeof FILTERS)[number]
/**
 * 分组维度：卡片角标 tag 会随子类型变化（寻物/招领、拼单凑单/借东西…），
 * 因此筛选与「读哪张主表拿联系方式」都必须按 group 判断，不能按 tag 文本判断。
 */
type FeedGroup = Exclude<Filter, '全部'>

type FeedItem = {
  key: string
  group: FeedGroup
  tag: string
  title: string
  body: string
  user: string
  place: string
  time: string
  action?: { label: string; id: number; kind: 'signup' | 'contact' }
  category?: string
  statusText?: string
  /** 公告封面图（来自 news.cover）；活动/失物/互助无此字段 */
  cover?: string
}

function includeFocused<T extends { id: number }>(rows: T[], row?: T): T[] {
  return row ? [row, ...rows.filter((item) => item.id !== row.id)] : rows
}
interface FocusResult { key: string; rows: InfoTargetRecord[]; error: string | null }

export function InfoPage() {
  const toast = useToast()
  const auth = useAuth()
  const authRef = useRef(auth)
  authRef.current = auth
  const [params, setParams] = useSearchParams()
  const parsedFocus = useMemo(() => parseInfoTarget(params), [params])
  const focusedTarget = parsedFocus.target
  const focusKey = focusedTarget ? infoTargetKey(focusedTarget) : ''
  const publishQ = params.get('publish')
  const filter: Filter = focusedTarget ? INFO_KIND_FILTER[focusedTarget.kind] : FILTERS.find((value) => value === params.get('filter')) || '全部'
  const activityCategory = filter === '活动' && params.get('category') === 'teamup' ? 'teamup' : ''
  const [busy, setBusy] = useState(0)
  const isAdmin = auth.isSigned && !!(auth.profile?.isAdmin || auth.profile?.isSuperAdmin)
  /** 管理员待删除的求助：互助墙没有详情页，入口只能落在卡片上 */
  const [delHelp, setDelHelp] = useState<{ id: number; title: string } | null>(null)
  const [delBusy, setDelBusy] = useState(false)
  const [publishMode, setPublishMode] = useState<InfoPublishMode | null>(
    publishQ === 'help' || publishQ === 'teamup' ? publishQ : null,
  )
  const [pickMode, setPickMode] = useState(false)
  const pickedMode = useRef<InfoPublishMode | null>(null)
  const [myHelpState, setMyHelpState] = useState<{ uid: string; ids: Set<number> }>({ uid: '', ids: new Set() })
  const myHelpIds = auth.user?.uid === myHelpState.uid ? myHelpState.ids : new Set<number>()
  const focusRef = useRef<HTMLElement | null>(null)

  const news = usePollingRows<News>(() => fetchNews(), [], 30000)
  const acts = usePollingRows<Activity>(() => fetchActivities(activityCategory || 'activity'), [activityCategory], 30000)
  const lost = usePollingRows<LostItem>(() => fetchLostList(), [], 30000)
  const help = usePollingRows<HelpItem>(() => fetchHelpList(), [], 30000)
  const focused = usePollingRows<FocusResult>(async () => {
    if (!focusedTarget) return { rows: [], error: null }
    const result = await fetchInfoTarget(focusedTarget)
    return { rows: [{ key: focusKey, rows: result.rows, error: result.error }], error: null }
  }, [focusedTarget?.kind, focusedTarget?.id], 30000)
  const focusResult = focused.rows.find((item) => item.key === focusKey)
  const focusRecord = focusResult?.rows.find((item) => item.kind === focusedTarget?.kind && item.row.id === focusedTarget?.id)
  const focusLoading = !!focusedTarget && (!focusResult || focused.loading)
  const focusError = focusResult?.error || focused.error

  const retryFeed = () => { news.reload(); acts.reload(); lost.reload(); help.reload() }
  const clearFocusQuery = () => { const next = new URLSearchParams(params); next.delete('id'); next.delete('kind'); next.delete('filter'); next.delete('category'); setParams(next, { replace: true }) }

  useEffect(() => {
    if (publishQ === 'help' || publishQ === 'teamup') {
      setPublishMode(publishQ)
      setPickMode(false)
    }
  }, [publishQ])

  useEffect(() => {
    const uid = auth.user?.uid
    if (!uid) return
    let alive = true
    void fetchHelpMine(uid).then((r) => {
      if (alive) setMyHelpState({ uid, ids: new Set(r.rows.filter((h) => h.status === 'open').map((h) => h.id)) })
    })
    return () => { alive = false }
  }, [auth.user?.uid, help.rows])

  const feed = useMemo<FeedItem[]>(() => {
    const newsItems: FeedItem[] = includeFocused(news.rows, focusRecord?.kind === 'news' ? focusRecord.row : undefined).map((n) => ({
      key: `n-${n.id}`,
      group: '公告',
      tag: '公告',
      title: n.title,
      body: focusedTarget?.kind === 'news' && n.id === focusedTarget.id ? n.body || n.summary || '' : n.summary || n.body || '',
      user: n.source || n.creator_name || '校园信息站',
      place: '信息站',
      time: fmtBulletinTime(n.published_at || n.created_at),
      cover: n.cover || '',
    }))

    const actItems: FeedItem[] = includeFocused(acts.rows, focusRecord?.kind === 'activity' ? focusRecord.row : undefined).map((a) => {
      const isTeam = (a.category || 'activity') === 'teamup'
      const ended = !!a.end_at && Number.isFinite(Date.parse(a.end_at)) && Date.parse(a.end_at) <= Date.now()
      const accepting = (!a.status || a.status === 'open') && !ended
      return {
        key: `a-${a.id}`,
        group: '活动' as const,
        tag: isTeam ? '组队出行' : '活动',
        title: a.title,
        body: a.description || '',
        user: a.organizer || a.creator_name || '组织者',
        place: a.location || '校园',
        time: a.start_at || fmtBulletinTime(a.created_at),
        action: accepting ? { label: `报名 · ${activitySeatText(a)}`, id: a.id, kind: 'signup' as const } : undefined,
        statusText: a.status === 'cancelled' ? '活动已取消' : a.status === 'closed' ? '报名已结束' : ended ? '活动已结束' : a.status && a.status !== 'open' ? '状态待同步' : '报名中',
        category: a.category || 'activity',
      }
    })

    const lostItems: FeedItem[] = includeFocused(lost.rows, focusRecord?.kind === 'lost' ? focusRecord.row : undefined).map((l) => ({
      key: `l-${l.id}`,
      group: '失物招领',
      tag: LOST_KIND_TEXT[l.kind] || '失物',
      title: l.title,
      body: l.description || '',
      user: l.creator_name || '同学',
      place: l.place || '校园',
      time: fmtBulletinTime(l.created_at),
      action: l.status === 'open' ? { label: '联系方式', id: l.id, kind: 'contact' } : undefined,
      statusText: LOST_STATUS_TEXT[l.status] || '状态待同步',
    }))

    const helpItems: FeedItem[] = help.rows.map((h) => ({
      key: `h-${h.id}`,
      group: '互助',
      tag: HELP_KIND_TEXT[h.kind] || '互助',
      title: h.title,
      body: h.description || '',
      user: h.creator_name || '同学',
      place: h.place || '校园',
      time: fmtBulletinTime(h.created_at),
      action: h.status === 'open' ? { label: '联系方式', id: h.id, kind: 'contact' } : undefined,
      statusText: HELP_STATUS_TEXT[h.status] || '状态待同步',
    }))

    return [...newsItems, ...actItems, ...lostItems, ...helpItems]
  }, [news.rows, acts.rows, lost.rows, help.rows, focusRecord, focusedTarget])

  const list = useMemo(() => {
    const grouped = filter === '全部' ? feed : feed.filter((f) => f.group === filter)
    const base = filter === '活动' && activityCategory ? grouped.filter((item) => item.category === activityCategory) : grouped
    if (!focusedTarget) return base
    const hit = focusRecord ? base.find((f) => f.key === focusKey) : undefined
    if (!hit) return focusResult && !focusResult.error ? base.filter((item) => item.key !== focusKey) : base
    return [hit, ...base.filter((f) => f.key !== focusKey)]
  }, [feed, filter, focusKey, activityCategory, focusRecord, focusedTarget, focusResult])
  const sources = filter === '公告' ? [news] : filter === '活动' ? [acts] : filter === '失物招领' ? [lost] : filter === '互助' ? [help] : [news, acts, lost, help]
  const loading = sources.some((source) => source.loading)
  const error = sources.find((source) => source.error)?.error

  useEffect(() => {
    if (!focusRecord || focusLoading) return
    const t = window.setTimeout(() => {
      focusRef.current?.scrollIntoView({ behavior: 'auto', block: 'center' })
    }, 80)
    return () => window.clearTimeout(t)
  }, [focusKey, focusRecord, focusLoading])

  const clearPublishQuery = useCallback(() => {
    if (!params.get('publish')) return
    const next = new URLSearchParams(params)
    next.delete('publish')
    setParams(next, { replace: true })
  }, [params, setParams])

  const onAction = useCallback(
    async (item: FeedItem) => {
      if (!item.action) return
      const { kind, id } = item.action
      if (kind === 'signup') {
        if (!(await auth.ensureSignedIn('活动报名需要登录'))) return
        const current = authRef.current
        if (!current.isSigned || !current.user?.uid) return
        setBusy(id)
        const res = await signupActivity(
          {
            activity_id: id,
            uid: current.user.uid,
            name: current.profile?.username || current.user.nickname || '同学',
            building: current.profile?.building || '',
            contact: '',
          },
          { category: item.category },
        )
        setBusy(0)
        if (res.error) toast.err(res.error)
        else {
          toast.ok('报名成功')
          acts.reload()
        }
        return
      }
      if (!(await auth.ensureSignedIn('查看联系方式需要登录'))) return
      const table = item.group === '失物招领' ? 'lost_items' : 'help_items'
      const res = await queryRows<{ created_at?: string; contact?: string }>(table, { id }, 1)
      toast(res.rows[0]?.contact || '联系方式已保护，请使用站内联系')
    },
    [acts, auth, toast],
  )

  const markHelpDone = useCallback(
    async (id: number) => {
      if (!(await auth.ensureSignedIn('需要登录'))) return
      setBusy(id)
      const res = await setHelpStatus(id, 'done')
      setBusy(0)
      if (res.error) toast.err(res.error)
      else {
        toast.ok('已标记解决，宠物记了一笔成长')
        help.reload()
      }
    },
    [auth, help, toast],
  )

  /**
   * 管理员当场删除违规求助。
   * 越权拦截由 help_delete_own（creator_uid = auth.uid() OR is_admin_user()）兜底，
   * 前端 isAdmin 只决定这个按钮挂不挂载；删除成功后刷新信息流即可。
   */
  const removeHelp = useCallback(async () => {
    if (!delHelp || delBusy) return
    setDelBusy(true)
    const r = await deletePost('help_items', delHelp.id)
    setDelBusy(false)
    if (r.error) {
      toast.err(r.error)
      return
    }
    toast.ok('已删除该求助')
    setDelHelp(null)
    help.reload()
  }, [delBusy, delHelp, help, toast])

  return (
    <div className={`${styles.page} ${infoStyles.page}`}>
      <PageHeader title="校园信息站" right={<button type="button" className={infoStyles.publishAction} onClick={() => setPickMode(true)}>发布</button>} />
      <div className={`${styles.chips} hide-scroll`}>
        {FILTERS.map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} className={`${styles.chip} ${filter === f ? styles.on : ''}`} onClick={() => { const next = new URLSearchParams(params); next.set('filter', f); next.delete('category'); next.delete('id'); next.delete('kind'); setParams(next, { replace: true }) }}>
            {f}
          </button>
        ))}
      </div>
      {parsedFocus.error ? <ErrorState compact title="这条链接无法打开" hint={parsedFocus.error} action={<button type="button" onClick={clearFocusQuery}>查看校园信息</button>} /> : null}
      {focusLoading ? <LoadingState compact title="正在打开这条校园信息…" hint="核对原记录后展示内容" /> : focusedTarget && focusError ? <ErrorState compact title="这条信息暂时无法读取" hint={focusError} action={<button type="button" onClick={focused.reload}>重试</button>} /> : focusedTarget && focusResult && !focusRecord ? <EmptyState compact title="这条信息暂不可见" hint="可能已下架、删除或不再公开。可以查看其他校园信息。" action={<button type="button" onClick={clearFocusQuery}>查看全部信息</button>} /> : null}
      {focusRecord && focusedTarget ? <div className={infoStyles.located} role="status"><span>已定位原{INFO_KIND_FILTER[focusedTarget.kind]}</span><button type="button" onClick={clearFocusQuery}>查看全部</button></div> : null}
      {error ? <ErrorState compact title={list.length ? '部分信息未能同步' : '校园信息暂时无法读取'} hint={error} action={<button type="button" onClick={retryFeed}>重新加载</button>} /> : null}
      <div className={styles.feed}>
        {list.length === 0 && !error && !focusedTarget && !parsedFocus.error ? loading ? <LoadingState compact title="正在同步校园信息…" hint="" /> : <EmptyState compact title="这一栏还没有信息" hint="可以切换分类，或发布生活求助和组队活动。" /> : null}
        {list.map((p) => {
          /* 取到局部常量：闭包里不会丢失 action 的非空收窄 */
          const act = p.action
          const focused = !!focusRecord && p.key === focusKey
          return (
            <article
              key={p.key}
              ref={focused ? focusRef : undefined}
              tabIndex={focused ? -1 : undefined}
              aria-label={focused ? `已定位：${p.title}` : undefined}
              className={focused ? `${styles.post} ${styles.postFocus}` : styles.post}
            >
              <span className={styles.tag}>{p.tag}</span>
              {p.statusText ? <span className={infoStyles.recordStatus}>{p.statusText}</span> : null}
              <div className={styles.postMain}>
                <div>
                  <div className={styles.postBody}>
                    <b>{p.title}</b>
                    {p.body}
                  </div>
                </div>
                {p.tag === '公告' ? (
                  p.cover ? (
                    <div className={styles.thumb}>
                      <img
                        src={p.cover}
                        alt={p.title}
                        loading="lazy"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', borderRadius: 12 }}
                        onError={(e) => {
                          ;(e.currentTarget as HTMLImageElement).style.visibility = 'hidden'
                        }}
                      />
                    </div>
                  ) : null
                ) : (
                  <div className={styles.thumb}>
                    <ProductArt kind="box" />
                  </div>
                )}
              </div>
              <div className={styles.postFoot}>
                <span className={styles.user} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Avatar name={p.user} seed={p.user} />
                  {p.user} · {p.place} · {p.time}
                </span>
                <span className={`${styles.acts} ${infoStyles.actions}`}>
                  {act ? (
                    <button disabled={busy === act.id} onClick={() => onAction(p)}>
                      {busy === act.id ? '处理中…' : act.label}
                    </button>
                  ) : (
                    <span>{p.statusText || '信息站'}</span>
                  )}
                  {/* 管理员当场处理违规求助；公告 / 活动 / 失物招领一律不出现 */}
                  {p.group === '互助' && act && myHelpIds.has(act.id) ? (
                    <button disabled={busy === act.id} onClick={() => void markHelpDone(act.id)}>
                      {busy === act.id ? '处理中…' : '已解决'}
                    </button>
                  ) : null}
                  {isAdmin && p.group === '互助' && act ? (
                    <button className={styles.del} onClick={() => setDelHelp({ id: act.id, title: p.title })}>
                      删除
                    </button>
                  ) : null}
                </span>
              </div>
            </article>
          )
        })}
      </div>

      {pickMode ? (
        <DialogLayer title="发布到信息站" className={pubStyles.sheet} onClose={() => { setPickMode(false); if (pickedMode.current) { setPublishMode(pickedMode.current); pickedMode.current = null } }}>
            <div className={pubStyles.head}><h2>发布到信息站</h2><button type="button" className={pubStyles.close} aria-label="关闭" onClick={(event) => event.currentTarget.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))}>×</button></div>
            <div className={pubStyles.grid}>
              <button
                type="button"
                className={pubStyles.opt}
                onClick={(event) => {
                  pickedMode.current = 'help'
                  event.currentTarget.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))
                }}
              >
                <b>生活求助</b>
                <span>拼单、借物、临时帮忙</span>
              </button>
              <button
                type="button"
                className={pubStyles.opt}
                onClick={(event) => {
                  pickedMode.current = 'teamup'
                  event.currentTarget.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))
                }}
              >
                <b>组队出行</b>
                <span>同城、返乡、运动搭子</span>
              </button>
            </div>
        </DialogLayer>
      ) : null}

      {publishMode ? (
        <InfoPublishSheet
          mode={publishMode}
          onClose={() => {
            setPublishMode(null)
            clearPublishQuery()
          }}
          onDone={() => {
            setPublishMode(null)
            clearPublishQuery()
            help.reload()
            acts.reload()
          }}
        />
      ) : null}

      {delHelp ? (
        <ConfirmSheet
          danger
          title="删除该求助？"
          desc={`「${delHelp.title}」将被永久删除且无法恢复，互助墙不再展示这条求助，发布者预留的联系方式会一并消失。`}
          confirmText="确认删除"
          busy={delBusy}
          onConfirm={removeHelp}
          onClose={() => setDelHelp(null)}
        />
      ) : null}
    </div>
  )
}
