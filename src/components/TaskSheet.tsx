/**
 * 发布任务底部弹层：**校区必选**（通灌 / 苍梧 / 宋跳），再填类型与详情。
 *
 * 校区落库进 `tasks.location`（表无独立 campus 列），格式「校区 · 具体地点」，
 * 由 lib/campus 统一组合，保证卡片徽标与 📍 地点两处口径一致。
 * 登录门控在提交前做，避免用户填完才被拦。
 */
import { useState } from 'react'
import { ConfirmSheet } from './ConfirmSheet'
import { CAMPUSES, composeLocation } from '../lib/campus'
import { useCampusPreference } from '../lib/use-campus-preference'
import { TASK_KINDS, createTask } from '../lib/market'
import { uploadTaskImage } from '../lib/task-images'
import { useAuth } from '../lib/auth'
import { useToast } from '../context/ToastContext'
import styles from './TaskSheet.module.css'

/** 与 tasks 表 images 列、TaskImageGallery 的展示上限保持一致 */
const MAX_TASK_IMAGES = 3

export function TaskSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const auth = useAuth()
  const { campus, setCampus } = useCampusPreference()
  const [kind, setKind] = useState<string>(TASK_KINDS[0])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [reward, setReward] = useState('')
  const [place, setPlace] = useState('')
  const [deadline, setDeadline] = useState('')
  const [contact, setContact] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  /* 误触遮罩不该丢掉填了一半的表单：有内容时先确认 */
  const [askClose, setAskClose] = useState(false)

  /* 配图：走与「发布闲置」相同的可见原生 file input。不用弹层选图 —— 之前那个弹层
     把 input 放在遮罩里，转发的点击会冒泡到「点遮罩关闭」，选完图没有任何动静。 */
  async function pickImages(files: FileList | null) {
    /* 先同步拷一份：onChange 里紧接着会清空 value，FileList 是活引用，会被清空 */
    const list = files ? Array.from(files) : []
    if (!list.length) return
    const uid = String(auth.user?.uid || '').trim()
    if (!uid) {
      if (await auth.ensureSignedIn('发布任务配图需要先登录')) setErr('已登录，请再选一次图片')
      return
    }
    const room = MAX_TASK_IMAGES - images.length
    if (room <= 0) {
      setErr(`最多上传 ${MAX_TASK_IMAGES} 张图片`)
      return
    }
    setErr('')
    setUploading(true)
    for (const file of list.slice(0, room)) {
      const res = await uploadTaskImage(file, uid)
      if (res.error) {
        setErr(res.error)
        toast.err(res.error)
        break
      }
      if (res.url) {
        setImages((list) => (list.includes(res.url as string) ? list : [...list, res.url as string]).slice(0, MAX_TASK_IMAGES))
      }
    }
    setUploading(false)
  }

  function requestClose() {
    const dirty =
      Boolean(title.trim() || description.trim() || reward.trim() || place.trim() || contact.trim() || deadline) ||
      Boolean(campus) ||
      images.length > 0
    if (dirty) setAskClose(true)
    else onClose()
  }

  async function submit() {
    if (busy || uploading) return
    if (!campus) {
      setErr('请选择发布校区')
      return
    }
    if (!title.trim()) {
      setErr('请填写任务标题')
      return
    }
    if (!contact.trim()) {
      setErr('请填写联系方式，接单同学才能找到你')
      return
    }
    if (reward.trim() && !/^\d+(\.\d{1,2})?$/.test(reward.trim())) {
      setErr('酬劳请填数字，留空表示面议')
      return
    }

    if (!(await auth.ensureSignedIn('发布任务需要登录'))) return

    setErr('')
    setBusy(true)
    const res = await createTask({
      title: title.trim(),
      description: description.trim(),
      kind,
      reward: reward.trim(),
      location: composeLocation(campus, place),
      deadline: deadline.trim(),
      contact: contact.trim(),
      images,
      creator_name: auth.profile?.username || '同学',
      /* 显式带上 owner：避免上传期间换了账号，任务被挂到别人名下 */
      creator_uid: String(auth.user?.uid || '').trim() || undefined,
    })
    setBusy(false)
    if (res.error) {
      setErr(res.error)
      toast.err(res.error)
      return
    }
    toast.ok('任务已发布')
    onDone()
  }

  return (
    <div className={styles.mask} onClick={requestClose} role="presentation">
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="发布任务">
        <div className={styles.handle} />

        <div className={styles.head}>
          <span className={styles.headIc}>📦</span>
          <span className={styles.headTxt}>
            <b>发布任务</b>
            <span>{campus ? `已沿用${campus}，无需重复选择` : '选好校区，同校区的同学才能就近接单'}</span>
          </span>
        </div>

        <div className={styles.field}>
          <label htmlFor="task-campus">
            校区<em>{campus ? '已选，可切换' : '必选'}</em>
          </label>
          <div className={styles.campusRow} id="task-campus">
            {CAMPUSES.map((c) => (
              <button
                key={c}
                type="button"
                className={`${styles.campus} ${c === campus ? styles.campusOn : ''}`}
                aria-pressed={c === campus}
                onClick={() => setCampus(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <label htmlFor="task-kind">任务类型</label>
          <div className={styles.chips} id="task-kind">
            {TASK_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                className={`${styles.chip} ${k === kind ? styles.chipOn : ''}`}
                onClick={() => setKind(k)}
              >
                {k}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <label htmlFor="task-title">任务标题</label>
          <input
            id="task-title"
            className={styles.input}
            placeholder="例如：帮取一个快递到 3 号宿舍楼"
            maxLength={40}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="task-desc">
            任务说明<em>选填</em>
          </label>
          <textarea
            id="task-desc"
            className={styles.area}
            rows={3}
            placeholder="件数、大小、注意事项…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="task-images">
            配图<em>选填，最多 {MAX_TASK_IMAGES} 张</em>
          </label>
          {/* 用可见的原生 input，和「发布闲置」一致。别改成按钮 + JS 触发：
              WebView 要求唤起选择器必须在手势的同步调用栈里，插了 setState 就失效。 */}
          <input
            id="task-images"
            className={styles.input}
            type="file"
            accept="image/*"
            multiple
            disabled={uploading || images.length >= MAX_TASK_IMAGES}
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
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className={styles.row2}>
          <div className={styles.field}>
            <label htmlFor="task-reward">
              酬劳（元）<em>选填</em>
            </label>
            <input
              id="task-reward"
              className={styles.input}
              placeholder="留空为面议"
              inputMode="decimal"
              value={reward}
              onChange={(e) => setReward(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="task-deadline">
              希望完成时间<em>选填</em>
            </label>
            <input
              id="task-deadline"
              className={styles.input}
              placeholder="例如：今天 18:00"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>
        </div>

        <div className={styles.field}>
          <label htmlFor="task-place">
            具体地点<em>选填</em>
          </label>
          <input
            id="task-place"
            className={styles.input}
            placeholder="例如：各校区驿站 / 图书馆一楼"
            value={place}
            onChange={(e) => setPlace(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="task-contact">联系方式</label>
          <input
            id="task-contact"
            className={styles.input}
            placeholder="手机号或微信号，仅登录同学可见"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
          />
        </div>

        <p className={styles.preview}>
          将发布到：<b>{campus ? composeLocation(campus, place) : '请先选择校区'}</b>
        </p>

        {err ? <p className={styles.err}>{err}</p> : null}

        <div className={styles.acts}>
          <button type="button" className={styles.cancel} onClick={onClose} disabled={busy}>
            再想想
          </button>
          <button type="button" className={styles.submit} onClick={submit} disabled={busy || uploading}>
            {busy ? '发布中…' : uploading ? '图片上传中…' : '发布任务'}
          </button>
        </div>
      </div>

      {askClose ? (
        <ConfirmSheet
          title="放弃这次发布？"
          desc="已填写的内容不会保存"
          confirmText="放弃"
          cancelText="继续编辑"
          danger
          onClose={() => setAskClose(false)}
          onConfirm={() => {
            setAskClose(false)
            onClose()
          }}
        />
      ) : null}
    </div>
  )
}
