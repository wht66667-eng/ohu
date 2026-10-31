import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { Avatar, ProductArt } from '../components/Thumbs'
import { ConfirmSheet } from '../components/ConfirmSheet'
import { DeniedState, EmptyState, ErrorState, LoadingState } from '../components/ui/StateViews'
import { IconClock, IconPin } from '../components/Icons'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../lib/auth'
import { openDmThread } from '../lib/dm-entry'
import { AsyncOwner, positiveRecordId, type OwnerTicket } from '../lib/async-owner'
import { subscribeImSession } from '../lib/im-session'
import {
  ITEM_STATUS_TEXT,
  fmtTime,
  queryRows,
  setItemStatus,
  type Item,
} from '../lib/market'
import { deleteItemComment, fetchItemComments, addItemComment, type DealComment } from '../lib/deal'
import { deleteGoods, setGoodsStatus } from '../lib/moderation'
import styles from './ItemDetailPage.module.css'

export function ItemDetailPage() {
  const { id } = useParams()
  const auth = useAuth()
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  return <ItemDetailContent key={`${id || 'invalid'}:${uid}`} />
}

function ItemDetailContent() {
  const { id } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const auth = useAuth()
  const authRef = useRef(auth)
  authRef.current = auth
  const [item, setItem] = useState<Item | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [contact, setContact] = useState('')
  const [comments, setComments] = useState<DealComment[]>([])
  const [commentsError, setCommentsError] = useState('')
  const [commentsLoading, setCommentsLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState('')
  const [delItemOpen, setDelItemOpen] = useState(false)
  const [delCmtId, setDelCmtId] = useState<number | null>(null)
  const idNum = positiveRecordId(id)

  const isAdmin = auth.isSigned && !!(auth.profile?.isAdmin || auth.profile?.isSuperAdmin)
  const uid = auth.isSigned ? auth.user?.uid || '' : ''
  const signed = auth.isSigned
  const scope = useRef(new AsyncOwner(`${id}:${uid}`))
  scope.current.select(`${id}:${uid}`)
  useEffect(() => subscribeImSession(() => scope.current.invalidate()), [])
  const flight = useRef<OwnerTicket | null>(null)
  const myName = auth.profile?.username || auth.user?.nickname || '同学'

  const load = useCallback(async () => {
    const ticket = scope.current.begin('load')
    setLoading(true)
    setErr('')
    setItem(null)
    if (!idNum) { setErr('这条闲置不存在'); setLoading(false); return }
    const res = await queryRows<Item>('v_secondhand_public', { id: idNum }, 1)
    if (!scope.current.current(ticket)) return
    if (res.error) setErr(res.error)
    else if (!res.rows.length || Number(res.rows[0].id) !== idNum) setErr('这条闲置可能已下架或被删除')
    else setItem(res.rows[0])
    setLoading(false)
  }, [idNum])

  const loadComments = useCallback(async () => {
    const ticket = scope.current.begin('comments')
    setCommentsLoading(true)
    setCommentsError('')
    if (!idNum) { setComments([]); setCommentsLoading(false); return }
    // 登录后读主表可获得 creator_uid，管理员删除按钮依赖主表读权限
    const res = await fetchItemComments(idNum, signed)
    if (!scope.current.current(ticket)) return
    setCommentsLoading(false)
    if (res.error) setCommentsError(res.error)
    else setComments(res.rows.filter((row) => Number(row.item_id) === idNum))
  }, [idNum, signed])

  useEffect(() => {
    void load()
    return () => scope.current.invalidate()
  }, [load])

  useEffect(() => {
    void loadComments()
  }, [loadComments])

  const retry = useCallback(() => {
    setLoading(true)
    setErr('')
    void load()
  }, [load])

  /** 视图行带 creator_uid 时可判定本人；拿不到则按访客处理，不影响既有鉴权 */
  const isOwner = !!item && !!uid && item.creator_uid === uid
  const active = item?.status === 'on'

  const showContact = useCallback(async () => {
    if (!item || !active || !idNum) return
    const before = scope.current.capture()
    if (!(await auth.ensureSignedIn('查看卖家联系方式需要登录'))) return
    if (!scope.current.current(before) || !authRef.current.isSigned) return
    const ticket = scope.current.begin('contact')
    const res = await queryRows<Item>('secondhand_items', { id: idNum }, 1)
    if (!scope.current.current(ticket)) return
    if (res.error) { toast.err(res.error); return }
    const row = res.rows.find((row) => Number(row.id) === idNum)
    if (!row || row.status !== 'on') { toast('这件闲置已不可联系'); void load(); return }
    setContact(row.contact || '卖家未留联系方式')
  }, [auth, idNum, active, item, load, toast])

  /** 发私信：走腾讯云 IM 单聊（与广场统一） */
  const startChat = useCallback(async () => {
    if (!item || !active || !idNum || flight.current) return
    const ticket = scope.current.begin('write')
    flight.current = ticket
    if (!(await auth.ensureSignedIn('发私信需要先登录'))) { if (flight.current === ticket) flight.current = null; return }
    if (!scope.current.current(ticket) || !authRef.current.isSigned) return
    setBusy('chat')
    const res = await queryRows<Item>('secondhand_items', { id: idNum }, 1)
    if (flight.current === ticket) flight.current = null
    if (!scope.current.current(ticket)) return
    if (res.error) {
      setBusy('')
      toast.err(res.error)
      return
    }
    const row = res.rows.find((row) => Number(row.id) === idNum)
    if (!row || row.status !== 'on') { setBusy(''); toast('这件闲置已不可联系'); void load(); return }
    const peerUid = row.creator_uid || item.creator_uid || ''
    if (!peerUid) {
      setBusy('')
      toast('暂时联系不上这位卖家')
      return
    }
    // 用原始 uid 比较：会话线按真实 uid 建，按 IM 字符集裁剪会对不上号
    if (peerUid === (auth.user?.uid || '')) {
      setBusy('')
      toast('这是你自己发布的闲置，不用发私信啦')
      return
    }
    setBusy('')
    void (async () => {
      const r = await openDmThread({
        peerUid,
        peerName: item?.creator_name || '卖家',
        topicType: 'secondhand',
        topicId: idNum,
        topicTitle: item?.title || '闲置',
      })
      if (r.error) toast.err(r.error)
      else nav(r.path)
    })()
  }, [auth, active, idNum, item, nav, load, toast])

  /** 发布者本人：标为已出 / 重新上架（与集市「我的发布」同一套状态流转） */
  async function toggleOwner() {
    if (!item || !isOwner || flight.current) return
    const ticket = scope.current.begin('write')
    flight.current = ticket
    const next = item.status === 'on' ? 'sold' : 'on'
    setBusy('owner')
    const res = await setItemStatus(item.id, next)
    if (flight.current === ticket) flight.current = null
    if (!scope.current.current(ticket)) return
    setBusy('')
    if (res.error) {
      toast.err(res.error)
      return
    }
    toast.ok(`已标记为${ITEM_STATUS_TEXT[next]}`)
    setItem({ ...item, status: next })
  }

  /** 管理员：下架 / 恢复上架（学生视角无此按钮） */
  async function toggleOff() {
    if (!item || !isAdmin || !uid || flight.current) return
    const ticket = scope.current.begin('write')
    flight.current = ticket
    const next = item.status === 'on' ? 'off' : 'on'
    setBusy('toggle')
    const r = await setGoodsStatus('secondhand_items', item.id, next)
    if (flight.current === ticket) flight.current = null
    if (!scope.current.current(ticket)) return
    setBusy('')
    if (r.error) {
      toast.err(r.error)
      return
    }
    toast(next === 'off' ? '已下架，学生端不再展示' : '已恢复上架')
    setItem({ ...item, status: next })
    void load()
  }

  async function removeItem() {
    if (!item || !isAdmin || !uid || flight.current) return
    const ticket = scope.current.begin('write')
    flight.current = ticket
    setBusy('del')
    const r = await deleteGoods('secondhand_items', item.id)
    if (flight.current === ticket) flight.current = null
    if (!scope.current.current(ticket)) return
    setBusy('')
    if (r.error) {
      toast.err(r.error)
      return
    }
    toast.ok('已删除该闲置')
    setDelItemOpen(false)
    setItem(null)
    setErr('这条闲置已被管理员删除')
  }

  async function sendComment() {
    if (!item || !active || !idNum || flight.current) return
    const text = draft.trim()
    if (!text) {
      toast('说点什么再发送吧')
      return
    }
    const ticket = scope.current.begin('write')
    flight.current = ticket
    if (!(await auth.ensureSignedIn('留言需要先登录'))) { if (flight.current === ticket) flight.current = null; return }
    if (!scope.current.current(ticket) || !authRef.current.isSigned) return
    setBusy('send')
    const r = await addItemComment(idNum, myName, text)
    if (flight.current === ticket) flight.current = null
    if (!scope.current.current(ticket)) return
    setBusy('')
    if (r.error) {
      toast.err(r.error)
      return
    }
    setDraft('')
    void loadComments()
  }

  async function removeComment() {
    if (delCmtId == null || !isAdmin || !uid || flight.current || !comments.some((row) => row.id === delCmtId)) return
    const ticket = scope.current.begin('write')
    flight.current = ticket
    setBusy('delc')
    const r = await deleteItemComment(delCmtId)
    if (flight.current === ticket) flight.current = null
    if (!scope.current.current(ticket)) return
    setBusy('')
    if (r.error) {
      toast.err(r.error)
      return
    }
    toast.ok('已删除该条留言')
    setDelCmtId(null)
    void loadComments()
  }

  const backToList = (
    <button type="button" onClick={() => nav('/market')}>
      返回二手集市
    </button>
  )

  const notFound = !!err && /已删除|已下架|不存在/.test(err)
  const denied = !!err && /42501|permission denied|权限/i.test(err)

  return (
    <div className={styles.page}>
      <PageHeader title="闲置详情" />

      {loading ? <LoadingState title="正在加载闲置…" hint="阿狐马上就好" /> : null}
      {!loading && notFound ? (
        <EmptyState title="闲置不存在" hint={err} action={backToList} />
      ) : null}
      {!loading && denied ? (
        <DeniedState title="暂无权限查看" hint="当前账号还看不到这条闲置" action={backToList} />
      ) : null}
      {!loading && err && !notFound && !denied ? (
        <ErrorState hint={err} action={<button type="button" onClick={retry}>重试</button>} />
      ) : null}

      {!loading && !err && item ? (
        <>
          <article className={styles.card}>
            <div className={styles.pic}>
              {item.images?.[0] ? (
                <img src={item.images[0]} alt={item.title} />
              ) : (
                <ProductArt kind="goods" />
              )}
              <span className={`${styles.picBadge} ${item.status === 'on' ? '' : styles.picBadgeMuted}`}>
                {ITEM_STATUS_TEXT[item.status] || item.status}
              </span>
            </div>
            <div className={styles.body}>
              <div className={styles.tagRow}>
                <span className={styles.tag}>{item.category || '闲置'}</span>
                {item.condition ? <span className={`${styles.badge} ${styles.badgeMuted}`}>{item.condition}</span> : null}
              </div>

              {item.status === 'sold' ? (
                <div className={styles.banner}>这件闲置已售出，看看其他闲置吧</div>
              ) : null}
              {item.status === 'off' ? (
                <div className={styles.banner}>这件闲置已下架，暂时无法联系卖家</div>
              ) : null}

              <h1 className={styles.title}>{item.title}</h1>
              <div className={styles.priceRow}>
                <span className={styles.price}>¥{item.price}</span>
                <span className={styles.priceLabel}>转让价</span>
              </div>

              <div className={styles.meta}>
                <span className={styles.metaItem}>
                  <IconPin size={14} />
                  <span>{item.building || '校内'}</span>
                </span>
                <span className={styles.metaItem}>
                  <IconClock size={14} />
                  <span>{fmtTime(item.created_at)}发布</span>
                </span>
              </div>

              <div className={styles.seller}>
                <Avatar name={item.creator_name || '同学'} seed={item.creator_name || '同学'} />
                <span className={styles.sellerInfo}>
                  <b>{item.creator_name || '同学'}</b>
                  <small>卖家</small>
                </span>
              </div>

              {contact ? (
                <div className={styles.contactBox}>
                  <span>联系方式</span>
                  <b>{contact}</b>
                </div>
              ) : null}

              <p className={styles.sectionLabel}>闲置描述</p>
              <p className={styles.desc}>{item.description || '卖家没有填写更多描述'}</p>
            </div>
          </article>

          {/* 管理员操作区：学生视角完全不挂载 */}
          {isAdmin ? (
            <section className={styles.adminCard}>
              <div className={styles.adminTitle}>
                <span>🛡</span>管理员操作
              </div>
              <p className={styles.adminHint}>
                下架后该闲置会从学生端列表与详情同时消失；删除不可恢复，仅在内容违规时使用。
              </p>
              <div className={styles.adminRow}>
                <button
                  type="button"
                  className={item.status === 'on' ? styles.adminOff : styles.adminOn}
                  onClick={toggleOff}
                  disabled={busy === 'toggle'}
                >
                  {busy === 'toggle' ? '处理中…' : item.status === 'on' ? '下架该闲置' : '恢复上架'}
                </button>
                <button type="button" className={styles.adminDel} onClick={() => setDelItemOpen(true)} disabled={busy !== ''}>
                  删除该闲置
                </button>
              </div>
            </section>
          ) : null}

          {/* 底部固定主操作栏：访客联系卖家；发布者本人显示橙色标为已出/重新上架 */}
          <div className={styles.bottomBar}>
            {isOwner ? (
              <button
                type="button"
                className={styles.ownerBtn}
                onClick={() => void toggleOwner()}
                disabled={busy === 'owner'}
              >
                {busy === 'owner'
                  ? '处理中…'
                  : item.status === 'on'
                    ? '标为已出'
                    : '重新上架'}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => void showContact()}
                  disabled={!active}
                >
                  {contact
                    ? '已显示联系方式'
                    : item.status === 'sold'
                      ? '已售出'
                      : item.status === 'off'
                        ? '已下架'
                        : '查看联系方式'}
                </button>
                <button
                  type="button"
                  className={styles.ghostBtn}
                  onClick={() => void startChat()}
                  disabled={busy === 'chat' || !active}
                >
                  {busy === 'chat' ? '正在打开…' : '发私信'}
                </button>
              </>
            )}
          </div>

          <section className={styles.cmtCard}>
            <div className={styles.cmtTitle}>
              <span>💬</span>留言
              <em>{comments.length}</em>
            </div>
            {commentsLoading ? <LoadingState compact title="正在读取留言…" /> : null}
            {commentsError ? <ErrorState compact title="留言读取失败" hint={commentsError} action={<button type="button" onClick={() => void loadComments()}>重试</button>} /> : null}
            {comments.length ? (
              comments.map((c) => (
                <div className={styles.cmtItem} key={c.id}>
                  <div className={styles.cmtAuthor}>
                    {c.creator_name || '同学'}
                    <span>{fmtTime(c.created_at)}</span>
                  </div>
                  <p className={styles.cmtBody}>{c.content}</p>
                  {isAdmin ? (
                    <button type="button" className={styles.cmtDel} onClick={() => setDelCmtId(c.id)}>
                      删除该留言
                    </button>
                  ) : null}
                </div>
              ))
            ) : !commentsLoading && !commentsError ? (
              <p className={styles.cmtEmpty}>还没有人留言，来问一句「还在吗」帮卖家更快出手。</p>
            ) : null}
            <div className={styles.cmtForm}>
              <textarea
                rows={1}
                enterKeyHint="enter"
                aria-label="留言内容"
                value={draft}
                maxLength={100}
                placeholder={signed ? '想问点什么？例如：还在吗 / 能便宜点吗' : '登录后可以留言询问'}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button type="button" onClick={() => void sendComment()} disabled={!!busy || !active}>
                {busy === 'send' ? '发送中' : '发送'}
              </button>
            </div>
          </section>
        </>
      ) : null}

      {delItemOpen && isAdmin && !!uid && item ? (
        <ConfirmSheet
          danger
          title="删除该闲置？"
          desc={`「${item?.title || '这条闲置'}」及其留言将永久删除，无法恢复。如果只是想暂时隐藏，请改用「下架」。`}
          confirmText="确认删除"
          busy={busy === 'del'}
          onConfirm={removeItem}
          onClose={() => setDelItemOpen(false)}
        />
      ) : null}

      {delCmtId != null && isAdmin && !!uid ? (
        <ConfirmSheet
          danger
          title="删除该条留言？"
          desc="留言将永久删除且无法恢复，卖家与留言者都不会再看到这条内容。"
          confirmText="确认删除"
          busy={busy === 'delc'}
          onConfirm={removeComment}
          onClose={() => setDelCmtId(null)}
        />
      ) : null}
    </div>
  )
}
