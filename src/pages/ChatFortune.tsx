import { useEffect, useState } from 'react'
import { birthDateInfo, localDateKey, type FortunePreferences } from '../lib/chat-fortune'
import { CHINESE_ZODIAC, WESTERN_ZODIAC, dailyFortunePrompt } from '../plugins/builtin/fortune-cards'
import { FortuneIllustration } from '../plugins/builtin/FortuneIllustration'
import styles from './ChatPage.module.css'

export function FortuneSettings({ preferences, onSave, onClose }: {
  preferences: FortunePreferences
  onSave: (next: FortunePreferences) => boolean
  onClose: () => void
}) {
  const [draft, setDraft] = useState(preferences)
  const [error, setError] = useState('')
  const birth = birthDateInfo(draft.birthday)

  return <form className={styles.fortuneSettings} onSubmit={event => {
    event.preventDefault()
    if (draft.birthday && !birth) { setError('请选择有效的公历生日。'); return }
    if (!onSave(draft)) { setError('暂时无法保存，请检查本机存储后重试。'); return }
    onClose()
  }}>
    <h2>每日解读设置</h2>
    <p>生日和开关只保存在本机。每日解读在聊天里显示，不推送通知。</p>
    <label className={styles.fortuneDate}>公历生日<input type="date" max={localDateKey()} value={draft.birthday}
      onChange={event => { setError(''); setDraft(current => ({ ...current, birthday: event.target.value })) }} /></label>
    {draft.birthday ? <button className={styles.clearBirth} type="button" onClick={() => {
      setDraft(current => ({ ...current, birthday: '' })); setError('')
    }}>清除生日</button> : null}
    {birth ? <p>{WESTERN_ZODIAC[birth.starIndex].name}{birth.animalIndex !== null ? ` · 属${CHINESE_ZODIAC[birth.animalIndex].name}` : ' · 此设备暂无法计算生肖'}</p> : null}
    <label className={styles.fortuneToggle}><span>每日星座解读</span><input type="checkbox" role="switch" checked={draft.stars}
      onChange={event => setDraft(current => ({ ...current, stars: event.target.checked }))} /></label>
    <label className={styles.fortuneToggle}><span>每日生肖解读</span><input type="checkbox" role="switch" checked={draft.animals}
      onChange={event => setDraft(current => ({ ...current, animals: event.target.checked }))} /></label>
    {(draft.stars || draft.animals) && !draft.birthday ? <p>填写生日后，已开启的解读才会出现。</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <div className={styles.confirmationActions}>
      <button type="button" onClick={onClose}>取消</button>
      <button type="submit">保存设置</button>
    </div>
  </form>
}

export function DailyFortune({ preferences }: { preferences: FortunePreferences }) {
  const [day, setDay] = useState(localDateKey)
  useEffect(() => {
    const update = () => setDay(localDateKey())
    const timer = window.setInterval(update, 30_000)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  const birth = birthDateInfo(preferences.birthday)
  if (!birth) return null
  const star = preferences.stars ? WESTERN_ZODIAC[birth.starIndex] : null
  const animal = preferences.animals && birth.animalIndex !== null ? CHINESE_ZODIAC[birth.animalIndex] : null
  if (!star && !animal) return null
  const date = new Date(`${day}T12:00:00`)

  return <section id="chat-daily-fortune" className={styles.dailyFortune} tabIndex={-1} aria-labelledby="chat-daily-title">
    <header><h2 id="chat-daily-title">每日解读</h2><time dateTime={day}>{date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</time></header>
    {star ? <article id="chat-daily-stars" tabIndex={-1} className={styles.dailyCard}>
      <FortuneIllustration series="western-zodiac" id={star.id} alt={`${star.name}插画`} previewTitle={star.name} />
      <div><h3>星座 · {star.name}</h3><p>{dailyFortunePrompt(star.number - 1, date)}</p></div>
    </article> : null}
    {animal ? <article id="chat-daily-animals" tabIndex={-1} className={styles.dailyCard}>
      <FortuneIllustration series="chinese-zodiac" id={animal.id} alt={`生肖${animal.name}插画`} previewTitle={`生肖${animal.name}`} />
      <div><h3>生肖 · {animal.name}</h3><p>{dailyFortunePrompt(animal.number, date)}</p></div>
    </article> : null}
    <small>仅供娱乐和自我反思。</small>
  </section>
}
