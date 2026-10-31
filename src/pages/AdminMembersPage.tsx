/**
 * 站长成员治理台：增删普通管理员（仅 isSuperAdmin）
 * 数据层见 src/lib/admin.ts；服务端 RPC 自校验 is_super_admin_user()。
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
import { useImSessionVersion } from '../lib/use-im-session-version'
import { DeniedState, EmptyState, ErrorState, LoadingState } from '../components/ui/StateViews'
import styles from './AdminMembersPage.module.css'

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
      toast.warn('请输入至少 2 个字（手机号 / 学号 / 昵称）')
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
      <p className={styles.notice}>
        {isSuper
          ? '站长可搜索已注册用户并添加 / 移除普通管理员。站长账号不可被移除。'
          : '当前为普通管理员：可查看成员列表，增删仅站长可用。'}
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

      {isSuper ? (
        <section className={styles.panel}>
          <h3>添加管理员</h3>
          <div className={styles.searchRow}>
            <input
              className={styles.input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="手机号 / 学号 / 昵称"
              aria-label="搜索用户：手机号、学号或昵称"
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
      ) : null}

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
