import { useEffect, useState } from 'react'
import { copyText } from '../../lib/campus-account'
import { isPublicMeetUrl, meetInviteTheme } from '../../lib/meet-share-url'
import { saveShareImage } from '../../lib/share-image'
import styles from './MeetShareCode.module.css'

type ShareDetails = { title: string; activity?: string; targetSize?: number; dateLabel?: string }
type Palette = { background: string; accent: string; secondary: string; decoration: string }

const THEMES: Palette[] = [
  { background: '#F3F7E8', accent: '#CDE7BB', secondary: '#E6F1DB', decoration: '#52936A' },
  { background: '#FFF2E4', accent: '#FFD2AC', secondary: '#FFF8EE', decoration: '#EB8E44' },
  { background: '#EDF7F4', accent: '#C4E5DF', secondary: '#F8FDF8', decoration: '#5A9D90' },
  { background: '#F5F2E7', accent: '#F5D5B4', secondary: '#FBFAEF', decoration: '#E59C59' },
]

const FOX_URL = `${import.meta.env.BASE_URL}brand/ohu-original/fox-todo-transparent.png`
const PAGE_WIDTH = 720
const PAGE_HEIGHT = 1080

function safeFilename(title: string): string {
  return `${title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim().slice(0, 50) || '碰个空'}-邀请卡.png`
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = url
  })
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function fitText(ctx: CanvasRenderingContext2D, value: string, maxWidth: number): string {
  const characters = Array.from(value)
  if (ctx.measureText(value).width <= maxWidth) return value
  while (characters.length && ctx.measureText(`${characters.join('')}…`).width > maxWidth) characters.pop()
  return `${characters.join('')}…`
}

function wrapTitle(ctx: CanvasRenderingContext2D, value: string, maxWidth: number): string[] {
  const chars = Array.from(value.trim() || '一起碰个空')
  let first = ''
  while (chars.length && ctx.measureText(first + chars[0]).width <= maxWidth) first += chars.shift()
  return chars.length ? [first, fitText(ctx, chars.join(''), maxWidth)] : [first]
}

