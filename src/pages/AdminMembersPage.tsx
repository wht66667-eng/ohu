/**
 * 站长成员治理台（tab 化：概览 / 成员与搜索 / 日活 / 制裁 / 邀请码）
 * - 概览 + 成员增删：仅 isSuperAdmin（数据层 src/lib/admin.ts；服务端 RPC 自校验 is_super_admin_user()）
 * - 日活 / 制裁：isAdmin 可见（admin_activity_overview RPC 守卫 is_admin_user()；user_sanctions RLS）
 * - 邀请码发放（TASK-C2）：isAdmin 可见。生成/撤销走 src/lib/social-invites.ts 封装
 *   （social_invite_create 对 admin 不限次数；social_invite_revoke 仅发放方本人可撤销），
 *   列表直读 social_invites（RLS：发放者本人或 is_admin_user() 可见全量）。
 *   迁移未部署（42883 / 表不存在）= 可读错误 + 部署指引，不放行、不降级、无绕过。
 */
import { useEffect, useRef, useState } from 'react'
import { PageHeader } from '../components/PageHeader'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../lib/auth'
import { usePollingRows } from '../lib/hooks'
import {
  addMember,
  fetchAdminAccounts,
  removeMember,
  searchUsers,
  setAccountAccess,
  type AdminAccountRow,
  type AdminUserRow,
} from '../lib/admin'
import { captureImSession, currentImSession } from '../lib/im-session'
import {
  fetchAdminActivity, fetchAdminSanctions, fetchAdminInvites,
  addAdminSanction, liftAdminSanction,
  kindLabel, activeRate,
  type AdminActivityOverview, type AdminInvitesResult, type AdminSanctionRow,
} from '../lib/admin-analytics'
import {
  adminInviteCanRevoke, adminInviteExpiryText, adminInviteRevokeHint,
  adminInviteRoleText, adminInviteSummaryText, adminInviteUnavailableReason, adminInviteUsageText,
  type AdminInviteRowView,
} from '../lib/admin-analytics-helpers'
import { socialInviteCreate, socialInviteRevoke } from '../lib/social-invites'
import { maskSocialUid, RELATION_OPTIONS } from '../lib/social-invites-helpers'
import { useImSessionVersion } from '../lib/use-im-session-version'
import { DeniedState, EmptyState, ErrorState, LoadingState } from '../components/ui/StateViews'
import styles from './AdminMembersPage.module.css'

type MembersTab = 'overview' | 'members' | 'activity' | 'sanctions' | 'invites'

const MEMBERS_TABS: Array<{ key: MembersTab; label: string; superOnly?: boolean }> = [
  { key: 'overview', label: '概览' },
  { key: 'members', label: '成员与搜索', superOnly: true },
  { key: 'activity', label: '日活' },
  { key: 'sanctions', label: '制裁' },
  { key: 'invites', label: '邀请码' },
]

export function AdminMembersPage() {
  const auth = useAuth()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const revision = useImSessionVersion(uid)
  const role = auth.profile?.isSuperAdmin ? 'super' : auth.profile?.isAdmin ? 'admin' : 'denied'
  return <MembersForAccount key={`${uid}:${revision}:${role}`} />
}

