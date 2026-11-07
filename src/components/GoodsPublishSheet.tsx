/**
 * 二手集市「发布闲置」弹层：校区 + 分类 + 成色 + 价格 + 图片 + 联系方式。
 * 图片上传到 pgstore 桶 images；登录门控在提交前做。
 */
import { useState } from 'react'
import { CAMPUSES, composeLocation } from '../lib/campus'
import { useCampusPreference } from '../lib/use-campus-preference'
import { createItem, uploadImages } from '../lib/market'
import { useAuth } from '../lib/auth'
import { useToast } from '../context/ToastContext'
import { DialogLayer } from './ui/DialogLayer'
import sheet from '../pages/work.module.css'

const CATEGORIES = ['教材', '电车', '自行车', '数码', '生活'] as const
const CONDITIONS = ['全新', '九成新', '八成新', '可议价'] as const
const MAX_IMAGES = 3

export function GoodsPublishSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const auth = useAuth()
  const { campus, setCampus } = useCampusPreference()
  const [category, setCategory] = useState<string>(CATEGORIES[0])
  const [condition, setCondition] = useState<string>(CONDITIONS[1])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [place, setPlace] = useState('')
  const [contact, setContact] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function pickImages(files: FileList | null) {
    if (!files || !files.length) return
    const room = MAX_IMAGES - images.length
    if (room <= 0) {
      setErr(`最多上传 ${MAX_IMAGES} 张图片`)
      return
    }
    setUploading(true)
    const res = await uploadImages(Array.from(files).slice(0, room), 'secondhand')
    setUploading(false)
    if (res.error) {
      setErr(res.error)
      return
    }
    setImages((list) => [...list, ...res.urls].slice(0, MAX_IMAGES))
    setErr('')
  }

  async function submit() {
    if (busy || uploading) return
    if (!campus) return setErr('请选择发布校区')
    if (!title.trim()) return setErr('请填写商品标题')
    if (!/^\d+(\.\d{1,2})?$/.test(price.trim())) return setErr('请填写正确的价格')
    if (!contact.trim()) return setErr('请填写联系方式，买家才能找到你')
    if (!(await auth.ensureSignedIn('发布闲置需要登录'))) return

    setErr('')
    setBusy(true)
    const res = await createItem({
      title: title.trim(),
      description: description.trim(),
      category,
      condition,
      price: Number(price.trim()),
      images,
      building: composeLocation(campus, place),
      contact: contact.trim(),
      creator_name: auth.profile?.username || '同学',
    })
    setBusy(false)
    if (res.error) {
      setErr(res.error)
      toast.err(res.error)
      return
    }
    toast.ok('闲置已发布')
    onDone()
  }

  return (
    <DialogLayer title="发布闲置" className={sheet.sheet} onClose={onClose} allowClose={!busy && !uploading}>
        <div className={sheet.handle} />
        <h3 className={sheet.sheetTitle}>发布闲置</h3>

        <div className={sheet.field}>
          <label htmlFor="gp-campus">
            校区 <em>*</em>
          </label>
          <div className={sheet.seg} id="gp-campus">
            {CAMPUSES.map((c) => (
              <button
                key={c}
                type="button"
                className={`${sheet.segBtn} ${c === campus ? sheet.segOn : ''}`}
                aria-pressed={c === campus}
                onClick={() => setCampus(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className={sheet.field}>
          <label htmlFor="gp-cat">分类</label>
          <div className={sheet.seg} id="gp-cat">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                className={`${sheet.segBtn} ${c === category ? sheet.segOn : ''}`}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className={sheet.field}>
          <label htmlFor="gp-cond">成色</label>
          <div className={sheet.seg} id="gp-cond">
            {CONDITIONS.map((c) => (
              <button
                key={c}
                type="button"
                className={`${sheet.segBtn} ${c === condition ? sheet.segOn : ''}`}
                onClick={() => setCondition(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className={sheet.field}>
          <label htmlFor="gp-title">
            商品标题 <em>*</em>
          </label>
          <input
            id="gp-title"
            className={sheet.input}
            value={title}
            maxLength={40}
            placeholder="例如：九成新《高数》教材"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className={sheet.field}>
          <label htmlFor="gp-desc">商品描述</label>
          <textarea
            id="gp-desc"
            className={sheet.area}
            rows={3}
            value={description}
            placeholder="成色、购买时间、有无笔记…"
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className={sheet.grid2}>
          <div className={sheet.field}>
            <label htmlFor="gp-price">
              价格（元） <em>*</em>
            </label>
            <input
              id="gp-price"
              className={sheet.input}
              inputMode="decimal"
              value={price}
              placeholder="例如：25"
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>
          <div className={sheet.field}>
            <label htmlFor="gp-place">具体地点</label>
            <input
              id="gp-place"
              className={sheet.input}
              value={place}
              placeholder="例如：3 号宿舍楼楼下"
              onChange={(e) => setPlace(e.target.value)}
            />
          </div>
        </div>

        <div className={sheet.field}>
          <label htmlFor="gp-images">商品图片</label>
          <input
            id="gp-images"
            type="file"
            accept="image/*"
            multiple
            className={sheet.input}
            disabled={uploading || images.length >= MAX_IMAGES}
            onChange={(e) => {
              void pickImages(e.target.files)
              e.target.value = ''
            }}
          />
          {uploading ? <p className={sheet.preview}>图片上传中…</p> : null}
          {images.length ? (
            <div className={sheet.seg}>
              {images.map((url) => (
                <img
                  key={url}
                  src={url}
                  alt="预览"
                  style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10 }}
                />
              ))}
            </div>
          ) : null}
        </div>

        <div className={sheet.field}>
          <label htmlFor="gp-contact">
            联系方式 <em>*</em>
          </label>
          <input
            id="gp-contact"
            className={sheet.input}
            value={contact}
            placeholder="手机号或微信号，仅登录同学可见"
            onChange={(e) => setContact(e.target.value)}
          />
        </div>

        <p className={sheet.preview}>
          将发布到：<b>{campus ? composeLocation(campus, place) : '请先选择校区'}</b>
        </p>

        {err ? <p className={sheet.err}>{err}</p> : null}

        <div className={sheet.btnRow} data-input-actions="">
          <button
            type="button"
            className={`${sheet.btn} ${sheet.btnBlk} ${sheet.btnN}`}
            disabled={busy}
            onClick={onClose}
          >
            再想想
          </button>
          <button
            type="button"
            className={`${sheet.btn} ${sheet.btnBlk} ${sheet.btnP}`}
            disabled={busy || uploading}
            onClick={submit}
          >
            {busy ? '发布中…' : '发布闲置'}
          </button>
        </div>
    </DialogLayer>
  )
}
