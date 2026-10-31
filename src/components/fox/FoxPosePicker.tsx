import { FOX_V1_STICKERS, foxV1StickerUrl, type FoxV1StickerId } from '../../lib/fox-v1-assets'
import styles from './FoxPosePicker.module.css'

export function FoxPosePicker({ disabled, onChoose }: { disabled?: boolean; onChoose: (id: FoxV1StickerId) => void }) {
  return <div className={styles.picker}>
    <p>或选一张阿狐表情作头像 · 首发 {FOX_V1_STICKERS.length} 款均可选</p>
    <div className={styles.grid} role="group" aria-label="阿狐头像">
      {FOX_V1_STICKERS.map((sticker) => <button key={sticker.id} type="button" disabled={disabled} onClick={() => onChoose(sticker.id)} aria-label={`选择${sticker.name}作头像`} title={sticker.caption}>
        <img src={foxV1StickerUrl(sticker)} alt="" width="512" height="512" loading="lazy" />
      </button>)}
    </div>
  </div>
}
