import { useEffect, useState } from 'react'
import { CampusIcon } from './CampusIcon'
import { playSound, SoundEvent } from '../lib/sound'
import { defaultSoundPreferences, getSoundPreferences, saveSoundPreferences, subscribeSoundPreferences, type SoundGroup, type SoundPreferences } from '../lib/sound-prefs'
import styles from './SoundSettings.module.css'

const GROUP_META: { group: SoundGroup; icon: string; label: string; hint: string; event: SoundEvent }[] = [
  { group: 'click', icon: 'flash', label: '按钮点击音', hint: '默认关闭，开启后只在手账翻页等特定按钮播放', event: SoundEvent.ButtonClick },
  { group: 'page', icon: 'link', label: '页面切换音', hint: '极轻柔和的气流声', event: SoundEvent.PageSwitch },
  { group: 'success', icon: 'heart', label: '成功提示音', hint: '清脆温暖的双音铃', event: SoundEvent.Success },
  { group: 'task', icon: 'task', label: '任务完成音', hint: '待办勾选、专注完成时轻快上行', event: SoundEvent.TaskComplete },
  { group: 'fox', icon: 'paw', label: '狐狸互动音', hint: '摸摸阿狐时的可爱短音，随机不重复', event: SoundEvent.FoxHappy },
  { group: 'notify', icon: 'bell', label: '通知提示音', hint: '系统通知的铃声震动由手机管理，这里不重复叠加', event: SoundEvent.Notification },
  { group: 'achieve', icon: 'flag', label: '成就提示音', hint: '连续打卡里程碑的仪式感和弦', event: SoundEvent.Achievement },
]

/** 声音与反馈：全部偏好只存本机；试听绕过开关与免打扰，但仍跟随音量。 */
export function SoundSettings() {
  const [prefs, setPrefs] = useState(getSoundPreferences)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => subscribeSoundPreferences(() => setPrefs(getSoundPreferences())), [])
  function update(patch: Partial<SoundPreferences>) {
    try { saveSoundPreferences({ ...getSoundPreferences(), ...patch }); setError(''); setMessage('') }
    catch { setError('声音设置暂未保存，本次仍会生效') }
  }
  function toggleGroup(group: SoundGroup) {
    update({ events: { ...prefs.events, [group]: !prefs.events[group] } })
  }
  const preview = (event: SoundEvent) => playSound(event, { preview: true })
  const switchRow = (label: string, checked: boolean, onToggle: () => void, hint?: string, icon = 'sound') => (
    <div className={styles.row}>
      <span className={styles.icon}><CampusIcon name={icon} size={22} /></span>
      <span><strong>{label}</strong>{hint ? <small>{hint}</small> : null}</span>
      <button type="button" className={styles.switch} role="switch" aria-label={label} aria-checked={checked} onClick={onToggle}>{checked ? '开' : '关'}</button>
    </div>
  )
  return <div className={styles.panel}>
    <h3>声音与反馈</h3>
    <fieldset className={styles.group}><legend>总开关与音量</legend>
      {switchRow('声音总开关', prefs.master, () => update({ master: !prefs.master }), '关闭后所有提示音与背景音乐立即停止')}
      <div className={styles.row}>
        <span className={styles.icon}><CampusIcon name="sound" size={22} /></span>
        <span><strong>音量</strong><small>默认 35%，轻柔不打扰；跟随系统媒体音量</small></span>
        <span className={styles.volume}>
          <input type="range" min={0} max={100} step={5} value={Math.round(prefs.volume * 100)} aria-label="音量" data-click-sound="off"
            onChange={(event) => update({ volume: Number(event.target.value) / 100 })} />
          <b>{Math.round(prefs.volume * 100)}%</b>
        </span>
      </div>
    </fieldset>
    <fieldset className={styles.group}><legend>提示音</legend>
      <p>按钮音和页面切换音默认关闭，其他提示音可单独调整；点「试听」不受开关与免打扰影响。</p>
      {GROUP_META.map(({ group, icon, label, hint, event }) => (
        <div className={styles.row} key={group}>
          <span className={styles.icon}><CampusIcon name={icon} size={22} /></span>
          <span><strong>{label}</strong><small>{hint}</small></span>
          <button type="button" className={styles.preview} data-click-sound="off" aria-label={`试听${label}`} onClick={() => preview(event)}>试听</button>
          <button type="button" className={styles.switch} role="switch" aria-label={label} aria-checked={prefs.events[group]} onClick={() => toggleGroup(group)}>{prefs.events[group] ? '开' : '关'}</button>
        </div>
      ))}
      <div className={styles.foxPreviews} role="group" aria-label="狐狸声音试听">
        <span>阿狐的声音：</span>
        <button type="button" data-click-sound="off" onClick={() => preview(SoundEvent.FoxHappy)}>开心</button>
        <button type="button" data-click-sound="off" onClick={() => preview(SoundEvent.FoxSleep)}>入睡</button>
        <button type="button" data-click-sound="off" onClick={() => preview(SoundEvent.FoxWake)}>醒来</button>
      </div>
    </fieldset>
    <fieldset className={styles.group}><legend>免打扰时段</legend>
      <p>时段内所有声音静音，阿狐夜间也自动安静；支持跨午夜。</p>
      {switchRow('免打扰', prefs.quietEnabled, () => update({ quietEnabled: !prefs.quietEnabled }), `每天 ${prefs.quietStart}–${prefs.quietEnd}`, 'moon')}
      <div className={styles.quietTimes}>
        <label>开始<input type="time" value={prefs.quietStart} aria-label="免打扰开始时间" onChange={(event) => { if (event.target.value) update({ quietStart: event.target.value }) }} /></label>
        <label>结束<input type="time" value={prefs.quietEnd} aria-label="免打扰结束时间" onChange={(event) => { if (event.target.value) update({ quietEnd: event.target.value }) }} /></label>
      </div>
    </fieldset>
    <fieldset className={styles.group}><legend>App 背景音乐</legend>
      {switchRow('背景音乐', prefs.bgm, () => update({ bgm: !prefs.bgm }), '轻柔环境音垫，默认关闭；官网品牌音乐不会自动带入 App', 'chat')}
    </fieldset>
    <div className={styles.buttons}>
      <button type="button" onClick={() => { try { saveSoundPreferences(defaultSoundPreferences()); setError(''); setMessage('已恢复默认声音设置') } catch { setError('恢复默认未保存，请重试') } }}>恢复默认设置</button>
    </div>
    {error ? <p className={styles.error} role="alert">{error}</p> : message ? <p className={styles.feedback} role="status">{message}</p> : null}
    <p className={styles.note}>全部音效为哦狐原创合成，随 App 离线打包，不加载网络音频。专注沉浸期间自动静音；系统通知的声音与震动仍由手机系统管理，不会重复发声。</p>
  </div>
}