import {
  chooseFontFamily,
  FONT_CHOICES,
  getFontLoadState,
  retryFontDownload,
  useFontFamilyPref,
  useFontLoadVersion,
} from '../../lib/font-pref'
import styles from './FontLibrarySettings.module.css'

const SAMPLE = 'OHU 哦狐校园 · 高等数学 08:00—09:35'

/** 字体库：全部皮肤可用的手写/阅读字面自选；字库按需下载，默认不占用安装包。 */
export function FontLibrarySettings() {
  const pref = useFontFamilyPref()
  useFontLoadVersion()
  return (
    <section className={styles.panel} aria-label="字体库">
      <h3>字体库</h3>
      <p>全部皮肤可用。字库不随安装包分发，选中后按需下载并缓存在本机，之后可离线使用；数字与时间始终保持系统字体。可随时恢复默认。</p>
      <div className={styles.choices}>
        {FONT_CHOICES.map((choice) => {
          const state = getFontLoadState(choice.id)
          const selected = pref === choice.id
          const stateText = selected
            ? state === 'loading' ? '正在下载字体…' : state === 'failed' ? '下载失败，点此重试' : '使用中'
            : choice.id === 'default' ? '恢复默认字体' : `切换到${choice.title}${choice.size ? ` · 需下载 ${choice.size}` : ''}`
          return (
            <button
              key={choice.id}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                if (selected && state === 'failed') { retryFontDownload(choice.id); return }
                chooseFontFamily(choice.id)
              }}
            >
              <strong>{choice.title}</strong>
              <small>{choice.description}</small>
              <span className={styles.sample} style={choice.family ? { fontFamily: choice.family } : undefined}>
                {SAMPLE}
              </span>
              <span className={styles.state}>{stateText}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}