function MembersForAccount() {
  const auth = useAuth()
  const toast = useToast()
  const isSuper = !!auth.profile?.isSuperAdmin
  const isAdmin = auth.isSigned && !!(auth.profile?.isAdmin || auth.profile?.isSuperAdmin)

  const accounts = usePollingRows<AdminAccountRow>(
    () => (isAdmin ? fetchAdminAccounts() : Promise.resolve({ rows: [], error: null })),
    [isAdmin, auth.user?.uid],
    20000,
  )

  const [tab, setTab] = useState<MembersTab>('overview')
  const visibleTabs = MEMBERS_TABS.filter((t) => !t.superOnly || isSuper)

  const [q, setQ] = useState('')
  const [hits, setHits] = useState<AdminUserRow[]>([])
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')
  const alive = useRef(true)
  const searchSequence = useRef(0)
  const writing = useRef(false)
  const uid = auth.user?.uid || ''
  useEffect(() => { alive.current = true; return () => { alive.current = false; searchSequence.current++ } }, [])

  async function operate(key: string, run: (valid: () => boolean) => Promise<void>) {
    const owner = captureImSession(uid)
    if (!auth.isSigned || !isSuper || !owner || writing.current) return
    writing.current = true
    setBusy(key)
    const valid = () => alive.current && currentImSession(owner)
    try { await run(valid) }
    catch (error) { if (valid()) toast.err(error instanceof Error ? error.message : '操作失败，请重试') }
    finally { writing.current = false; if (valid()) setBusy('') }
  }

  async function onSearch() {
    if (!isSuper) {
      toast('仅站长可搜索并添加管理员')
      return
    }
    const kw = q.trim()
    if (kw.length < 2) {
      toast.warn('请输入至少 2 个字（手机号 / 学号 / 昵称 / 邮箱）')
      return
    }
    const owner = captureImSession(uid)
    if (!owner || writing.current) return
    const ticket = ++searchSequence.current
    setSearching(true)
    setHits([])
    let res: Awaited<ReturnType<typeof searchUsers>>
    try { res = await searchUsers(kw) }
    catch (error) { res = { rows: [], error: error instanceof Error ? error.message : '搜索失败，请重试' } }
    if (!alive.current || ticket !== searchSequence.current || !currentImSession(owner)) return
    setSearching(false)
    if (res.error) {
      toast.err(res.error)
      return
    }
    setHits(res.rows)
    if (!res.rows.length) toast('未找到用户，对方需先注册登录')
  }

  async function onAdd(u: AdminUserRow) {
    if (!isSuper || busy) return
    if (u.is_super_admin) {
      toast.ok('对方已是站长')
      return
    }
    if (u.is_admin) {
      toast.ok('对方已是管理员')
      return
    }
    await operate(u.account, async (valid) => {
    const res = await addMember(u.account, u.nickname || u.account, note.trim() || '站长授权')
    if (!valid()) return
    if (res.error) {
      toast.err(res.error)
      return
    }
    toast.ok(`已添加管理员 ${u.account}`)
    setHits((h) => h.map((x) => (x.uid === u.uid ? { ...x, is_admin: true } : x)))
    accounts.reload()
    })
  }

  async function onBan(u: AdminUserRow) {
    if (!isSuper || busy) return
    if (u.is_admin || u.is_super_admin) {
      toast.err('不能封禁管理员')
      return
    }
    await operate(`ban${u.account}`, async (valid) => {
    const reason = note.trim() || '违反校园社区规范'
    const nextBanned = !u.banned
    const res = await setAccountAccess(u.account, u.uid, nextBanned, reason)
    if (!valid()) return
    if (res.error) {
      toast.err(res.error)
      return
    }
    toast.ok(`${nextBanned ? '已封号' : '已解封'} ${u.account}`)
    setHits((h) => h.map((x) => (x.uid === u.uid ? { ...x, banned: nextBanned, banned_note: nextBanned ? reason : '' } : x)))
    })
  }

  /* 移除管理员改走统一确认弹层，不用原生 confirm */
  const [askRemove, setAskRemove] = useState<AdminAccountRow | null>(null)

  function onRemove(row: AdminAccountRow) {
    if (!isSuper || busy) return
    if (row.role === 'super_admin') {
      toast.err('不能移除站长')
      return
    }
    setAskRemove(row)
  }

  async function doRemove(row: AdminAccountRow) {
    setAskRemove(null)
    await operate(row.account, async (valid) => {
    const res = await removeMember(row.account)
    if (!valid()) return
    if (res.error) {
      toast.err(res.error)
      return
    }
    toast.ok('已移除管理员')
    accounts.reload()
    })
  }

  /* —— 日活 + 制裁 + 邀请码（TASK-C2：管理员可见三块治理数据） —— */
  const [activity, setActivity] = useState<AdminActivityOverview | null>(null)
  const [sanctions, setSanctions] = useState<AdminSanctionRow[] | null>(null)
  const [sanctionError, setSanctionError] = useState('')
  const [sanctionKind, setSanctionKind] = useState<AdminSanctionRow['kind']>('mute')
  const [sanctionDays, setSanctionDays] = useState('7')
  const [sanctionReason, setSanctionReason] = useState('')
  const [sanctionBusy, setSanctionBusy] = useState(false)
  const [sanctionTarget, setSanctionTarget] = useState<{ uid: string; name: string } | null>(null)
  const [invites, setInvites] = useState<AdminInvitesResult | null>(null)
  const [inviteRelation, setInviteRelation] = useState('friend')
  const [inviteLabel, setInviteLabel] = useState('')
  const [inviteNote, setInviteNote] = useState('')
  const [inviteBusy, setInviteBusy] = useState(false)

  const loadGovernance = async () => {
    setActivity(await fetchAdminActivity(14))
    const list = await fetchAdminSanctions(200)
    setSanctions(list.rows); setSanctionError(list.error ?? '')
    setInvites(await fetchAdminInvites(100))
  }
  useEffect(() => { void loadGovernance() }, [])

  const reloadInvites = async () => {
    setInvites(await fetchAdminInvites(100))
  }

  /** 生成管理员码：social_invite_create 对 admin max_uses=null 不限次数，默认 7 天有效 */
  const createInvite = async () => {
    if (inviteBusy) return
    if (inviteRelation === 'custom' && !inviteLabel.trim()) {
      toast.err('自定义关系请填写称呼（1 到 12 个字）')
      return
    }
    setInviteBusy(true)
    try {
      const res = await socialInviteCreate(inviteNote.trim(), inviteRelation, inviteLabel)
      if (res.rpcMissing) {
        toast.err('邀请码体系尚未部署，无法生成：请在生产库执行 docs/sql/social-invites-166.sql 后刷新')
        void reloadInvites()
        return
      }
      if (res.error) {
        toast.err(adminInviteUnavailableReason(res.error) ?? res.error)
        void reloadInvites()
        return
      }
      toast.ok(`已生成管理员码 ${res.code}（默认 7 天有效、不限次数）`)
      setInviteLabel(''); setInviteNote('')
      await reloadInvites()
    } finally { setInviteBusy(false) }
  }

  /** 撤销码：服务端仅允许发放方本人（created_by_uid = auth.uid()） */
  const revokeInvite = async (code: string) => {
    if (inviteBusy) return
    setInviteBusy(true)
    try {
      const res = await socialInviteRevoke(code)
      if (res.rpcMissing) {
        toast.err('邀请码体系尚未部署，无法撤销：请在生产库执行 docs/sql/social-invites-166.sql 后刷新')
        return
      }
      if (res.error) {
        toast.err(adminInviteUnavailableReason(res.error) ?? res.error)
        return
      }
      toast.ok('已撤销邀请码，对方将无法再绑定')
      await reloadInvites()
    } finally { setInviteBusy(false) }
  }

  const copyInviteCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      toast.ok('邀请码已复制')
    } catch {
      toast.err('复制失败，请手动复制')
    }
  }

  const submitSanction = async () => {
  if (!sanctionTarget) { toast.err('请先在「成员与搜索」里点「处置」选中一个用户'); return }
  setSanctionBusy(true)
  try {
    const days = sanctionDays.trim() === '' ? null : Number(sanctionDays)
    const reason = await addAdminSanction(sanctionTarget.uid, sanctionKind, days && days > 0 ? days : null, sanctionReason, uid)
    if (reason) toast.err(reason)
    else { toast.ok('已登记处置'); setSanctionReason(''); const list = await fetchAdminSanctions(200); setSanctions(list.rows); setSanctionError(list.error ?? '') }
  } finally { setSanctionBusy(false) }
  }

  const lift = async (id: number) => {
    setSanctionBusy(true)
    try {
      const reason = await liftAdminSanction(id)
      if (reason) toast.err(reason)
      else { toast.ok('已解除处置'); const list = await fetchAdminSanctions(200); setSanctions(list.rows); setSanctionError(list.error ?? '') }
    } finally { setSanctionBusy(false) }
  }

  if (!isAdmin) {
    return (
      <div className={styles.page}>
        <PageHeader title="成员治理" />
        <DeniedState title="暂无权限" hint="需要管理员身份才能查看成员治理台。" />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <PageHeader title="成员治理" />

      <div className={styles.searchRow} role="tablist" aria-label="成员治理分区">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? styles.btnMain : styles.btnGhost}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <div role="tabpanel" aria-label="概览">
          <p className={styles.notice}>
            {isSuper
              ? '站长可搜索已注册用户并添加 / 移除普通管理员（含社工邮箱账号，见「成员与搜索」）。站长账号不可被移除。'
              : '当前为普通管理员：可查看成员列表、日活、制裁与邀请码发放；成员增删仅站长可用。'}
          </p>

          <div className={styles.summary}>
            <div>
              <b>{accounts.rows.length}</b>
              <span>当前管理员</span>
            </div>
            <div>
              <b>{accounts.rows.filter((row) => row.role === 'super_admin').length}</b>
              <span>站长账号</span>
            </div>
          </div>

          <section className={styles.panel}>
            <h3>当前管理员（{accounts.rows.length}）</h3>
            {accounts.loading ? (
              <LoadingState compact title="正在同步管理员…" />
            ) : accounts.error ? (
              <ErrorState
                compact
                title="管理员列表加载失败"
                hint={accounts.error}
                action={
                  <button type="button" onClick={() => accounts.reload()}>
                    重试
                  </button>
                }
              />
            ) : accounts.rows.length ? (
              <ul className={styles.list}>
                {accounts.rows.map((row) => (
                  <li key={row.id} className={styles.card}>
                    <div className={styles.cardTop}>
                      <b>{row.display_name || row.account}</b>
                      <span className={row.role === 'super_admin' ? styles.super : styles.admin}>
                        {row.role === 'super_admin' ? '站长' : '管理员'}
                      </span>
                    </div>
                    <p className={styles.meta}>{row.account}</p>
                    {row.note ? <p className={styles.meta}>{row.note}</p> : null}
                    {isSuper && row.role !== 'super_admin' ? (
                      <button
                        type="button"
                        className={`${styles.danger} ${styles.dangerBlock}`}
                        disabled={!!busy}
                        onClick={() => void onRemove(row)}
                      >
                        {busy === row.account ? '移除中…' : '移除管理员'}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                compact
                title="暂无管理员记录"
                hint="站长首次登录后会自动写入 admin_accounts。"
              />
            )}
          </section>
        </div>
      ) : null}

      {tab === 'members' && isSuper ? (
        <div role="tabpanel" aria-label="成员与搜索">
          <section className={styles.panel}>
            <h3>添加管理员</h3>
            <p className={styles.notice}>
              支持手机号 / 用户名 / 昵称 / 邮箱。社工（邮箱验证码登录）用户输入其注册邮箱即可授予与学生管理员完全同等的权限；未建档的邮箱账号会自动补建默认档案。
            </p>
            <div className={styles.searchRow}>
              <input
                className={styles.input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="手机号 / 学号 / 昵称 / 邮箱"
                aria-label="搜索用户：手机号、学号、昵称或邮箱"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void onSearch()
                }}
              />
              <button type="button" className={styles.btnMain} disabled={searching || !!busy} onClick={() => void onSearch()}>
                {searching ? '搜索中…' : '搜索'}
              </button>
            </div>
            <input
              className={styles.input}
              style={{ marginTop: 8 }}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="备注（可选）"
              aria-label="管理员授权备注，可选"
            />
            {hits.length ? (
              <ul className={styles.hits}>
                {hits.map((u) => (
                  <li key={u.uid}>
                    <div>
                      <b>{u.nickname || u.account}</b>
                      <span>{u.account}</span>
                      <span className={u.banned && !u.is_admin && !u.is_super_admin ? styles.tagBan : styles.tag}>
                        {u.is_super_admin ? '站长' : u.is_admin ? '管理员' : u.banned ? '已封禁' : '普通用户'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={styles.btnGhost}
                      disabled={!!busy || u.is_admin || u.is_super_admin || u.banned}
                      onClick={() => void onAdd(u)}
                    >
                      {busy === u.account ? '…' : '设为管理员'}
                    </button>
                    <button
                      type="button"
                      className={styles.btnGhost}
                      onClick={() => { setSanctionTarget({ uid: u.uid, name: u.nickname || u.account }); setNote(`${u.nickname || u.account} 已选为处置对象`); setTab('sanctions') }}
                    >
                      处置
                    </button>
                    <button
                      type="button"
                      className={u.banned ? styles.btnGhost : styles.danger}
                      disabled={!!busy || u.is_admin || u.is_super_admin}
                      onClick={() => void onBan(u)}
                    >
                      {busy === `ban${u.account}` ? '…' : u.banned ? '解封' : '封号'}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>
      ) : null}

      {tab === 'activity' ? (
        <div role="tabpanel" aria-label="日活">
          <section className={styles.panel} aria-labelledby="gov-activity">
            <h3 id="gov-activity">用户日活（近 14 天）</h3>
            {activity === null ? <p className={styles.notice}>正在读取…</p> : activity.unavailable ? (
              <p className={styles.notice}>聚合 RPC 尚未部署：{activity.reason}。请在生产库执行 docs/sql/admin-analytics-166.sql 后刷新。</p>
            ) : (
              <>
                <div className={styles.govMetrics}>
                  <div><b>{activity.dau}</b><span>今日活跃 (DAU)</span></div>
                  <div><b>{activity.wau}</b><span>周活跃 (WAU)</span></div>
                  <div><b>{activity.mau}</b><span>月活跃 (MAU)</span></div>
                  <div><b>{activeRate(activity.dau, activity.total)}%</b><span>今日活跃率</span></div>
                </div>
                <div className={styles.govBars} role="img" aria-label="近 14 天日活柱状图">
                  {activity.days.map((d) => (
                    <div key={d.day} className={styles.govBarCol} title={`${d.day}：${d.active} 人`}>
                      <div className={styles.govBar} style={{ height: `${Math.max(2, activeRate(d.active, Math.max(1, activity.dau)))}%` }} />
                      <small>{d.day.slice(5)}</small>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      ) : null}

      {tab === 'sanctions' ? (
        <div role="tabpanel" aria-label="制裁">
          <section className={styles.panel} aria-labelledby="gov-sanctions">
            <h3 id="gov-sanctions">处置与封禁明细</h3>
            {sanctionError ? <p className={styles.notice} role="alert">制裁表不可读：{sanctionError}（确认 docs/release/plaza-sanctions.sql 已部署）</p> : null}
            {sanctionTarget ? <p className={styles.notice}>处置对象：<b>{sanctionTarget.name}</b>（{sanctionTarget.uid.slice(0, 10)}…）</p> : <p className={styles.notice}>先在「成员与搜索」点「处置」选中用户。</p>}
            <div className={styles.searchRow}>
              <select className={styles.input} aria-label="处置类型" value={sanctionKind} onChange={(e) => setSanctionKind(e.target.value as AdminSanctionRow['kind'])}>
                <option value="mute">禁言</option>
                <option value="hall_ban">封大厅</option>
                <option value="account">封账号</option>
              </select>
              <input className={styles.input} type="number" min="1" max="365" placeholder="天数（空=永久）" aria-label="处置天数，留空为永久" value={sanctionDays} onChange={(e) => setSanctionDays(e.target.value)} style={{ maxWidth: 130 }} />
              <input className={styles.input} placeholder="原因（必填，留痕）" aria-label="处置原因" value={sanctionReason} onChange={(e) => setSanctionReason(e.target.value)} />
              <button type="button" className={styles.danger} disabled={sanctionBusy || !sanctionTarget || !sanctionReason.trim()} onClick={() => void submitSanction()}>
                {sanctionBusy ? '…' : '登记处置'}
              </button>
            </div>
            {sanctions === null ? <p className={styles.notice}>正在读取制裁表…</p> : sanctions.length === 0 ? <p className={styles.notice}>当前没有处置记录。</p> : (
              <ul className={styles.hits}>
                {sanctions.map((row) => (
                  <li key={row.id}>
                    <div>
                      <b>{row.username || row.uid.slice(0, 10)}</b>
                      <span>{kindLabel(row.kind)} · {row.remainingText}</span>
                      <span className={styles.tag}>{row.reason || '未填写原因'}</span>
                      {row.until_at ? <span className={styles.tag}>{new Date(row.until_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} 止</span> : <span className={styles.tagBan}>永久</span>}
                    </div>
                    <button type="button" className={styles.btnGhost} disabled={sanctionBusy} onClick={() => void lift(row.id)}>
                      解除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}

      {tab === 'invites' ? (
        <div role="tabpanel" aria-label="邀请码">
          <InvitePanel
            invites={invites}
            myUid={uid}
            relation={inviteRelation}
            relationLabel={inviteLabel}
            note={inviteNote}
            busy={inviteBusy}
            onRelation={setInviteRelation}
            onRelationLabel={setInviteLabel}
            onNote={setInviteNote}
            onCreate={() => void createInvite()}
            onRevoke={(code) => void revokeInvite(code)}
            onCopy={(code) => void copyInviteCode(code)}
            onRetry={() => void reloadInvites()}
          />
        </div>
      ) : null}

      {askRemove ? (
        <ConfirmSheet
          title="移除管理员？"
          desc={`「${askRemove.display_name || askRemove.account}」将失去管理权限`}
          confirmText="移除"
          danger
          busy={busy === askRemove.account}
          onClose={() => setAskRemove(null)}
          onConfirm={() => {
            void doRemove(askRemove)
          }}
        />
      ) : null}
    </div>
  )
}

/* —— 邀请码发放面板（TASK-C2）：展示层抽成纯 props 组件，便于阅读；数据在上方统一加载 —— */
function InvitePanel(props: {
  invites: AdminInvitesResult | null
  myUid: string
  relation: string
  relationLabel: string
  note: string
  busy: boolean
  onRelation: (value: string) => void
  onRelationLabel: (value: string) => void
  onNote: (value: string) => void
  onCreate: () => void
  onRevoke: (code: string) => void
  onCopy: (code: string) => void
  onRetry: () => void
}) {
  const { invites } = props
  return (
    <section className={styles.panel} aria-labelledby="gov-invites">
      <h3 id="gov-invites">邀请码发放</h3>
      <p className={styles.notice}>
        管理员码不限绑定次数、默认 7 天有效；学生码每码限 1 位社工。撤销仅对本人发放的码生效（服务端守卫，学生码在此只读展示）。
      </p>

      <div className={styles.searchRow}>
        <select className={styles.input} aria-label="关系类型（只影响称呼）" value={props.relation} onChange={(e) => props.onRelation(e.target.value)}>
          {RELATION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {props.relation === 'custom' ? (
          <input
            className={styles.input}
            value={props.relationLabel}
            onChange={(e) => props.onRelationLabel(e.target.value)}
            placeholder="自定义称呼（1-12 字）"
            aria-label="自定义关系称呼"
            maxLength={12}
            style={{ maxWidth: 170 }}
          />
        ) : null}
        <input
          className={styles.input}
          value={props.note}
          onChange={(e) => props.onNote(e.target.value)}
          placeholder="备注（可选）"
          aria-label="邀请码备注，可选"
        />
        <button type="button" className={styles.btnMain} disabled={props.busy} onClick={props.onCreate}>
          {props.busy ? '…' : '生成邀请码'}
        </button>
      </div>

      {invites === null ? (
        <p className={styles.notice}>正在读取邀请码…</p>
      ) : invites.unavailable ? (
        <p className={styles.notice} role="alert">
          {invites.hint ?? invites.error}
          <button type="button" className={styles.btnGhost} style={{ marginLeft: 10 }} onClick={props.onRetry}>
            重试
          </button>
        </p>
      ) : invites.error ? (
        <p className={styles.notice} role="alert">
          邀请码列表不可读：{invites.error}
          <button type="button" className={styles.btnGhost} style={{ marginLeft: 10 }} onClick={props.onRetry}>
            重试
          </button>
        </p>
      ) : (
        <>
          <p className={styles.notice}>{adminInviteSummaryText(invites.rows)}</p>
          {invites.rows.length === 0 ? (
            <EmptyState compact title="还没有邀请码" hint="点上方「生成邀请码」发出第一枚管理员码。" />
          ) : (
            <ul className={styles.hits}>
              {invites.rows.map((row: AdminInviteRowView) => {
                const revokeHint = adminInviteRevokeHint(row, props.myUid)
                const expiry = adminInviteExpiryText(row)
                return (
                  <li key={row.code}>
                    <div>
                      <b>{row.code}</b>
                      <span>{adminInviteRoleText(row)} · {adminInviteUsageText(row)}</span>
                      <span className={row.revoked ? styles.tagBan : styles.tag}>{row.relationLabel}</span>
                      {expiry ? <span className={styles.tag}>{expiry}</span> : null}
                      <span className={styles.meta}>
                        {row.createdByUid === props.myUid ? '我发放的' : row.createdByUid ? `发放者 ${maskSocialUid(row.createdByUid)}` : '发放者未知'}
                        {row.createdAt ? ` · ${row.createdAt.slice(0, 10)}` : ''}
                        {row.note ? ` · ${row.note}` : ''}
                        {revokeHint ? ` · ${revokeHint}` : ''}
                      </span>
                    </div>
                    <div className={styles.searchRow}>
                      <button type="button" className={styles.btnGhost} onClick={() => props.onCopy(row.code)}>
                        复制
                      </button>
                      <button
                        type="button"
                        className={styles.danger}
                        disabled={props.busy || !adminInviteCanRevoke(row, props.myUid)}
                        title={revokeHint || '撤销后不可再被绑定'}
                        onClick={() => props.onRevoke(row.code)}
                      >
                        {props.busy ? '…' : '撤销'}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
