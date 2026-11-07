import { useState } from 'react'
import { chooseUiVariant, useUiVariant } from '../../lib/ui-variant'
import { CompanionSettings } from './CompanionSettings'
import styles from './UiThemeSettings.module.css'

export function UiThemeSettings() {
  const variant = useUiVariant()
  const [message, setMessage] = useState('')
  function choose(next: 'classic' | 'pure' | 'companion') {
    try {
      chooseUiVariant(next)
      setMessage(next === 'classic' ? '已切换为经典版' : next === 'pure' ? '已切换为简单版' : '已切换为微绿版')
    } catch (error) { setMessage((error as Error).message) }
  }
  return <section className={styles.panel} aria-label="界面版本">
    <h3>界面版本</h3>
    <p>默认微绿版，界面不含狐狸插画；选择经典版后，阿狐插画才会出现。右下角陪伴宠物三种皮肤都会显示，都可换成自定义图片。</p>
    <div className={styles.choices}>
      <div className={styles.option}><button type="button" aria-pressed={variant === 'classic'} onClick={() => choose('classic')}><span className={`${styles.preview} ${styles.classic}`} aria-hidden="true"><i /><i /><i /></span><strong>经典版</strong><small>保留哦狐插画、校园配色与原有布局</small><span className={styles.state}>{variant === 'classic' ? '使用中' : '切换到经典版'}</span></button></div>
      <div className={styles.option}><button type="button" aria-pressed={variant === 'companion'} onClick={() => choose('companion')}><span className={`${styles.preview} ${styles.pure}`} aria-hidden="true"><i /><i /><i /></span><strong>微绿版 · 默认</strong><small>纯白背景、绿色图标与操作，突出功能与内容，无狐狸插画</small><span className={styles.state}>{variant === 'companion' ? '使用中' : '切换到微绿版'}</span></button></div>
      <div className={styles.option}><button type="button" aria-pressed={variant === 'pure'} onClick={() => choose('pure')}><span className={`${styles.preview} ${styles.simple}`} aria-hidden="true"><i /><i /><i /></span><strong>简单版</strong><small>中性灰度，优先显示功能，可自行收起陪伴</small><span className={styles.state}>{variant === 'pure' ? '使用中' : '切换到简单版'}</span></button></div>
    </div>
    <p role="status" className={styles.message}>{message}</p><CompanionSettings />
  </section>
}
