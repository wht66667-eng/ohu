import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { ImagePickButton } from '../components/ImageUploadField'
import { AnnouncementBanner } from '../components/AnnouncementBanner'
import { useAuth } from '../lib/auth'
import { uploadToBucket } from '../lib/chat-image'
import { useToast } from '../context/ToastContext'
import {
  createNews,
  deleteNews,
  fetchNewsAll,
  fetchNewsBroadcastStats,
  notifyStudentsOfNews,
  pinNewsExclusive,
  setNewsStatus,
  updateNews,
  type News,
  type NewsBroadcastStat,
} from '../lib/bulletin'
import { DeniedState, EmptyState, ErrorState, LoadingState } from '../components/ui/StateViews'
import work from './work.module.css'
import s from './AdminContentPage.module.css'

type Status = 'draft' | 'published' | 'hidden'

function statusText(status: string): string {
  if (status === 'published') return '已发布'
  if (status === 'hidden') return '已下架'
  return '草稿'
}

function emptyForm() {
  return { title: '', summary: '', body: '', cover: '', notify: false, publishAt: '' }
}

/** 形如 2026-10-10T14:30 的本地时间串（datetime-local 输入框要这个格式） */
function toLocalInput(iso: string): string {
  const t = new Date(String(iso || '')).getTime()
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function scheduledHint(n: News): string {
  if (n.status !== 'published') return ''
  const t = new Date(String(n.published_at || '')).getTime()
  return Number.isFinite(t) && t > Date.now() ? `预约 ${toLocalInput(String(n.published_at))} 上线` : ''
}

/** 管理端公告：草稿 / 发布 / 下架 / 单条置顶。勾选后才给在校学生发站内信。 */
export function AdminNewsPage() {
  const auth = useAuth()
  const toast = useToast()
  const nav = useNavigate()
  const isAdmin = auth.isSigned && !!(auth.profile?.isAdmin || auth.profile?.isSuperAdmin)
  const [rows, setRows] = useState<News[]>([])
  const [busy, setBusy] = useState('')
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [coverUploading, setCoverUploading] = useState(false)
  const [preview, setPreview] = useState('')
  const [stats, setStats] = useState<NewsBroadcastStat[]>([])
  const [statsError, setStatsError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    const [r, st] = await Promise.all([fetchNewsAll(), fetchNewsBroadcastStats()])
    setLoading(false)
    if (r.error) {
      toast.err(r.error)
      setLoadError(r.error)
      setRows([])
    } else {
      setLoadError(null)
      const list = r.rows.slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      setRows(list)
    }
    // 统计 RPC 未上线时静默降级，只记一条提示，不影响公告本身
    setStats(st.error ? [] : st.rows)
    setStatsError(st.error || null)
  }, [toast])

  useEffect(() => {
    if (isAdmin) void reload()
  }, [isAdmin, reload])

  /** 同一条公告可能发过多次站内信，已读人数累加 */
  const readByNews = useMemo(() => {
    const m = new Map<number, number>()
    for (const s of stats) {
      if (s.news_id == null) continue
      m.set(s.news_id, (m.get(s.news_id) || 0) + s.read_count)
    }
    return m
  }, [stats])

  function openNew() {
    setEditing('new')
    setForm(emptyForm())
  }

  function openEdit(n: News) {
    setEditing(n.id)
    setForm({
      title: n.title || '',
      summary: n.summary || '',
      body: n.body || '',
      cover: n.cover || '',
      notify: false,
      publishAt: toLocalInput(String(n.published_at || '')),
    })
  }

  async function pickCover(file: File) {
    if (!file || coverUploading) return
    setCoverUploading(true)
    const res = await uploadToBucket(file, 'news/')
    setCoverUploading(false)
    if (res.error || !res.url) {
      toast.err(res.error || '封面图上传失败，请稍后重试')
      return
    }
    setForm((f) => ({ ...f, cover: res.url as string }))
  }

  async function save(status: Status) {
    const title = form.title.trim()
    const body = form.body.trim()
    if (title.length < 2 || body.length < 2) {
      toast('标题和正文至少 2 个字')
      return
    }
    setBusy('save')
    const draft = {
      title: title.slice(0, 80),
      summary: form.summary.trim().slice(0, 140),
      body: body.slice(0, 2000),
      tag: '公告',
      source: '校园信息站',
      creator_name: auth.profile?.username || '管理员',
      cover: form.cover || undefined,
    }
    let newsId = typeof editing === 'number' ? editing : 0
    const target = status === 'hidden' ? 'draft' : status
    // 定时：填了未来时间就是「预约上线」，学生端到点才看得到
    const at = form.publishAt ? new Date(form.publishAt).toISOString() : null
    const scheduled = !!at && new Date(at).getTime() > Date.now() + 60_000
    if (editing === 'new') {
      const created = await createNews(draft, target, at)
      if (created.error || !created.id) {
        setBusy('')
        toast(created.error || '保存失败')
        return
      }
      newsId = created.id
    } else if (typeof editing === 'number') {
      const updated = await updateNews(editing, draft)
      if (updated.error) {
        setBusy('')
        toast.err(updated.error)
        return
      }
      const st = await setNewsStatus(editing, target, at)
      if (st.error) {
        setBusy('')
        toast.err(st.error)
        return
      }
    }
    // 预约的公告现在还不该弹站内信，等上线后再点「再通知学生」
    if (form.notify && status === 'published' && newsId && !scheduled) {
      const n = await notifyStudentsOfNews({
        newsId,
        title: draft.title,
        body: draft.summary || draft.body,
        actorUid: auth.user?.uid || '',
        actorName: draft.creator_name,
      })
      setBusy('')
      toast(n.error ? `公告已发布，通知未发出：${n.error}` : '已发布，并通知了学生')
    } else {
      setBusy('')
      toast(
        scheduled
          ? `已预约，${toLocalInput(at as string)} 自动上线（站内信请在上线的公告上再点「再通知学生」）`
          : status === 'published'
            ? '已发布到信息站'
            : '草稿已保存',
      )
    }
    setEditing(null)
    void reload()
  }

  async function publishRow(n: News, notify: boolean) {
    setBusy(`p${n.id}`)
    const st = await setNewsStatus(n.id, 'published')
    if (st.error) {
      setBusy('')
      toast.err(st.error)
      return
    }
    if (notify) {
      const r = await notifyStudentsOfNews({
        newsId: n.id,
        title: n.title,
        body: n.summary || n.body,
        actorUid: auth.user?.uid || '',
        actorName: auth.profile?.username || '管理员',
      })
      setBusy('')
      toast(r.error ? `已发布，通知未发出：${r.error}` : '已发布并通知学生')
    } else {
      setBusy('')
      toast.ok('已发布到信息站')
    }
    void reload()
  }

  if (!isAdmin) {
    return (
      <div className={work.page}>
        <PageHeader title="公告" />
        <DeniedState
          title="暂无权限"
          hint="仅管理员可发布公告。"
          action={
            <button type="button" className={`${work.btn} ${work.btnP}`} onClick={() => nav('/settings')}>
              返回设置
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div className={work.page}>
      <PageHeader
        title="公告"
        right={
          <button type="button" className={`${work.btn} ${work.btnSm} ${work.btnP}`} onClick={openNew}>
            新建
          </button>
        }
      />
      <div className={work.wrap}>
        <p className={work.hint}>
          草稿和学生端无关。发布后出现在学生端信息站与首页校园动态，下架后立刻消失。同时只置顶一条。勾选「通知学生」才会在学生打开 App 时出现站内信，每天最多 8 条。上线时间可填未来时刻做预约发布。
        </p>

        {editing != null ? (
          <div className={work.card} style={{ padding: 14, marginBottom: 12 }}>
            <input
              style={{ width: '100%', marginBottom: 8, height: 40, borderRadius: 12, padding: '0 12px', border: '1px solid var(--line)' }}
              value={form.title}
              placeholder="标题"
              maxLength={80}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            />
            <input
              style={{ width: '100%', marginBottom: 8, height: 40, borderRadius: 12, padding: '0 12px', border: '1px solid var(--line)' }}
              value={form.summary}
              placeholder="摘要（首页滚动这一句）"
              maxLength={140}
              onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
            />
            <textarea
              className={work.area}
              rows={5}
              maxLength={2000}
              placeholder="正文"
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            />
            <div style={{ maxWidth: 520, margin: '12px 0', borderRadius: 14, overflow: 'hidden' }}>
              <p className={work.hint}>首页横幅预览（发布并到达上线时间后显示）</p>
              <AnnouncementBanner fallback="/brand/ohu-original/home-campus-banner.webp" preview={{ id: 0, title: form.title, summary: form.summary, cover: form.cover }} />
              <p className={work.hint}>广场横幅预览</p>
              <AnnouncementBanner fallback="/ohu-v7-assets/community-campus-scene.webp" preview={{ id: 0, title: form.title, summary: form.summary, cover: form.cover }} />
            </div>
            <div style={{ margin: '8px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: 'var(--text-2)' }}>封面图（可选）</span>
                <ImagePickButton
                  label={coverUploading ? '上传中…' : form.cover ? '换一张' : '选择图片'}
                  disabled={coverUploading}
                  onPick={(files) => void pickCover(files[0])}
                />
                {form.cover ? (
                  <button
                    type="button"
                    className={`${work.btn} ${work.btnSm} ${work.btnN}`}
                    onClick={() => setForm((f) => ({ ...f, cover: '' }))}
                  >
                    移除
                  </button>
                ) : null}
              </div>
              {form.cover ? (
                <img
                  src={form.cover}
                  alt="封面预览"
                  onClick={() => setPreview(form.cover)}
                  style={{ width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 10, cursor: 'pointer' }}
                />
              ) : null}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0', fontSize: 13 }}>
              <span style={{ color: 'var(--text-2)' }}>上线时间（选填）</span>
              <input
                type="datetime-local"
                value={form.publishAt}
                onChange={(e) => setForm((f) => ({ ...f, publishAt: e.target.value }))}
                style={{ flex: 1, height: 36, borderRadius: 10, padding: '0 10px', border: '1px solid var(--line)' }}
              />
              {form.publishAt ? (
                <button
                  type="button"
                  className={`${work.btn} ${work.btnSm} ${work.btnN}`}
                  onClick={() => setForm((f) => ({ ...f, publishAt: '' }))}
                >
                  清除
                </button>
              ) : null}
            </div>
            <p className={work.hint} style={{ margin: '0 0 8px' }}>
              留空＝立即上线。填未来时间＝预约，学生端到点自动看到；预约期间不会发站内信。
            </p>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.notify}
                onChange={(e) => setForm((f) => ({ ...f, notify: e.target.checked }))}
              />
              发布时同时通知学生（站内信，不震动）
            </label>
            <div className={work.btnRow}>
              <button type="button" className={`${work.btn} ${work.btnSm}`} onClick={() => setEditing(null)}>
                取消
              </button>
              <button type="button" className={`${work.btn} ${work.btnSm}`} disabled={busy === 'save'} onClick={() => void save('draft')}>
                存草稿
              </button>
              <button type="button" className={`${work.btn} ${work.btnSm} ${work.btnP}`} disabled={busy === 'save'} onClick={() => void save('published')}>
                发布
              </button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <LoadingState compact title="正在同步公告…" />
        ) : loadError ? (
          <ErrorState
            compact
            title="公告加载失败"
            hint={loadError}
            action={
              <button type="button" onClick={() => void reload()}>
                重试
              </button>
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState compact title="还没有公告" hint="点击右上角「新建」发布第一条校园公告。" />
        ) : (
        <>
        <div className={work.card}>
          {rows.map((n) => (
            <div className={s.gRow} key={n.id}>
              <span className={s.gGrow}>
                <b>
                  {n.is_top ? '置顶 · ' : ''}
                  {n.title || '未命名'}
                </b>
                <span className={s.gMeta}>
                  {statusText(n.status)}
                  {scheduledHint(n) ? ` · ${scheduledHint(n)}` : ''}
                  {readByNews.has(n.id) ? ` · 站内信已读 ${readByNews.get(n.id)} 人` : ''}
                  {' · '}
                  {n.summary || n.body || ''}
                </span>
                <span className={s.acts}>
                  <button type="button" className={`${work.btn} ${work.btnSm}`} onClick={() => openEdit(n)}>
                    编辑
                  </button>
                  {n.status !== 'published' ? (
                    <button
                      type="button"
                      className={`${work.btn} ${work.btnSm} ${work.btnP}`}
                      disabled={!!busy}
                      onClick={() => void publishRow(n, false)}
                    >
                      仅发布
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`${work.btn} ${work.btnSm}`}
                      disabled={!!busy}
                      onClick={() => {
                        setBusy(`h${n.id}`)
                        void setNewsStatus(n.id, 'hidden').then((r) => {
                          setBusy('')
                          toast(r.error || '已下架')
                          if (!r.error) void reload()
                        })
                      }}
                    >
                      下架
                    </button>
                  )}
                  <button
                    type="button"
                    className={`${work.btn} ${work.btnSm}`}
                    disabled={!!busy || n.status !== 'published'}
                    onClick={() => {
                      setBusy(`t${n.id}`)
                      void pinNewsExclusive(n.id, !n.is_top).then((r) => {
                        setBusy('')
                        toast(r.error || (n.is_top ? '已取消置顶' : '已置顶，其余置顶已取消'))
                        if (!r.error) void reload()
                      })
                    }}
                  >
                    {n.is_top ? '取消置顶' : '置顶'}
                  </button>
                  {n.status === 'published' ? (
                    <button
                      type="button"
                      className={`${work.btn} ${work.btnSm} ${work.btnN}`}
                      disabled={!!busy}
                      onClick={() => void publishRow(n, true)}
                    >
                      再通知学生
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={`${work.btn} ${work.btnSm} ${work.btnD}`}
                    disabled={!!busy}
                    onClick={() => {
                      setBusy(`d${n.id}`)
                      void deleteNews(n.id).then((r) => {
                        setBusy('')
                        toast(r.error || '已删除')
                        if (!r.error) void reload()
                      })
                    }}
                  >
                    删除
                  </button>
                </span>
              </span>
            </div>
          ))}
        </div>
          {statsError ? (
            <p className={work.hint} style={{ marginTop: 8 }}>
              已读统计暂不可用（{statsError}）。需要先把 docs/release/news-broadcast-stats.sql 执行到数据库。
            </p>
          ) : null}
        </>
        )}
      </div>

      {preview ? (
        <div
          onClick={() => setPreview('')}
          role="dialog"
          aria-label="图片预览"
          style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(12,20,12,0.86)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <img src={preview} alt="图片预览" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8 }} />
        </div>
      ) : null}
    </div>
  )
}
