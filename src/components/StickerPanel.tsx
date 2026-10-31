import { useEffect, useRef, useState } from 'react'
import { useToast } from '../context/ToastContext'
import { uploadChatImage } from '../lib/chat-image'
import { CHAT_EMOJIS } from '../lib/emoji'
import { drawSticker, renderStickerFile, STICKER_BG_OPTIONS } from '../lib/sticker-maker'
import { ImagePickButton } from './ImageUploadField'
import { FOX_V1_STICKERS, foxV1StickerFile, foxV1StickerUrl, type FoxV1StickerId } from '../lib/fox-v1-assets'
import {
  addSticker,
  getStickers,
  pullStickers,
  removeSticker,
  STICKER_LIMIT,
  subscribeStickers,
} from '../lib/stickers'
import styles from './StickerPanel.module.css'

/**
 * 表情 / 表情包面板。
 *
 * - 「表情」是字符，直接插进输入框（系统键盘本来也能打，这里只是省得翻页找）
 * - 「我的表情包」是图片：可以**添加**（相册 / 拍照 / 文件）也可以**制作**
 *   （文字画到 Canvas 导出 PNG），两者最终都上传成一张图存进表情包
 * - 表情包本质就是图片，点一下按图片消息发出，发送链路完全复用
 */
export function StickerPanel({
  uid,
  onEmoji,
  onSticker,
}: {
  uid: string
  onEmoji: (emoji: string) => void
  onSticker: (url: string) => void
}) {
  const toast = useToast()
  const [tab, setTab] = useState<'emoji' | 'fox' | 'mine'>('emoji')
  const [stickers, setStickers] = useState(() => getStickers(uid))
  const [busy, setBusy] = useState(false)
  const [foxBusy, setFoxBusy] = useState<FoxV1StickerId | null>(null)
  const [foxUrls, setFoxUrls] = useState<Partial<Record<FoxV1StickerId, string>>>({})
  const [pickerOpen, setPickerOpen] = useState(false)
  const [makerOpen, setMakerOpen] = useState(false)
  const [draftText, setDraftText] = useState('')
  const [draftBg, setDraftBg] = useState(STICKER_BG_OPTIONS[0])
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => subscribeStickers(() => setStickers(getStickers(uid))), [uid])
  useEffect(() => {
    setStickers(getStickers(uid))
    if (uid) void pullStickers(uid).then((rows) => setStickers(rows))
  }, [uid])

  useEffect(() => {
    if (!makerOpen || !canvasRef.current) return
    drawSticker(canvasRef.current, { text: draftText, bg: draftBg })
  }, [makerOpen, draftText, draftBg])

  async function saveUploaded(file: File, text = '') {
    if (!uid) {
      toast.err('登录后才能添加表情包')
      return
    }
    setBusy(true)
    const up = await uploadChatImage(file, uid)
    setBusy(false)
    if (up.error || !up.url) {
      toast.err(up.error || '图片上传失败，请稍后重试')
      return
    }
    if (!addSticker(uid, up.url, text).some((s) => s.url === up.url)) {
      toast.err(`表情包最多 ${STICKER_LIMIT} 个，先删几个吧`)
      return
    }
    toast.ok('已加入我的表情包')
  }

  async function makeSticker() {
    const text = draftText.trim()
    if (!text) {
      toast.err('先写点文字吧')
      return
    }
    setBusy(true)
    const file = await renderStickerFile({ text, bg: draftBg })
    setBusy(false)
    if (!file) {
      toast.err('生成失败，换个文字试试')
      return
    }
    await saveUploaded(file, text)
    setMakerOpen(false)
    setDraftText('')
  }

  async function sendFox(pose: FoxV1StickerId) {
    if (foxBusy || !uid) return
    const cached = foxUrls[pose]
    if (cached) { onSticker(cached); return }
    setFoxBusy(pose)
    try {
      const up = await uploadChatImage(await foxV1StickerFile(pose), uid)
      if (up.error || !up.url) { toast.err(up.error || '阿狐表情发送失败，请重试'); return }
      setFoxUrls((current) => ({ ...current, [pose]: up.url! }))
      onSticker(up.url)
    } catch { toast.err('阿狐表情暂时无法发送，请重试') }
    finally { setFoxBusy(null) }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.tabs}>
        <button type="button" className={`${styles.tab} ${tab === 'emoji' ? styles.tabOn : ''}`} onClick={() => setTab('emoji')}>
          表情
        </button>
        <button type="button" className={`${styles.tab} ${tab === 'fox' ? styles.tabOn : ''}`} onClick={() => setTab('fox')}>
          阿狐表情
        </button>
        <button type="button" className={`${styles.tab} ${tab === 'mine' ? styles.tabOn : ''}`} onClick={() => setTab('mine')}>
          我的表情包
        </button>
      </div>

      {tab === 'emoji' ? (
        <div className={`${styles.grid} hide-scroll`}>
          {CHAT_EMOJIS.map((e, i) => (
            <button key={`${e}-${i}`} type="button" className={styles.cell} onClick={() => onEmoji(e)} aria-label={`表情 ${i + 1}`}>
              {e}
            </button>
          ))}
        </div>
      ) : null}

      {tab === 'fox' ? <div className={`${styles.grid} ${styles.stickerGrid} hide-scroll`} role="group" aria-label="阿狐表情包">
        {FOX_V1_STICKERS.map((sticker) => <button key={sticker.id} type="button" className={styles.sticker} disabled={!!foxBusy} onClick={() => void sendFox(sticker.id)} aria-label={`发送${sticker.name}`} title={sticker.caption}>
          <img src={foxV1StickerUrl(sticker)} alt="" width="512" height="512" loading="lazy" />
          {foxBusy === sticker.id ? <span className={styles.sending}>发送中…</span> : null}
        </button>)}
      </div> : null}

      {tab === 'mine' ? (
        <>
          <div className={`${styles.grid} ${styles.stickerGrid} hide-scroll`}>
            {stickers.map((s) => (
              <div key={s.id} style={{ position: 'relative' }}>
                <button type="button" className={styles.sticker} onClick={() => onSticker(s.url)} aria-label="发送表情包">
                  <img src={s.url} alt={s.text || '表情包'} loading="lazy" />
                </button>
                <button type="button" className={styles.del} aria-label="删除表情包" onClick={() => removeSticker(uid, s.id)}>
                  ✕
                </button>
              </div>
            ))}
            {stickers.length < STICKER_LIMIT ? (
              <button type="button" className={styles.add} onClick={() => setPickerOpen(true)} aria-label="添加表情包">
                ＋
              </button>
            ) : null}
          </div>
          {stickers.length === 0 ? <p className={styles.empty}>还没有表情包，点「＋」添加，或自己做一个</p> : null}
          <div className={styles.bar}>
            <span className={styles.barHint}>{busy ? '处理中…' : `最多 ${STICKER_LIMIT} 个`}</span>
            <button type="button" className={styles.miniBtn} onClick={() => setMakerOpen((v) => !v)} disabled={busy}>
              {makerOpen ? '收起' : '自己做'}
            </button>
          </div>
          {makerOpen ? (
            <div className={styles.maker}>
              <div className={styles.preview}>
                <canvas ref={canvasRef} />
              </div>
              <div className={styles.makerMain}>
                <input
                  className={styles.makerInput}
                  value={draftText}
                  maxLength={40}
                  placeholder="写点文字，可以带表情"
                  onChange={(e) => setDraftText(e.target.value)}
                />
                <div className={styles.swatches}>
                  {STICKER_BG_OPTIONS.map((bg) => (
                    <button
                      key={bg}
                      type="button"
                      className={`${styles.swatch} ${draftBg === bg ? styles.swatchOn : ''}`}
                      style={{ background: bg }}
                      aria-label={`底色 ${bg}`}
                      onClick={() => setDraftBg(bg)}
                    />
                  ))}
                </div>
                <div className={styles.makerActions}>
                  <button type="button" className={styles.miniBtn} onClick={() => void makeSticker()} disabled={busy}>
                    保存为表情包
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {pickerOpen ? (
        <ImagePickButton label="从相册选择" onPick={(files) => { setPickerOpen(false); if (files[0]) void saveUploaded(files[0]) }} />
      ) : null}
    </div>
  )
}
