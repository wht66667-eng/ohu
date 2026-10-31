import { useState } from 'react'
import { chooseUiVariant, useUiVariant } from '../../lib/ui-variant'
import styles from './UiThemeSettings.module.css'

export function UiThemeSettings() {
  const variant = useUiVariant()
  const [message, setMessage] = useState('')
  function choose(next: 'classic' | 'pure') {
    try {
      chooseUiVariant(next)
      setMessage(next === 'classic' ? '已切换为经典版' : '已切换为简单版')
    } catch (error) { setMessage((error as Error).message) }
  }
  return <section className={styles.panel} aria-label="界面版本">
    <h3>界面版本</h3>
    <p>仅保留经典版与简单版，两版功能相同；简单版减少品牌装饰，让服务入口更紧凑。</p>
    <div className={styles.choices}>
      <div className={styles.option}><button type="button" aria-pressed={variant === 'classic'} onClick={() => choose('classic')}><span className={`${styles.preview} ${styles.classic}`} aria-hidden="true"><i /><i /><i /></span><strong>经典版</strong><small>保留哦狐插画、校园配色与原有布局</small><span className={styles.state}>{variant === 'classic' ? '使用中' : '切换到经典版'}</span></button></div>
      <div className={styles.option}><button type="button" aria-pressed={variant === 'pure'} onClick={() => choose('pure')}><span className={`${styles.preview} ${styles.pure}`} aria-hidden="true"><i /><i /><i /></span><strong>简单版</strong><small>隐藏品牌插画与彩色装饰；服务目录改为紧凑网格，优先显示功能</small><span className={styles.state}>{variant === 'pure' ? '使用中' : '切换到简单版'}</span></button></div>
    </div>
    <p role="status" className={styles.message}>{message}</p>
  </section>
}
