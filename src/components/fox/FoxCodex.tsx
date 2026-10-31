/**
 * 首发表情图鉴：16 款全部可查看，不以登录天数锁定。
 * 使用应用共用弹层，让关闭、返回键与焦点行为保持一致。
 */
import { useState } from 'react'
import { FOX_V1_STICKERS, foxV1StickerUrl, type FoxV1StickerId } from '../../lib/fox-v1-assets'
import { DialogLayer } from '../ui/DialogLayer'
import { getUiVariant, isFoxFreeVariant } from '../../lib/ui-variant'
import styles from './FoxCodex.module.css'

const LS_SEEN = 'sc.fox.codex.v1'

function readSeen(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(LS_SEEN) || '[]')
    return Array.isArray(value) ? value.filter((state): state is string => typeof state === 'string') : []
  } catch {
    return []
  }
}

/** 保留历史状态记录接口；首发图鉴不依赖这些记录设定门槛。 */
export function markCodexSeen(state: string): void {
  if (!state || state === 'default') return
  const seen = readSeen()
  if (seen.includes(state)) return
  try {
    localStorage.setItem(LS_SEEN, JSON.stringify([...seen, state]))
  } catch {
    /* 本地存储不可写时继续显示当前表情。 */
  }
}

export function FoxCodex({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState<FoxV1StickerId>(FOX_V1_STICKERS[0].id)
  const preview = FOX_V1_STICKERS.find((sticker) => sticker.id === selected) || FOX_V1_STICKERS[0]

  /* 无狐皮肤不出现表情图鉴（含狐狸表情格子）。早退必须放在全部 hook 之后。 */
  if (isFoxFreeVariant(getUiVariant())) return null

  return <DialogLayer title="阿狐表情图鉴" onClose={onClose} className={styles.sheet}>
    <div className={styles.handle} aria-hidden="true" />
    <div className={styles.head}>
      <h2>阿狐表情图鉴</h2>
      <span>首发 {FOX_V1_STICKERS.length} 款 · 全部可用</span>
    </div>
    <p className={styles.lead}>点选查看表情，可在头像选择或聊天中使用，无需累计登录天数。</p>
    <div className={styles.preview}>
      <img src={foxV1StickerUrl(preview)} alt={preview.name} width="512" height="512" />
      <div><b>{preview.name}</b><p role="status">{preview.caption}</p></div>
    </div>

    <ul className={styles.grid} aria-label="狐狸表情">
      {FOX_V1_STICKERS.map((sticker) => {
        const active = selected === sticker.id
        return <li key={sticker.id}>
          <button type="button" className={`${styles.cell} ${active ? styles.cellNow : ''}`} onClick={() => setSelected(sticker.id)} aria-label={`查看${sticker.name}`} aria-pressed={active}>
            <img className={styles.face} src={foxV1StickerUrl(sticker)} alt="" width="512" height="512" loading="lazy" />
            <span className={styles.name}>{sticker.name}</span>
          </button>
        </li>
      })}
    </ul>

    <button type="button" className={styles.close} onClick={(event) => event.currentTarget.closest('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }))}>
      收起图鉴
    </button>
  </DialogLayer>
}
