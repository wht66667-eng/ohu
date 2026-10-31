import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { useToast } from '../context/ToastContext'
import { banUser } from '../lib/admin'
import {
  deletePlazaMessage,
  deletePlazaPost,
  fetchPlazaMessages,
  fetchPlazaPosts,
  type PlazaMessage,
  type PlazaPost,
} from '../lib/plaza'
import {
  applySanction,
  fetchActiveSanctions,
  liftSanctions,
  sanctionKindText,
  type SanctionKind,
  type SanctionRow,
} from '../lib/sanctions'
import work from './work.module.css'
import s from './AdminContentPage.module.css'
import { EmptyState, ErrorState, LoadingState } from '../components/ui/StateViews'

const MUTE_HOURS = [
  { label: '禁言 1 小时', hours: 1 },
  { label: '禁言 1 天', hours: 24 },
  { label: '禁言 7 天', hours: 168 },
] as const

/** 管理端跟进学生广场：删大厅消息、删帖、禁言、封大厅；封号仅站长 */
export function AdminPlazaPane() {
  const auth = useAuth()
  const toast = useToast()
  const actor = auth.user?.uid || ''
  const isSuper = !!auth.profile?.isSuperAdmin
  const [msgs, setMsgs] = useState<PlazaMessage[]>([])
  const [posts, setPosts] = useState<PlazaPost[]>([])
  const [holds, setHolds] = useState<SanctionRow[]>([])
  const [busy, setBusy] = useState('')
  const [sub, setSub] = useState<'lobby' | 'feed' | 'holds'>('lobby')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const [m, p, h] = await Promise.all([fetchPlazaMessages(80), fetchPlazaPosts(60), fetchActiveSanctions()])
    if (m.error) toast.err(m.error)
    if (p.error) toast.err(p.error)
    if (h.error) toast.err(h.error)
    setMsgs(m.rows.slice().reverse())
    setPosts(p.rows)
    setHolds(h.rows)
    setLoadError(m.error || p.error || h.error)
    setLoading(false)
  }, [toast])

  useEffect(() => {
    void reload()
  }, [reload])

  async function punish(uid: string, name: string, kind: SanctionKind, hours: number | null, label: string) {
    if (!uid || busy) return
    setBusy(`${kind}${uid}`)
    const r = await applySanction({
      uid,
      kind,
      hours,
      reason: `${label} · ${name || '同学'}`,
      actorUid: actor,
    })
    setBusy('')
    if (r.error) {
      toast.err(r.error)
      return
    }
    toast.ok(`${sanctionKindText(kind)}已生效`)
    void reload()
  }

  async function sealAccount(name: string, uid: string) {
    if (!isSuper) {
      toast('封号仅站长可用')
      return
    }
    setBusy(`ban${uid}`)
    const r = await banUser(name || uid, '广场违规封号')
    if (!r.error) {
      await applySanction({ uid, kind: 'account', hours: null, reason: '封号', actorUid: actor })
    }
    setBusy('')
    toast(r.error || '已封号，对方将无法登录')
    void reload()
  }

  async function lift(row: SanctionRow) {
    setBusy(`lift${row.id}`)
    const r = await liftSanctions(row.uid, row.kind)
    setBusy('')
    if (r.error) {
      toast.err(r.error)
      return
    }
    toast.ok('已解除')
    void reload()
  }

  function actions(uid: string, name: string) {
    return (
      <span className={s.acts}>
        {MUTE_HOURS.map((m) => (
          <button
            key={m.hours}
            type="button"
            className={`${work.btn} ${work.btnSm}`}
            disabled={!!busy}
            onClick={() => void punish(uid, name, 'mute', m.hours, m.label)}
          >
            {m.label}
          </button>
        ))}
        <button
          type="button"
          className={`${work.btn} ${work.btnSm} ${work.btnN}`}
          disabled={!!busy}
          onClick={() => void punish(uid, name, 'hall_ban', null, '封禁大厅')}
        >
          封大厅
        </button>
        {isSuper ? (
          <button
            type="button"
            className={`${work.btn} ${work.btnSm} ${work.btnD}`}
            disabled={!!busy}
            onClick={() => void sealAccount(name, uid)}
          >
            封号
          </button>
        ) : null}
      </span>
    )
  }

  return (
    <div>
      <p className={work.hint}>
        删的是广场原文。禁言不能发大厅和帖子；封大厅仍可看帖、不能进大厅。限时到期自动失效。需要先执行 npm run deploy:db，服务端才会拒绝直接调接口发帖。
      </p>
      <div className={s.chips} style={{ marginBottom: 10 }}>
        <button type="button" className={`${s.chip} ${sub === 'lobby' ? s.chipOn : ''}`} onClick={() => setSub('lobby')}>
          大厅
        </button>
        <button type="button" className={`${s.chip} ${sub === 'feed' ? s.chipOn : ''}`} onClick={() => setSub('feed')}>
          帖子
        </button>
        <button type="button" className={`${s.chip} ${sub === 'holds' ? s.chipOn : ''}`} onClick={() => setSub('holds')}>
          生效中的处罚
        </button>
      </div>

      {loading ? (
        <LoadingState title="正在同步广场内容…" />
      ) : loadError ? (
        <ErrorState
          title="广场内容加载失败"
          hint={loadError}
          action={
            <button type="button" className={`${work.btn} ${work.btnSm} ${work.btnP}`} onClick={() => void reload()}>
              重试
            </button>
          }
        />
      ) : (
        <>
      {sub === 'lobby' ? (
        <div className={work.card}>
          {msgs.length === 0 ? <EmptyState compact title="大厅暂无消息" /> : null}
          {msgs.map((m) => (
            <div className={s.gRow} key={m.id}>
              <span className={s.gGrow}>
                <b>{m.creator_name || '同学'}</b>
                <span className={s.gMeta}>{m.body}</span>
                {actions(m.creator_uid, m.creator_name)}
              </span>
              <button
                type="button"
                className={`${work.btn} ${work.btnSm} ${work.btnD}`}
                disabled={busy === `dm${m.id}`}
                onClick={() => {
                  setBusy(`dm${m.id}`)
                  void deletePlazaMessage(m.id).then((r) => {
                    setBusy('')
                    toast(r.error || '已删除这条大厅消息')
                    if (!r.error) void reload()
                  })
                }}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {sub === 'feed' ? (
        <div className={work.card}>
          {posts.length === 0 ? <EmptyState compact title="暂无帖子" /> : null}
          {posts.map((p) => (
            <div className={s.gRow} key={p.id}>
              <span className={s.gGrow}>
                <b>
                  {p.tag || '吐槽'} · {p.creator_name || '同学'}
                </b>
                <span className={s.gMeta}>{p.body}</span>
                {actions(p.creator_uid, p.creator_name)}
              </span>
              <button
                type="button"
                className={`${work.btn} ${work.btnSm} ${work.btnD}`}
                disabled={busy === `dp${p.id}`}
                onClick={() => {
                  setBusy(`dp${p.id}`)
                  void deletePlazaPost(p.id).then((r) => {
                    setBusy('')
                    toast(r.error || '已删除这条帖子')
                    if (!r.error) void reload()
                  })
                }}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {sub === 'holds' ? (
        <div className={work.card}>
          {holds.length === 0 ? <EmptyState compact title="当前没有生效中的处罚" /> : null}
          {holds.map((h) => (
            <div className={s.gRow} key={h.id}>
              <span className={s.gGrow}>
                <b>
                  {sanctionKindText(h.kind)} · {h.uid}
                </b>
                <span className={s.gMeta}>
                  {h.reason || '无原因'}
                  {h.until_at ? ` · 至 ${new Date(h.until_at).toLocaleString()}` : ' · 直到解除'}
                </span>
              </span>
              <button
                type="button"
                className={`${work.btn} ${work.btnSm}`}
                disabled={!!busy}
                onClick={() => void lift(h)}
              >
                解除
              </button>
            </div>
          ))}
        </div>
      ) : null}
        </>
      )}
    </div>
  )
}
