/**
 * 信息站发布：生活求助 / 组队出行（走 bulletin.publishHelp / createActivity）。
 */
import { useState } from 'react'
import {
  HELP_KIND_OPTIONS,
  TEAMUP_TAGS,
  createActivity,
  publishHelp,
} from '../lib/bulletin'
import { useAuth } from '../lib/auth'
import { useToast } from '../context/ToastContext'
import { uploadUgcImage } from '../lib/ugc-image'
import { DialogLayer } from './ui/DialogLayer'
import styles from './TaskSheet.module.css'

export type InfoPublishMode = 'help' | 'teamup'

const HELP_KINDS = HELP_KIND_OPTIONS.filter((k) => k.value)

/** 求助可带多张配图；组队走 activities.cover，只存一张封面 */
const MAX_HELP_IMAGES = 3

export function InfoPublishSheet({
  mode,
  onClose,
  onDone,
}: {
  mode: InfoPublishMode
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const auth = useAuth()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const [kind, setKind] = useState(HELP_KINDS[0]?.value || 'help')
  const [tag, setTag] = useState(TEAMUP_TAGS[0])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [place, setPlace] = useState('')
  const [contact, setContact] = useState('')
  const [seats, setSeats] = useState('4')
  const [startAt, setStartAt] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)

  /**
   * 配图：与能正常上传的「发布闲置」同一套写法——可见的原生 file input。
   * 不用 ImageSourceSheet：那个弹层把 input 放在遮罩里，label 转发的点击
   * 会冒泡到「点遮罩关闭」，选完图没有任何动静（线上实测）。
   */
  async function pickImages(files: FileList | null) {
    /* 同步拷一份：onChange 里紧接着会清空 value，FileList 是活引用 */
    const list = files ? Array.from(files) : []
    if (!list.length) return
    const isHelp = mode === 'help'
    const limit = isHelp ? MAX_HELP_IMAGES : 1
    const uid = String(auth.user?.uid || '').trim()
    if (!uid) {
      if (await auth.ensureSignedIn('发布配图需要先登录')) setErr('已登录，请再选一次图片')
      return
    }
    const room = limit - images.length
    if (room <= 0) {
      setErr(isHelp ? `最多上传 ${limit} 张图片` : '封面图只能上传 1 张')
      return
    }
    setErr('')
    setUploading(true)
    for (const file of list.slice(0, room)) {
      const res = await uploadUgcImage(file, uid, isHelp ? 'help' : 'activity')
      if (res.error) {
        setErr(res.error)
        toast.err(res.error)
        break
      }
      if (res.url) {
        setImages((prev) => (prev.includes(res.url as string) ? prev : [...prev, res.url as string]).slice(0, limit))
      }
    }
    setUploading(false)
  }

  async function submit() {
    if (busy || uploading) return
    if (!title.trim()) {
      setErr('请填写标题')
      return
    }
    if (!contact.trim()) {
      setErr('请填写联系方式，方便同学找到你')
      return
    }
    if (!(await auth.ensureSignedIn(mode === 'help' ? '发布求助需要登录' : '发起组队需要登录'))) return

    const name = auth.profile?.username || auth.user?.nickname || '同学'
    setErr('')
    setBusy(true)

    if (mode === 'help') {
      const res = await publishHelp({
        kind,
        category: HELP_KINDS.find((k) => k.value === kind)?.label || '互助',
        title: title.trim(),
        description: description.trim(),
        place: place.trim() || '校园',
        expect_at: '',
        contact: contact.trim(),
        images,
        creator_name: name,
      })
      setBusy(false)
      if (res.error) {
        setErr(res.error)
        toast.err(res.error)
        return
      }
      toast.ok('求助已发布，宠物也记了一笔成长')
      onDone()
      return
    }

    const seatN = Math.max(0, Math.min(99, Number(seats) || 0))
    const descParts = [description.trim(), contact.trim() ? `联系：${contact.trim()}` : ''].filter(Boolean)
    const res = await createActivity({
      title: title.trim(),
      organizer: name,
      description: descParts.join('\n'),
      tag,
      location: place.trim() || '校园',
      start_at: startAt.trim() || '待定',
      end_at: '',
      seats: seatN,
      /* 组队没有 images 列，配图落在已有的 cover 上 */
      cover: images[0] || '',
      creator_name: name,
      category: 'teamup',
    })
    setBusy(false)
    if (res.error) {
      setErr(res.error)
      toast.err(res.error)
      return
    }
    toast.ok('组队已发起，等搭子报名吧')
    onDone()
  }

  const isHelp = mode === 'help'

  return (
    <DialogLayer title={isHelp ? '发布生活求助' : '发起组队出行'} className={styles.sheet} onClose={onClose} allowClose={!busy && !uploading}>
        <div className={styles.handle} />
        <div className={styles.head}>
          <span className={styles.headIc}>{isHelp ? '🤝' : '🚌'}</span>
          <span className={styles.headTxt}>
            <b>{isHelp ? '发布生活求助' : '发起组队出行'}</b>
            <span>{isHelp ? '拼单、借物、临时帮忙' : '同城出游、返乡、运动搭子'}</span>
          </span>
        </div>

        <div className={styles.field}>
          <label>{isHelp ? '类型' : '标签'}</label>
          <div className={styles.chips}>
            {(isHelp ? HELP_KINDS : TEAMUP_TAGS.map((t) => ({ value: t, label: t }))).map((k) => {
              const on = isHelp ? kind === k.value : tag === k.value
              return (
                <button
                  key={k.value}
                  type="button"
                  className={`${styles.chip} ${on ? styles.chipOn : ''}`}
                  onClick={() => (isHelp ? setKind(k.value) : setTag(k.value))}
                >
                  {k.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className={styles.field}>
          <label htmlFor="info-pub-title">
            标题<em>必填</em>
          </label>
          <input
            id="info-pub-title"
            className={styles.input}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={isHelp ? '例如：今晚食堂拼奶茶' : '例如：周末宋跳骑行'}
            maxLength={40}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="info-pub-desc">说明</label>
          <textarea
            id="info-pub-desc"
            className={styles.area}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="补充时间、人数、注意事项…"
            maxLength={200}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="info-pub-images">
            {isHelp ? '配图' : '封面图'}
            <em>选填{isHelp ? `，最多 ${MAX_HELP_IMAGES} 张` : ''}</em>
          </label>
          {/* 可见的原生 file input：手指直接落在原生控件上，手势不会丢 */}
          <input
            id="info-pub-images"
            className={styles.input}
            type="file"
            accept="image/*"
            multiple={isHelp}
            disabled={uploading || images.length >= (isHelp ? MAX_HELP_IMAGES : 1)}
            onChange={(e) => {
              void pickImages(e.target.files)
              e.target.value = ''
            }}
          />
          {uploading ? <p className={styles.preview}>图片上传中…</p> : null}
          {images.length ? (
            <div className={styles.chips}>
              {images.map((url) => (
                <img
                  key={url}
                  src={url}
                  alt="配图预览"
                  style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10 }}
                  onClick={() => setImages((prev) => prev.filter((u) => u !== url))}
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className={styles.row2}>
          <div className={styles.field}>
            <label htmlFor="info-pub-place">地点</label>
            <input
              id="info-pub-place"
              className={styles.input}
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              placeholder="校区 / 集合点"
              maxLength={40}
            />
          </div>
          {isHelp ? (
            <div className={styles.field}>
              <label htmlFor="info-pub-contact">
                联系方式<em>必填</em>
              </label>
              <input
                id="info-pub-contact"
                className={styles.input}
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="微信 / 手机"
                maxLength={40}
              />
            </div>
          ) : (
            <div className={styles.field}>
              <label htmlFor="info-pub-seats">人数上限</label>
              <input
                id="info-pub-seats"
                className={styles.input}
                value={seats}
                onChange={(e) => setSeats(e.target.value)}
                placeholder="0 不限"
                inputMode="numeric"
              />
            </div>
          )}
        </div>

        {!isHelp ? (
          <div className={styles.row2}>
            <div className={styles.field}>
              <label htmlFor="info-pub-start">出发时间</label>
              <input
                id="info-pub-start"
                className={styles.input}
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
                placeholder="如 周六 9:00"
                maxLength={40}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="info-pub-contact2">
                联系方式<em>必填</em>
              </label>
              <input
                id="info-pub-contact2"
                className={styles.input}
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="微信 / 手机"
                maxLength={40}
              />
            </div>
          </div>
        ) : null}

        {err ? <p className={styles.err}>{err}</p> : null}

        <div className={styles.acts} data-input-actions="">
          <button type="button" className={styles.cancel} disabled={busy} onClick={onClose}>
            取消
          </button>
          <button type="button" className={styles.submit} disabled={busy || uploading} onClick={() => void submit()}>
            {busy ? '提交中…' : uploading ? '图片上传中…' : '发布'}
          </button>
        </div>
    </DialogLayer>
  )
}