function drawDecoration(ctx: CanvasRenderingContext2D, theme: number, color: string) {
  ctx.save()
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineWidth = 4
  ctx.globalAlpha = .7
  if (theme === 0) {
    // Two little leaves carry the oh-fox sprout motif.
    ctx.beginPath()
    ctx.moveTo(383, 72)
    ctx.quadraticCurveTo(390, 52, 403, 46)
    ctx.stroke()
    ctx.beginPath()
    ctx.ellipse(393, 52, 12, 6, -.6, 0, Math.PI * 2)
    ctx.ellipse(382, 55, 10, 5, .5, 0, Math.PI * 2)
    ctx.fill()
  } else if (theme === 1) {
    ctx.font = '700 32px system-ui, sans-serif'
    ctx.fillText('✦', 382, 65)
    ctx.font = '700 17px system-ui, sans-serif'
    ctx.fillText('✦', 416, 45)
  } else if (theme === 2) {
    for (const [x, y, r] of [[378, 54, 5], [397, 44, 7], [414, 57, 4]]) {
      ctx.beginPath()
      ctx.arc(x!, y!, r!, 0, Math.PI * 2)
      ctx.fill()
    }
  } else {
    ctx.font = '700 29px system-ui, sans-serif'
    ctx.fillText('✿', 386, 63)
    ctx.beginPath()
    ctx.arc(417, 43, 4, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

/** Render the share card on-device. The QR's white quiet zone is never decorated. */
async function createInvitePoster(qrData: string, details: ShareDetails, theme: number): Promise<string> {
  const [qr, fox] = await Promise.all([loadImage(qrData), loadImage(FOX_URL).catch(() => null)])
  const canvas = document.createElement('canvas')
  canvas.width = PAGE_WIDTH
  canvas.height = PAGE_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前设备不能生成邀请卡')
  const palette = THEMES[theme]!
  ctx.fillStyle = palette.background
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)
  ctx.fillStyle = palette.accent
  ctx.beginPath()
  ctx.ellipse(594, 139, 185, 164, -.32, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = palette.secondary
  ctx.beginPath()
  ctx.ellipse(95, 1045, 186, 92, .1, 0, Math.PI * 2)
  ctx.ellipse(645, 1061, 135, 77, -.2, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#0D4939'
  ctx.font = '700 23px system-ui, sans-serif'
  ctx.fillText('OHU  ·  碰个空', 52, 66)
  drawDecoration(ctx, theme, palette.decoration)
  ctx.font = '800 54px system-ui, sans-serif'
  const lines = wrapTitle(ctx, details.title, 390)
  lines.forEach((line, index) => ctx.fillText(line, 52, 140 + index * 67))
  ctx.fillStyle = '#4F7667'
  ctx.font = '500 24px system-ui, sans-serif'
  ctx.fillText('好朋友，一起找个好时间', 52, 276)
  if (fox) ctx.drawImage(fox, 440, 80, 235, 250)
  ctx.fillStyle = '#FFFFFF'
  roundedRect(ctx, 42, 330, 636, 650, 36)
  ctx.fill()
  ctx.fillStyle = '#174C3C'
  ctx.font = '700 24px system-ui, sans-serif'
  const metadata = [details.activity?.trim(), details.targetSize ? `目标 ${details.targetSize} 人` : '', details.dateLabel?.trim()].filter(Boolean).join('  ·  ')
  ctx.fillText(fitText(ctx, metadata || '邀请同学一起参加', 525), 70, 389)
  ctx.fillStyle = '#EDF3E9'
  roundedRect(ctx, 83, 422, 554, 457, 28)
  ctx.fill()
  ctx.fillStyle = '#FFFFFF'
  roundedRect(ctx, 107, 430, 506, 441, 22)
  ctx.fill()
  // The QR image already includes four white modules. Leave it exactly
  // untouched, centered with another white border to preserve scanability.
  const extent = Math.min(420, qr.naturalWidth, qr.naturalHeight)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(qr, (PAGE_WIDTH - extent) / 2, 448 + (420 - extent) / 2, extent, extent)
  ctx.imageSmoothingEnabled = true
  ctx.fillStyle = '#174C3C'
  ctx.font = '700 27px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('微信扫一扫，一起碰个空', PAGE_WIDTH / 2, 931)
  ctx.fillStyle = palette.decoration
  ctx.font = '700 24px system-ui, sans-serif'
  ctx.fillText('✦  邀请你加入  ✦', PAGE_WIDTH / 2, 1036)
  return canvas.toDataURL('image/png')
}

/** Encode locally: invitation URLs and course details never go to a QR service. */
export function MeetShareCode({ url, title, activity, targetSize, dateLabel }: ShareDetails & { url: string }) {
  const [image, setImage] = useState('')
  const [poster, setPoster] = useState('')
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const valid = isPublicMeetUrl(url)
  const theme = meetInviteTheme(url)

  useEffect(() => {
    let active = true
    setImage('')
    setPoster('')
    setError('')
    setFeedback('')
    if (!valid) return () => { active = false }
    void import('qrcode').then(async ({ default: qr }) => {
      const data = await qr.toDataURL(url, {
        errorCorrectionLevel: 'M',
        margin: 4,
        scale: 12,
        color: { dark: '#000000', light: '#FFFFFF' },
      })
      if (!active) return
      setImage(data)
      const card = await createInvitePoster(data, { title, activity, targetSize, dateLabel }, theme)
      if (active) setPoster(card)
    }).catch(() => { if (active) setError('邀请卡暂时没有生成成功，二维码仍可使用。') })
    return () => { active = false }
  }, [url, valid, attempt, title, activity, targetSize, dateLabel, theme])

  async function copy() {
    if (busy) return
    setBusy(true)
    const copied = await copyText(url)
    setFeedback(copied ? '邀请链接已复制，可以发给同学。' : '复制失败，请长按下方链接手动复制。')
    setBusy(false)
  }

  async function share() {
    if (busy) return
    if (!navigator.share) { await copy(); return }
    setBusy(true)
    try {
      const asset = poster || image
      const blob = asset ? await (await fetch(asset)).blob() : null
      const file = blob ? new File([blob], safeFilename(title), { type: 'image/png' }) : null
      const shareImage = file && navigator.canShare?.({ files: [file] })
      await navigator.share(shareImage
        ? { title: `${title} · 碰个空`, text: '选好有空的时间，一起碰个空。', files: [file] }
        : { title: `${title} · 碰个空`, text: '选好有空的时间，一起碰个空。', url })
      setFeedback('已打开系统分享。')
    } catch (failure) {
      if ((failure as Error).name !== 'AbortError') {
        const copied = await copyText(url)
        setFeedback(copied ? '邀请链接已复制，可以粘贴到微信。' : '系统分享未能打开，请长按下方链接复制。')
      }
    } finally { setBusy(false) }
  }

  async function download() {
    const asset = poster || image
    if (!asset || busy) return
    setBusy(true)
    setFeedback('正在保存邀请卡…')
    try { setFeedback(await saveShareImage(asset, safeFilename(title))) }
    catch (failure) { setFeedback(failure instanceof Error ? failure.message : '保存失败，请检查相册权限后重试。') }
    finally { setBusy(false) }
  }

  if (!valid) return <div className={styles.preview} role="status">
    <strong>分享二维码将在公开网页上线后提供</strong>
    <p>当前链接是本地预览地址，微信和其他手机暂时无法访问。</p>
  </div>

  return <section className={styles.root} aria-label="分享碰个空邀请" aria-busy={!poster && !error}>
    <div className={styles.heading}><span>SHARE WITH FRIENDS</span><h3>把好时间分享出去</h3><p>每个活动都有一张专属邀请卡</p></div>
    <div className={`${styles.frame} ${styles[`theme${theme}`]}`}>
      {poster ? <img className={styles.poster} src={poster} width={PAGE_WIDTH} height={PAGE_HEIGHT} alt={`${title}的邀请卡，含微信可识别的邀请二维码`} />
        : error ? <div className={styles.state} role="alert">{image ? <img className={styles.qrFallback} src={image} alt={`${title}的邀请二维码`} /> : null}<p>{image ? error : '二维码暂时没有生成成功，请重试。'}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>重新生成</button></div>
          : <p className={styles.state} role="status">正在生成邀请卡…</p>}
    </div>
    <p className={styles.hint}>微信扫一扫，或长按邀请卡识别二维码</p>
    <div className={styles.actions}>
      <button type="button" disabled={!image || busy} onClick={() => void share()}>分享邀请</button>
      <button type="button" disabled={!image || busy} onClick={() => void download()}>{busy ? '正在保存…' : poster ? '保存邀请卡' : '保存二维码'}</button>
      <button type="button" disabled={busy} onClick={() => void copy()}>复制链接</button>
    </div>
    <p className={styles.feedback} aria-live="polite">{feedback}</p>
    <a className={styles.link} href={url}>{url}</a>
  </section>
}
