/**
 * 头像裁剪弹层
 *
 * 裁剪引擎换成 react-easy-crop（MIT）：拖动挪位置、双指捏合（或拖滑杆）缩放、网格辅助线。
 * 圆形取景圈里看到什么，导出就是什么 —— 所见即所得。
 *
 * 为什么换掉自研版：旧实现里圆形取景圈只占取景框的 78%，导出却按整个正方形走，
 * 结果比预览大一圈（所见非所得）。react-easy-crop 直接在**源图坐标**上给出裁剪区
 * （croppedAreaPixels），照它 drawImage 必然对得上。顺带把统一的 512² JPEG 压缩也保住了。
 *
 * 纯 Web 实现（无原生插件），可直接走 OTA。
 */
import { useCallback, useEffect, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import 'react-easy-crop/react-easy-crop.css'
import { AVATAR_OUT, canvasToFile } from '../lib/avatar-crop'
import { DialogLayer } from './ui/DialogLayer'
import s from './AvatarCropper.module.css'

const MIN_ZOOM = 1
const MAX_ZOOM = 4

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.addEventListener('load', () => resolve(img))
    img.addEventListener('error', () => reject(new Error('image load failed')))
    img.src = src
  })
}

export function AvatarCropper({
  file,
  busy,
  topLayer = false,
  onCancel,
  onConfirm,
}: {
  file: File | null
  busy?: boolean
  topLayer?: boolean
  onCancel: () => void
  onConfirm: (file: File) => void
}) {
  const [url, setUrl] = useState('')
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  /** 源图坐标上的裁剪区；点确认时按它直出 512² */
  const [area, setArea] = useState<Area | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!file) {
      setUrl('')
      return
    }
    const objectUrl = URL.createObjectURL(file)
    setUrl(objectUrl)
    setCrop({ x: 0, y: 0 })
    setZoom(1)
    setArea(null)
    setErr('')
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  const onCropComplete = useCallback((_percent: Area, pixels: Area) => {
    setArea(pixels)
  }, [])

  const confirm = async () => {
    if (!area || !url) return
    setErr('')
    try {
      const img = await loadImage(url)
      const canvas = document.createElement('canvas')
      canvas.width = AVATAR_OUT
      canvas.height = AVATAR_OUT
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        setErr('裁剪失败，换一张试试')
        return
      }
      // 白底：PNG 透明区导出成 JPEG 不会变黑
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, AVATAR_OUT, AVATAR_OUT)
      // aspect=1，取较短边保证是正方形，避免 1px 误差导致拉伸
      const side = Math.min(area.width, area.height)
      ctx.drawImage(img, area.x, area.y, side, side, 0, 0, AVATAR_OUT, AVATAR_OUT)
      const out = await canvasToFile(canvas)
      if (!out) {
        setErr('裁剪失败，换一张试试')
        return
      }
      onConfirm(out)
    } catch {
      setErr('这张图读不出来，换一张试试')
    }
  }

  if (!file) return null

  const content = (
      <div className={s.card}>
        <div className={s.head}>
          <b className={s.title}>调整头像</b>
          <button type="button" className={s.close} onClick={onCancel} aria-label="取消">
            ✕
          </button>
        </div>
        <p className={s.hint}>拖动挪位置，双指捏合或拖滑杆缩放。圆形内就是最终头像。</p>

        <div className={s.stage}>
          {url ? (
            <Cropper
              image={url}
              crop={crop}
              zoom={zoom}
              rotation={0}
              aspect={1}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              cropShape="round"
              showGrid
              /* cover：图片始终盖满取景框，避免取景圈里露白边 */
              objectFit="cover"
              restrictPosition
              zoomWithScroll
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          ) : null}
        </div>

        <label className={s.zoomRow}>
          <span>缩放</span>
          <input
            className={s.slider}
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            disabled={!url}
            aria-label="缩放"
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>

        {err ? <p className={s.err}>{err}</p> : null}

        <div className={s.actions}>
          <button type="button" className={s.ghost} onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button type="button" className={s.main} onClick={() => void confirm()} disabled={busy || !area}>
            {busy ? '上传中…' : '就用这张'}
          </button>
        </div>
      </div>
  )

  return topLayer
    ? <DialogLayer title="调整头像" className={s.dialogSurface} onClose={onCancel} allowClose={!busy}>{content}</DialogLayer>
    : <div className={s.mask} role="dialog" aria-modal="true" aria-label="调整头像">{content}</div>
}
