import { useRef, useState, type KeyboardEvent } from 'react'
import type { FortuneWorkbenchMode } from '../lib/chat-fortune'
import { ChineseZodiacReading, TarotArtworkGallery, TarotReflection, ZodiacReflection } from '../plugins/builtin/PlayfulReadings'
import styles from './today-fortune.module.css'

const readings = [
  ['stars', '十二星座', '✦'],
  ['animals', '十二生肖', '◉'],
  ['tarot', '塔罗', '◇'],
] as const
type Reading = typeof readings[number][0]

export function FortuneWorkbench({ initialReading, onClose }: { initialReading: FortuneWorkbenchMode; onClose: () => void }) {
  const [reading, setReading] = useState<Reading>(initialReading)
  const tabs = useRef<Partial<Record<Reading, HTMLButtonElement>>>({})

  function selectReading(next: Reading) {
    if (next === reading) return
    setReading(next)
    tabs.current[next]?.closest('[data-fortune-scroll]')?.scrollTo({ top: 0, behavior: 'instant' })
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number
    switch (event.key) {
      case 'ArrowLeft': nextIndex = (index + readings.length - 1) % readings.length; break
      case 'ArrowRight': nextIndex = (index + 1) % readings.length; break
      case 'Home': nextIndex = 0; break
      case 'End': nextIndex = readings.length - 1; break
      default: return
    }
    event.preventDefault()
    const [next] = readings[nextIndex]
    selectReading(next)
    tabs.current[next]?.focus({ preventScroll: true })
  }

  return <div className={styles.page} data-fortune-workbench="" data-fortune-scroll="">
    <div className={styles.navigation} data-fortune-navigation="">
      <header className={styles.chatHeader}><h2>今日天机</h2><button type="button" onClick={onClose}>返回聊天</button></header>
      <div className={styles.navigationInner}>
        <div className={styles.switcher} role="tablist" aria-label="选择卡牌系列">
          {readings.map(([id, title, mark], index) => <button
            key={id}
            ref={element => { if (element) tabs.current[id] = element; else delete tabs.current[id] }}
            id={`fortune-tab-${id}`}
            type="button"
            role="tab"
            tabIndex={reading === id ? 0 : -1}
            aria-selected={reading === id}
            aria-controls={`fortune-${id}`}
            onClick={() => selectReading(id)}
            onKeyDown={event => handleTabKey(event, index)}
          ><span aria-hidden="true" className={styles.tabMark}>{mark}</span>{title}</button>)}
        </div>
      </div>
    </div>
    <div className={styles.content}>
      <div id="fortune-stars" role="tabpanel" aria-labelledby="fortune-tab-stars" tabIndex={0} hidden={reading !== 'stars'}><ZodiacReflection enabled active={reading === 'stars'} /></div>
      <div id="fortune-animals" role="tabpanel" aria-labelledby="fortune-tab-animals" tabIndex={0} hidden={reading !== 'animals'}><ChineseZodiacReading /></div>
      <div id="fortune-tarot" role="tabpanel" aria-labelledby="fortune-tab-tarot" tabIndex={0} hidden={reading !== 'tarot'} className={styles.tarotPanel}>
        <TarotReflection enabled active={reading === 'tarot'} />
        <TarotArtworkGallery />
      </div>
    </div>
  </div>
}
